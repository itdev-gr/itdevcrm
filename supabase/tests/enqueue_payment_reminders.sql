-- Stage-locked accounting reminder harness (RAISE-style, savepoint-rollback).
-- Runs against prod via runharness.py (pgtap is NOT installed on prod).
-- Each scenario seeds its own client+deal, exercises the reminder path, asserts
-- the outbox rows for THAT deal only, then RAISEs a RESULT and rolls back.
--
-- Locks under test (enqueue_payment_reminders):
--   payment_due_soon     -> awaiting_payment, today < due <= today+7
--   payment_overdue      -> on_hold,          1..6 days past due
--   payment_final_notice -> on_hold,          >=7 days past due
-- Guards under test:
--   * client.status='done'                 -> never email closed clients
--   * deal_payments.created_at::date >= due -> suppressed for 3 days after
--     entry (grace, 20260902110000: SL19 fires after grace, SL9 still quiet
--     same-day); totals always include in-grace siblings (SL20)
--   * wrong column                          -> no email
--   * no PAID row on the deal              -> no email (first-payment rule, SL18)
-- Chain: run_daily_payment_reminders() moves (reconcile) THEN sends (enqueue).
--
-- NOTE: overdue scenarios seed created_at BEFORE the due date (forward-looking),
-- otherwise the back-dated guard would suppress them (that guard is tested by SL9).
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
  -- First-payment rule (2026-08-31): reminders require >=1 PAID row on the deal
  -- (guard added by 20260831230000; without this seed the scenario is silenced).
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, end_date, status, paid_at)
    values (v_deal,'web_seo',9,'one_time',10,24, current_date - 90, current_date - 90, 'paid', now() - interval '90 days');
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

-- ---- SL2: on_hold + 3d overdue (forward-dated) -> 1 payment_overdue ---
do $$
declare v_client uuid; v_deal uuid; v_over int; v_other int;
begin
  insert into public.clients (name, email, country) values ('sl2_'||gen_random_uuid()::text,'sl2@example.com','Greece') returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method, stage_id, accounting_stage_id)
    values (v_client,'SL2','sl2','cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='on_hold'))
    returning id into v_deal;
  -- First-payment rule (2026-08-31): reminders require >=1 PAID row on the deal
  -- (guard added by 20260831230000; without this seed the scenario is silenced).
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, end_date, status, paid_at)
    values (v_deal,'web_seo',9,'one_time',10,24, current_date - 90, current_date - 90, 'paid', now() - interval '90 days');
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, created_at, status)
    values (v_deal,'web_seo',0,'recurring_monthly',100,24, current_date - 3, now() - interval '33 days', 'overdue');
  perform public.enqueue_payment_reminders();
  select count(*) into v_over  from public.email_outbox where (data->>'deal_id')::uuid=v_deal and template_key='payment_overdue';
  select count(*) into v_other from public.email_outbox where (data->>'deal_id')::uuid=v_deal and template_key<>'payment_overdue';
  if v_over <> 1 or v_other <> 0 then
    raise exception 'RESULT :: FAIL SL2 :: expected 1 overdue + 0 other, got over=% other=%', v_over, v_other;
  end if;
  raise exception 'RESULT :: PASS SL2 :: on_hold + 3d-overdue (fwd) -> 1 payment_overdue';
end $$;

-- ---- SL3: on_hold + 9d overdue (forward-dated) -> 1 payment_final_notice
do $$
declare v_client uuid; v_deal uuid; v_final int; v_other int;
begin
  insert into public.clients (name, email, country) values ('sl3_'||gen_random_uuid()::text,'sl3@example.com','Greece') returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method, stage_id, accounting_stage_id)
    values (v_client,'SL3','sl3','cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='on_hold'))
    returning id into v_deal;
  -- First-payment rule (2026-08-31): reminders require >=1 PAID row on the deal
  -- (guard added by 20260831230000; without this seed the scenario is silenced).
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, end_date, status, paid_at)
    values (v_deal,'web_seo',9,'one_time',10,24, current_date - 90, current_date - 90, 'paid', now() - interval '90 days');
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, created_at, status)
    values (v_deal,'web_seo',0,'recurring_monthly',100,24, current_date - 9, now() - interval '39 days', 'overdue');
  perform public.enqueue_payment_reminders();
  select count(*) into v_final from public.email_outbox where (data->>'deal_id')::uuid=v_deal and template_key='payment_final_notice';
  select count(*) into v_other from public.email_outbox where (data->>'deal_id')::uuid=v_deal and template_key<>'payment_final_notice';
  if v_final <> 1 or v_other <> 0 then
    raise exception 'RESULT :: FAIL SL3 :: expected 1 final + 0 other, got final=% other=%', v_final, v_other;
  end if;
  raise exception 'RESULT :: PASS SL3 :: on_hold + 9d-overdue (fwd) -> 1 payment_final_notice';
end $$;

-- ---- SL4 (NEG col): awaiting + 7d overdue (fwd) -> NO email ----------
do $$
declare v_client uuid; v_deal uuid; v_any int;
begin
  insert into public.clients (name, email, country) values ('sl4_'||gen_random_uuid()::text,'sl4@example.com','Greece') returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method, stage_id, accounting_stage_id)
    values (v_client,'SL4','sl4','cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='awaiting_payment'))
    returning id into v_deal;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, created_at, status)
    values (v_deal,'web_seo',0,'recurring_monthly',100,24, current_date - 7, now() - interval '37 days', 'overdue');
  -- deal_payments_reconcile_stage (single-owner reconcile, post-07-02) moves an
  -- overdue-payment deal to on_hold on INSERT; force the stage back so the test
  -- still exercises the enqueue gate for a deal held in awaiting_payment —
  -- same pattern as SL6/SL11.
  update public.deals set accounting_stage_id =
    (select id from public.pipeline_stages where board='accounting_onboarding' and code='awaiting_payment')
   where id = v_deal;
  perform public.enqueue_payment_reminders();
  select count(*) into v_any from public.email_outbox where (data->>'deal_id')::uuid=v_deal;
  if v_any <> 0 then
    raise exception 'RESULT :: FAIL SL4 :: awaiting+7d-overdue must get NO email (wrong column), got %', v_any;
  end if;
  raise exception 'RESULT :: PASS SL4 :: awaiting + 7d-overdue -> no email (final_notice needs on_hold)';
end $$;

-- ---- SL5 (NEG col): awaiting + 3d overdue (fwd) -> no email ----------
do $$
declare v_client uuid; v_deal uuid; v_any int;
begin
  insert into public.clients (name, email, country) values ('sl5_'||gen_random_uuid()::text,'sl5@example.com','Greece') returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method, stage_id, accounting_stage_id)
    values (v_client,'SL5','sl5','cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='awaiting_payment'))
    returning id into v_deal;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, created_at, status)
    values (v_deal,'web_seo',0,'recurring_monthly',100,24, current_date - 3, now() - interval '33 days', 'overdue');
  -- Same force-back as SL4: the reconcile trigger would move this deal to
  -- on_hold at INSERT, which is not the state under test.
  update public.deals set accounting_stage_id =
    (select id from public.pipeline_stages where board='accounting_onboarding' and code='awaiting_payment')
   where id = v_deal;
  perform public.enqueue_payment_reminders();
  select count(*) into v_any from public.email_outbox where (data->>'deal_id')::uuid=v_deal;
  if v_any <> 0 then
    raise exception 'RESULT :: FAIL SL5 :: awaiting+3d-overdue must get NO email (wrong column), got %', v_any;
  end if;
  raise exception 'RESULT :: PASS SL5 :: awaiting + 3d-overdue -> no email (overdue needs on_hold)';
end $$;

-- ---- SL6 (NEG col): paid_in_full (held) + due 3d -> no email --------
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
  -- The move_to_awaiting trigger bumps paid_in_full -> awaiting on a pending
  -- insert, so force the stage back to paid_in_full to test the enqueue gate for
  -- a deal genuinely HELD in paid_in_full (the real 24h-grace state).
  update public.deals set accounting_stage_id =
    (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full')
   where id = v_deal;
  perform public.enqueue_payment_reminders();
  select count(*) into v_any from public.email_outbox where (data->>'deal_id')::uuid=v_deal;
  if v_any <> 0 then
    raise exception 'RESULT :: FAIL SL6 :: paid_in_full (held) must get NO reminder, got %', v_any;
  end if;
  raise exception 'RESULT :: PASS SL6 :: paid_in_full (held) -> no reminder';
end $$;

-- ---- SL7 (NEG col): partial_payment + 9d overdue (fwd) -> no email --
do $$
declare v_client uuid; v_deal uuid; v_any int;
begin
  insert into public.clients (name, email, country) values ('sl7_'||gen_random_uuid()::text,'sl7@example.com','Greece') returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method, stage_id, accounting_stage_id)
    values (v_client,'SL7','sl7','cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='partial_payment'))
    returning id into v_deal;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, created_at, status)
    values (v_deal,'web_seo',0,'recurring_monthly',100,24, current_date - 9, now() - interval '39 days', 'overdue');
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
  -- First-payment rule (2026-08-31): reminders require >=1 PAID row on the deal
  -- (guard added by 20260831230000; without this seed the scenario is silenced).
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, end_date, status, paid_at)
    values (v_deal,'web_seo',9,'one_time',10,24, current_date - 90, current_date - 90, 'paid', now() - interval '90 days');
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

-- ---- SL9 (GUARD backdated): on_hold + 5d overdue but BACK-DATED -> no email
do $$
declare v_client uuid; v_deal uuid; v_any int;
begin
  insert into public.clients (name, email, country) values ('sl9_'||gen_random_uuid()::text,'sl9@example.com','Greece') returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method, stage_id, accounting_stage_id)
    values (v_client,'SL9','sl9','cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='on_hold'))
    returning id into v_deal;
  -- created_at (today) >= start_date (today-5): back-dated row -> must be suppressed.
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, status)
    values (v_deal,'web_seo',0,'recurring_monthly',100,24, current_date - 5, 'overdue');
  perform public.enqueue_payment_reminders();
  select count(*) into v_any from public.email_outbox where (data->>'deal_id')::uuid=v_deal;
  if v_any <> 0 then
    raise exception 'RESULT :: FAIL SL9 :: back-dated row (created>=due) must get NO email, got %', v_any;
  end if;
  raise exception 'RESULT :: PASS SL9 :: back-dated overdue row -> no email (no-backdated guard)';
end $$;

-- ---- SL10 (GUARD closed client): on_hold + 3d overdue (fwd) but status=done -> no email
do $$
declare v_client uuid; v_deal uuid; v_any int;
begin
  insert into public.clients (name, email, country, status) values ('sl10_'||gen_random_uuid()::text,'sl10@example.com','Greece','done') returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method, stage_id, accounting_stage_id)
    values (v_client,'SL10','sl10','cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='on_hold'))
    returning id into v_deal;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, created_at, status)
    values (v_deal,'web_seo',0,'recurring_monthly',100,24, current_date - 3, now() - interval '33 days', 'overdue');
  perform public.enqueue_payment_reminders();
  select count(*) into v_any from public.email_outbox where (data->>'deal_id')::uuid=v_deal;
  if v_any <> 0 then
    raise exception 'RESULT :: FAIL SL10 :: closed client (status=done) must get NO email, got %', v_any;
  end if;
  raise exception 'RESULT :: PASS SL10 :: closed client -> no email (never-email-closed guard)';
end $$;

-- ---- SL11 (NEG col): invoice_issued + due 3d (fwd) -> NO due_soon ----
do $$
declare v_client uuid; v_deal uuid; v_any int;
begin
  insert into public.clients (name, email, country) values ('sl11_'||gen_random_uuid()::text,'sl11@example.com','Greece') returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method, stage_id, accounting_stage_id)
    values (v_client,'SL11','sl11','cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='invoice_issued'))
    returning id into v_deal;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, status)
    values (v_deal,'web_seo',0,'recurring_monthly',100,24, current_date + 3, 'pending');
  -- move_to_awaiting bumps invoice_issued -> awaiting on a pending insert; force
  -- it back to invoice_issued to test that due_soon is locked to awaiting only.
  update public.deals set accounting_stage_id =
    (select id from public.pipeline_stages where board='accounting_onboarding' and code='invoice_issued')
   where id = v_deal;
  perform public.enqueue_payment_reminders();
  select count(*) into v_any from public.email_outbox where (data->>'deal_id')::uuid=v_deal;
  if v_any <> 0 then
    raise exception 'RESULT :: FAIL SL11 :: invoice_issued must get NO due_soon (locked to awaiting), got %', v_any;
  end if;
  raise exception 'RESULT :: PASS SL11 :: invoice_issued -> no due_soon (regression guard)';
end $$;

-- ---- SL12 (CHAIN move-before-send): awaiting deal, 3d overdue (fwd),
--       run_daily_payment_reminders() reconciles to on_hold THEN sends overdue.
do $$
declare v_client uuid; v_deal uuid; v_stage text; v_over int;
begin
  insert into public.clients (name, email, country) values ('sl12_'||gen_random_uuid()::text,'sl12@example.com','Greece') returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method, stage_id, accounting_stage_id)
    values (v_client,'SL12','sl12','cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='awaiting_payment'))
    returning id into v_deal;
  -- First-payment rule (2026-08-31): reminders require >=1 PAID row on the deal
  -- (guard added by 20260831230000; without this seed the scenario is silenced).
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, end_date, status, paid_at)
    values (v_deal,'web_seo',9,'one_time',10,24, current_date - 90, current_date - 90, 'paid', now() - interval '90 days');
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, created_at, status)
    values (v_deal,'web_seo',0,'recurring_monthly',100,24, current_date - 3, now() - interval '33 days', 'overdue');
  perform public.run_daily_payment_reminders();   -- reconcile (move) THEN enqueue (send)
  select ps.code into v_stage from public.deals d join public.pipeline_stages ps on ps.id=d.accounting_stage_id where d.id=v_deal;
  select count(*) into v_over from public.email_outbox where (data->>'deal_id')::uuid=v_deal and template_key='payment_overdue';
  if v_stage <> 'on_hold' or v_over <> 1 then
    raise exception 'RESULT :: FAIL SL12 :: chain expected move->on_hold + 1 overdue, got stage=% over=%', v_stage, v_over;
  end if;
  raise exception 'RESULT :: PASS SL12 :: chain moved awaiting->on_hold then sent 1 payment_overdue';
end $$;

-- ---- SL13 (BOUNDARY): on_hold + exactly 6d overdue (fwd) -> overdue --
do $$
declare v_client uuid; v_deal uuid; v_over int; v_final int;
begin
  insert into public.clients (name, email, country) values ('sl13_'||gen_random_uuid()::text,'sl13@example.com','Greece') returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method, stage_id, accounting_stage_id)
    values (v_client,'SL13','sl13','cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='on_hold'))
    returning id into v_deal;
  -- First-payment rule (2026-08-31): reminders require >=1 PAID row on the deal
  -- (guard added by 20260831230000; without this seed the scenario is silenced).
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, end_date, status, paid_at)
    values (v_deal,'web_seo',9,'one_time',10,24, current_date - 90, current_date - 90, 'paid', now() - interval '90 days');
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, created_at, status)
    values (v_deal,'web_seo',0,'recurring_monthly',100,24, current_date - 6, now() - interval '36 days', 'overdue');
  perform public.enqueue_payment_reminders();
  select count(*) into v_over  from public.email_outbox where (data->>'deal_id')::uuid=v_deal and template_key='payment_overdue';
  select count(*) into v_final from public.email_outbox where (data->>'deal_id')::uuid=v_deal and template_key='payment_final_notice';
  if v_over <> 1 or v_final <> 0 then
    raise exception 'RESULT :: FAIL SL13 :: 6d-overdue boundary must be overdue not final, got over=% final=%', v_over, v_final;
  end if;
  raise exception 'RESULT :: PASS SL13 :: 6d-overdue boundary -> payment_overdue (upper edge of 1..6)';
end $$;

-- ---- SL14 (BOUNDARY): on_hold + exactly 7d overdue (fwd) -> final ----
do $$
declare v_client uuid; v_deal uuid; v_over int; v_final int;
begin
  insert into public.clients (name, email, country) values ('sl14_'||gen_random_uuid()::text,'sl14@example.com','Greece') returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method, stage_id, accounting_stage_id)
    values (v_client,'SL14','sl14','cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='on_hold'))
    returning id into v_deal;
  -- First-payment rule (2026-08-31): reminders require >=1 PAID row on the deal
  -- (guard added by 20260831230000; without this seed the scenario is silenced).
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, end_date, status, paid_at)
    values (v_deal,'web_seo',9,'one_time',10,24, current_date - 90, current_date - 90, 'paid', now() - interval '90 days');
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, created_at, status)
    values (v_deal,'web_seo',0,'recurring_monthly',100,24, current_date - 7, now() - interval '37 days', 'overdue');
  perform public.enqueue_payment_reminders();
  select count(*) into v_over  from public.email_outbox where (data->>'deal_id')::uuid=v_deal and template_key='payment_overdue';
  select count(*) into v_final from public.email_outbox where (data->>'deal_id')::uuid=v_deal and template_key='payment_final_notice';
  if v_final <> 1 or v_over <> 0 then
    raise exception 'RESULT :: FAIL SL14 :: 7d-overdue boundary must be final not overdue, got over=% final=%', v_over, v_final;
  end if;
  raise exception 'RESULT :: PASS SL14 :: 7d-overdue boundary -> payment_final_notice (lower edge of >=7)';
end $$;

-- ---- SL15 (AGGREGATE): two pending payments due SAME day -> ONE summed email
do $$
declare v_client uuid; v_deal uuid; v_rows int; v_amount numeric; v_key text; v_rows2 int; v_break text;
begin
  insert into public.clients (name, email, country) values ('sl15_'||gen_random_uuid()::text,'sl15@example.com','Greece') returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method, stage_id, accounting_stage_id)
    values (v_client,'SL15','sl15','cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='awaiting_payment'))
    returning id into v_deal;
  -- First-payment rule (2026-08-31): reminders require >=1 PAID row on the deal
  -- (guard added by 20260831230000; without this seed the scenario is silenced).
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, end_date, status, paid_at)
    values (v_deal,'web_seo',9,'one_time',10,24, current_date - 90, current_date - 90, 'paid', now() - interval '90 days');
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, status)
    values (v_deal,'web_seo',0,'recurring_monthly',100,24, current_date + 3, 'pending'),
           (v_deal,'hosting',1,'recurring_monthly',200,24, current_date + 3, 'pending');
  perform public.enqueue_payment_reminders();
  select count(*) into v_rows from public.email_outbox where (data->>'deal_id')::uuid=v_deal;
  select (data->>'amount_gross')::numeric, dedupe_key, data->>'breakdown' into v_amount, v_key, v_break
    from public.email_outbox where (data->>'deal_id')::uuid=v_deal limit 1;
  perform public.enqueue_payment_reminders();   -- re-run: group key must dedupe
  select count(*) into v_rows2 from public.email_outbox where (data->>'deal_id')::uuid=v_deal;
  if v_rows <> 1 or v_rows2 <> 1 or v_amount <> 372.00
     or v_key <> 'pay_soon:'||v_deal||':'||to_char(current_date+3,'YYYYMMDD')
     or v_break is distinct from E'\n(Φιλοξενία: 248€ • Web SEO: 124€)' then
    raise exception 'RESULT :: FAIL SL15 :: expected 1 summed row (372.00, group key, 2-svc breakdown), got rows=% rows2=% amount=% key=% break=[%]', v_rows, v_rows2, v_amount, v_key, v_break;
  end if;
  raise exception 'RESULT :: PASS SL15 :: two same-day payments -> 1 summed due_soon (372.00) + breakdown, re-run dedupes';
end $$;

-- ---- SL16 (AGGREGATE scope): two payments due DIFFERENT days -> two emails
do $$
declare v_client uuid; v_deal uuid; v_rows int; v_dates int; v_breaks int;
begin
  insert into public.clients (name, email, country) values ('sl16_'||gen_random_uuid()::text,'sl16@example.com','Greece') returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method, stage_id, accounting_stage_id)
    values (v_client,'SL16','sl16','cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='awaiting_payment'))
    returning id into v_deal;
  -- First-payment rule (2026-08-31): reminders require >=1 PAID row on the deal
  -- (guard added by 20260831230000; without this seed the scenario is silenced).
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, end_date, status, paid_at)
    values (v_deal,'web_seo',9,'one_time',10,24, current_date - 90, current_date - 90, 'paid', now() - interval '90 days');
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, status)
    values (v_deal,'web_seo',0,'recurring_monthly',100,24, current_date + 3, 'pending'),
           (v_deal,'web_seo',1,'recurring_monthly',100,24, current_date + 5, 'pending');
  perform public.enqueue_payment_reminders();
  select count(*), count(distinct data->>'due_date') into v_rows, v_dates
    from public.email_outbox where (data->>'deal_id')::uuid=v_deal and template_key='payment_due_soon';
  -- Single-service groups must carry an EMPTY breakdown (email renders as today).
  select count(*) into v_breaks
    from public.email_outbox where (data->>'deal_id')::uuid=v_deal and coalesce(data->>'breakdown','') <> '';
  if v_rows <> 2 or v_dates <> 2 or v_breaks <> 0 then
    raise exception 'RESULT :: FAIL SL16 :: different due dates must email separately w/o breakdown, got rows=% dates=% breaks=%', v_rows, v_dates, v_breaks;
  end if;
  raise exception 'RESULT :: PASS SL16 :: different-day payments -> 2 separate due_soon emails, no breakdown';
end $$;

-- ---- SL17 (TRANSITION): payment already reminded under legacy key -> only the other aggregates
do $$
declare v_client uuid; v_deal uuid; v_paid uuid; v_rows int; v_amount numeric;
begin
  insert into public.clients (name, email, country) values ('sl17_'||gen_random_uuid()::text,'sl17@example.com','Greece') returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method, stage_id, accounting_stage_id)
    values (v_client,'SL17','sl17','cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='awaiting_payment'))
    returning id into v_deal;
  -- First-payment rule (2026-08-31): reminders require >=1 PAID row on the deal
  -- (guard added by 20260831230000; without this seed the scenario is silenced).
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, end_date, status, paid_at)
    values (v_deal,'web_seo',9,'one_time',10,24, current_date - 90, current_date - 90, 'paid', now() - interval '90 days');
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, status)
    values (v_deal,'web_seo',0,'recurring_monthly',100,24, current_date + 3, 'pending')
    returning id into v_paid;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, status)
    values (v_deal,'hosting',1,'recurring_monthly',200,24, current_date + 3, 'pending');
  -- Simulate the pre-aggregation era: first payment already reminded.
  insert into public.email_log (identity, to_email, template_key, status, dedupe_key)
    values ('accounting','sl17@example.com','payment_due_soon','sent','pay_soon:'||v_paid);
  perform public.enqueue_payment_reminders();
  select count(*) into v_rows from public.email_outbox where (data->>'deal_id')::uuid=v_deal;
  select (data->>'amount_gross')::numeric into v_amount
    from public.email_outbox where (data->>'deal_id')::uuid=v_deal limit 1;
  if v_rows <> 1 or v_amount <> 248.00 then
    raise exception 'RESULT :: FAIL SL17 :: expected 1 row covering only the un-reminded payment (248.00), got rows=% amount=%', v_rows, v_amount;
  end if;
  raise exception 'RESULT :: PASS SL17 :: legacy-reminded payment excluded; other aggregates alone (248.00)';
end $$;

-- ---- SL18 (GUARD first payment): awaiting + due 3d but ZERO paid rows -> no email
do $$
declare v_client uuid; v_deal uuid; v_any int;
begin
  insert into public.clients (name, email, country) values ('sl18_'||gen_random_uuid()::text,'sl18@example.com','Greece') returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method, stage_id, accounting_stage_id)
    values (v_client,'SL18','sl18','cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='awaiting_payment'))
    returning id into v_deal;
  -- Deliberately NO paid row: a client who has never paid anything must get no
  -- automated reminder even in awaiting_payment (owner rule 2026-08-31).
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, status)
    values (v_deal,'web_seo',0,'recurring_monthly',100,24, current_date + 3, 'pending');
  perform public.enqueue_payment_reminders();
  select count(*) into v_any from public.email_outbox where (data->>'deal_id')::uuid=v_deal;
  if v_any <> 0 then
    raise exception 'RESULT :: FAIL SL18 :: never-paid deal must get NO reminder, got %', v_any;
  end if;
  raise exception 'RESULT :: PASS SL18 :: never-paid deal -> no reminder (first-payment rule)';
end $$;

-- ---- SL19 (GRACE 2026-09-02): late-entered row (created 4d ago, due 10d ago)
-- on_hold -> DOES email now (payment_final_notice); grace expired.
do $$
declare v_client uuid; v_deal uuid; v_final int; v_other int;
begin
  insert into public.clients (name, email, country) values ('sl19_'||gen_random_uuid()::text,'sl19@example.com','Greece') returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method, stage_id, accounting_stage_id)
    values (v_client,'SL19','sl19','cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='on_hold'))
    returning id into v_deal;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, end_date, status, paid_at)
    values (v_deal,'web_seo',9,'one_time',10,24, current_date - 90, current_date - 90, 'paid', now() - interval '90 days');
  -- created_at (today-4) >= start_date (today-10): back-dated, but the 3-day
  -- grace (20260902110000) has expired -> eligible.
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, created_at, status)
    values (v_deal,'web_seo',0,'recurring_monthly',100,24, current_date - 10, now() - interval '4 days', 'overdue');
  perform public.enqueue_payment_reminders();
  select count(*) into v_final from public.email_outbox where (data->>'deal_id')::uuid=v_deal and template_key='payment_final_notice';
  select count(*) into v_other from public.email_outbox where (data->>'deal_id')::uuid=v_deal and template_key<>'payment_final_notice';
  if v_final <> 1 or v_other <> 0 then
    raise exception 'RESULT :: FAIL SL19 :: late row past grace must email 1 final_notice, got final=% other=%', v_final, v_other;
  end if;
  raise exception 'RESULT :: PASS SL19 :: late-entered row past 3d grace -> 1 payment_final_notice';
end $$;

-- ---- SL20 (TRUTHFUL TOTALS 2026-09-02): eligible sibling triggers, the
-- fresh late row of the SAME due date is still counted in amount+breakdown.
do $$
declare v_client uuid; v_deal uuid; v_cnt int; v_amt numeric; v_svc text;
begin
  insert into public.clients (name, email, country) values ('sl20_'||gen_random_uuid()::text,'sl20@example.com','Greece') returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method, stage_id, accounting_stage_id)
    values (v_client,'SL20','sl20','cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='on_hold'))
    returning id into v_deal;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, end_date, status, paid_at)
    values (v_deal,'web_seo',9,'one_time',10,24, current_date - 90, current_date - 90, 'paid', now() - interval '90 days');
  -- Eligible trigger row: forward-dated, 8d overdue (final window). 100 net -> 124 gross.
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, created_at, status)
    values (v_deal,'web_seo',0,'recurring_monthly',100,24, current_date - 8, now() - interval '20 days', 'overdue');
  -- Late sibling, SAME due date, entered today (inside grace -> NOT eligible,
  -- but must still be summed). 200 net -> 248 gross.
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, status)
    values (v_deal,'social_media',1,'recurring_monthly',200,24, current_date - 8, 'overdue');
  perform public.enqueue_payment_reminders();
  select count(*), max((data->>'amount_gross')::numeric), max(data->>'service_type')
    into v_cnt, v_amt, v_svc
    from public.email_outbox where (data->>'deal_id')::uuid=v_deal;
  if v_cnt <> 1 or v_amt <> 372 or v_svc <> 'social_media + web_seo' then
    raise exception 'RESULT :: FAIL SL20 :: expected 1 email / 372 / social_media + web_seo, got cnt=% amt=% svc=%', v_cnt, v_amt, v_svc;
  end if;
  raise exception 'RESULT :: PASS SL20 :: totals include in-grace sibling (372 = 124 + 248, both services)';
end $$;
