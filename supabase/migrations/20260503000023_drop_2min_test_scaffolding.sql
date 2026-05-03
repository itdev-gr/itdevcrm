-- =============================================================================
-- Drop the temporary 2-minute test scaffolding now that the user has visually
-- confirmed the renewal cron works. Inverse of migrations 14 (kept), 15
-- (test branch + next_due_at column + recurring_test_2min CHECK + every-min cron),
-- and 16 (re-scheduled both crons).
--
-- After this migration:
--   - daily_ensure_recurring_payments cron stays in place (the real fix).
--   - every_minute_ensure_recurring_payments cron is gone.
--   - ensure_recurring_payments() returns to the original two-loop logic
--     (monthly + yearly) — no recurring_test_2min branch.
--   - deal_payments has no next_due_at column.
--   - deal_payments.billing_type CHECK no longer includes recurring_test_2min.
-- =============================================================================

-- 1. Unschedule the every-minute cron (no-op if pg_cron unavailable / job missing)
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'every_minute_ensure_recurring_payments') then
      perform cron.unschedule('every_minute_ensure_recurring_payments');
    end if;
  end if;
end $$;

-- 2. Delete every test row (also makes the CHECK rewrite below safe)
delete from public.deal_payments where billing_type = 'recurring_test_2min';

-- 3. Restore the original ensure_recurring_payments() — production cadence only
create or replace function public.ensure_recurring_payments()
returns int
language plpgsql security definer set search_path = public as $$
declare
  r record;
  next_start date;
  next_end date;
  created int := 0;
begin
  for r in
    select dp.*
      from public.deal_payments dp
      join public.deals d on d.id = dp.deal_id
     where dp.billing_type in ('recurring_monthly','recurring_yearly')
       and dp.end_date is not null
       and dp.end_date <= current_date + interval '7 days'
       and d.archived = false
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
      (deal_id, service_type, service_index, billing_type, amount, start_date, end_date)
      values (r.deal_id, r.service_type, r.service_index, r.billing_type, r.amount, next_start, next_end);

    created := created + 1;
  end loop;

  return created;
end $$;

-- 4. Restore the original CHECK constraint (no recurring_test_2min)
alter table public.deal_payments
  drop constraint if exists deal_payments_billing_type_check;
alter table public.deal_payments
  add constraint deal_payments_billing_type_check
  check (billing_type in ('one_time','recurring_monthly','recurring_yearly'));

-- 5. Drop the test-only column
alter table public.deal_payments
  drop column if exists next_due_at;
