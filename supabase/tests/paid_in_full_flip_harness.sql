-- SUPERSEDED (2026-07-02): the 24h grace + move_to_awaiting + release_from_on_hold this
-- file exercises were RETIRED by the single-owner stage change. Grace/mover scenarios here
-- now FAIL by design (deal goes on_hold instead of grace-held paid_in_full; on_hold is not
-- auto-lifted per Decision B). Authoritative coverage: supabase/tests/reconcile_deal_stage.sql
-- + spec docs/superpowers/specs/2026-07-02-accounting-stage-single-owner-design.md. Kept for history.

-- Paid-In-Full flip-flop harness. Run each scenario in its own transaction,
-- rollback at the end so the DB is untouched. Each scenario raises with a
-- clear REPRO message on failure and prints 'OK: <name>' on success.
--
-- Schema note (2026-07-01): the plan's example inserts only client_id/code/
-- payment_method/accounting_stage_id on public.deals, but prod requires
-- title (NOT NULL) and stage_id (NOT NULL, references the sales kanban).
-- Every deals insert below sets title='HARN-<letter>' and stage_id='won'
-- so the FK/NOT NULL constraints pass without changing scenario semantics.

\set ON_ERROR_STOP on

-- ---- Scenario A: single-service recurring, cron creates next -----------
begin;
do $$
declare v_client uuid; v_deal uuid; v_before int; v_after int;
        v_paid_id uuid; v_won_id uuid;
begin
  select id into v_paid_id from public.pipeline_stages
    where board='accounting_onboarding' and code='paid_in_full';
  select id into v_won_id  from public.pipeline_stages
    where board='sales' and code='won';
  insert into public.clients (name) values ('harness_A_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, stage_id, payment_method, accounting_stage_id)
    values (v_client, 'HARN-A', 'HARN-A', v_won_id, 'cash', v_paid_id)
    returning id into v_deal;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly',
            100, 24, current_date - 40, current_date - 10, 'paid');
  select count(*) into v_before from public.deal_payments where deal_id = v_deal;
  perform public.ensure_recurring_payments();
  select count(*) into v_after  from public.deal_payments where deal_id = v_deal;
  if v_after <> v_before + 1 then
    raise exception 'A FAILED: expected 1 new row, got %', v_after - v_before;
  end if;
  raise notice 'OK: A single-service recurring next-period created';
end $$;
rollback;

-- ---- Scenario B: bug repro — manual advance on service_index=1 --------
begin;
do $$
declare v_client uuid; v_deal uuid; v_before int; v_after int;
        v_paid_id uuid; v_won_id uuid;
begin
  select id into v_paid_id from public.pipeline_stages
    where board='accounting_onboarding' and code='paid_in_full';
  select id into v_won_id  from public.pipeline_stages
    where board='sales' and code='won';
  insert into public.clients (name) values ('harness_B_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, stage_id, payment_method, accounting_stage_id)
    values (v_client, 'HARN-B', 'HARN-B', v_won_id, 'cash', v_paid_id)
    returning id into v_deal;
  -- Original cron row (service_index=0)
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly',
            100, 24, current_date - 40, current_date - 10, 'paid');
  -- Manual advance row (service_index=1) covering the next period
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'ai_seo', 1, 'recurring_monthly',
            100, 24, current_date - 10, current_date + 20, 'paid');
  select count(*) into v_before from public.deal_payments where deal_id = v_deal;
  perform public.ensure_recurring_payments();
  select count(*) into v_after  from public.deal_payments where deal_id = v_deal;
  if v_after > v_before then
    raise exception 'B REPRO: cron created % duplicate row(s) despite live next-period coverage', v_after - v_before;
  end if;
  raise notice 'OK: B manual-advance duplicate suppressed';
end $$;
rollback;

-- ---- Scenario C: same as B but trigger-side (INSERT bypassing the cron)
begin;
do $$
declare v_client uuid; v_deal uuid; v_new_id uuid;
        v_paid_id uuid; v_won_id uuid;
begin
  select id into v_paid_id from public.pipeline_stages
    where board='accounting_onboarding' and code='paid_in_full';
  select id into v_won_id  from public.pipeline_stages
    where board='sales' and code='won';
  insert into public.clients (name) values ('harness_C_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, stage_id, payment_method, accounting_stage_id)
    values (v_client, 'HARN-C', 'HARN-C', v_won_id, 'cash', v_paid_id)
    returning id into v_deal;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly',
            100, 24, current_date - 10, current_date + 20, 'paid');
  -- Attempt to insert a duplicate on a DIFFERENT service_index
  begin
    insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
      amount_net, vat_rate, start_date, end_date, status)
      values (v_deal, 'ai_seo', 1, 'recurring_monthly',
              100, 24, current_date - 10, current_date + 20, 'pending')
      returning id into v_new_id;
  exception when others then
    raise exception 'C unexpected exception: %', sqlerrm;
  end;
  if v_new_id is not null then
    raise exception 'C REPRO: trigger allowed duplicate insert (id=%)', v_new_id;
  end if;
  raise notice 'OK: C insert-time trigger blocked cross-index dupe';
end $$;
rollback;

-- ---- Scenario D: yearly billing, cron creates next annual --------------
begin;
do $$
declare v_client uuid; v_deal uuid; v_before int; v_after int;
        v_paid_id uuid; v_won_id uuid;
begin
  select id into v_paid_id from public.pipeline_stages
    where board='accounting_onboarding' and code='paid_in_full';
  select id into v_won_id  from public.pipeline_stages
    where board='sales' and code='won';
  insert into public.clients (name) values ('harness_D_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, stage_id, payment_method, accounting_stage_id)
    values (v_client, 'HARN-D', 'HARN-D', v_won_id, 'cash', v_paid_id)
    returning id into v_deal;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'hosting', 0, 'recurring_yearly',
            120, 24, current_date - 380, current_date - 10, 'paid');
  select count(*) into v_before from public.deal_payments where deal_id = v_deal;
  perform public.ensure_recurring_payments();
  select count(*) into v_after  from public.deal_payments where deal_id = v_deal;
  if v_after <> v_before + 1 then
    raise exception 'D FAILED: yearly next-period not created, got % new', v_after - v_before;
  end if;
  raise notice 'OK: D yearly recurring';
end $$;
rollback;

-- ---- Scenario E: cancelled row does NOT block cron ----------------------
begin;
do $$
declare v_client uuid; v_deal uuid; v_before int; v_after int;
        v_paid_id uuid; v_won_id uuid;
begin
  select id into v_paid_id from public.pipeline_stages
    where board='accounting_onboarding' and code='paid_in_full';
  select id into v_won_id  from public.pipeline_stages
    where board='sales' and code='won';
  insert into public.clients (name) values ('harness_E_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, stage_id, payment_method, accounting_stage_id)
    values (v_client, 'HARN-E', 'HARN-E', v_won_id, 'cash', v_paid_id)
    returning id into v_deal;
  -- Existing paid row
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'web_seo', 0, 'recurring_monthly',
            100, 24, current_date - 40, current_date - 10, 'paid');
  -- Cancelled row for the "next" period — should not block
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'web_seo', 0, 'recurring_monthly',
            100, 24, current_date - 10, current_date + 20, 'cancelled');
  select count(*) into v_before from public.deal_payments where deal_id = v_deal;
  perform public.ensure_recurring_payments();
  select count(*) into v_after  from public.deal_payments where deal_id = v_deal;
  if v_after <> v_before + 1 then
    raise exception 'E FAILED: cancelled row should not block cron, got % new', v_after - v_before;
  end if;
  raise notice 'OK: E cancelled row ignored by guard';
end $$;
rollback;

-- ---- Scenario F: multi-service deal, one row per service_type ----------
begin;
do $$
declare v_client uuid; v_deal uuid; v_before int; v_after int;
        v_paid_id uuid; v_won_id uuid;
begin
  select id into v_paid_id from public.pipeline_stages
    where board='accounting_onboarding' and code='paid_in_full';
  select id into v_won_id  from public.pipeline_stages
    where board='sales' and code='won';
  insert into public.clients (name) values ('harness_F_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, stage_id, payment_method, accounting_stage_id)
    values (v_client, 'HARN-F', 'HARN-F', v_won_id, 'cash', v_paid_id)
    returning id into v_deal;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'web_seo',   0, 'recurring_monthly', 100, 24, current_date - 40, current_date - 10, 'paid'),
           (v_deal, 'local_seo', 0, 'recurring_monthly', 100, 24, current_date - 40, current_date - 10, 'paid'),
           (v_deal, 'hosting',   0, 'recurring_yearly',  120, 24, current_date - 380, current_date - 10, 'paid');
  select count(*) into v_before from public.deal_payments where deal_id = v_deal;
  perform public.ensure_recurring_payments();
  select count(*) into v_after  from public.deal_payments where deal_id = v_deal;
  if v_after <> v_before + 3 then
    raise exception 'F FAILED: expected 3 new rows (1/service_type), got %', v_after - v_before;
  end if;
  raise notice 'OK: F multi-service creates one row per service_type';
end $$;
rollback;

-- ---- Scenario G: reconcile respects 24h grace on cron-created rows -----
begin;
do $$
declare v_client uuid; v_deal uuid; v_stage text; v_paid_id uuid; v_won_id uuid;
begin
  select id into v_paid_id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full';
  select id into v_won_id  from public.pipeline_stages where board='sales' and code='won';
  insert into public.clients (name) values ('harness_G_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, stage_id, payment_method, accounting_stage_id)
    values (v_client, 'HARN-G', 'HARN-G', v_won_id, 'cash', v_paid_id) returning id into v_deal;
  -- Paid current period + a "just now cron-created" phantom past-dated row
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status, created_at)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
            current_date - 40, current_date - 10, 'paid', now() - interval '30 days'),
           (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
            current_date - 10, current_date + 20, 'overdue', now() - interval '3 hours');
  perform public.reconcile_block_lifecycle(false);
  select ps.code into v_stage from public.deals d
    join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;
  if v_stage <> 'paid_in_full' then
    raise exception 'G REPRO: deal flipped to % despite <24h cron-created row', v_stage;
  end if;
  raise notice 'OK: G 24h grace held paid_in_full';
end $$;
rollback;

-- ---- Scenario H: reconcile still flips on legitimately-old unpaid ------
begin;
do $$
declare v_client uuid; v_deal uuid; v_stage text; v_paid_id uuid; v_won_id uuid;
begin
  select id into v_paid_id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full';
  select id into v_won_id  from public.pipeline_stages where board='sales' and code='won';
  insert into public.clients (name) values ('harness_H_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, stage_id, payment_method, accounting_stage_id)
    values (v_client, 'HARN-H', 'HARN-H', v_won_id, 'cash', v_paid_id) returning id into v_deal;
  -- Genuinely-old unpaid row (created 5 days ago, past-due)
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status, created_at)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
            current_date - 10, current_date + 20, 'overdue', now() - interval '5 days');
  perform public.reconcile_block_lifecycle(false);
  select ps.code into v_stage from public.deals d
    join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;
  if v_stage <> 'on_hold' then
    raise exception 'H FAILED: expected on_hold (legitimate overdue), got %', v_stage;
  end if;
  raise notice 'OK: H legitimate flip to on_hold preserved';
end $$;
rollback;

-- ---- Scenario I: idempotency — running fix.sql twice is a no-op --------
-- (Handled by the migration file being written with `create or replace`
--  and `create table if not exists`; verified by rerunning Step 5.)

-- ---- Scenario J: integrity audit detects duplicates -------------------
-- Uses `alter table ... disable trigger user` inside the txn to bypass the
-- Layer 2 dup-guard trigger while seeding the duplicate rows. Everything
-- rolls back so nothing persists. Supabase's `postgres` role probably
-- can't `set session_replication_role`, so this alter-table pattern is
-- used instead (Task 1's implementer flagged that).
begin;
do $$
declare v_client uuid; v_deal uuid; v_alerts int;
        v_paid_id uuid; v_won_id uuid;
begin
  select id into v_paid_id from public.pipeline_stages
    where board='accounting_onboarding' and code='paid_in_full';
  select id into v_won_id  from public.pipeline_stages
    where board='sales' and code='won';
  insert into public.clients (name) values ('harness_J_' || gen_random_uuid()::text) returning id into v_client;
  insert into public.deals (client_id, code, title, stage_id, payment_method, accounting_stage_id)
    values (v_client, 'HARN-J', 'HARN-J', v_won_id, 'cash', v_paid_id)
    returning id into v_deal;
  -- Two live rows same period (Layer 2 trigger would normally reject the
  -- 2nd — disable user triggers to seed the duplicate the audit catches).
  alter table public.deal_payments disable trigger user;
  insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
    amount_net, vat_rate, start_date, end_date, status)
    values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
            current_date - 40, current_date - 10, 'paid'),
           (v_deal, 'ai_seo', 1, 'recurring_monthly', 100, 24,
            current_date - 40, current_date - 10, 'paid');
  alter table public.deal_payments enable trigger user;
  select public.reconcile_payment_integrity() into v_alerts;
  raise exception 'HARNESS_J_RESULT :: %', case when v_alerts >= 1 then 'PASS J: audit flagged dupes (alerts=' || v_alerts || ')' else 'FAIL J: audit missed dupes (alerts=' || v_alerts || ')' end;
end $$;
rollback;
