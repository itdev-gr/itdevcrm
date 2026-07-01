-- Run with: supabase test db  (transactional; rolls back)
-- Verifies enqueue_payment_reminders():
--   * fires only for deals whose accounting_stage is in the invoiced+ whitelist
--     (invoice_issued / awaiting_payment / partial_payment / paid_in_full / on_hold)
--   * uses the current +7 / -1 / -7 date window and picks the right template
--   * skips 'paid' payments
--   * is idempotent (dedupe on second run)
begin;
select plan(6);

do $$
declare
  cid uuid;
  did_new uuid; did_docs uuid; did_inv uuid; did_await uuid; did_closed uuid;
  sales_sid uuid;
  s_new uuid; s_docs uuid; s_inv uuid; s_await uuid; s_closed uuid;
begin
  select id into sales_sid from public.pipeline_stages where board = 'sales' order by position limit 1;
  select id into s_new    from public.pipeline_stages where board='accounting_onboarding' and code='new';
  select id into s_docs   from public.pipeline_stages where board='accounting_onboarding' and code='documents_verified';
  select id into s_inv    from public.pipeline_stages where board='accounting_onboarding' and code='invoice_issued';
  select id into s_await  from public.pipeline_stages where board='accounting_onboarding' and code='awaiting_payment';
  select id into s_closed from public.pipeline_stages where board='accounting_onboarding' and code='closed';

  insert into public.clients (name, email, country)
       values ('TestCo', 't@example.com', 'Greece')
    returning id into cid;

  insert into public.deals (client_id, archived, title, stage_id, accounting_stage_id)
       values (cid, false, 'New-stage deal',   sales_sid, s_new)    returning id into did_new;
  insert into public.deals (client_id, archived, title, stage_id, accounting_stage_id)
       values (cid, false, 'Docs-verified',    sales_sid, s_docs)   returning id into did_docs;
  insert into public.deals (client_id, archived, title, stage_id, accounting_stage_id)
       values (cid, false, 'Invoice-issued',   sales_sid, s_inv)    returning id into did_inv;
  insert into public.deals (client_id, archived, title, stage_id, accounting_stage_id)
       values (cid, false, 'Awaiting-payment', sales_sid, s_await)  returning id into did_await;

  -- 'closed' stage may not exist on every environment (was added later); skip if so.
  if s_closed is not null then
    insert into public.deals (client_id, archived, title, stage_id, accounting_stage_id)
         values (cid, false, 'Closed', sales_sid, s_closed) returning id into did_closed;
  end if;

  -- One payment per deal on the +7-day (due_soon) window.
  insert into public.deal_payments
    (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, status)
  values
    (did_new,   'web_seo',0,'recurring_monthly',100,24, current_date + 7, 'pending'),
    (did_docs,  'web_seo',0,'recurring_monthly',100,24, current_date + 7, 'pending'),
    (did_inv,   'web_seo',0,'recurring_monthly',100,24, current_date + 7, 'pending'),
    (did_await, 'web_seo',0,'recurring_monthly',100,24, current_date + 7, 'pending'),
    -- Same due date, but 'paid' → must be ignored regardless of stage.
    (did_inv,   'web_seo',1,'recurring_monthly',100,24, current_date + 7, 'paid');

  if did_closed is not null then
    insert into public.deal_payments
      (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, status)
    values
      (did_closed, 'web_seo',0,'recurring_monthly',100,24, current_date + 7, 'pending');
  end if;

  -- Also add a -1-day (overdue) row on an invoiced deal to prove template routing.
  insert into public.deal_payments
    (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, status)
  values
    (did_await, 'web_seo',1,'recurring_monthly',100,24, current_date - 1, 'pending');
end $$;

-- Assertions
-- 2 invoiced+ deals × 1 due_soon each + 1 overdue = 3 reminders.
select is( public.enqueue_payment_reminders(), 3,
           'stage-gated: 2 due_soon (invoiced+) + 1 overdue' );

select is( (select count(*)::int from public.email_outbox where template_key='payment_due_soon'), 2,
           'exactly 2 due_soon reminders (invoice_issued + awaiting_payment)' );

select is( (select count(*)::int from public.email_outbox where template_key='payment_overdue'), 1,
           'exactly 1 overdue reminder' );

select is( (select count(*)::int
              from public.email_outbox o
              join public.deals d on d.id = (o.data->>'deal_id')::uuid
              join public.pipeline_stages ps on ps.id = d.accounting_stage_id
             where ps.code in ('new','documents_verified','closed')), 0,
           'no reminders for new / documents_verified / closed stages' );

-- Idempotent: a second run enqueues nothing new (dedupe).
select is( public.enqueue_payment_reminders(), 0, 'second run is idempotent' );

-- Backfill safety: cleanup snapshot table must exist (created by the fix migration).
select has_table('public','email_outbox_stage_gate_backup_20260701',
                 'cleanup snapshot table exists for rollback');

select * from finish();
rollback;
