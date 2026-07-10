-- 2026-07-10: capture sales<->prospect email on the lead + Accounting dept rule.
-- Spec: docs/superpowers/specs/2026-07-10-lead-emails-3-categories-design.md

-- 1. Where a lead email is filed before conversion.
alter table public.email_messages add column if not exists lead_id uuid references public.leads(id);
create index if not exists email_messages_lead_idx on public.email_messages(lead_id) where lead_id is not null;

-- 2. resolve_email_filing v3: return type changes (adds lead_id) => drop + recreate.
drop function if exists public.resolve_email_filing(text,text,text);
create function public.resolve_email_filing(p_from text, p_to text, p_subject text)
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
      -- Uncoded client mail: department from the staff party's groups
      -- (owner-approved 07-10). sales wins over accounting; neither => sales.
      if exists (select 1 from user_groups ug join groups g on g.id = ug.group_id
                  where ug.user_id = v_staff and g.code = 'sales') then
        v_dept := 'sales';
      elsif exists (select 1 from user_groups ug join groups g on g.id = ug.group_id
                     where ug.user_id = v_staff and g.code = 'accounting') then
        v_dept := 'accounting';
      else
        v_dept := 'sales';
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

-- Recreate closes the old grants; built-in PUBLIC execute default must be
-- cancelled explicitly (grant-boundary rule).
revoke execute on function public.resolve_email_filing(text,text,text) from public, anon, authenticated;
grant execute on function public.resolve_email_filing(text,text,text) to service_role;

-- 3. RLS: lead-only emails must NOT leak across reps (leads are own-only).
drop policy if exists email_messages_select on public.email_messages;
create policy email_messages_select on public.email_messages for select using (
  staff_user_id = auth.uid()
  or (
    case when lead_id is not null and client_id is null then
      public.current_user_is_admin()
      or exists (select 1 from public.leads l
                  where l.id = email_messages.lead_id and l.owner_user_id = auth.uid())
    else public.current_user_can(department, 'view')
    end
  )
);

-- 4. One-off retag (owner-approved): uncoded rows whose staff party is in
-- accounting and not in sales become Accounting. Lead rows excluded by rule.
update public.email_messages em
   set department = 'accounting'
 where em.department = 'sales' and em.job_id is null and em.lead_id is null
   and exists (select 1 from public.user_groups ug join public.groups g on g.id = ug.group_id
                where ug.user_id = em.staff_user_id and g.code = 'accounting')
   and not exists (select 1 from public.user_groups ug join public.groups g on g.id = ug.group_id
                    where ug.user_id = em.staff_user_id and g.code = 'sales');

notify pgrst, 'reload schema';

-- ROLLBACK:
--   update public.email_messages set department='sales'
--     where department='accounting' and job_id is null and lead_id is null;
--   (restore policy + fn v2 from 20260709175000_email_messages.sql /
--    20260709170100_resolve_email_filing.sql)
--   alter table public.email_messages drop column if exists lead_id;
