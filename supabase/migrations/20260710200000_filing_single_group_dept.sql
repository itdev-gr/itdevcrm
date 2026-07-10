-- 2026-07-10: uncoded dept rule v5 — a staff party in exactly ONE group (and
-- not sales/accounting) tags that group's department; e.g. pefstathiadis
-- (web_seo-only) work mail lands in Technical, not Sales. Owner-approved with
-- retag of existing rows (preview: 111 local_seo + 102 web_seo).
-- Base body: 20260710171000_filing_registry_dept.sql (v4, drift-checked clean).
-- ROLLBACK: re-apply the v4 body from that file; retag-undo:
--   update email_messages set department='sales'
--    where department in (select code from groups where code not in ('sales','accounting'))
--      and job_id is null and lead_id is null and staff_user_id is not null
--      and department <> 'support';  -- (support rows come from the registry, keep)

create or replace function public.resolve_email_filing(p_from text, p_to text, p_subject text)
returns table (client_id uuid, deal_id uuid, job_id uuid, lead_id uuid, department text, staff_user_id uuid, direction text)
language plpgsql security definer set search_path = public stable
as $$
declare
  v_from text := lower(trim(coalesce(p_from,'')));
  v_to   text := lower(trim(coalesce(p_to,'')));
  v_from_staff boolean := exists (select 1 from profiles where lower(email)=v_from);
  v_to_staff   boolean := exists (select 1 from profiles where lower(email)=v_to);
  v_staff_email text; v_client_email text; v_dir text;
  v_staff uuid; v_client uuid; v_dept text; v_deal uuid; v_job uuid; v_lead uuid; v_code text;
begin
  -- Exactly one side must be staff (a client<->staff email). Skip internal
  -- staff-to-staff and mail with no staff party at all.
  if v_from_staff and v_to_staff then return; end if;
  if v_from_staff then
    v_staff_email:=v_from; v_client_email:=v_to; v_dir:='outbound';
  elsif v_to_staff then
    v_staff_email:=v_to; v_client_email:=v_from; v_dir:='inbound';
  else
    return;  -- no staff party
  end if;

  select user_id into v_staff from profiles where lower(email)=v_staff_email limit 1;

  -- Code is authoritative: a job code in the subject files the email on that
  -- job + deal and derives the client from the deal.
  v_code := substring(coalesce(p_subject,'') from '(\d{6}-[A-Z]{3,})');
  if v_code is not null then
    select j.id, j.deal_id, d.client_id, j.service_type
      into v_job, v_deal, v_client, v_dept
      from jobs j join deals d on d.id = j.deal_id
     where j.code = v_code limit 1;
  end if;

  if v_client is null then
    select id into v_client from clients where lower(email)=v_client_email limit 1;
    if v_client is not null then
      select d.id into v_deal from deals d
        where d.client_id=v_client and d.archived=false
        order by d.created_at desc limit 1;
      -- Uncoded client mail: a shared company mailbox has a fixed department
      -- (registry); a person tags by their groups (sales > accounting > sales).
      -- (alias required: the fn's return table declares a `department` OUT
      -- column, which PL/pgSQL would otherwise resolve ambiguously)
      select sm.department into v_dept from shared_mailboxes sm where sm.user_id = v_staff;
      if v_dept is null then
        if exists (select 1 from user_groups ug join groups g on g.id = ug.group_id
                    where ug.user_id = v_staff and g.code = 'sales') then
          v_dept := 'sales';
        elsif exists (select 1 from user_groups ug join groups g on g.id = ug.group_id
                       where ug.user_id = v_staff and g.code = 'accounting') then
          v_dept := 'accounting';
        else
          -- Exactly one group (non-sales/accounting) => that group's dept
          -- (owner-approved 07-10: e.g. a web_seo-only person's uncoded work
          -- mail is Technical, not Sales). Multi-group/group-less => sales.
          select min(g.code) into v_dept
            from user_groups ug join groups g on g.id = ug.group_id
           where ug.user_id = v_staff
          having count(*) = 1;
          v_dept := coalesce(v_dept, 'sales');
        end if;
      end if;
    else
      -- NEW: prospect mail files on the newest open lead with that address.
      -- Client match keeps precedence (existing-customer resubmission case).
      select l.id into v_lead from leads l
        where lower(l.email) = v_client_email
          and l.converted_at is null and l.archived = false
        order by l.created_at desc limit 1;
      if v_lead is null then return; end if;  -- unknown party => skip (privacy)
      v_dept := 'sales';  -- lead emails are always Sales
    end if;
  end if;

  -- Keep department only if it maps to a real team group.
  if v_dept is not null and not exists (select 1 from groups g where g.code = v_dept) then
    v_dept := null;
  end if;

  return query select v_client, v_deal, v_job, v_lead, v_dept, v_staff, v_dir;
end $$;

-- One-off retag matching the new rule.
update public.email_messages em set department = s.only_group
  from (select ug.user_id, min(g.code) as only_group
          from public.user_groups ug join public.groups g on g.id = ug.group_id
         group by ug.user_id
        having count(*) = 1 and bool_and(g.code not in ('sales','accounting'))) s
 where em.staff_user_id = s.user_id
   and em.department = 'sales' and em.job_id is null and em.lead_id is null;
