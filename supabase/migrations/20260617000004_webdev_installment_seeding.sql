-- Website (web_dev) billing terms: a one-time total collected in installments.
-- services_planned[].payment_terms drives the split — '50_50' -> 50%+50%,
-- '50_25_25' -> 50%+25%+25%, 'full'/absent -> a single payment. billing_type
-- stays 'one_time' (job creation + recurring logic unaffected); only the seeded
-- deal_payments rows are split. Each installment is a 'one_time' row.
create or replace function public.seed_deal_payments(target_deal_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  d record; svc jsonb; idx int := 0; s_start date; s_end date;
  net numeric(12,4); setup_net numeric(12,4); vat numeric(5,2);
  client_country text; bt text; st text; term text; pct numeric[]; i int;
begin
  select * into d from public.deals where id = target_deal_id;
  if d is null then return; end if;
  if exists (select 1 from public.deal_payments where deal_id = d.id) then return; end if;
  if d.services_planned is null or jsonb_typeof(d.services_planned) <> 'array' then return; end if;

  select c.country into client_country from public.clients c where c.id = d.client_id;
  vat := case when trim(coalesce(client_country, '')) ilike 'cyprus' then 0.00 else 24.00 end;
  s_start := coalesce(d.actual_close_date, current_date);

  for svc in select * from jsonb_array_elements(d.services_planned)
  loop
    bt := coalesce(svc->>'billing_type', 'one_time');
    st := svc->>'service_type';
    term := svc->>'payment_terms';
    setup_net := coalesce(nullif(svc->>'setup_fee','')::numeric, 0);

    if bt = 'one_time' and st = 'web_dev' and term in ('50_50', '50_25_25') then
      -- Website paid in installments: split the one-time total.
      net := coalesce(nullif(svc->>'one_time_amount','')::numeric, 0);
      pct := case when term = '50_25_25' then array[0.5, 0.25, 0.25]::numeric[]
                  else array[0.5, 0.5]::numeric[] end;
      for i in 1 .. array_length(pct, 1) loop
        insert into public.deal_payments
          (deal_id, service_type, service_index, billing_type, amount_net, vat_rate,
           start_date, end_date, label)
          values (d.id, st, idx, 'one_time', round(net * pct[i], 4), vat, s_start, s_start,
                  'Installment ' || i || '/' || array_length(pct, 1));
        idx := idx + 1;
      end loop;
    else
      -- one_time (incl. 'full'/no term), recurring_monthly, recurring_yearly.
      if bt = 'one_time' then
        net := coalesce(nullif(svc->>'one_time_amount','')::numeric, 0); s_end := s_start;
      elsif bt = 'recurring_monthly' then
        net := coalesce(nullif(svc->>'monthly_amount','')::numeric, 0); s_end := s_start + interval '1 month';
      elsif bt = 'recurring_yearly' then
        net := coalesce(nullif(svc->>'monthly_amount','')::numeric, 0); s_end := s_start + interval '1 year';
      else
        net := 0; s_end := s_start;
      end if;
      insert into public.deal_payments
        (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, end_date)
        values (d.id, st, idx, bt, round(net, 4), vat, s_start, s_end);
      idx := idx + 1;
    end if;

    if setup_net > 0 then
      insert into public.deal_payments
        (deal_id, service_type, service_index, billing_type, amount_net, vat_rate,
         start_date, end_date, label)
        values (d.id, st, idx, 'one_time', round(setup_net, 4), vat, s_start, s_start, 'Setup fee');
      idx := idx + 1;
    end if;
  end loop;
end $$;

-- ROLLBACK: restore seed_deal_payments from 20260616110538_seed_payments_net_basis.sql.
