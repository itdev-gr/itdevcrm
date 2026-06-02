-- Run with: supabase test db  (transactional; rolls back)
begin;
select plan(3);

-- Arrange: a non-archived deal + client with email, and 3 pending payments
-- due in +3 / today / -1 days, plus one paid (must be ignored).
do $$
declare cid uuid; did uuid; sid uuid;
begin
  select id into sid from public.pipeline_stages where board = 'sales' order by position limit 1;
  insert into public.clients (name, email, country) values ('TestCo', 't@example.com', 'Greece') returning id into cid;
  insert into public.deals (client_id, archived, title, stage_id)
    values (cid, false, 'TestCo deal', sid) returning id into did;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, status)
  values (did,'web_seo',0,'recurring_monthly',100,24, current_date + 3,'pending'),
         (did,'web_seo',1,'recurring_monthly',100,24, current_date,'pending'),
         (did,'web_seo',2,'recurring_monthly',100,24, current_date - 1,'pending'),
         (did,'web_seo',3,'recurring_monthly',100,24, current_date,'paid');
end $$;

select is( public.enqueue_payment_reminders(), 3, 'enqueues exactly 3 reminders (skips paid)');
select is( (select count(*)::int from public.email_outbox where template_key='payment_due_soon'), 1, 'one due_soon');
-- Idempotent: a second run enqueues nothing new (dedupe).
select is( public.enqueue_payment_reminders(), 0, 'second run is idempotent');

select * from finish();
rollback;
