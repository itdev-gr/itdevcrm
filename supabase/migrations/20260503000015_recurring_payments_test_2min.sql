-- =============================================================================
-- TEMPORARY: 2-minute test cadence for ensure_recurring_payments() so the
-- user can visually confirm the renewal loop on deal 000013's Payments tab.
-- Cleanup migration will follow once the user signs off.
--
-- Touches:
--   1. deal_payments: nullable next_due_at column (timestamptz, sub-day cadence)
--   2. deal_payments.billing_type CHECK: allow 'recurring_test_2min'
--   3. ensure_recurring_payments(): adds a second loop for the test cadence
--   4. pg_cron: every-minute schedule that calls the same RPC
--   5. seed: one initial recurring_test_2min row on deal code='000013'
-- =============================================================================

-- 1. Sub-day cadence column
alter table public.deal_payments
  add column if not exists next_due_at timestamptz;

-- 2. Extend billing_type CHECK
alter table public.deal_payments
  drop constraint if exists deal_payments_billing_type_check;
alter table public.deal_payments
  add constraint deal_payments_billing_type_check
  check (billing_type in ('one_time','recurring_monthly','recurring_yearly','recurring_test_2min'));

-- 3. Replace function with extended logic. Production loop (monthly + yearly)
--    is unchanged — it still uses end_date / start_date for day-resolution.
--    A second loop handles recurring_test_2min using next_due_at.
create or replace function public.ensure_recurring_payments()
returns int
language plpgsql security definer set search_path = public as $$
declare
  r record;
  next_start date;
  next_end date;
  next_due timestamptz;
  created int := 0;
begin
  -- Production cadence: monthly + yearly, day resolution
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

  -- Test cadence: every 2 minutes, timestamptz resolution
  for r in
    select dp.*
      from public.deal_payments dp
      join public.deals d on d.id = dp.deal_id
     where dp.billing_type = 'recurring_test_2min'
       and dp.next_due_at is not null
       and dp.next_due_at <= now()
       and d.archived = false
       and not exists (
         select 1 from public.deal_payments dp2
          where dp2.deal_id = dp.deal_id
            and dp2.service_index = dp.service_index
            and dp2.next_due_at is not null
            and dp2.next_due_at > dp.next_due_at
       )
  loop
    next_due := r.next_due_at + interval '2 minutes';
    insert into public.deal_payments
      (deal_id, service_type, service_index, billing_type, amount, start_date, next_due_at)
      values (r.deal_id, r.service_type, r.service_index, r.billing_type, r.amount, current_date, next_due);
    created := created + 1;
  end loop;

  return created;
end $$;

-- 4. Schedule every-minute cron (TEMPORARY)
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'every_minute_ensure_recurring_payments') then
      perform cron.unschedule('every_minute_ensure_recurring_payments');
    end if;
    perform cron.schedule(
      'every_minute_ensure_recurring_payments',
      '* * * * *',
      $cron$ select public.ensure_recurring_payments(); $cron$
    );
  end if;
exception when others then
  null;
end $$;

-- 5. Seed one test row on deal with code '000013'.
--    Intentionally does NOT touch services_planned — that JSONB is validated
--    by complete_accounting() and would reject 'recurring_test_2min'. The
--    PaymentsPanel reads from deal_payments directly, so the row shows up
--    in the UI without needing a services_planned entry.
do $$
declare
  d_id uuid;
  next_idx int;
begin
  select id into d_id from public.deals where code = '000013' limit 1;
  if d_id is null then
    raise notice 'deal with code 000013 not found — skipping test seed';
    return;
  end if;

  if exists (
    select 1 from public.deal_payments
     where deal_id = d_id and billing_type = 'recurring_test_2min'
  ) then
    raise notice 'test row already seeded on deal 000013 — skipping';
    return;
  end if;

  select coalesce(max(service_index), -1) + 1 into next_idx
    from public.deal_payments where deal_id = d_id;

  insert into public.deal_payments
    (deal_id, service_type, service_index, billing_type, amount, start_date, next_due_at, label)
  values
    (d_id, 'test', next_idx, 'recurring_test_2min', 1.00, current_date,
     now() + interval '2 minutes', 'TEST — auto every 2 min');
end $$;
