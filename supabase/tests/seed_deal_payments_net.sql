-- Run with: supabase test db  (transactional; rolls back)
-- The amount a salesperson enters is the NET (pre-VAT) price: seed_deal_payments
-- must store it verbatim as amount_net and let the generated amount_gross add VAT
-- on top — matching the offer/pricing-summary "Total". (Previously it treated the
-- entered amount as gross and back-divided, under-billing by the VAT.)
begin;
select plan(3);

do $$
declare cid uuid; did uuid; sid uuid;
begin
  select id into sid from public.pipeline_stages where board = 'sales' order by position limit 1;
  insert into public.clients (name, email, country)
    values ('NetBasisCo', 'nb@example.com', 'Greece') returning id into cid;
  insert into public.deals (client_id, archived, title, stage_id, actual_close_date, services_planned)
    values (cid, false, 'Net basis deal', sid, current_date,
            '[{"service_type":"web_seo","billing_type":"recurring_monthly","monthly_amount":500,"setup_fee":300}]'::jsonb)
    returning id into did;
  perform public.seed_deal_payments(did); -- no-op if an insert trigger already seeded
end $$;

select is(
  (select round(dp.amount_net, 2) from public.deal_payments dp
     join public.deals d on d.id = dp.deal_id
     join public.clients c on c.id = d.client_id
    where c.name = 'NetBasisCo' and dp.service_index = 0),
  500.00::numeric,
  'monthly amount is stored as net (the entered value), not back-divided');

select is(
  (select dp.amount_gross from public.deal_payments dp
     join public.deals d on d.id = dp.deal_id
     join public.clients c on c.id = d.client_id
    where c.name = 'NetBasisCo' and dp.service_index = 0),
  620.00::numeric,
  'gross = net + 24% VAT on top (500 -> 620)');

select is(
  (select dp.amount_gross from public.deal_payments dp
     join public.deals d on d.id = dp.deal_id
     join public.clients c on c.id = d.client_id
    where c.name = 'NetBasisCo' and dp.label = 'Setup fee'),
  372.00::numeric,
  'setup fee is also net (300 -> 372 gross)');

select * from finish();
rollback;
