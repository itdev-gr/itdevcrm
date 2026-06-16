-- Treat the amount entered per planned service as the NET (pre-VAT) price.
--
-- Before: seed_deal_payments treated the entered amount as VAT-inclusive (gross)
-- and back-divided to net (net = amount * 100/(100+vat)). That under-billed by
-- the VAT and disagreed with the offer/lead/deal "Pricing summary", which shows
-- the entered amount as the subtotal and adds VAT on top to reach the Total.
--
-- After: the entered amount IS amount_net; the generated amount_gross column adds
-- VAT on top (gross = net * (1 + vat/100)). A €500/mo service now bills €620 gross
-- in Greece, matching what the salesperson sees as the Total. Cyprus (0% VAT) is
-- unaffected (net == gross either way). This also removes the 1-cent gross display
-- artifact, since amount_net is now the exact entered value rather than a repeating
-- decimal.
--
-- Only new seedings are affected; existing deal_payments rows are left as-is.

create or replace function public.seed_deal_payments(target_deal_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  d record;
  svc jsonb;
  idx int := 0;
  s_start date;
  s_end date;
  net numeric(12,4);
  setup_net numeric(12,4);
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
    -- The entered amount is the NET (pre-VAT) price; VAT is added on top by the
    -- generated amount_gross column.
    if bt = 'one_time' then
      net := coalesce(nullif(svc->>'one_time_amount','')::numeric, 0);
      s_end := s_start;
    elsif bt = 'recurring_monthly' then
      net := coalesce(nullif(svc->>'monthly_amount','')::numeric, 0);
      s_end := s_start + interval '1 month';
    elsif bt = 'recurring_yearly' then
      net := coalesce(nullif(svc->>'monthly_amount','')::numeric, 0);
      s_end := s_start + interval '1 year';
    else
      net := 0; s_end := s_start;
    end if;

    insert into public.deal_payments
      (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, end_date)
      values (d.id, st, idx, bt, round(net, 4), vat, s_start, s_end);
    idx := idx + 1;

    -- Setup fee: its own one-time row so it actually gets invoiced.
    setup_net := coalesce(nullif(svc->>'setup_fee','')::numeric, 0);
    if setup_net > 0 then
      insert into public.deal_payments
        (deal_id, service_type, service_index, billing_type, amount_net, vat_rate,
         start_date, end_date, label)
        values (d.id, st, idx, 'one_time', round(setup_net, 4), vat,
                s_start, s_start, 'Setup fee');
      idx := idx + 1;
    end if;
  end loop;
end $$;

-- ROLLBACK (restore the prior gross-interpretation behavior from
-- 20260610000004_money_seeding_and_overdue.sql):
-- create or replace function public.seed_deal_payments(target_deal_id uuid)
-- returns void language plpgsql security definer set search_path = public as $$
-- declare
--   d record; svc jsonb; idx int := 0; s_start date; s_end date;
--   gross numeric(12,2); setup_gross numeric(12,2); net numeric(12,4);
--   vat numeric(5,2); client_country text; bt text; st text;
-- begin
--   select * into d from public.deals where id = target_deal_id;
--   if d is null then return; end if;
--   if exists (select 1 from public.deal_payments where deal_id = d.id) then return; end if;
--   if d.services_planned is null or jsonb_typeof(d.services_planned) <> 'array' then return; end if;
--   select c.country into client_country from public.clients c where c.id = d.client_id;
--   vat := case when trim(coalesce(client_country, '')) ilike 'cyprus' then 0.00 else 24.00 end;
--   s_start := coalesce(d.actual_close_date, current_date);
--   for svc in select * from jsonb_array_elements(d.services_planned)
--   loop
--     bt := coalesce(svc->>'billing_type', 'one_time'); st := svc->>'service_type';
--     if bt = 'one_time' then
--       gross := coalesce(nullif(svc->>'one_time_amount','')::numeric, 0); s_end := s_start;
--     elsif bt = 'recurring_monthly' then
--       gross := coalesce(nullif(svc->>'monthly_amount','')::numeric, 0); s_end := s_start + interval '1 month';
--     elsif bt = 'recurring_yearly' then
--       gross := coalesce(nullif(svc->>'monthly_amount','')::numeric, 0); s_end := s_start + interval '1 year';
--     else gross := 0; s_end := s_start; end if;
--     net := round(gross * 100 / (100 + vat), 4);
--     insert into public.deal_payments
--       (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, end_date)
--       values (d.id, st, idx, bt, net, vat, s_start, s_end);
--     idx := idx + 1;
--     setup_gross := coalesce(nullif(svc->>'setup_fee','')::numeric, 0);
--     if setup_gross > 0 then
--       insert into public.deal_payments
--         (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, end_date, label)
--         values (d.id, st, idx, 'one_time', round(setup_gross * 100 / (100 + vat), 4), vat, s_start, s_start, 'Setup fee');
--       idx := idx + 1;
--     end if;
--   end loop;
-- end $$;
