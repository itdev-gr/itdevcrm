-- Full Payments & Accounting smoke test.
-- 56 scenarios across Groups A-K (this file: A, B, C = 22 scenarios).
-- Runs against prod via MCP execute_sql (savepoint-rollback, terminal
-- RAISE EXCEPTION surfaces the result — NOTICE is swallowed).
--
-- Assertion pattern (from paid_in_full_flip_edgecases.sql):
--   * cron effect  → per-deal count delta before/after
--   * reconcile    → per-deal accounting_stage code before/after
--   * trigger      → check the deal's stage after the mutation
--   Never rely on ensure_recurring_payments / reconcile_block_lifecycle
--   return values — those are GLOBAL counts.
--
-- Seed requirements: clients(name); deals(client_id, code, title,
-- payment_method='cash', stage_id=sales.won, accounting_stage_id=<initial>).

\set ON_ERROR_STOP off

-- =====================================================================
-- Group A: Deal onboarding lifecycle (8 scenarios)
-- =====================================================================

-- ---- Scenario A1: fresh deal in `new` + no payments -----------------
-- Cron should touch nothing (no recurring rows to extend).
begin;
do $$
declare v_client uuid; v_deal uuid; v_before int; v_after int;
begin
  insert into public.clients (name) values ('smoke_A1_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method,
    stage_id, accounting_stage_id)
    values (v_client, 'SMOKE-A1', 'smoke A1', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='new'))
    returning id into v_deal;

  select count(*) into v_before from public.deal_payments where deal_id = v_deal;
  perform public.ensure_recurring_payments();
  select count(*) into v_after from public.deal_payments where deal_id = v_deal;

  if (v_after - v_before) <> 0 then
    raise exception 'RESULT :: FAIL A1 :: expected delta=0 for fresh empty deal, got %', (v_after - v_before);
  end if;
  raise exception 'RESULT :: PASS A1 :: fresh new deal with no payments is left alone by cron';
end $$;
rollback;

-- ---- Scenario A2: invoice_issued + insert pending → awaiting_payment
-- deal_payments_move_to_awaiting trigger fires on INSERT.
begin;
do $$
declare v_client uuid; v_deal uuid; v_row uuid; v_stage text;
begin
  insert into public.clients (name) values ('smoke_A2_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method,
    stage_id, accounting_stage_id)
    values (v_client, 'SMOKE-A2', 'smoke A2', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='invoice_issued'))
    returning id into v_deal;

  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'web_dev', 0, 'one_time', 500, 24,
            current_date, current_date, 'pending')
    returning id into v_row;

  select ps.code into v_stage from public.deals d
    join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;
  if v_stage <> 'awaiting_payment' then
    raise exception 'RESULT :: FAIL A2 :: expected awaiting_payment after pending INSERT, got %', v_stage;
  end if;
  raise exception 'RESULT :: PASS A2 :: invoice_issued + pending INSERT moves deal to awaiting_payment';
end $$;
rollback;

-- ---- Scenario A3: on_hold + overdue → paid → paid_in_full ----------
-- release_from_on_hold trigger promotes when no past-due remains.
begin;
do $$
declare v_client uuid; v_deal uuid; v_row uuid; v_stage text;
begin
  insert into public.clients (name) values ('smoke_A3_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method,
    stage_id, accounting_stage_id)
    values (v_client, 'SMOKE-A3', 'smoke A3', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='on_hold'))
    returning id into v_deal;

  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
            current_date - 40, current_date - 10, 'overdue')
    returning id into v_row;

  update public.deal_payments set status = 'paid' where id = v_row;

  select ps.code into v_stage from public.deals d
    join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;
  if v_stage <> 'paid_in_full' then
    raise exception 'RESULT :: FAIL A3 :: expected paid_in_full after overdue→paid on on_hold, got %', v_stage;
  end if;
  raise exception 'RESULT :: PASS A3 :: overdue→paid on on_hold deal promotes to paid_in_full';
end $$;
rollback;

-- ---- Scenario A4: full onboarding chain (exemplar) -----------------
-- new → invoice_issued → awaiting_payment (via INSERT) → paid_in_full (via reconcile)
begin;
do $$
declare v_client uuid; v_deal uuid; v_row uuid; v_stage_final text;
begin
  insert into public.clients (name) values ('smoke_A4_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method, stage_id, accounting_stage_id)
    values (v_client, 'SMOKE-A4', 'smoke A4', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='new'))
    returning id into v_deal;

  -- Progress: new → invoice_issued (manual advance by accountant)
  update public.deals set accounting_stage_id =
    (select id from public.pipeline_stages where board='accounting_onboarding' and code='invoice_issued')
   where id = v_deal;

  -- INSERT a pending payment → trigger moves deal to awaiting_payment
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'web_dev', 0, 'one_time', 500, 24,
            current_date, current_date, 'pending')
    returning id into v_row;

  -- Mark paid → release trigger tries to promote (but deal is awaiting_payment,
  -- not on_hold, so release trigger's guard fails — need reconcile to move)
  update public.deal_payments set status='paid' where id = v_row;
  perform public.reconcile_block_lifecycle(false);

  select ps.code into v_stage_final from public.deals d
    join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;
  if v_stage_final <> 'paid_in_full' then
    raise exception 'RESULT :: FAIL A4 :: expected paid_in_full after full chain, got %', v_stage_final;
  end if;
  raise exception 'RESULT :: PASS A4 :: full onboarding chain reaches paid_in_full';
end $$;
rollback;

-- ---- Scenario A5: documents_verified + INSERT pending → awaiting_payment
-- documents_verified is NOT in the trigger's skip-list (new/on_hold/partial_payment).
begin;
do $$
declare v_client uuid; v_deal uuid; v_row uuid; v_stage text;
begin
  insert into public.clients (name) values ('smoke_A5_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method,
    stage_id, accounting_stage_id)
    values (v_client, 'SMOKE-A5', 'smoke A5', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='documents_verified'))
    returning id into v_deal;

  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'web_dev', 0, 'one_time', 500, 24,
            current_date, current_date, 'pending')
    returning id into v_row;

  select ps.code into v_stage from public.deals d
    join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;
  if v_stage <> 'awaiting_payment' then
    raise exception 'RESULT :: FAIL A5 :: expected awaiting_payment after pending INSERT on documents_verified, got %', v_stage;
  end if;
  raise exception 'RESULT :: PASS A5 :: documents_verified + pending INSERT moves to awaiting_payment';
end $$;
rollback;

-- ---- Scenario A6: partial_payment + INSERT pending → stage unchanged
-- Trigger's skip-list includes partial_payment.
begin;
do $$
declare v_client uuid; v_deal uuid; v_row uuid; v_stage text;
begin
  insert into public.clients (name) values ('smoke_A6_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method,
    stage_id, accounting_stage_id)
    values (v_client, 'SMOKE-A6', 'smoke A6', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='partial_payment'))
    returning id into v_deal;

  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'web_dev', 0, 'one_time', 250, 24,
            current_date, current_date, 'pending')
    returning id into v_row;

  select ps.code into v_stage from public.deals d
    join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;
  if v_stage <> 'partial_payment' then
    raise exception 'RESULT :: FAIL A6 :: expected partial_payment unchanged, got %', v_stage;
  end if;
  raise exception 'RESULT :: PASS A6 :: partial_payment + pending INSERT leaves stage unchanged';
end $$;
rollback;

-- ---- Scenario A7: done (terminal) + INSERT pending → stage unchanged
-- Trigger's skip-list includes terminal stages (done).
begin;
do $$
declare v_client uuid; v_deal uuid; v_row uuid; v_stage text;
begin
  insert into public.clients (name) values ('smoke_A7_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method,
    stage_id, accounting_stage_id)
    values (v_client, 'SMOKE-A7', 'smoke A7', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='done'))
    returning id into v_deal;

  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'web_dev', 0, 'one_time', 100, 24,
            current_date, current_date, 'pending')
    returning id into v_row;

  select ps.code into v_stage from public.deals d
    join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;
  if v_stage <> 'done' then
    raise exception 'RESULT :: FAIL A7 :: expected done unchanged, got %', v_stage;
  end if;
  raise exception 'RESULT :: PASS A7 :: done + pending INSERT leaves stage unchanged';
end $$;
rollback;

-- ---- Scenario A8: closed (terminal) + recurring paid row → cron skips
-- ensure_recurring_payments's WHERE filters out closed deals.
begin;
do $$
declare v_client uuid; v_deal uuid; v_before int; v_after int;
begin
  insert into public.clients (name) values ('smoke_A8_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method,
    stage_id, accounting_stage_id)
    values (v_client, 'SMOKE-A8', 'smoke A8', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='closed'))
    returning id into v_deal;

  -- Paid recurring row ending YESTERDAY (would normally trigger a next-period create)
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
            current_date - 40, current_date - 1, 'paid');

  select count(*) into v_before from public.deal_payments where deal_id = v_deal;
  perform public.ensure_recurring_payments();
  select count(*) into v_after from public.deal_payments where deal_id = v_deal;

  if (v_after - v_before) <> 0 then
    raise exception 'RESULT :: FAIL A8 :: cron created % row(s) on closed deal, expected 0', (v_after - v_before);
  end if;
  raise exception 'RESULT :: PASS A8 :: closed deal is skipped by cron';
end $$;
rollback;

-- =====================================================================
-- Group B: Payment lifecycle (7 scenarios)
-- =====================================================================

-- ---- Scenario B1: pending → overdue via mark_overdue (exemplar) ----
begin;
do $$
declare v_client uuid; v_deal uuid; v_row uuid; v_status_after text;
begin
  insert into public.clients (name) values ('smoke_B1_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method, stage_id, accounting_stage_id)
    values (v_client, 'SMOKE-B1', 'smoke B1', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='new'))
    returning id into v_deal;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
            current_date - 5, current_date + 25, 'pending')
    returning id into v_row;

  perform public.mark_overdue_payments();
  select status into v_status_after from public.deal_payments where id = v_row;

  if v_status_after <> 'overdue' then
    raise exception 'RESULT :: FAIL B1 :: expected overdue, got %', v_status_after;
  end if;
  raise exception 'RESULT :: PASS B1 :: mark_overdue flips pending→overdue';
end $$;
rollback;

-- ---- Scenario B2: on_hold + single overdue → paid → paid_in_full ---
-- No other past-due remains → release trigger promotes.
begin;
do $$
declare v_client uuid; v_deal uuid; v_row uuid; v_stage text;
begin
  insert into public.clients (name) values ('smoke_B2_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method,
    stage_id, accounting_stage_id)
    values (v_client, 'SMOKE-B2', 'smoke B2', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='on_hold'))
    returning id into v_deal;

  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
            current_date - 40, current_date - 10, 'overdue')
    returning id into v_row;

  update public.deal_payments set status='paid' where id = v_row;

  select ps.code into v_stage from public.deals d
    join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;
  if v_stage <> 'paid_in_full' then
    raise exception 'RESULT :: FAIL B2 :: expected paid_in_full after single-overdue paid, got %', v_stage;
  end if;
  raise exception 'RESULT :: PASS B2 :: single overdue→paid on on_hold promotes to paid_in_full';
end $$;
rollback;

-- ---- Scenario B3: on_hold + TWO overdue → pay one → stays on_hold --
-- Remaining past-due row keeps deal blocked.
begin;
do $$
declare v_client uuid; v_deal uuid; v_row_a uuid; v_row_b uuid; v_stage text;
begin
  insert into public.clients (name) values ('smoke_B3_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method,
    stage_id, accounting_stage_id)
    values (v_client, 'SMOKE-B3', 'smoke B3', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='on_hold'))
    returning id into v_deal;

  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
            current_date - 60, current_date - 30, 'overdue')
    returning id into v_row_a;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
            current_date - 30, current_date - 1, 'overdue')
    returning id into v_row_b;

  update public.deal_payments set status='paid' where id = v_row_a;

  select ps.code into v_stage from public.deals d
    join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;
  if v_stage <> 'on_hold' then
    raise exception 'RESULT :: FAIL B3 :: expected on_hold with remaining overdue, got %', v_stage;
  end if;
  raise exception 'RESULT :: PASS B3 :: paying one of two overdue leaves deal on_hold';
end $$;
rollback;

-- ---- Scenario B4: paid_in_full + paid→pending (old row) → on_hold --
-- Exposes past-due; grace doesn't apply because row is >24h old.
begin;
do $$
declare v_client uuid; v_deal uuid; v_row uuid; v_stage text;
begin
  insert into public.clients (name) values ('smoke_B4_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method,
    stage_id, accounting_stage_id)
    values (v_client, 'SMOKE-B4', 'smoke B4', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
    returning id into v_deal;

  -- Old paid recurring row; created_at old so no L3 grace after flip
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status, created_at)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
            current_date - 40, current_date - 10, 'paid', now() - interval '30 days')
    returning id into v_row;

  -- Flip paid → pending manually; row's created_at stays old
  update public.deal_payments set status='pending' where id = v_row;
  perform public.reconcile_block_lifecycle(false);

  select ps.code into v_stage from public.deals d
    join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;
  if v_stage <> 'on_hold' then
    raise exception 'RESULT :: FAIL B4 :: expected on_hold after paid→pending on old row, got %', v_stage;
  end if;
  raise exception 'RESULT :: PASS B4 :: paid→pending on old row flips paid_in_full to on_hold';
end $$;
rollback;

-- ---- Scenario B5: awaiting_payment + overdue → paid → stage unchanged
-- release_from_on_hold trigger only handles on_hold; awaiting_payment is untouched.
begin;
do $$
declare v_client uuid; v_deal uuid; v_row uuid; v_stage text;
begin
  insert into public.clients (name) values ('smoke_B5_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method,
    stage_id, accounting_stage_id)
    values (v_client, 'SMOKE-B5', 'smoke B5', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='awaiting_payment'))
    returning id into v_deal;

  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
            current_date - 40, current_date - 10, 'overdue')
    returning id into v_row;

  update public.deal_payments set status='paid' where id = v_row;

  select ps.code into v_stage from public.deals d
    join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;
  if v_stage <> 'awaiting_payment' then
    raise exception 'RESULT :: FAIL B5 :: expected awaiting_payment unchanged, got %', v_stage;
  end if;
  raise exception 'RESULT :: PASS B5 :: awaiting_payment stays put (release trigger only handles on_hold)';
end $$;
rollback;

-- ---- Scenario B6: pending with start_date=TODAY → mark_overdue -----
-- Guard uses `<=` (inclusive) → today should flip to overdue.
begin;
do $$
declare v_client uuid; v_deal uuid; v_row uuid; v_status_after text;
begin
  insert into public.clients (name) values ('smoke_B6_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method, stage_id, accounting_stage_id)
    values (v_client, 'SMOKE-B6', 'smoke B6', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='new'))
    returning id into v_deal;

  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
            current_date, current_date + 30, 'pending')
    returning id into v_row;

  perform public.mark_overdue_payments();
  select status into v_status_after from public.deal_payments where id = v_row;

  if v_status_after <> 'overdue' then
    raise exception 'RESULT :: FAIL B6 :: expected overdue for today start_date (boundary), got %', v_status_after;
  end if;
  raise exception 'RESULT :: PASS B6 :: mark_overdue includes today (inclusive `<=`)';
end $$;
rollback;

-- ---- Scenario B7: on_hold + one paid (old) + one overdue → pay overdue
-- No past-due remains → release trigger promotes to paid_in_full.
begin;
do $$
declare v_client uuid; v_deal uuid; v_row_paid uuid; v_row_od uuid; v_stage text;
begin
  insert into public.clients (name) values ('smoke_B7_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method,
    stage_id, accounting_stage_id)
    values (v_client, 'SMOKE-B7', 'smoke B7', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='on_hold'))
    returning id into v_deal;

  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
            current_date - 90, current_date - 60, 'paid')
    returning id into v_row_paid;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
            current_date - 60, current_date - 30, 'overdue')
    returning id into v_row_od;

  update public.deal_payments set status='paid' where id = v_row_od;

  select ps.code into v_stage from public.deals d
    join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;
  if v_stage <> 'paid_in_full' then
    raise exception 'RESULT :: FAIL B7 :: expected paid_in_full after clearing overdue, got %', v_stage;
  end if;
  raise exception 'RESULT :: PASS B7 :: clearing last overdue on on_hold promotes to paid_in_full';
end $$;
rollback;

-- =====================================================================
-- Group C: Recurring chain — single service (7 scenarios)
-- =====================================================================

-- ---- Scenario C1: paid row ending TODAY → cron creates next-period -
-- Expected: delta = 1; new row start=today, end ~= today + 1 month.
-- (Real cron uses interval '1 month', so end may be +30 or +31 days.)
begin;
do $$
declare v_client uuid; v_deal uuid; v_before int; v_after int;
        v_new_start date; v_new_end date;
begin
  insert into public.clients (name) values ('smoke_C1_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method,
    stage_id, accounting_stage_id)
    values (v_client, 'SMOKE-C1', 'smoke C1', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
    returning id into v_deal;

  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
            current_date - 30, current_date, 'paid');

  select count(*) into v_before from public.deal_payments where deal_id = v_deal;
  perform public.ensure_recurring_payments();
  select count(*) into v_after from public.deal_payments where deal_id = v_deal;

  if (v_after - v_before) <> 1 then
    raise exception 'RESULT :: FAIL C1 :: expected delta=1 for row ending today, got %', (v_after - v_before);
  end if;

  -- Sanity: verify the newly-created row's window
  --   start_date = today (cron picks up from prior end_date = today)
  --   end_date within [today+28, today+31] (interval '1 month' varies by cal month)
  select start_date, end_date into v_new_start, v_new_end
    from public.deal_payments
    where deal_id = v_deal and status = 'pending'
    order by created_at desc limit 1;
  if v_new_start <> current_date then
    raise exception 'RESULT :: CONCERN C1 :: new row start=% expected % (today)', v_new_start, current_date;
  end if;
  if v_new_end < current_date + 28 or v_new_end > current_date + 31 then
    raise exception 'RESULT :: CONCERN C1 :: new row end=% outside [today+28, today+31] window', v_new_end;
  end if;
  raise exception 'RESULT :: PASS C1 :: paid row ending today spawns next-period start=% end=%',
    v_new_start, v_new_end;
end $$;
rollback;

-- ---- Scenario C2: paid row ended YESTERDAY → cron creates next -----
-- Then reconcile: stage stays paid_in_full (L3 grace, new row <24h old).
begin;
do $$
declare v_client uuid; v_deal uuid; v_before int; v_after int; v_stage text;
begin
  insert into public.clients (name) values ('smoke_C2_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method,
    stage_id, accounting_stage_id)
    values (v_client, 'SMOKE-C2', 'smoke C2', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
    returning id into v_deal;

  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
            current_date - 31, current_date - 1, 'paid');

  select count(*) into v_before from public.deal_payments where deal_id = v_deal;
  perform public.ensure_recurring_payments();
  select count(*) into v_after from public.deal_payments where deal_id = v_deal;

  if (v_after - v_before) <> 1 then
    raise exception 'RESULT :: FAIL C2 :: expected delta=1 for row ending yesterday, got %', (v_after - v_before);
  end if;

  -- Reconcile: L3 grace should keep the deal in paid_in_full (new row <24h)
  perform public.reconcile_block_lifecycle(false);

  select ps.code into v_stage from public.deals d
    join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;
  if v_stage <> 'paid_in_full' then
    raise exception 'RESULT :: FAIL C2 :: expected paid_in_full (L3 grace), got %', v_stage;
  end if;
  raise exception 'RESULT :: PASS C2 :: yesterday-end + cron + L3 grace keeps paid_in_full';
end $$;
rollback;

-- ---- Scenario C3: paid row ending +5 DAYS → cron creates next ------
-- Cron look-ahead is +7d. Reconcile: next_due in +5d → awaiting_payment.
begin;
do $$
declare v_client uuid; v_deal uuid; v_before int; v_after int; v_stage text;
begin
  insert into public.clients (name) values ('smoke_C3_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method,
    stage_id, accounting_stage_id)
    values (v_client, 'SMOKE-C3', 'smoke C3', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
    returning id into v_deal;

  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
            current_date - 25, current_date + 5, 'paid');

  select count(*) into v_before from public.deal_payments where deal_id = v_deal;
  perform public.ensure_recurring_payments();
  select count(*) into v_after from public.deal_payments where deal_id = v_deal;

  if (v_after - v_before) <> 1 then
    raise exception 'RESULT :: FAIL C3 :: expected delta=1 for row ending +5d (within +7d window), got %', (v_after - v_before);
  end if;

  perform public.reconcile_block_lifecycle(false);

  select ps.code into v_stage from public.deals d
    join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;
  if v_stage <> 'awaiting_payment' then
    raise exception 'RESULT :: FAIL C3 :: expected awaiting_payment (next_due +5d), got %', v_stage;
  end if;
  raise exception 'RESULT :: PASS C3 :: +5d end row generates next, reconcile → awaiting_payment';
end $$;
rollback;

-- ---- Scenario C4: 6-month history, newest ends TODAY → delta=1 ----
-- Cron must not re-fill history; only ONE new row.
begin;
do $$
declare v_client uuid; v_deal uuid; v_before int; v_after int;
begin
  insert into public.clients (name) values ('smoke_C4_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method,
    stage_id, accounting_stage_id)
    values (v_client, 'SMOKE-C4', 'smoke C4', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
    returning id into v_deal;

  -- 6 sequential paid recurring rows (single-row inserts — no multi-row RETURNING scalar trap)
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
            current_date - 180, current_date - 150, 'paid');
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
            current_date - 150, current_date - 120, 'paid');
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
            current_date - 120, current_date - 90, 'paid');
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
            current_date - 90, current_date - 60, 'paid');
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
            current_date - 60, current_date - 30, 'paid');
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
            current_date - 30, current_date, 'paid');

  select count(*) into v_before from public.deal_payments where deal_id = v_deal;
  perform public.ensure_recurring_payments();
  select count(*) into v_after from public.deal_payments where deal_id = v_deal;

  if (v_after - v_before) <> 1 then
    raise exception 'RESULT :: FAIL C4 :: expected delta=1 for 6mo history, got %', (v_after - v_before);
  end if;
  raise exception 'RESULT :: PASS C4 :: 6-month paid history yields exactly ONE new next-period row';
end $$;
rollback;

-- ---- Scenario C5: on_hold + overdue → pay → paid_in_full → cron OK
-- Verify release trigger promotes AND cron continues to generate next row.
begin;
do $$
declare v_client uuid; v_deal uuid; v_row uuid; v_before int; v_after int; v_stage text;
begin
  insert into public.clients (name) values ('smoke_C5_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method,
    stage_id, accounting_stage_id)
    values (v_client, 'SMOKE-C5', 'smoke C5', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='on_hold'))
    returning id into v_deal;

  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
            current_date - 30, current_date, 'overdue')
    returning id into v_row;

  update public.deal_payments set status='paid' where id = v_row;

  select ps.code into v_stage from public.deals d
    join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;
  if v_stage <> 'paid_in_full' then
    raise exception 'RESULT :: FAIL C5 :: release trigger did not promote; got %', v_stage;
  end if;

  -- Cron now generates the next-period row
  select count(*) into v_before from public.deal_payments where deal_id = v_deal;
  perform public.ensure_recurring_payments();
  select count(*) into v_after from public.deal_payments where deal_id = v_deal;

  if (v_after - v_before) <> 1 then
    raise exception 'RESULT :: FAIL C5 :: expected delta=1 after promotion, got %', (v_after - v_before);
  end if;
  raise exception 'RESULT :: PASS C5 :: on_hold→paid_in_full via release, cron then extends chain';
end $$;
rollback;

-- ---- Scenario C6: service_index NULL → cron guard tolerates -------
-- Historical rows sometimes have NULL service_index. Cron should still extend.
begin;
do $$
declare v_client uuid; v_deal uuid; v_before int; v_after int;
begin
  insert into public.clients (name) values ('smoke_C6_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method,
    stage_id, accounting_stage_id)
    values (v_client, 'SMOKE-C6', 'smoke C6', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
    returning id into v_deal;

  -- NB: default_service_keys trigger may backfill service_index. Insert as NULL
  -- and let the DB decide — if the trigger backfills, still expect delta=1.
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'ai_seo', NULL, 'recurring_monthly', 100, 24,
            current_date - 30, current_date, 'paid');

  select count(*) into v_before from public.deal_payments where deal_id = v_deal;
  perform public.ensure_recurring_payments();
  select count(*) into v_after from public.deal_payments where deal_id = v_deal;

  if (v_after - v_before) <> 1 then
    raise exception 'RESULT :: FAIL C6 :: expected delta=1 for NULL service_index row, got %', (v_after - v_before);
  end if;
  raise exception 'RESULT :: PASS C6 :: NULL service_index still extends the recurring chain';
end $$;
rollback;

-- ---- Scenario C7: service_type NULL → cron behavior (INFO) --------
-- L1 guard compares service_type = dp.service_type; NULL semantics vary.
-- Either delta=1 or delta=0 is acceptable — record which; caller flags CONCERN if 0.
begin;
do $$
declare v_client uuid; v_deal uuid; v_before int; v_after int; v_delta int;
begin
  insert into public.clients (name) values ('smoke_C7_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method,
    stage_id, accounting_stage_id)
    values (v_client, 'SMOKE-C7', 'smoke C7', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
    returning id into v_deal;

  -- Try inserting NULL service_type — if a CHECK / trigger blocks it,
  -- capture that too and emit an INFO row (not a FAIL).
  begin
    insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
      amount_net, vat_rate, start_date, end_date, status)
      values (v_deal, NULL, 0, 'recurring_monthly', 100, 24,
              current_date - 30, current_date, 'paid');
  exception when others then
    raise exception 'RESULT :: INFO C7 :: NULL service_type INSERT rejected by DB (%)', sqlerrm;
  end;

  select count(*) into v_before from public.deal_payments where deal_id = v_deal;
  perform public.ensure_recurring_payments();
  select count(*) into v_after from public.deal_payments where deal_id = v_deal;
  v_delta := v_after - v_before;

  raise exception 'RESULT :: INFO C7 :: NULL service_type cron delta=% (0=guard-skips, 1=guard-tolerates)', v_delta;
end $$;
rollback;

-- =====================================================================
-- Group D: AI SEO 3-row split (5 scenarios)
-- =====================================================================
-- AI SEO uses a 3-row split (per project_local_seo_owner memory):
--   * Parent job — service_type='ai_seo', billing_only=true, holds price.
--   * Web SEO child — service_type='web_seo', billing_only=false, billing_active=true.
--   * Local SEO child — service_type='local_seo', billing_only=false, billing_active=true.
--   * Children linked via jobs.parent_job_id.
-- Recurring row attaches to the PARENT (service_type='ai_seo'); the
-- ensure_recurring_payments guard checks for an active job with
-- j.service_type = dp.service_type — so the parent's own active/billing_active
-- job satisfies the guard on its own.

-- ---- Scenario D1: standard AI SEO trio, cron fires parent ----------
-- Parent + 2 active children + paid recurring on parent ending today
-- → cron creates 1 new row on parent chain. Delta = 1.
begin;
do $$
declare v_client uuid; v_deal uuid; v_before int; v_after int;
    v_parent_job uuid; v_web_child uuid; v_local_child uuid;
    v_web_group uuid; v_local_group uuid;
begin
  insert into public.clients (name) values ('smoke_D1_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method, stage_id, accounting_stage_id)
    values (v_client, 'SMOKE-D1', 'smoke D1', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
    returning id into v_deal;

  select id into v_web_group from public.groups where code='web_seo';
  select id into v_local_group from public.groups where code='local_seo';

  -- Parent (billing_only, no service work)
  insert into public.jobs (deal_id, client_id, service_type, billing_type, status, stage_id,
    billing_active, billing_only)
    values (v_deal, v_client, 'ai_seo', 'recurring_monthly', 'active',
            (select id from public.pipeline_stages where board='ai_seo' and not archived order by position limit 1),
            true, true)
    returning id into v_parent_job;
  -- Web SEO child
  insert into public.jobs (deal_id, client_id, service_type, billing_type, status, stage_id,
    billing_active, billing_only, parent_job_id, assigned_group_id)
    values (v_deal, v_client, 'web_seo', 'recurring_monthly', 'active',
            (select id from public.pipeline_stages where board='web_seo' and not archived order by position limit 1),
            true, false, v_parent_job, v_web_group)
    returning id into v_web_child;
  -- Local SEO child
  insert into public.jobs (deal_id, client_id, service_type, billing_type, status, stage_id,
    billing_active, billing_only, parent_job_id, assigned_group_id)
    values (v_deal, v_client, 'local_seo', 'recurring_monthly', 'active',
            (select id from public.pipeline_stages where board='local_seo' and not archived order by position limit 1),
            true, false, v_parent_job, v_local_group)
    returning id into v_local_child;

  -- Recurring on parent, expiring today
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 300, 24,
            current_date - 30, current_date, 'paid');

  select count(*) into v_before from public.deal_payments where deal_id = v_deal;
  perform public.ensure_recurring_payments();
  select count(*) into v_after  from public.deal_payments where deal_id = v_deal;

  if (v_after - v_before) <> 1 then
    raise exception 'RESULT :: FAIL D1 :: expected 1 new row on AI SEO parent chain, got %', (v_after - v_before);
  end if;
  raise exception 'RESULT :: PASS D1 :: AI SEO trio (parent+2 children) spawns 1 new parent-period row';
end $$;
rollback;

-- ---- Scenario D2: archived parent → cron skips deal ----------------
-- With the ai_seo parent archived, the cron guard finds no non-archived
-- ai_seo job for the deal → guard's first branch (not exists) requires
-- billing_active on some non-archived job for the service. Both fail →
-- cron skips. Delta = 0.
begin;
do $$
declare v_client uuid; v_deal uuid; v_before int; v_after int;
    v_parent_job uuid; v_web_group uuid; v_local_group uuid;
begin
  insert into public.clients (name) values ('smoke_D2_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method, stage_id, accounting_stage_id)
    values (v_client, 'SMOKE-D2', 'smoke D2', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
    returning id into v_deal;

  select id into v_web_group from public.groups where code='web_seo';
  select id into v_local_group from public.groups where code='local_seo';

  insert into public.jobs (deal_id, client_id, service_type, billing_type, status, stage_id,
    billing_active, billing_only)
    values (v_deal, v_client, 'ai_seo', 'recurring_monthly', 'active',
            (select id from public.pipeline_stages where board='ai_seo' and not archived order by position limit 1),
            true, true)
    returning id into v_parent_job;
  insert into public.jobs (deal_id, client_id, service_type, billing_type, status, stage_id,
    billing_active, billing_only, parent_job_id, assigned_group_id)
    values (v_deal, v_client, 'web_seo', 'recurring_monthly', 'active',
            (select id from public.pipeline_stages where board='web_seo' and not archived order by position limit 1),
            true, false, v_parent_job, v_web_group);
  insert into public.jobs (deal_id, client_id, service_type, billing_type, status, stage_id,
    billing_active, billing_only, parent_job_id, assigned_group_id)
    values (v_deal, v_client, 'local_seo', 'recurring_monthly', 'active',
            (select id from public.pipeline_stages where board='local_seo' and not archived order by position limit 1),
            true, false, v_parent_job, v_local_group);

  -- Archive the parent (children stay unarchived; NOT ai_seo service).
  update public.jobs set archived=true where id = v_parent_job;

  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 300, 24,
            current_date - 30, current_date, 'paid');

  select count(*) into v_before from public.deal_payments where deal_id = v_deal;
  perform public.ensure_recurring_payments();
  select count(*) into v_after  from public.deal_payments where deal_id = v_deal;

  if (v_after - v_before) <> 0 then
    raise exception 'RESULT :: FAIL D2 :: expected delta=0 when ai_seo parent archived, got %', (v_after - v_before);
  end if;
  raise exception 'RESULT :: PASS D2 :: archived ai_seo parent → cron skips (no active ai_seo job)';
end $$;
rollback;

-- ---- Scenario D3: web_seo child billing_active=false → cron still fires
-- The cron guard checks the DP's service_type ('ai_seo'), not the child's
-- service_type. Web SEO child's billing_active has no bearing on the
-- ai_seo cron branch. Delta = 1.
begin;
do $$
declare v_client uuid; v_deal uuid; v_before int; v_after int;
    v_parent_job uuid; v_web_child uuid; v_web_group uuid; v_local_group uuid;
begin
  insert into public.clients (name) values ('smoke_D3_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method, stage_id, accounting_stage_id)
    values (v_client, 'SMOKE-D3', 'smoke D3', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
    returning id into v_deal;

  select id into v_web_group from public.groups where code='web_seo';
  select id into v_local_group from public.groups where code='local_seo';

  insert into public.jobs (deal_id, client_id, service_type, billing_type, status, stage_id,
    billing_active, billing_only)
    values (v_deal, v_client, 'ai_seo', 'recurring_monthly', 'active',
            (select id from public.pipeline_stages where board='ai_seo' and not archived order by position limit 1),
            true, true)
    returning id into v_parent_job;
  insert into public.jobs (deal_id, client_id, service_type, billing_type, status, stage_id,
    billing_active, billing_only, parent_job_id, assigned_group_id)
    values (v_deal, v_client, 'web_seo', 'recurring_monthly', 'active',
            (select id from public.pipeline_stages where board='web_seo' and not archived order by position limit 1),
            true, false, v_parent_job, v_web_group)
    returning id into v_web_child;
  insert into public.jobs (deal_id, client_id, service_type, billing_type, status, stage_id,
    billing_active, billing_only, parent_job_id, assigned_group_id)
    values (v_deal, v_client, 'local_seo', 'recurring_monthly', 'active',
            (select id from public.pipeline_stages where board='local_seo' and not archived order by position limit 1),
            true, false, v_parent_job, v_local_group);

  -- Deactivate the web_seo child's billing. Parent (ai_seo) stays active.
  update public.jobs set billing_active=false where id = v_web_child;

  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 300, 24,
            current_date - 30, current_date, 'paid');

  select count(*) into v_before from public.deal_payments where deal_id = v_deal;
  perform public.ensure_recurring_payments();
  select count(*) into v_after  from public.deal_payments where deal_id = v_deal;

  if (v_after - v_before) <> 1 then
    raise exception 'RESULT :: FAIL D3 :: expected delta=1 when web_seo child inactive, got %', (v_after - v_before);
  end if;
  raise exception 'RESULT :: PASS D3 :: web_seo child billing_active=false does not affect ai_seo cron';
end $$;
rollback;

-- ---- Scenario D4: delete web_seo child → parent chain still fires --
-- Deleting a child doesn't affect the ai_seo cron guard. Then reconcile
-- with the new row (start=today, <24h old) → L3 grace protects
-- paid_in_full. Stage stays paid_in_full.
begin;
do $$
declare v_client uuid; v_deal uuid; v_before int; v_after int;
    v_parent_job uuid; v_web_child uuid; v_stage_after text;
    v_web_group uuid; v_local_group uuid;
begin
  insert into public.clients (name) values ('smoke_D4_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method, stage_id, accounting_stage_id)
    values (v_client, 'SMOKE-D4', 'smoke D4', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
    returning id into v_deal;

  select id into v_web_group from public.groups where code='web_seo';
  select id into v_local_group from public.groups where code='local_seo';

  insert into public.jobs (deal_id, client_id, service_type, billing_type, status, stage_id,
    billing_active, billing_only)
    values (v_deal, v_client, 'ai_seo', 'recurring_monthly', 'active',
            (select id from public.pipeline_stages where board='ai_seo' and not archived order by position limit 1),
            true, true)
    returning id into v_parent_job;
  insert into public.jobs (deal_id, client_id, service_type, billing_type, status, stage_id,
    billing_active, billing_only, parent_job_id, assigned_group_id)
    values (v_deal, v_client, 'web_seo', 'recurring_monthly', 'active',
            (select id from public.pipeline_stages where board='web_seo' and not archived order by position limit 1),
            true, false, v_parent_job, v_web_group)
    returning id into v_web_child;
  insert into public.jobs (deal_id, client_id, service_type, billing_type, status, stage_id,
    billing_active, billing_only, parent_job_id, assigned_group_id)
    values (v_deal, v_client, 'local_seo', 'recurring_monthly', 'active',
            (select id from public.pipeline_stages where board='local_seo' and not archived order by position limit 1),
            true, false, v_parent_job, v_local_group);

  -- Delete the web_seo child (FK is parent_job_id → jobs cascade if defined;
  -- otherwise deletes cleanly since we're the parent and its parent_job_id
  -- points to the ai_seo parent, not the reverse).
  delete from public.jobs where id = v_web_child;

  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 300, 24,
            current_date - 30, current_date, 'paid');

  select count(*) into v_before from public.deal_payments where deal_id = v_deal;
  perform public.ensure_recurring_payments();
  select count(*) into v_after  from public.deal_payments where deal_id = v_deal;

  if (v_after - v_before) <> 1 then
    raise exception 'RESULT :: FAIL D4 :: expected delta=1 after deleting web_seo child, got %', (v_after - v_before);
  end if;

  perform public.reconcile_block_lifecycle(false);
  select ps.code into v_stage_after from public.deals d
    join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;
  if v_stage_after <> 'paid_in_full' then
    raise exception 'RESULT :: FAIL D4 :: expected paid_in_full (L3 grace), got %', v_stage_after;
  end if;
  raise exception 'RESULT :: PASS D4 :: delete web_seo child — parent chain fires, stage unchanged';
end $$;
rollback;

-- ---- Scenario D5: web_seo child is_blocked → cron unaffected -------
-- Job-level block flags don't gate ensure_recurring_payments. Parent
-- still fires. Reconcile: L3 grace keeps paid_in_full.
begin;
do $$
declare v_client uuid; v_deal uuid; v_before int; v_after int;
    v_parent_job uuid; v_web_child uuid; v_stage_after text;
    v_web_group uuid; v_local_group uuid;
begin
  insert into public.clients (name) values ('smoke_D5_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method, stage_id, accounting_stage_id)
    values (v_client, 'SMOKE-D5', 'smoke D5', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
    returning id into v_deal;

  select id into v_web_group from public.groups where code='web_seo';
  select id into v_local_group from public.groups where code='local_seo';

  insert into public.jobs (deal_id, client_id, service_type, billing_type, status, stage_id,
    billing_active, billing_only)
    values (v_deal, v_client, 'ai_seo', 'recurring_monthly', 'active',
            (select id from public.pipeline_stages where board='ai_seo' and not archived order by position limit 1),
            true, true)
    returning id into v_parent_job;
  insert into public.jobs (deal_id, client_id, service_type, billing_type, status, stage_id,
    billing_active, billing_only, parent_job_id, assigned_group_id)
    values (v_deal, v_client, 'web_seo', 'recurring_monthly', 'active',
            (select id from public.pipeline_stages where board='web_seo' and not archived order by position limit 1),
            true, false, v_parent_job, v_web_group)
    returning id into v_web_child;
  insert into public.jobs (deal_id, client_id, service_type, billing_type, status, stage_id,
    billing_active, billing_only, parent_job_id, assigned_group_id)
    values (v_deal, v_client, 'local_seo', 'recurring_monthly', 'active',
            (select id from public.pipeline_stages where board='local_seo' and not archived order by position limit 1),
            true, false, v_parent_job, v_local_group);

  update public.jobs
     set is_blocked=true, blocked_reason='account_on_hold', blocked_at=now()
   where id = v_web_child;

  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 300, 24,
            current_date - 30, current_date, 'paid');

  select count(*) into v_before from public.deal_payments where deal_id = v_deal;
  perform public.ensure_recurring_payments();
  select count(*) into v_after  from public.deal_payments where deal_id = v_deal;

  if (v_after - v_before) <> 1 then
    raise exception 'RESULT :: FAIL D5 :: expected delta=1 with blocked child, got %', (v_after - v_before);
  end if;

  perform public.reconcile_block_lifecycle(false);
  select ps.code into v_stage_after from public.deals d
    join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;
  if v_stage_after <> 'paid_in_full' then
    raise exception 'RESULT :: FAIL D5 :: expected paid_in_full (L3 grace), got %', v_stage_after;
  end if;
  raise exception 'RESULT :: PASS D5 :: blocked web_seo child leaves ai_seo cron chain untouched';
end $$;
rollback;

-- =====================================================================
-- Group E: Web dev installments (4 scenarios)
-- =====================================================================
-- Web dev = ONE job per website (per project_webdev_one_job_per_website).
-- Installments live as separate one_time deal_payments rows. Cron never
-- touches one_time rows; reconcile drives stage from deal_next_due
-- (min unpaid start_date across ALL payment rows).

-- ---- Scenario E1: 3 one_time installments, cron ignores them -------
-- Seed 3 pending one_time rows (30/30/40) with staggered start_dates.
-- Manually stage the deal in paid_in_full afterwards to test cron in
-- isolation (INSERTs would otherwise auto-move to awaiting_payment).
-- Cron delta must be 0.
begin;
do $$
declare v_client uuid; v_deal uuid; v_before int; v_after int;
    v_stage_after text; v_paid_in_full_id uuid;
begin
  insert into public.clients (name) values ('smoke_E1_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method, stage_id, accounting_stage_id)
    values (v_client, 'SMOKE-E1', 'smoke E1', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='new'))
    returning id into v_deal;

  -- 3 installments: 30/30/40, dates 30d apart, all pending.
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'web_dev', 0, 'one_time', 30, 24,
            current_date, current_date, 'pending');
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'web_dev', 1, 'one_time', 30, 24,
            current_date + 30, current_date + 30, 'pending');
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'web_dev', 2, 'one_time', 40, 24,
            current_date + 60, current_date + 60, 'pending');

  -- Manually park in paid_in_full to isolate cron (INSERT trigger would
  -- have moved us to awaiting_payment; we override to test cron in vacuo).
  select id into v_paid_in_full_id from public.pipeline_stages
    where board='accounting_onboarding' and code='paid_in_full';
  update public.deals set accounting_stage_id = v_paid_in_full_id where id = v_deal;

  select count(*) into v_before from public.deal_payments where deal_id = v_deal;
  perform public.ensure_recurring_payments();
  select count(*) into v_after  from public.deal_payments where deal_id = v_deal;

  if (v_after - v_before) <> 0 then
    raise exception 'RESULT :: FAIL E1 :: cron touched one_time rows: delta=%', (v_after - v_before);
  end if;

  -- Reconcile: deal_next_due = today (installment 1 pending, start=today).
  -- target = on_hold; L3 grace only protects if we came from paid_in_full
  -- (we do), but grace ignores unpaid rows created <24h ago → v_eff_next_due
  -- is null (all 3 rows are fresh) → v_eff_target = paid_in_full →
  -- stage stays paid_in_full.
  perform public.reconcile_block_lifecycle(false);
  select ps.code into v_stage_after from public.deals d
    join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;
  if v_stage_after <> 'paid_in_full' then
    raise exception 'RESULT :: CONCERN E1 :: expected paid_in_full via L3 grace, got % (delta=0 confirmed)', v_stage_after;
  end if;
  raise exception 'RESULT :: PASS E1 :: cron ignores one_time (delta=0); reconcile keeps paid_in_full under L3';
end $$;
rollback;

-- ---- Scenario E2: pay installment 1 only, then all 3 --------------
-- Partial pay leaves min(unpaid start_date) at installment 2's date →
-- reconcile target depends on how far out it is. With inst.2 at +30d
-- (>7d), reconcile targets paid_in_full (else branch), so stage stays
-- paid_in_full. After paying all 3, deal_next_due=null → paid_in_full.
begin;
do $$
declare v_client uuid; v_deal uuid; v_row1 uuid; v_row2 uuid; v_row3 uuid;
    v_stage_partial text; v_stage_full text; v_paid_in_full_id uuid;
begin
  insert into public.clients (name) values ('smoke_E2_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method, stage_id, accounting_stage_id)
    values (v_client, 'SMOKE-E2', 'smoke E2', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='new'))
    returning id into v_deal;

  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'web_dev', 0, 'one_time', 30, 24,
            current_date, current_date, 'pending')
    returning id into v_row1;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'web_dev', 1, 'one_time', 30, 24,
            current_date + 30, current_date + 30, 'pending')
    returning id into v_row2;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'web_dev', 2, 'one_time', 40, 24,
            current_date + 60, current_date + 60, 'pending')
    returning id into v_row3;

  select id into v_paid_in_full_id from public.pipeline_stages
    where board='accounting_onboarding' and code='paid_in_full';
  update public.deals set accounting_stage_id = v_paid_in_full_id where id = v_deal;

  -- Pay installment 1 → next_due = inst.2 (+30d). Reconcile: target = paid_in_full (>+7d).
  update public.deal_payments set status='paid' where id = v_row1;
  perform public.reconcile_block_lifecycle(false);
  select ps.code into v_stage_partial from public.deals d
    join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;
  if v_stage_partial <> 'paid_in_full' then
    raise exception 'RESULT :: CONCERN E2 :: stage after 1/3 paid = %, expected paid_in_full (inst.2 > +7d)', v_stage_partial;
  end if;

  -- Pay remaining. deal_next_due = null → target = paid_in_full → unchanged.
  update public.deal_payments set status='paid' where id in (v_row2, v_row3);
  perform public.reconcile_block_lifecycle(false);
  select ps.code into v_stage_full from public.deals d
    join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;
  if v_stage_full <> 'paid_in_full' then
    raise exception 'RESULT :: FAIL E2 :: expected paid_in_full after all 3 paid, got %', v_stage_full;
  end if;
  raise exception 'RESULT :: PASS E2 :: web dev installments 1→3 paid leaves deal paid_in_full';
end $$;
rollback;

-- ---- Scenario E3: installment 2 backdated past-due → on_hold ------
-- mark_overdue_payments flips one_time to overdue when end_date < today
-- (strict "<"). Set both start_date and end_date of inst.2 to today-5
-- so it's past-due. Reconcile: deal_next_due = today-5 (older than 24h?
-- No — row was inserted moments ago; L3 grace ignores it. So v_eff_next_due
-- is null → grace protects paid_in_full. To exercise the true on_hold
-- transition, we age the row's created_at to >24h too. Then grace lifts
-- and reconcile targets on_hold.
begin;
do $$
declare v_client uuid; v_deal uuid; v_row2 uuid;
    v_status_after_overdue text; v_stage_after_reconcile text;
    v_paid_in_full_id uuid;
begin
  insert into public.clients (name) values ('smoke_E3_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method, stage_id, accounting_stage_id)
    values (v_client, 'SMOKE-E3', 'smoke E3', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='new'))
    returning id into v_deal;

  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status, created_at)
    values (v_deal, 'web_dev', 0, 'one_time', 30, 24,
            current_date, current_date, 'pending', now() - interval '30 days');
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status, created_at)
    values (v_deal, 'web_dev', 1, 'one_time', 30, 24,
            current_date - 5, current_date - 5, 'pending', now() - interval '30 days')
    returning id into v_row2;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status, created_at)
    values (v_deal, 'web_dev', 2, 'one_time', 40, 24,
            current_date + 60, current_date + 60, 'pending', now() - interval '30 days');

  select id into v_paid_in_full_id from public.pipeline_stages
    where board='accounting_onboarding' and code='paid_in_full';
  update public.deals set accounting_stage_id = v_paid_in_full_id where id = v_deal;

  perform public.mark_overdue_payments();
  select status into v_status_after_overdue from public.deal_payments where id = v_row2;
  if v_status_after_overdue <> 'overdue' then
    raise exception 'RESULT :: FAIL E3 :: expected overdue on backdated one_time, got %', v_status_after_overdue;
  end if;

  perform public.reconcile_block_lifecycle(false);
  select ps.code into v_stage_after_reconcile from public.deals d
    join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;
  -- inst.1 is start=today (unpaid), so min(unpaid start_date)=today (grace
  -- ignores fresh rows, but we aged all rows to 30d → grace does NOT hide
  -- them). Actually min unpaid is today-5 (inst.2). target = on_hold.
  if v_stage_after_reconcile <> 'on_hold' then
    raise exception 'RESULT :: FAIL E3 :: expected on_hold with 30-day-old past-due inst.2, got %', v_stage_after_reconcile;
  end if;
  raise exception 'RESULT :: PASS E3 :: backdated installment 2 → overdue + reconcile → on_hold';
end $$;
rollback;

-- ---- Scenario E4: custom 5-row schedule, sequential paid → stage flow
-- 5 one_time rows staggered across 5 weeks. Cron delta=0. After paying
-- all: deal_next_due=null → paid_in_full. This exercises reconcile
-- against an arbitrary custom schedule.
begin;
do $$
declare v_client uuid; v_deal uuid;
    v_before int; v_after int;
    v_row1 uuid; v_row2 uuid; v_row3 uuid; v_row4 uuid; v_row5 uuid;
    v_stage_after text; v_paid_in_full_id uuid;
begin
  insert into public.clients (name) values ('smoke_E4_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method, stage_id, accounting_stage_id)
    values (v_client, 'SMOKE-E4', 'smoke E4', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='new'))
    returning id into v_deal;

  -- 5 varied installments across 5 weeks
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'web_dev', 0, 'one_time', 10, 24,
            current_date + 7, current_date + 7, 'pending')
    returning id into v_row1;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'web_dev', 1, 'one_time', 20, 24,
            current_date + 14, current_date + 14, 'pending')
    returning id into v_row2;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'web_dev', 2, 'one_time', 30, 24,
            current_date + 21, current_date + 21, 'pending')
    returning id into v_row3;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'web_dev', 3, 'one_time', 25, 24,
            current_date + 28, current_date + 28, 'pending')
    returning id into v_row4;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'web_dev', 4, 'one_time', 15, 24,
            current_date + 35, current_date + 35, 'pending')
    returning id into v_row5;

  select id into v_paid_in_full_id from public.pipeline_stages
    where board='accounting_onboarding' and code='paid_in_full';
  update public.deals set accounting_stage_id = v_paid_in_full_id where id = v_deal;

  select count(*) into v_before from public.deal_payments where deal_id = v_deal;
  perform public.ensure_recurring_payments();
  select count(*) into v_after  from public.deal_payments where deal_id = v_deal;
  if (v_after - v_before) <> 0 then
    raise exception 'RESULT :: FAIL E4 :: cron touched 5-installment schedule: delta=%', (v_after - v_before);
  end if;

  -- Pay all 5 sequentially, reconcile after each; final state = paid_in_full.
  update public.deal_payments set status='paid' where id = v_row1;
  perform public.reconcile_block_lifecycle(false);
  update public.deal_payments set status='paid' where id = v_row2;
  perform public.reconcile_block_lifecycle(false);
  update public.deal_payments set status='paid' where id = v_row3;
  perform public.reconcile_block_lifecycle(false);
  update public.deal_payments set status='paid' where id = v_row4;
  perform public.reconcile_block_lifecycle(false);
  update public.deal_payments set status='paid' where id = v_row5;
  perform public.reconcile_block_lifecycle(false);

  select ps.code into v_stage_after from public.deals d
    join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;
  if v_stage_after <> 'paid_in_full' then
    raise exception 'RESULT :: FAIL E4 :: expected paid_in_full after all 5 paid, got %', v_stage_after;
  end if;
  raise exception 'RESULT :: PASS E4 :: 5-installment custom schedule cron-ignored + reconcile paid_in_full';
end $$;
rollback;

-- =====================================================================
-- Group F: Partial payment stage (5 scenarios)
-- =====================================================================
-- The `partial_payment` stage is accountant-set manually. Neither the
-- move_to_awaiting trigger nor reconcile_block_lifecycle move deals in
-- or out of it automatically. 12 deals in prod sit here.

-- ---- Scenario F1: partial_payment + null-dated pending → skip -----
-- Reconcile's cur_code IN ('awaiting_payment','on_hold','paid_in_full')
-- gate excludes `partial_payment` → deal is not touched.
begin;
do $$
declare v_client uuid; v_deal uuid; v_stage_after text;
begin
  insert into public.clients (name) values ('smoke_F1_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method, stage_id, accounting_stage_id)
    values (v_client, 'SMOKE-F1', 'smoke F1', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='partial_payment'))
    returning id into v_deal;

  -- One paid row + one null-dated pending row.
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'web_dev', 0, 'one_time', 100, 24,
            current_date - 30, current_date - 30, 'paid');
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'web_dev', 1, 'one_time', 50, 24,
            null, null, 'pending');

  perform public.reconcile_block_lifecycle(false);
  select ps.code into v_stage_after from public.deals d
    join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;
  if v_stage_after <> 'partial_payment' then
    raise exception 'RESULT :: FAIL F1 :: expected partial_payment (reconcile skips), got %', v_stage_after;
  end if;
  raise exception 'RESULT :: PASS F1 :: reconcile skips partial_payment (not in eligible cur_code list)';
end $$;
rollback;

-- ---- Scenario F2: partial_payment + past-due pending → still skip -
-- mark_overdue flips the row; reconcile still skips partial_payment.
begin;
do $$
declare v_client uuid; v_deal uuid; v_row uuid;
    v_status_after text; v_stage_after text;
begin
  insert into public.clients (name) values ('smoke_F2_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method, stage_id, accounting_stage_id)
    values (v_client, 'SMOKE-F2', 'smoke F2', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='partial_payment'))
    returning id into v_deal;

  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'web_dev', 0, 'one_time', 100, 24,
            current_date - 30, current_date - 30, 'paid');
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 50, 24,
            current_date - 10, current_date + 20, 'pending')
    returning id into v_row;

  perform public.mark_overdue_payments();
  select status into v_status_after from public.deal_payments where id = v_row;
  if v_status_after <> 'overdue' then
    raise exception 'RESULT :: FAIL F2 :: expected overdue on past-due recurring, got %', v_status_after;
  end if;

  perform public.reconcile_block_lifecycle(false);
  select ps.code into v_stage_after from public.deals d
    join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;
  if v_stage_after <> 'partial_payment' then
    raise exception 'RESULT :: FAIL F2 :: expected partial_payment (reconcile skips), got %', v_stage_after;
  end if;
  raise exception 'RESULT :: PASS F2 :: overdue row on partial_payment deal — reconcile still skips';
end $$;
rollback;

-- ---- Scenario F3: partial_payment + all paid → stays partial ------
-- release_from_on_hold trigger only fires when cur_code=on_hold, so all-
-- paid on partial_payment leaves the stage manual until accountant moves.
begin;
do $$
declare v_client uuid; v_deal uuid; v_row uuid; v_stage_after text;
begin
  insert into public.clients (name) values ('smoke_F3_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method, stage_id, accounting_stage_id)
    values (v_client, 'SMOKE-F3', 'smoke F3', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='partial_payment'))
    returning id into v_deal;

  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'web_dev', 0, 'one_time', 100, 24,
            current_date - 30, current_date - 30, 'paid');
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'web_dev', 1, 'one_time', 50, 24,
            current_date - 10, current_date - 10, 'pending')
    returning id into v_row;

  update public.deal_payments set status='paid' where id = v_row;
  perform public.reconcile_block_lifecycle(false);

  select ps.code into v_stage_after from public.deals d
    join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;
  if v_stage_after <> 'partial_payment' then
    raise exception 'RESULT :: FAIL F3 :: expected partial_payment (release trigger fires only on_hold), got %', v_stage_after;
  end if;
  raise exception 'RESULT :: PASS F3 :: all-paid on partial_payment stays put — accountant-managed';
end $$;
rollback;

-- ---- Scenario F4: partial_payment + insert paid row → stays partial
-- The move_to_awaiting AFTER-INSERT trigger's guard includes
-- ('new','on_hold','partial_payment') as skip codes → INSERT does not
-- reroute the deal.
begin;
do $$
declare v_client uuid; v_deal uuid; v_stage_after text;
begin
  insert into public.clients (name) values ('smoke_F4_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method, stage_id, accounting_stage_id)
    values (v_client, 'SMOKE-F4', 'smoke F4', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='partial_payment'))
    returning id into v_deal;

  -- No prior rows. INSERT a paid recurring row.
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 200, 24,
            current_date - 30, current_date, 'paid');

  select ps.code into v_stage_after from public.deals d
    join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;
  if v_stage_after <> 'partial_payment' then
    raise exception 'RESULT :: FAIL F4 :: expected partial_payment after paid INSERT, got %', v_stage_after;
  end if;
  raise exception 'RESULT :: PASS F4 :: paid INSERT on partial_payment leaves stage untouched (trigger guard)';
end $$;
rollback;

-- ---- Scenario F5: partial_payment → manual paid_in_full override --
-- Accountant manually promotes to paid_in_full. Subsequent reconcile
-- with no unpaid rows leaves it at paid_in_full (deal_next_due=null →
-- target=paid_in_full → no change).
begin;
do $$
declare v_client uuid; v_deal uuid; v_paid_in_full_id uuid; v_stage_after text;
begin
  insert into public.clients (name) values ('smoke_F5_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, payment_method, stage_id, accounting_stage_id)
    values (v_client, 'SMOKE-F5', 'smoke F5', 'cash',
            (select id from public.pipeline_stages where board='sales' and code='won'),
            (select id from public.pipeline_stages where board='accounting_onboarding' and code='partial_payment'))
    returning id into v_deal;

  -- Everything paid, no unpaid remaining.
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'web_dev', 0, 'one_time', 100, 24,
            current_date - 30, current_date - 30, 'paid');
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'web_dev', 1, 'one_time', 50, 24,
            current_date - 10, current_date - 10, 'paid');

  -- Manual promotion.
  select id into v_paid_in_full_id from public.pipeline_stages
    where board='accounting_onboarding' and code='paid_in_full';
  update public.deals set accounting_stage_id = v_paid_in_full_id where id = v_deal;

  select ps.code into v_stage_after from public.deals d
    join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;
  if v_stage_after <> 'paid_in_full' then
    raise exception 'RESULT :: FAIL F5 :: manual override failed, got %', v_stage_after;
  end if;

  perform public.reconcile_block_lifecycle(false);
  select ps.code into v_stage_after from public.deals d
    join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;
  if v_stage_after <> 'paid_in_full' then
    raise exception 'RESULT :: FAIL F5 :: reconcile disturbed manual promotion, got %', v_stage_after;
  end if;
  raise exception 'RESULT :: PASS F5 :: manual promotion partial_payment→paid_in_full survives reconcile';
end $$;
rollback;

-- =====================================================================
-- End Groups D + E + F (14 scenarios). Groups G–K appended in later tasks.
-- =====================================================================
