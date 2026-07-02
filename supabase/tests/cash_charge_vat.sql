-- supabase/tests/cash_charge_vat.sql
-- Run with: supabase test db  (transactional; rolls back)
begin;
select plan(4);

select has_column('public','deals','cash_charge_vat','deals has cash_charge_vat');
select has_column('public','leads','cash_charge_vat','leads has cash_charge_vat');

-- Cash + charge_vat=false -> seeded vat_rate 0 (Greece).
do $$
declare v_client uuid; v_deal uuid;
begin
  insert into public.clients (name, country, code) values ('VAT Test', 'Greece', 'TVAT01')
    returning id into v_client;
  insert into public.deals (client_id, title, code, payment_method, cash_charge_vat, services_planned)
    values (v_client, 'VAT test deal', 'TVAT01', 'cash', false,
      '[{"service_type":"local_seo","billing_type":"recurring_monthly","monthly_amount":100,"one_time_amount":0,"setup_fee":0}]'::jsonb)
    returning id into v_deal;
  perform set_config('t.deal', v_deal::text, true);
  perform public.release_billing_jobs_for_deal(v_deal);
end $$;

select is((select vat_rate from public.jobs
           where deal_id = current_setting('t.deal')::uuid and service_type='local_seo' limit 1),
          0.00, 'cash + charge_vat=false seeds vat_rate 0');

-- Cash + charge_vat=true -> seeded country rate (24, Greece).
do $$
declare v_client uuid; v_deal uuid;
begin
  insert into public.clients (name, country, code) values ('VAT Test2', 'Greece', 'TVAT02')
    returning id into v_client;
  insert into public.deals (client_id, title, code, payment_method, cash_charge_vat, services_planned)
    values (v_client, 'VAT test deal2', 'TVAT02', 'cash', true,
      '[{"service_type":"local_seo","billing_type":"recurring_monthly","monthly_amount":100,"one_time_amount":0,"setup_fee":0}]'::jsonb)
    returning id into v_deal;
  perform set_config('t.deal2', v_deal::text, true);
  perform public.release_billing_jobs_for_deal(v_deal);
end $$;

select is((select vat_rate from public.jobs
           where deal_id = current_setting('t.deal2')::uuid and service_type='local_seo' limit 1),
          24.00, 'cash + charge_vat=true seeds the country rate');

select * from finish();
rollback;
