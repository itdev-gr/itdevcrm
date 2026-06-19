-- Correct the recurring-payment idempotency (regression from 20260619120000) and
-- make the cron race-safe.
--
-- 20260619120000 matched the "successor already exists?" guard on
-- service_index + service_type + amount_net. But the reseed inserts the ORIGINAL
-- period with service_type NULL (job not yet present), while the deal_payments
-- BEFORE INSERT trigger DERIVES service_type on the generated successors — so a
-- NULL-type original never matched its typed successors and the cron duplicated on
-- every run. service_index is now reliably assigned per series, so match on that
-- alone (NULL-safe). Also: the cron runs from the daily job AND (until the frontend
-- redeploys) on every accounting-board mount, so two runs can race; take a
-- transaction advisory lock so invocations serialize.

create or replace function public.ensure_recurring_payments()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record; next_start date; next_end date; created int := 0; v_payment_id uuid;
begin
  -- serialize concurrent invocations to avoid duplicate generation under races
  perform pg_advisory_xact_lock(hashtext('ensure_recurring_payments')::bigint);

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
       -- idempotency: identify the billing series by service_index only (NULL-safe).
       and not exists (
         select 1 from public.deal_payments dp2
          where dp2.deal_id = dp.deal_id
            and dp2.billing_type = dp.billing_type
            and dp2.service_index is not distinct from dp.service_index
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

-- CHANGES / REVERT: idempotency guard now matches service_index only (was
-- service_index+service_type+amount_net in 20260619120000); added an advisory lock.
-- Revert by re-applying the 20260619120000 body (reintroduces the duplication).
