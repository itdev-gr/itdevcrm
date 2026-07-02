-- Stage-locked accounting reminder harness (RAISE-style, savepoint-rollback).
-- Runs against prod via runharness.py (pgtap is NOT installed on prod).
-- Each scenario seeds its own client+deal, calls enqueue_payment_reminders(),
-- asserts the outbox rows for THAT deal only, then RAISEs a RESULT and rolls back.
-- Locks under test:
--   payment_due_soon     -> awaiting_payment, today < due <= today+7
--   payment_overdue      -> on_hold,          1..6 days past due
--   payment_final_notice -> on_hold,          >=7 days past due
\set ON_ERROR_STOP off

-- ---- SL1: awaiting + due in 3d -> 1 payment_due_soon ------------------
do $$
declare v_client uuid; v_deal uuid; v_soon int; v_other int;
begin
  insert into public.clients (name, email, country) values ('sl1_'||gen_random_uuid()::text,'sl1@example.com','Greece') returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method, stage_id, accounting_stage_id)
    values (v_client,'SL1','sl1','cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='awaiting_payment'))
    returning id into v_deal;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, status)
    values (v_deal,'web_seo',0,'recurring_monthly',100,24, current_date + 3, 'pending');
  perform public.enqueue_payment_reminders();
  select count(*) into v_soon  from public.email_outbox where (data->>'deal_id')::uuid=v_deal and template_key='payment_due_soon';
  select count(*) into v_other from public.email_outbox where (data->>'deal_id')::uuid=v_deal and template_key<>'payment_due_soon';
  if v_soon <> 1 or v_other <> 0 then
    raise exception 'RESULT :: FAIL SL1 :: expected 1 due_soon + 0 other, got soon=% other=%', v_soon, v_other;
  end if;
  raise exception 'RESULT :: PASS SL1 :: awaiting + due-in-3 -> 1 payment_due_soon';
end $$;

-- ---- SL2: on_hold + 3d overdue -> 1 payment_overdue ------------------
do $$
declare v_client uuid; v_deal uuid; v_over int; v_other int;
begin
  insert into public.clients (name, email, country) values ('sl2_'||gen_random_uuid()::text,'sl2@example.com','Greece') returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method, stage_id, accounting_stage_id)
    values (v_client,'SL2','sl2','cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='on_hold'))
    returning id into v_deal;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, status)
    values (v_deal,'web_seo',0,'recurring_monthly',100,24, current_date - 3, 'overdue');
  perform public.enqueue_payment_reminders();
  select count(*) into v_over  from public.email_outbox where (data->>'deal_id')::uuid=v_deal and template_key='payment_overdue';
  select count(*) into v_other from public.email_outbox where (data->>'deal_id')::uuid=v_deal and template_key<>'payment_overdue';
  if v_over <> 1 or v_other <> 0 then
    raise exception 'RESULT :: FAIL SL2 :: expected 1 overdue + 0 other, got over=% other=%', v_over, v_other;
  end if;
  raise exception 'RESULT :: PASS SL2 :: on_hold + 3d-overdue -> 1 payment_overdue';
end $$;

-- ---- SL3: on_hold + 9d overdue -> 1 payment_final_notice -------------
do $$
declare v_client uuid; v_deal uuid; v_final int; v_other int;
begin
  insert into public.clients (name, email, country) values ('sl3_'||gen_random_uuid()::text,'sl3@example.com','Greece') returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method, stage_id, accounting_stage_id)
    values (v_client,'SL3','sl3','cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='on_hold'))
    returning id into v_deal;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, status)
    values (v_deal,'web_seo',0,'recurring_monthly',100,24, current_date - 9, 'overdue');
  perform public.enqueue_payment_reminders();
  select count(*) into v_final from public.email_outbox where (data->>'deal_id')::uuid=v_deal and template_key='payment_final_notice';
  select count(*) into v_other from public.email_outbox where (data->>'deal_id')::uuid=v_deal and template_key<>'payment_final_notice';
  if v_final <> 1 or v_other <> 0 then
    raise exception 'RESULT :: FAIL SL3 :: expected 1 final + 0 other, got final=% other=%', v_final, v_other;
  end if;
  raise exception 'RESULT :: PASS SL3 :: on_hold + 9d-overdue -> 1 payment_final_notice';
end $$;

-- ---- SL4 (KEY NEG): awaiting + 7d overdue -> NO final_notice ---------
do $$
declare v_client uuid; v_deal uuid; v_any int;
begin
  insert into public.clients (name, email, country) values ('sl4_'||gen_random_uuid()::text,'sl4@example.com','Greece') returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method, stage_id, accounting_stage_id)
    values (v_client,'SL4','sl4','cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='awaiting_payment'))
    returning id into v_deal;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, status)
    values (v_deal,'web_seo',0,'recurring_monthly',100,24, current_date - 7, 'overdue');
  perform public.enqueue_payment_reminders();
  select count(*) into v_any from public.email_outbox where (data->>'deal_id')::uuid=v_deal;
  if v_any <> 0 then
    raise exception 'RESULT :: FAIL SL4 :: awaiting+7d-overdue must get NO email, got %', v_any;
  end if;
  raise exception 'RESULT :: PASS SL4 :: awaiting + 7d-overdue -> no email (final_notice needs on_hold)';
end $$;

-- ---- SL5 (NEG): awaiting + 3d overdue -> no email --------------------
do $$
declare v_client uuid; v_deal uuid; v_any int;
begin
  insert into public.clients (name, email, country) values ('sl5_'||gen_random_uuid()::text,'sl5@example.com','Greece') returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method, stage_id, accounting_stage_id)
    values (v_client,'SL5','sl5','cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='awaiting_payment'))
    returning id into v_deal;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, status)
    values (v_deal,'web_seo',0,'recurring_monthly',100,24, current_date - 3, 'overdue');
  perform public.enqueue_payment_reminders();
  select count(*) into v_any from public.email_outbox where (data->>'deal_id')::uuid=v_deal;
  if v_any <> 0 then
    raise exception 'RESULT :: FAIL SL5 :: awaiting+3d-overdue must get NO email, got %', v_any;
  end if;
  raise exception 'RESULT :: PASS SL5 :: awaiting + 3d-overdue -> no email (overdue needs on_hold)';
end $$;

-- ---- SL6 (NEG): paid_in_full + due 3d -> no email --------------------
do $$
declare v_client uuid; v_deal uuid; v_any int;
begin
  insert into public.clients (name, email, country) values ('sl6_'||gen_random_uuid()::text,'sl6@example.com','Greece') returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method, stage_id, accounting_stage_id)
    values (v_client,'SL6','sl6','cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
    returning id into v_deal;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, status)
    values (v_deal,'web_seo',0,'recurring_monthly',100,24, current_date + 3, 'pending');
  -- The deal_payments_move_to_awaiting trigger bumps paid_in_full -> awaiting on
  -- a pending insert, so force the stage back to paid_in_full to test the enqueue
  -- gate for a deal genuinely HELD in paid_in_full (the real 24h-grace state:
  -- reconcile keeps a paid_in_full deal that has a fresh unpaid near-due row).
  update public.deals set accounting_stage_id =
    (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full')
   where id = v_deal;
  perform public.enqueue_payment_reminders();
  select count(*) into v_any from public.email_outbox where (data->>'deal_id')::uuid=v_deal;
  if v_any <> 0 then
    raise exception 'RESULT :: FAIL SL6 :: paid_in_full must get NO reminder, got %', v_any;
  end if;
  raise exception 'RESULT :: PASS SL6 :: paid_in_full (held) -> no reminder';
end $$;

-- ---- SL7 (NEG): partial_payment + 9d overdue -> no email -------------
do $$
declare v_client uuid; v_deal uuid; v_any int;
begin
  insert into public.clients (name, email, country) values ('sl7_'||gen_random_uuid()::text,'sl7@example.com','Greece') returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method, stage_id, accounting_stage_id)
    values (v_client,'SL7','sl7','cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='partial_payment'))
    returning id into v_deal;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, status)
    values (v_deal,'web_seo',0,'recurring_monthly',100,24, current_date - 9, 'overdue');
  perform public.enqueue_payment_reminders();
  select count(*) into v_any from public.email_outbox where (data->>'deal_id')::uuid=v_deal;
  if v_any <> 0 then
    raise exception 'RESULT :: FAIL SL7 :: partial_payment must get NO reminder, got %', v_any;
  end if;
  raise exception 'RESULT :: PASS SL7 :: partial_payment -> no reminder';
end $$;

-- ---- SL8: dedupe -> second enqueue adds nothing for the deal ---------
do $$
declare v_client uuid; v_deal uuid; v_after1 int; v_after2 int;
begin
  insert into public.clients (name, email, country) values ('sl8_'||gen_random_uuid()::text,'sl8@example.com','Greece') returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method, stage_id, accounting_stage_id)
    values (v_client,'SL8','sl8','cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='awaiting_payment'))
    returning id into v_deal;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, status)
    values (v_deal,'web_seo',0,'recurring_monthly',100,24, current_date + 3, 'pending');
  perform public.enqueue_payment_reminders();
  select count(*) into v_after1 from public.email_outbox where (data->>'deal_id')::uuid=v_deal;
  perform public.enqueue_payment_reminders();
  select count(*) into v_after2 from public.email_outbox where (data->>'deal_id')::uuid=v_deal;
  if v_after1 <> 1 or v_after2 <> 1 then
    raise exception 'RESULT :: FAIL SL8 :: dedupe broken, after1=% after2=%', v_after1, v_after2;
  end if;
  raise exception 'RESULT :: PASS SL8 :: dedupe holds (1 -> still 1 on second run)';
end $$;
