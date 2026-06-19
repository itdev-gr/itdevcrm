-- Fix three issues found in the 2026-06-19 accounting↔jobs smoke test:
--
--  BUG 1 (HIGH): A deal closed via close_deal kept generating recurring invoices
--    and was dragged back from "Closed" to "On Hold" by the overdue cron, because
--    the 'closed' accounting stage was NOT marked terminal and close_deal does not
--    set accounting_completed_at. Fix: mark 'closed' terminal, exclude 'closed' from
--    the recurring-billing cron, and exclude it explicitly from the overdue mover.
--
--  BUG 2 (MED-HIGH): end_job sets jobs.billing_active=false, but the live v1
--    recurring cron read only deal_payments and ignored billing_active, so ending a
--    job never stopped its invoices. Fix: ensure_recurring_payments now honors
--    billing_active (keeps billing when no job exists, stops when all matching jobs
--    are ended). NOTE: this does NOT swap to v2 — amounts are still copied forward
--    from deal_payments, so the €0-amount recurring jobs are unaffected.
--
--  BUG 3 (MED): email_notify_new_job queued internal "new job" emails regardless of
--    the email_automation_enabled('internal_new_job') toggle (unlike lead emails).
--    Fix: gate it on the toggle.
--
-- Product note: BUG 1 treats "Closed" as the end of the engagement (recurring billing
-- stops). Ongoing recurring clients are expected to stay in "Paid in full". If a
-- closed deal should keep billing, drop the `<> 'closed'` clause in
-- ensure_recurring_payments (see ROLLBACK at bottom).

-- ── BUG 1: make 'closed' a terminal accounting stage ──────────────────────────
update public.pipeline_stages
   set is_terminal = true
 where board = 'accounting_onboarding' and code = 'closed';

-- ── BUG 1 + BUG 2: recurring billing respects 'closed' and billing_active ─────
create or replace function public.ensure_recurring_payments()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record; next_start date; next_end date; created int := 0; v_payment_id uuid;
begin
  for r in
    select dp.*
      from public.deal_payments dp
      join public.deals d on d.id = dp.deal_id
     where dp.billing_type in ('recurring_monthly','recurring_yearly')
       and dp.end_date is not null
       and dp.end_date <= current_date + interval '7 days'
       and d.archived = false
       -- BUG 1: a closed engagement stops generating new invoices
       and coalesce((select ps.code from public.pipeline_stages ps
                      where ps.id = d.accounting_stage_id), '') <> 'closed'
       -- BUG 2: honor end_job / billing_active. Keep billing when no matching job
       -- exists (legacy data); stop when every matching job has been ended.
       and (
            not exists (select 1 from public.jobs j
                         where j.deal_id = dp.deal_id and j.service_type = dp.service_type
                           and not j.archived)
         or exists (select 1 from public.jobs j
                         where j.deal_id = dp.deal_id and j.service_type = dp.service_type
                           and not j.archived and j.billing_active)
       )
       and not exists (
         select 1 from public.deal_payments dp2
          where dp2.deal_id = dp.deal_id
            and dp2.service_index = dp.service_index
            and dp2.start_date >= dp.end_date
       )
  loop
    next_start := r.end_date;
    if r.billing_type = 'recurring_monthly' then
      next_end := next_start + interval '1 month';
    else
      next_end := next_start + interval '1 year';
    end if;

    insert into public.deal_payments
      (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, end_date)
      values (r.deal_id, r.service_type, r.service_index, r.billing_type, r.amount_net, r.vat_rate, next_start, next_end)
      returning id into v_payment_id;

    insert into public.deal_payment_lines (payment_id, job_id, label, amount_net, vat_rate)
      values (v_payment_id,
        (select j.id from public.jobs j
          where j.deal_id = r.deal_id and j.service_type = r.service_type and not j.archived
          order by j.created_at limit 1),
        coalesce(r.label, r.service_type), r.amount_net, r.vat_rate);

    created := created + 1;
  end loop;
  return created;
end $function$;

-- ── BUG 1: never drag a closed deal back to On Hold ───────────────────────────
create or replace function public.move_overdue_deals_to_on_hold()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  on_hold_id uuid;
  moved int := 0;
begin
  select id into on_hold_id
    from public.pipeline_stages
   where board = 'accounting_onboarding' and code = 'on_hold'
   limit 1;
  if on_hold_id is null then
    return 0;
  end if;

  with overdue_deals as (
    select distinct dp.deal_id
      from public.deal_payments dp
     where dp.billing_type in ('one_time','recurring_monthly','recurring_yearly')
       and dp.status = 'pending'
       and dp.end_date is not null
       and dp.end_date <= current_date
  )
  update public.deals d
     set accounting_stage_id = on_hold_id
    from overdue_deals od
   where d.id = od.deal_id
     and d.accounting_completed_at is null
     and d.accounting_stage_id is not null
     and d.accounting_stage_id <> on_hold_id
     and not exists (
       select 1 from public.pipeline_stages ps
        where ps.id = d.accounting_stage_id
          and (ps.is_terminal = true or ps.code = 'closed')  -- BUG 1: never re-hold a closed deal
     );
  get diagnostics moved = row_count;
  return moved;
end $function$;

-- ── BUG 3: internal new-job email respects the automation toggle ──────────────
create or replace function public.email_notify_new_job()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare m record; client_name text;
begin
  if new.assigned_group_id is null then return new; end if;
  -- BUG 3: honor the email automation toggle, like lead emails do
  if not public.email_automation_enabled('internal_new_job') then return new; end if;
  select name into client_name from public.clients where id = new.client_id;
  for m in
    select p.email
      from public.user_groups ug
      join public.profiles p on p.user_id = ug.user_id
     where ug.group_id = new.assigned_group_id
       and p.email is not null and p.email <> ''
  loop
    insert into public.email_outbox (identity, to_email, template_key, data, dedupe_key)
    values ('internal', m.email, 'internal_new_job',
            jsonb_build_object('service_type', new.service_type, 'client_name', client_name, 'deal_id', new.deal_id),
            'job:' || new.id || ':' || m.email);
  end loop;
  return new;
end $function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- CHANGES / REVERT
--   1. pipeline_stages('closed').is_terminal  false → true
--   2. ensure_recurring_payments()   + 'closed' exclusion + billing_active guard
--   3. move_overdue_deals_to_on_hold() + 'closed' exclusion
--   4. email_notify_new_job()        + automation toggle guard
--
-- ROLLBACK (restores pre-migration behavior):
--   update public.pipeline_stages set is_terminal = false
--     where board='accounting_onboarding' and code='closed';
--   -- then re-apply the prior bodies of ensure_recurring_payments(),
--   -- move_overdue_deals_to_on_hold(), email_notify_new_job() from
--   -- migrations 20260617000015, 20260503000019, and the new-job email migration.
-- ─────────────────────────────────────────────────────────────────────────────
