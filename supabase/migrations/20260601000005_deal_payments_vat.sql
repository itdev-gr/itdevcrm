alter table public.deal_payments
  add column if not exists amount_net numeric(12,2),
  add column if not exists vat_rate numeric(5,2) not null default 24.00,
  add column if not exists vat_amount numeric(12,2)
    generated always as (round(amount_net * vat_rate / 100, 2)) stored,
  add column if not exists amount_gross numeric(12,2)
    generated always as (round(amount_net + amount_net * vat_rate / 100, 2)) stored;

-- Country-aware backfill: GR clients are billed at 24% VAT (existing `amount`
-- is gross), every other country is billed at 0% (existing `amount` is already
-- net). Confirmed against live data on 2026-06-01: 7 GR clients + 1 CY client.
update public.deal_payments dp
  set amount_net = case
        when c.country = 'Greece' then round(dp.amount / 1.24, 2)
        else dp.amount
      end,
      vat_rate = case
        when c.country = 'Greece' then 24.00
        else 0.00
      end
  from public.deals d
  join public.clients c on c.id = d.client_id
  where d.id = dp.deal_id
    and dp.amount_net is null
    and dp.amount is not null;

alter table public.deal_payments
  alter column amount_net set not null;

alter table public.deal_payments
  add constraint deal_payments_amount_net_nonneg check (amount_net >= 0),
  add constraint deal_payments_vat_rate_bounded check (vat_rate >= 0 and vat_rate <= 100);

comment on column public.deal_payments.amount is
  'DEPRECATED: gross amount. Read amount_gross instead. Will be dropped after 2026-07-01.';

do $$
declare mismatched int;
begin
  select count(*) into mismatched
  from public.deal_payments
  where amount is not null
    and abs(amount_gross - amount) > 0.02;
  if mismatched > 0 then
    raise notice 'deal_payments VAT backfill: % rows differ from legacy amount by >€0.02', mismatched;
  end if;
end $$;

-- Updated seed_deal_payments writes amount_net instead of amount.
-- VAT defaults to 24% (Greek standard) for newly-seeded deals; non-GR clients
-- must edit the per-row vat_rate via the UI after seeding.
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
  net numeric(12,2);
  vat numeric(5,2) := 24.00;
  bt text;
  st text;
begin
  select * into d from public.deals where id = target_deal_id;
  if d is null then return; end if;
  if exists (select 1 from public.deal_payments where deal_id = d.id) then return; end if;
  if d.services_planned is null or jsonb_typeof(d.services_planned) <> 'array' then return; end if;

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

    net := round(gross / (1 + vat / 100), 2);

    insert into public.deal_payments
      (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, end_date)
      values (d.id, st, idx, bt, net, vat, s_start, s_end);

    idx := idx + 1;
  end loop;
end $$;

-- Updated ensure_recurring_payments writes amount_net + vat_rate.
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
      (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, end_date)
      values (r.deal_id, r.service_type, r.service_index, r.billing_type, r.amount_net, r.vat_rate, next_start, next_end);

    created := created + 1;
  end loop;
  return created;
end $$;

-- ROLLBACK:
-- alter table public.deal_payments
--   drop constraint if exists deal_payments_amount_net_nonneg,
--   drop constraint if exists deal_payments_vat_rate_bounded,
--   drop column if exists amount_net,
--   drop column if exists vat_rate,
--   drop column if exists vat_amount,
--   drop column if exists amount_gross;
-- (seed_deal_payments + ensure_recurring_payments must be reverted to the
--  pre-migration definitions from 20260503000010_deal_payments.sql.)
