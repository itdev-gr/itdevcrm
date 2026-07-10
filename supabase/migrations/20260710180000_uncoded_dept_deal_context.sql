-- 2026-07-10: resolve_email_filing v5 — deal-context department for uncoded
-- client mail from technical staff (owner-approved 2026-07-10).
--
-- Problem: uncoded mail tags by the staff party's groups (sales > accounting >
-- sales), so a multi-group person like mkifokeris (accounting + 4 technical
-- groups) always lands in Accounting even when the deal is pure web_dev
-- (observed on the TEST client, message a8ab0781, subject "test").
--
-- Rule: for a PERSON (not a shared mailbox) who is in at least one technical
-- group (any group other than sales/accounting) and is not in sales, if the
-- filed deal's jobs (excluding AI-SEO children, parent_job_id is null) all
-- share ONE service_type that maps to a real group, tag that service.
-- Otherwise fall back to the existing sales > accounting > sales rule.
-- Pure accounting staff (e.g. emarketaki) and sales reps are unaffected,
-- preserving both 07-10 morning decisions (accounting retag + sales-first).
--
-- Base body: v4 from 20260710171000_filing_registry_dept.sql.
-- NOTE for the parallel controller session: if v4 changes again, re-base this
-- body before applying.
--
-- Same signature => create or replace (grants preserved).
-- ROLLBACK:
--   re-apply the v4 body verbatim from 20260710171000_filing_registry_dept.sql;
--   update public.email_messages em set department = b.department
--     from public.email_dept_retag_backup_20260710 b where b.id = em.id;
--   drop table public.email_dept_retag_backup_20260710;

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
  v_svc text;
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
      -- (registry); a person tags by their groups, with deal context breaking
      -- the tie for technical staff (v5).
      -- (alias required: the fn's return table declares a `department` OUT
      -- column, which PL/pgSQL would otherwise resolve ambiguously)
      select sm.department into v_dept from shared_mailboxes sm where sm.user_id = v_staff;
      if v_dept is null then
        if exists (select 1 from user_groups ug join groups g on g.id = ug.group_id
                    where ug.user_id = v_staff and g.code = 'sales') then
          v_dept := 'sales';
        else
          -- Deal-context rule: technical-hat staff + single-service deal =>
          -- that service's department.
          if v_deal is not null and exists (
               select 1 from user_groups ug join groups g on g.id = ug.group_id
                where ug.user_id = v_staff and g.code not in ('sales','accounting')) then
            select min(j.service_type) into v_svc
              from jobs j
             where j.deal_id = v_deal and j.parent_job_id is null
            having count(distinct j.service_type) = 1;
            if v_svc is not null
               and exists (select 1 from groups g where g.code = v_svc) then
              v_dept := v_svc;
            end if;
          end if;
          if v_dept is null then
            if exists (select 1 from user_groups ug join groups g on g.id = ug.group_id
                        where ug.user_id = v_staff and g.code = 'accounting') then
              v_dept := 'accounting';
            else
              v_dept := 'sales';
            end if;
          end if;
        end if;
      end if;
    else
      -- Prospect mail files on the newest open lead with that address.
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

-- One-off retag under the same gating (backup first for rollback).
create table if not exists public.email_dept_retag_backup_20260710 as
select em.id, em.department
  from public.email_messages em
  join (select j.deal_id, min(j.service_type) as svc
          from public.jobs j
         where j.parent_job_id is null
         group by j.deal_id
        having count(distinct j.service_type) = 1) s on s.deal_id = em.deal_id
 where em.job_id is null and em.lead_id is null
   and em.department is distinct from s.svc
   and exists (select 1 from public.groups g where g.code = s.svc)
   and not exists (select 1 from public.shared_mailboxes sm
                    where sm.user_id = em.staff_user_id)
   and not exists (select 1 from public.user_groups ug
                     join public.groups g on g.id = ug.group_id
                    where ug.user_id = em.staff_user_id and g.code = 'sales')
   and exists (select 1 from public.user_groups ug
                 join public.groups g on g.id = ug.group_id
                where ug.user_id = em.staff_user_id
                  and g.code not in ('sales','accounting'));

update public.email_messages em
   set department = s.svc
  from (select j.deal_id, min(j.service_type) as svc
          from public.jobs j
         where j.parent_job_id is null
         group by j.deal_id
        having count(distinct j.service_type) = 1) s
 where s.deal_id = em.deal_id
   and em.id in (select id from public.email_dept_retag_backup_20260710);
