-- =============================================================================
-- Money fixes (audit 2026-06-10):
--   1. seed_deal_payments: VAT from the client's country (Cyprus = 0%) instead
--      of hardcoded 24%, and setup fees become their own one-time payment rows
--      (previously silently dropped from invoicing).
--   2. deal_payments.status gains 'overdue'; daily cron flips pending rows
--      whose period ended. Backfilled once at the end of this migration.
--   3. enqueue_payment_reminders also covers rows already marked overdue so
--      the day-after reminder still goes out.
--
-- Rollback:
--   select cron.unschedule('mark-overdue-payments');
--   drop function public.mark_overdue_payments();
--   update public.deal_payments set status = 'pending' where status = 'overdue';
--   alter table public.deal_payments drop constraint deal_payments_status_check;
--   alter table public.deal_payments add constraint deal_payments_status_check
--     check (status in ('pending','paid'));
--   -- restore seed_deal_payments from 20260601000005 (lines 49-100) and
--   -- enqueue_payment_reminders from 20260602000003.
-- =============================================================================

-- 1. status: allow 'overdue'.
alter table public.deal_payments drop constraint if exists deal_payments_status_check;
alter table public.deal_payments add constraint deal_payments_status_check
  check (status in ('pending', 'paid', 'overdue'));

-- 2. seed_deal_payments: country-aware VAT + setup-fee rows.
create or replace function public.seed_deal_payments(target_deal_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  d record;
  svc jsonb;
  idx int := 0;
  s_start date;
  s_end date;
  gross numeric(12,2);
  setup_gross numeric(12,2);
  net numeric(12,4);
  vat numeric(5,2);
  client_country text;
  bt text;
  st text;
begin
  select * into d from public.deals where id = target_deal_id;
  if d is null then return; end if;
  if exists (select 1 from public.deal_payments where deal_id = d.id) then return; end if;
  if d.services_planned is null or jsonb_typeof(d.services_planned) <> 'array' then return; end if;

  -- VAT by country, mirroring src/lib/countries.ts: Greece 24%, Cyprus 0%,
  -- unknown/unset defaults to 24%.
  select c.country into client_country from public.clients c where c.id = d.client_id;
  vat := case when trim(coalesce(client_country, '')) ilike 'cyprus' then 0.00 else 24.00 end;

  s_start := coalesce(d.actual_close_date, current_date);

  for svc in select * from jsonb_array_elements(d.services_planned)
  loop
    bt := coalesce(svc->>'billing_type', 'one_time');
    st := svc->>'service_type';
    if bt = 'one_time' then
      gross := coalesce(nullif(svc->>'one_time_amount','')::numeric, 0);
      s_end := s_start;
    elsif bt = 'recurring_monthly' then
      gross := coalesce(nullif(svc->>'monthly_amount','')::numeric, 0);
      s_end := s_start + interval '1 month';
    elsif bt = 'recurring_yearly' then
      gross := coalesce(nullif(svc->>'monthly_amount','')::numeric, 0);
      s_end := s_start + interval '1 year';
    else
      gross := 0; s_end := s_start;
    end if;

    net := round(gross * 100 / (100 + vat), 4);

    insert into public.deal_payments
      (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, end_date)
      values (d.id, st, idx, bt, net, vat, s_start, s_end);
    idx := idx + 1;

    -- Setup fee: its own one-time row so it actually gets invoiced.
    setup_gross := coalesce(nullif(svc->>'setup_fee','')::numeric, 0);
    if setup_gross > 0 then
      insert into public.deal_payments
        (deal_id, service_type, service_index, billing_type, amount_net, vat_rate,
         start_date, end_date, label)
        values (d.id, st, idx, 'one_time', round(setup_gross * 100 / (100 + vat), 4), vat,
                s_start, s_start, 'Setup fee');
      idx := idx + 1;
    end if;
  end loop;
end $$;

-- 3. Daily overdue marking.
create or replace function public.mark_overdue_payments()
returns int
language plpgsql security definer set search_path = public as $$
declare
  flipped int;
begin
  update public.deal_payments dp
     set status = 'overdue'
    from public.deals d
   where d.id = dp.deal_id
     and d.archived = false
     and dp.status = 'pending'
     and dp.end_date is not null
     and dp.end_date < current_date;
  get diagnostics flipped = row_count;
  return flipped;
end $$;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'mark-overdue-payments') then
    perform cron.schedule(
      'mark-overdue-payments',
      '15 2 * * *',
      $cron$ select public.mark_overdue_payments(); $cron$
    );
  end if;
end $$;

-- 4. Reminders: include overdue rows (the cron flips status at 02:15, before
-- reminders run at 06:00 — the 1-day-after reminder must still fire).
create or replace function public.enqueue_payment_reminders()
returns int
language plpgsql security definer set search_path = public as $$
declare
  r record;
  tkey text;
  dkey text;
  prefix text;
  created int := 0;
begin
  for r in
    select dp.id as payment_id, dp.service_type, dp.amount_gross, dp.start_date as due_date,
           dp.deal_id, c.name as client_name, c.email as to_email
      from public.deal_payments dp
      join public.deals d on d.id = dp.deal_id and d.archived = false
      join public.clients c on c.id = d.client_id
     where dp.status in ('pending', 'overdue')
       and c.email is not null and c.email <> ''
       and dp.start_date in (current_date + 3, current_date, current_date - 1)
  loop
    if r.due_date = current_date + 3 then
      tkey := 'payment_due_soon'; prefix := 'pay_soon';
    elsif r.due_date = current_date then
      tkey := 'payment_due_today'; prefix := 'pay_today';
    else
      tkey := 'payment_overdue'; prefix := 'pay_overdue';
    end if;

    dkey := prefix || ':' || r.payment_id;

    if exists (select 1 from public.email_log where dedupe_key = dkey and status = 'sent') then
      continue;
    end if;
    if exists (select 1 from public.email_outbox where dedupe_key = dkey and status in ('pending','sent')) then
      continue;
    end if;

    insert into public.email_outbox (identity, to_email, template_key, data, dedupe_key)
    values ('accounting', r.to_email, tkey,
            jsonb_build_object('client_name', r.client_name, 'service_type', r.service_type,
                               'amount_gross', r.amount_gross, 'due_date', to_char(r.due_date, 'DD/MM/YYYY'),
                               'deal_id', r.deal_id),
            dkey);
    created := created + 1;
  end loop;
  return created;
end $$;

-- 5. One-time backfill: flip the currently-lapsed pending rows.
select public.mark_overdue_payments();
