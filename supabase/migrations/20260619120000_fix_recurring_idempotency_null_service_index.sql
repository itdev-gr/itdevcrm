-- HOTFIX: ensure_recurring_payments generated unbounded duplicate recurring
-- payments for any deal whose deal_payments have a NULL service_index (which the
-- ClickUp reseed/import creates). The "does a successor already exist?" guard used
--   dp2.service_index = dp.service_index
-- but `NULL = NULL` is NULL (never TRUE) in SQL, so the guard never matched its own
-- successors and a new row was created on EVERY cron run — and the cron is invoked
-- on every accounting-board mount (useAccountingKanbanRealtime). One deal had 12+
-- identical 21/06→21/07 rows; 5 deals / 38 excess rows total.
--
-- Fix: make the idempotency guard NULL-safe (is not distinct from) and distinguish
-- distinct billing series by service_type + amount_net so two different recurring
-- services on one deal still each roll forward. Keeps the 20260619110000 guards
-- ('closed' exclusion + billing_active). (Upstream, the reseed should also populate
-- service_index/service_type — but the function is now robust regardless.)

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
       and coalesce((select ps.code from public.pipeline_stages ps
                      where ps.id = d.accounting_stage_id), '') <> 'closed'
       and (
            not exists (select 1 from public.jobs j
                         where j.deal_id = dp.deal_id and j.service_type = dp.service_type
                           and not j.archived)
         or exists (select 1 from public.jobs j
                         where j.deal_id = dp.deal_id and j.service_type = dp.service_type
                           and not j.archived and j.billing_active)
       )
       -- NULL-safe idempotency: a successor exists if any later-period row matches
       -- this billing series (NULL-safe on index/type/amount).
       and not exists (
         select 1 from public.deal_payments dp2
          where dp2.deal_id      =  dp.deal_id
            and dp2.billing_type  =  dp.billing_type
            and dp2.service_index is not distinct from dp.service_index
            and dp2.service_type  is not distinct from dp.service_type
            and dp2.amount_net    is not distinct from dp.amount_net
            and dp2.start_date   >= dp.end_date
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

-- CHANGES / REVERT: only the idempotency `not exists (...)` clause changed vs
-- migration 20260619110000. To revert, re-apply the 20260619110000 body (which used
-- `dp2.service_index = dp.service_index`) — but that reintroduces the duplication bug.
