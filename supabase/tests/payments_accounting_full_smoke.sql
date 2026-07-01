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
-- End Groups A + B + C (22 scenarios). Groups D–K appended in later tasks.
-- =====================================================================
