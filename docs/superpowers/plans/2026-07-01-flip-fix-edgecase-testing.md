# Flip-Fix Edge-Case Testing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the four-layer paid-in-full flip-fix (shipped 2026-07-01, migration `20260701010000_paid_in_full_flip_fix.sql`) holds against every plausible accounting mid-cycle payment modification. Identify FAIL / CONCERN cases and propose mitigations. Persist the test matrix as a regression harness.

**Architecture:** All tests run as SQL savepoint-rollback blocks against prod via Supabase MCP `execute_sql` — nothing persists. Each scenario seeds a synthetic deal, applies an "accounting-style" modification, invokes the state machine (cron / reconcile / trigger cascade), and asserts the expected outcome via the terminal-`RAISE EXCEPTION 'RESULT :: PASS/FAIL <details>'` pattern (`execute_sql` swallows `NOTICE`). Findings are compiled into a markdown report at `docs/superpowers/reports/2026-07-01-flip-fix-edgecase-findings.md`.

**Tech Stack:** Postgres 15 (Supabase), PL/pgSQL, `mcp__plugin_supabase_supabase__execute_sql`. No frontend/backend code changes.

**Scope:**
- IN: Accounting mid-cycle modifications on `deal_payments` (INSERT / UPDATE / DELETE), deal-level modifications (`payment_method`, `accounting_stage_id`, `archived`), and their downstream effect on the four defense layers.
- IN: L2's UPDATE-bypass gap (L2 trigger only fires on INSERT — UPDATE-based dupes aren't caught structurally).
- IN: L3's 24 h grace edge cases (row age boundary conditions).
- IN: Partial-payment scenarios (12 deals in prod are in `partial_payment` stage; verified pattern is separate `one_time` rows with null dates — but a REGRESSION could occur if someone starts using recurring dupes for partials).
- OUT: Frontend UX regressions (silent L2 drop feedback to the UI is a known trade-off, not in scope).
- OUT: Non-accounting flip-flop causes (network partitions, DB replication lag, Vercel edge caching).
- OUT: Any changes to the four defense layers — this plan is DIAGNOSTIC only. If a FAIL is found, Task 5 drafts a mitigation plan; execution of that plan is a separate follow-up.

**Prod schema facts confirmed at plan-write time (2026-07-01):**
- `deal_payments` columns: `id, deal_id, service_type (nullable), service_index (nullable), billing_type (NOT NULL), label, amount, start_date, end_date, status, invoice_number, paid_at, created_at, updated_at, amount_net, vat_rate, vat_amount (GENERATED), amount_gross (GENERATED)`. `amount` is a separate column from `amount_net` but appears unused (always `0.00`).
- Status CHECK: `pending | paid | overdue` only. `'cancelled'` is not valid.
- Billing_type CHECK: `one_time | recurring_monthly | recurring_yearly`.
- `deal_payments_deal_id_fkey` cascades on delete.
- 12 deals in `partial_payment` stage; partials use `one_time` rows with null start/end dates → NOT blocked by L2 (L2 only guards recurring).
- Triggers on `deal_payments`: `default_service_keys` (BEFORE INSERT), `no_duplicate_period` (BEFORE INSERT — the L2 one), `move_to_awaiting` (AFTER INSERT), `release_from_on_hold` (AFTER UPDATE), `set_updated_at` (BEFORE UPDATE), `log_activity` (AFTER INSERT / UPDATE / DELETE).
- Advisory lock: `pg_advisory_xact_lock(hashtext('ensure_recurring_payments'))` — protects cron from concurrent runs.

**Test matrix (35 scenarios across 10 categories):**

| Cat | # | Description | Layer(s) exercised | Risk |
|---|---|---|---|---|
| A | 5 | Date modifications on recurring rows | L1, L3 | HIGH |
| B | 4 | Amount modifications on recurring rows | L1 | LOW |
| C | 3 | Status modifications on recurring rows | L3, release trigger | MEDIUM |
| D | 4 | Service classification changes | L1, L2 | HIGH |
| E | 5 | Row lifecycle (INSERT / DELETE) | L1, L2, L3 | HIGH |
| F | 4 | Deal-level modifications | L1, L3 | LOW |
| G | 3 | Trigger cascade combinations | move_to_awaiting × L3 | MEDIUM |
| H | 3 | Concurrent modifications | Advisory lock | MEDIUM |
| I | 4 | L3 grace boundary conditions | L3 | HIGH |
| J | 3 | L4 audit corner cases | L4 | LOW |

**Files:**
- Create: `supabase/tests/paid_in_full_flip_edgecases.sql` — 35-scenario harness (persists as regression file).
- Create: `docs/superpowers/reports/2026-07-01-flip-fix-edgecase-findings.md` — PASS/FAIL/CONCERN report per scenario + mitigation proposals.

**Changes / Revert:** No prod state changes. All scenarios run in `begin;...rollback;` savepoints. No commit needed for the state, only for the two new files above. Revert = `git revert <commit>` on the two files.

---

### Task 1: Baseline smoke + schema baseline + probe hidden triggers

**Files:**
- Read only

Context: before running the edge-case matrix, verify the current fix is still deployed as expected and inventory every trigger/RPC that touches `deal_payments`. If a subsequent developer changed the fix functions after 2026-07-01, our tests may show different results than intended.

- [ ] **Step 1: Confirm the 4 deployed layers are the ones we shipped.** Run via `mcp__plugin_supabase_supabase__execute_sql`:

  ```sql
  select
    pg_get_functiondef('public.ensure_recurring_payments()'::regprocedure) ~ 'service_type = dp\.service_type'
      as L1_ok,
    pg_get_functiondef('public.deal_payments_no_duplicate_period()'::regprocedure) ~ 'service_type is not distinct from new\.service_type'
      as L2_ok,
    pg_get_functiondef('public.reconcile_block_lifecycle(boolean)'::regprocedure) ~ 'created_at <= now\(\) - interval ''24 hours'''
      as L3_ok,
    exists (select 1 from pg_proc where proname = 'reconcile_payment_integrity') as L4_ok,
    exists (select 1 from cron.job where jobname = 'reconcile_payment_integrity' and active) as L4_cron_ok;
  ```

  Expected: all 5 booleans `true`. If any is `false`, STOP and report NEEDS_CONTEXT — the fix has drifted from what we're testing against.

- [ ] **Step 2: Inventory every trigger on `deal_payments`.**

  ```sql
  select tgname, pg_get_triggerdef(oid) from pg_trigger
    where tgrelid = 'public.deal_payments'::regclass and not tgisinternal
    order by tgname;
  ```

  Save output verbatim. Report each trigger name and what it does. Watch for triggers we don't already know about (`default_service_keys`, `no_duplicate_period`, `move_to_awaiting`, `release_from_on_hold`, `set_updated_at`, `log_activity`).

- [ ] **Step 3: Confirm the harness from the fix plan still passes.** Read `supabase/tests/paid_in_full_flip_harness.sql` and run scenarios A, B, C, D, F, G, H via `execute_sql`. Each should raise its `HARNESS_X_RESULT :: PASS ...` message. If any FAIL, STOP — regressions on the fix itself need to be resolved before edge-case testing is meaningful.

- [ ] **Step 4: Snapshot current prod counters.** For the report:

  ```sql
  select
    (select count(*) from public.data_integrity_alerts where resolved_at is null) as open_alerts,
    (select count(*) from public.deal_payments where billing_type in ('recurring_monthly','recurring_yearly')) as recurring_rows,
    (select count(*) from public.deals d
       join public.pipeline_stages ps on ps.id = d.accounting_stage_id
      where ps.code = 'on_hold' and not d.archived) as on_hold_deals,
    (select count(*) from public.deals d
       join public.pipeline_stages ps on ps.id = d.accounting_stage_id
      where ps.code = 'paid_in_full' and not d.archived) as paid_in_full_deals,
    (select count(*) from public.deals d
       join public.pipeline_stages ps on ps.id = d.accounting_stage_id
      where ps.code = 'partial_payment' and not d.archived) as partial_deals,
    (select count(*) from public.deal_payments_flipflop_backup_20260701) as backup_rows;
  ```

  Paste result into the report scaffold.

- [ ] **Step 5: Scaffold the findings report file** at `docs/superpowers/reports/2026-07-01-flip-fix-edgecase-findings.md` with the columns:

  ```markdown
  # Flip-Fix Edge-Case Findings

  **Date:** 2026-07-01
  **Fix reference:** `supabase/migrations/20260701010000_paid_in_full_flip_fix.sql`
  **Harness:** `supabase/tests/paid_in_full_flip_edgecases.sql`

  ## Prod baseline (from Task 1 Step 4)
  ...

  ## Trigger inventory (from Task 1 Step 2)
  ...

  ## Scenario results

  | Cat | # | Description | Result | Details |
  |---|---|---|---|---|
  ```

  Leave the results table empty for now — Task 4 populates it.

---

### Task 2: Write the edge-case matrix file (Categories A–E: 21 scenarios)

**Files:**
- Create: `supabase/tests/paid_in_full_flip_edgecases.sql`

Context: bundle the first 21 scenarios into one file. Each is a `begin; ... rollback;` block; the whole file can be pasted into `execute_sql` at once — Postgres runs statements sequentially and rolls back each. The terminal `RAISE EXCEPTION` on each block is what surfaces the result through MCP.

**Category A — Date modifications on recurring rows (5 scenarios).** These are the highest-risk cases — the fix's guards revolve around date-range logic.

- [ ] **Step 1: Write Category A** (append to the harness file):

  ```sql
  \set ON_ERROR_STOP off

  -- ---- Scenario A1: shorten end_date of a paid recurring row ---------
  -- Expected: cron sees the new (earlier) end_date, guard still blocks a
  -- duplicate because any next-period row already covers the shortened
  -- window (or accepts a new one if the shortening removed coverage).
  begin;
  do $$
  declare v_client uuid; v_deal uuid; v_created int; v_row uuid;
  begin
    insert into public.clients (name) values ('edge_A1_' || gen_random_uuid()::text) returning id into v_client;
    insert into public.deals (client_id, code, title, payment_method,
      stage_id, accounting_stage_id)
      values (v_client, 'EDGE-A1', 'edge A1', 'cash',
              (select id from public.pipeline_stages where board='sales' and code='won'),
              (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
      returning id into v_deal;

    -- Original paid row + a manually-created next-period paid row
    insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
      amount_net, vat_rate, start_date, end_date, status)
      values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
              current_date - 40, current_date - 10, 'paid')
      returning id into v_row;
    insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
      amount_net, vat_rate, start_date, end_date, status)
      values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
              current_date - 10, current_date + 20, 'paid');

    -- Accounting shortens the original paid row's end_date by 5 days
    update public.deal_payments set end_date = current_date - 15 where id = v_row;

    -- Run the cron
    select public.ensure_recurring_payments() into v_created;

    -- Assertion: no new duplicate created (existing next-period covers)
    if v_created > 0 then
      raise exception 'RESULT :: FAIL A1 :: cron created % row(s) despite existing coverage', v_created;
    end if;
    raise exception 'RESULT :: PASS A1 :: shortened paid end_date does not cause duplicate';
  end $$;
  rollback;

  -- ---- Scenario A2: extend end_date of a paid recurring row ----------
  -- Expected: extended end_date means the "next" row's start_date might
  -- now be BEFORE the extended end_date — guard checks start_date >=
  -- dp.end_date, so it would NOT match. Cron may create a duplicate.
  begin;
  do $$
  declare v_client uuid; v_deal uuid; v_created int; v_row uuid;
  begin
    insert into public.clients (name) values ('edge_A2_' || gen_random_uuid()::text) returning id into v_client;
    insert into public.deals (client_id, code, title, payment_method,
      stage_id, accounting_stage_id)
      values (v_client, 'EDGE-A2', 'edge A2', 'cash',
              (select id from public.pipeline_stages where board='sales' and code='won'),
              (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
      returning id into v_deal;

    insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
      amount_net, vat_rate, start_date, end_date, status)
      values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
              current_date - 40, current_date - 10, 'paid')
      returning id into v_row;
    insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
      amount_net, vat_rate, start_date, end_date, status)
      values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
              current_date - 10, current_date + 20, 'paid');

    -- Accounting extends the original paid row to overlap the next one
    update public.deal_payments set end_date = current_date + 5 where id = v_row;

    select public.ensure_recurring_payments() into v_created;

    if v_created > 0 then
      raise exception 'RESULT :: FAIL A2 :: extending paid end_date past next-period start caused % dup', v_created;
    end if;
    raise exception 'RESULT :: PASS A2 :: extending end_date does not cause duplicate';
  end $$;
  rollback;

  -- ---- Scenario A3: move start_date of an unpaid row forward ---------
  -- Expected: deal_next_due shifts to the new date. If the deal was
  -- paid_in_full and the new start_date is > 24h old, reconcile flips
  -- to on_hold. If new start_date is in the future, deal stays.
  begin;
  do $$
  declare v_client uuid; v_deal uuid; v_row uuid; v_stage text;
  begin
    insert into public.clients (name) values ('edge_A3_' || gen_random_uuid()::text) returning id into v_client;
    insert into public.deals (client_id, code, title, payment_method,
      stage_id, accounting_stage_id)
      values (v_client, 'EDGE-A3', 'edge A3', 'cash',
              (select id from public.pipeline_stages where board='sales' and code='won'),
              (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
      returning id into v_deal;

    insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
      amount_net, vat_rate, start_date, end_date, status, created_at)
      values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
              current_date - 40, current_date - 10, 'paid', now() - interval '30 days'),
             (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
              current_date + 5, current_date + 35, 'pending', now() - interval '5 days')
      returning id into v_row;  -- captures the last insert (unpaid one)

    -- Accounting moves the pending row 10 days into the past
    update public.deal_payments set start_date = current_date - 5, end_date = current_date + 25
     where id = v_row;

    perform public.reconcile_block_lifecycle(false);

    select ps.code into v_stage from public.deals d
      join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;
    -- The unpaid row's created_at is 5 days ago (>24h) → no grace → flip expected
    if v_stage <> 'on_hold' then
      raise exception 'RESULT :: FAIL A3 :: expected on_hold after start_date moved to past, got %', v_stage;
    end if;
    raise exception 'RESULT :: PASS A3 :: unpaid start_date moved to past flips to on_hold';
  end $$;
  rollback;

  -- ---- Scenario A4: move end_date of an unpaid row forward -----------
  -- Expected: end_date change doesn't affect deal_next_due (uses
  -- start_date for recurring). No state change.
  begin;
  do $$
  declare v_client uuid; v_deal uuid; v_row uuid; v_stage_before text; v_stage_after text;
  begin
    insert into public.clients (name) values ('edge_A4_' || gen_random_uuid()::text) returning id into v_client;
    insert into public.deals (client_id, code, title, payment_method,
      stage_id, accounting_stage_id)
      values (v_client, 'EDGE-A4', 'edge A4', 'cash',
              (select id from public.pipeline_stages where board='sales' and code='won'),
              (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
      returning id into v_deal;

    insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
      amount_net, vat_rate, start_date, end_date, status, created_at)
      values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
              current_date + 5, current_date + 35, 'pending', now() - interval '5 days')
      returning id into v_row;

    select ps.code into v_stage_before from public.deals d
      join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;

    update public.deal_payments set end_date = current_date + 60 where id = v_row;
    perform public.reconcile_block_lifecycle(false);

    select ps.code into v_stage_after from public.deals d
      join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;

    if v_stage_after <> v_stage_before then
      raise exception 'RESULT :: FAIL A4 :: end_date extension caused stage flip % -> %', v_stage_before, v_stage_after;
    end if;
    raise exception 'RESULT :: PASS A4 :: end_date extension does not affect stage (%)', v_stage_after;
  end $$;
  rollback;

  -- ---- Scenario A5: swap start/end (invalid date range) --------------
  -- Expected: no CHECK constraint prevents this; system tolerates it
  -- without crashing. deal_next_due may return the "start" (now > end).
  begin;
  do $$
  declare v_client uuid; v_deal uuid; v_row uuid;
  begin
    insert into public.clients (name) values ('edge_A5_' || gen_random_uuid()::text) returning id into v_client;
    insert into public.deals (client_id, code, title, payment_method,
      stage_id, accounting_stage_id)
      values (v_client, 'EDGE-A5', 'edge A5', 'cash',
              (select id from public.pipeline_stages where board='sales' and code='won'),
              (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
      returning id into v_deal;

    insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
      amount_net, vat_rate, start_date, end_date, status)
      values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
              current_date + 10, current_date - 10, 'pending')
      returning id into v_row;

    perform public.reconcile_block_lifecycle(false);
    raise exception 'RESULT :: PASS A5 :: swapped dates tolerated (no crash)';
  exception when others then
    raise exception 'RESULT :: FAIL A5 :: swapped dates raised: %', sqlerrm;
  end $$;
  rollback;
  ```

**Category B — Amount modifications (4 scenarios).** Low-risk category; verifies amount changes don't accidentally influence state.

- [ ] **Step 2: Write Category B**:

  ```sql
  -- ---- Scenario B1: change amount_net on paid row -------------------
  begin;
  do $$
  declare v_client uuid; v_deal uuid; v_row uuid; v_created int;
  begin
    insert into public.clients (name) values ('edge_B1_' || gen_random_uuid()::text) returning id into v_client;
    insert into public.deals (client_id, code, title, payment_method,
      stage_id, accounting_stage_id)
      values (v_client, 'EDGE-B1', 'edge B1', 'cash',
              (select id from public.pipeline_stages where board='sales' and code='won'),
              (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
      returning id into v_deal;
    insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
      amount_net, vat_rate, start_date, end_date, status)
      values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
              current_date - 40, current_date - 10, 'paid')
      returning id into v_row;
    insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
      amount_net, vat_rate, start_date, end_date, status)
      values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
              current_date - 10, current_date + 20, 'paid');

    update public.deal_payments set amount_net = 250 where id = v_row;
    select public.ensure_recurring_payments() into v_created;

    if v_created > 0 then
      raise exception 'RESULT :: FAIL B1 :: amount change on paid row caused % dup', v_created;
    end if;
    raise exception 'RESULT :: PASS B1 :: amount change on paid row does not affect chain';
  end $$;
  rollback;

  -- ---- Scenario B2: change amount_net on unpaid row -----------------
  begin;
  do $$
  declare v_client uuid; v_deal uuid; v_row uuid; v_stage_after text;
  begin
    insert into public.clients (name) values ('edge_B2_' || gen_random_uuid()::text) returning id into v_client;
    insert into public.deals (client_id, code, title, payment_method,
      stage_id, accounting_stage_id)
      values (v_client, 'EDGE-B2', 'edge B2', 'cash',
              (select id from public.pipeline_stages where board='sales' and code='won'),
              (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
      returning id into v_deal;
    insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
      amount_net, vat_rate, start_date, end_date, status, created_at)
      values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
              current_date + 5, current_date + 35, 'pending', now() - interval '5 days')
      returning id into v_row;

    update public.deal_payments set amount_net = 50 where id = v_row;
    perform public.reconcile_block_lifecycle(false);

    select ps.code into v_stage_after from public.deals d
      join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;
    if v_stage_after <> 'paid_in_full' then
      raise exception 'RESULT :: FAIL B2 :: amount change on unpaid row flipped stage to %', v_stage_after;
    end if;
    raise exception 'RESULT :: PASS B2 :: amount change on unpaid row does not affect stage';
  end $$;
  rollback;

  -- ---- Scenario B3: amount_net = 0 (known edge from reference_recurring_payments) ----
  -- Known concern: cron with amount_net=0 propagates. NOT strictly a flip
  -- bug, but scenarios where accounting zeros a row expect the cron to
  -- respect it. Only verify chain integrity here.
  begin;
  do $$
  declare v_client uuid; v_deal uuid; v_row uuid; v_created int;
  begin
    insert into public.clients (name) values ('edge_B3_' || gen_random_uuid()::text) returning id into v_client;
    insert into public.deals (client_id, code, title, payment_method,
      stage_id, accounting_stage_id)
      values (v_client, 'EDGE-B3', 'edge B3', 'cash',
              (select id from public.pipeline_stages where board='sales' and code='won'),
              (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
      returning id into v_deal;
    insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
      amount_net, vat_rate, start_date, end_date, status)
      values (v_deal, 'ai_seo', 0, 'recurring_monthly', 0, 24,
              current_date - 40, current_date - 10, 'paid')
      returning id into v_row;

    select public.ensure_recurring_payments() into v_created;
    if v_created <> 1 then
      raise exception 'RESULT :: FAIL B3 :: expected 1 zero-amount next row, got %', v_created;
    end if;
    raise exception 'RESULT :: PASS B3 :: zero-amount row still creates next chain link (billing memory: known concern)';
  end $$;
  rollback;

  -- ---- Scenario B4: amount_net negative (CHECK-guarded) --------------
  begin;
  do $$
  declare v_client uuid; v_deal uuid;
  begin
    insert into public.clients (name) values ('edge_B4_' || gen_random_uuid()::text) returning id into v_client;
    insert into public.deals (client_id, code, title, payment_method,
      stage_id, accounting_stage_id)
      values (v_client, 'EDGE-B4', 'edge B4', 'cash',
              (select id from public.pipeline_stages where board='sales' and code='won'),
              (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
      returning id into v_deal;

    begin
      insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
        amount_net, vat_rate, start_date, end_date, status)
        values (v_deal, 'ai_seo', 0, 'recurring_monthly', -50, 24,
                current_date - 40, current_date - 10, 'paid');
      raise exception 'RESULT :: FAIL B4 :: negative amount_net was accepted (CHECK missing?)';
    exception when check_violation then
      raise exception 'RESULT :: PASS B4 :: negative amount_net rejected by CHECK constraint';
    end;
  end $$;
  rollback;
  ```

**Category C — Status modifications (3 scenarios).**

- [ ] **Step 3: Write Category C**:

  ```sql
  -- ---- Scenario C1: mark paid → pending on an old row ----------------
  begin;
  do $$
  declare v_client uuid; v_deal uuid; v_row uuid; v_stage_after text;
  begin
    insert into public.clients (name) values ('edge_C1_' || gen_random_uuid()::text) returning id into v_client;
    insert into public.deals (client_id, code, title, payment_method,
      stage_id, accounting_stage_id)
      values (v_client, 'EDGE-C1', 'edge C1', 'cash',
              (select id from public.pipeline_stages where board='sales' and code='won'),
              (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
      returning id into v_deal;
    insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
      amount_net, vat_rate, start_date, end_date, status, created_at)
      values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
              current_date - 40, current_date - 10, 'paid', now() - interval '30 days')
      returning id into v_row;

    update public.deal_payments set status = 'pending' where id = v_row;
    perform public.reconcile_block_lifecycle(false);

    select ps.code into v_stage_after from public.deals d
      join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;
    if v_stage_after <> 'on_hold' then
      raise exception 'RESULT :: FAIL C1 :: expected on_hold after paid→pending, got %', v_stage_after;
    end if;
    raise exception 'RESULT :: PASS C1 :: paid→pending correctly flips to on_hold';
  end $$;
  rollback;

  -- ---- Scenario C2: mark overdue → paid triggers release ------------
  begin;
  do $$
  declare v_client uuid; v_deal uuid; v_row uuid; v_stage_after text;
  begin
    insert into public.clients (name) values ('edge_C2_' || gen_random_uuid()::text) returning id into v_client;
    insert into public.deals (client_id, code, title, payment_method,
      stage_id, accounting_stage_id)
      values (v_client, 'EDGE-C2', 'edge C2', 'cash',
              (select id from public.pipeline_stages where board='sales' and code='won'),
              (select id from public.pipeline_stages where board='accounting_onboarding' and code='on_hold'))
      returning id into v_deal;
    insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
      amount_net, vat_rate, start_date, end_date, status, created_at)
      values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
              current_date - 40, current_date - 10, 'overdue', now() - interval '30 days')
      returning id into v_row;

    update public.deal_payments set status = 'paid' where id = v_row;
    -- No reconcile needed; the release trigger fires on the update
    select ps.code into v_stage_after from public.deals d
      join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;
    if v_stage_after <> 'paid_in_full' then
      raise exception 'RESULT :: FAIL C2 :: expected paid_in_full after overdue→paid, got %', v_stage_after;
    end if;
    raise exception 'RESULT :: PASS C2 :: overdue→paid trigger releases from on_hold';
  end $$;
  rollback;

  -- ---- Scenario C3: mark paid on a row from an on_hold deal WITH
  -- another unpaid past-due row still present ------------------------
  begin;
  do $$
  declare v_client uuid; v_deal uuid; v_row1 uuid; v_row2 uuid; v_stage_after text;
  begin
    insert into public.clients (name) values ('edge_C3_' || gen_random_uuid()::text) returning id into v_client;
    insert into public.deals (client_id, code, title, payment_method,
      stage_id, accounting_stage_id)
      values (v_client, 'EDGE-C3', 'edge C3', 'cash',
              (select id from public.pipeline_stages where board='sales' and code='won'),
              (select id from public.pipeline_stages where board='accounting_onboarding' and code='on_hold'))
      returning id into v_deal;
    insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
      amount_net, vat_rate, start_date, end_date, status, created_at)
      values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
              current_date - 60, current_date - 30, 'overdue', now() - interval '50 days')
      returning id into v_row1;
    insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
      amount_net, vat_rate, start_date, end_date, status, created_at)
      values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
              current_date - 30, current_date - 5, 'overdue', now() - interval '20 days')
      returning id into v_row2;

    update public.deal_payments set status = 'paid' where id = v_row1;
    select ps.code into v_stage_after from public.deals d
      join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;
    if v_stage_after <> 'on_hold' then
      raise exception 'RESULT :: FAIL C3 :: expected on_hold (second row still overdue), got %', v_stage_after;
    end if;
    raise exception 'RESULT :: PASS C3 :: release respects remaining unpaid past-due';
  end $$;
  rollback;
  ```

**Category D — Service classification (4 scenarios).**

- [ ] **Step 4: Write Category D**:

  ```sql
  -- ---- Scenario D1: change service_type on a paid row ---------------
  -- Chain identity shifts. Cron treats it as a NEW chain, may create a
  -- next-period row for the new service. Original chain has a gap.
  begin;
  do $$
  declare v_client uuid; v_deal uuid; v_row uuid; v_created int; v_rows_after int;
  begin
    insert into public.clients (name) values ('edge_D1_' || gen_random_uuid()::text) returning id into v_client;
    insert into public.deals (client_id, code, title, payment_method,
      stage_id, accounting_stage_id)
      values (v_client, 'EDGE-D1', 'edge D1', 'cash',
              (select id from public.pipeline_stages where board='sales' and code='won'),
              (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
      returning id into v_deal;
    insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
      amount_net, vat_rate, start_date, end_date, status)
      values (v_deal, 'web_seo', 0, 'recurring_monthly', 100, 24,
              current_date - 40, current_date - 10, 'paid')
      returning id into v_row;

    update public.deal_payments set service_type = 'local_seo' where id = v_row;
    select public.ensure_recurring_payments() into v_created;
    select count(*) into v_rows_after from public.deal_payments where deal_id = v_deal;

    if v_created <> 1 or v_rows_after <> 2 then
      raise exception 'RESULT :: FAIL D1 :: expected 1 new row (local_seo chain), got created=% total=%', v_created, v_rows_after;
    end if;
    raise exception 'RESULT :: PASS D1 :: service_type change starts new chain';
  end $$;
  rollback;

  -- ---- Scenario D2: recurring_monthly → recurring_yearly ------------
  begin;
  do $$
  declare v_client uuid; v_deal uuid; v_row uuid; v_created int;
      v_next_start date; v_next_end date;
  begin
    insert into public.clients (name) values ('edge_D2_' || gen_random_uuid()::text) returning id into v_client;
    insert into public.deals (client_id, code, title, payment_method,
      stage_id, accounting_stage_id)
      values (v_client, 'EDGE-D2', 'edge D2', 'cash',
              (select id from public.pipeline_stages where board='sales' and code='won'),
              (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
      returning id into v_deal;
    insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
      amount_net, vat_rate, start_date, end_date, status)
      values (v_deal, 'hosting', 0, 'recurring_monthly', 100, 24,
              current_date - 40, current_date - 10, 'paid')
      returning id into v_row;

    update public.deal_payments set billing_type = 'recurring_yearly' where id = v_row;
    select public.ensure_recurring_payments() into v_created;
    select start_date, end_date into v_next_start, v_next_end
      from public.deal_payments where deal_id = v_deal and status <> 'paid'
      order by created_at desc limit 1;

    if v_created <> 1 or v_next_end <> (v_next_start + interval '1 year')::date then
      raise exception 'RESULT :: FAIL D2 :: yearly cadence not applied: created=% start=% end=%',
        v_created, v_next_start, v_next_end;
    end if;
    raise exception 'RESULT :: PASS D2 :: billing_type change to yearly applies 1-year cadence';
  end $$;
  rollback;

  -- ---- Scenario D3: change service_index only (no other change) -----
  -- With L1/L2 no longer scoped by service_index, this should have no
  -- effect on cron or trigger.
  begin;
  do $$
  declare v_client uuid; v_deal uuid; v_row uuid; v_created int;
  begin
    insert into public.clients (name) values ('edge_D3_' || gen_random_uuid()::text) returning id into v_client;
    insert into public.deals (client_id, code, title, payment_method,
      stage_id, accounting_stage_id)
      values (v_client, 'EDGE-D3', 'edge D3', 'cash',
              (select id from public.pipeline_stages where board='sales' and code='won'),
              (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
      returning id into v_deal;
    insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
      amount_net, vat_rate, start_date, end_date, status)
      values (v_deal, 'web_seo', 0, 'recurring_monthly', 100, 24,
              current_date - 40, current_date - 10, 'paid'),
             (v_deal, 'web_seo', 1, 'recurring_monthly', 100, 24,
              current_date - 10, current_date + 20, 'paid')
      returning id into v_row;

    update public.deal_payments set service_index = 5 where id = v_row;
    select public.ensure_recurring_payments() into v_created;

    if v_created > 0 then
      raise exception 'RESULT :: FAIL D3 :: service_index change caused % dup', v_created;
    end if;
    raise exception 'RESULT :: PASS D3 :: service_index change alone does not create dupes (fix holds)';
  end $$;
  rollback;

  -- ---- Scenario D4: recurring → one_time (cron should skip) --------
  begin;
  do $$
  declare v_client uuid; v_deal uuid; v_row uuid; v_created int;
  begin
    insert into public.clients (name) values ('edge_D4_' || gen_random_uuid()::text) returning id into v_client;
    insert into public.deals (client_id, code, title, payment_method,
      stage_id, accounting_stage_id)
      values (v_client, 'EDGE-D4', 'edge D4', 'cash',
              (select id from public.pipeline_stages where board='sales' and code='won'),
              (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
      returning id into v_deal;
    insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
      amount_net, vat_rate, start_date, end_date, status)
      values (v_deal, 'web_dev', 0, 'recurring_monthly', 100, 24,
              current_date - 40, current_date - 10, 'paid')
      returning id into v_row;

    update public.deal_payments set billing_type = 'one_time' where id = v_row;
    select public.ensure_recurring_payments() into v_created;

    if v_created > 0 then
      raise exception 'RESULT :: FAIL D4 :: cron created % row(s) for one_time', v_created;
    end if;
    raise exception 'RESULT :: PASS D4 :: recurring→one_time removes from cron loop';
  end $$;
  rollback;
  ```

**Category E — Row lifecycle (5 scenarios; UPDATE-based dupes are the highest risk).**

- [ ] **Step 5: Write Category E**:

  ```sql
  -- ---- Scenario E1: delete a paid recurring row --------------------
  -- Cron may re-create it. If it does, and the recreated row has an
  -- immediately-past start_date, deal could flip.
  begin;
  do $$
  declare v_client uuid; v_deal uuid; v_row_del uuid; v_created int;
      v_stage_after text;
  begin
    insert into public.clients (name) values ('edge_E1_' || gen_random_uuid()::text) returning id into v_client;
    insert into public.deals (client_id, code, title, payment_method,
      stage_id, accounting_stage_id)
      values (v_client, 'EDGE-E1', 'edge E1', 'cash',
              (select id from public.pipeline_stages where board='sales' and code='won'),
              (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
      returning id into v_deal;
    insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
      amount_net, vat_rate, start_date, end_date, status)
      values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
              current_date - 40, current_date - 10, 'paid')
      returning id into v_row_del;

    delete from public.deal_payments where id = v_row_del;
    select public.ensure_recurring_payments() into v_created;
    perform public.reconcile_block_lifecycle(false);

    select ps.code into v_stage_after from public.deals d
      join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;
    -- After delete, no expiring row → cron creates 0.
    if v_created <> 0 then
      raise exception 'RESULT :: FAIL E1 :: cron created % rows after paid-row deletion', v_created;
    end if;
    -- Deal stayed paid_in_full since no unpaid rows exist
    if v_stage_after <> 'paid_in_full' then
      raise exception 'RESULT :: FAIL E1 :: stage flipped to % after paid-row deletion', v_stage_after;
    end if;
    raise exception 'RESULT :: PASS E1 :: deleting a paid row does not create phantom next-period';
  end $$;
  rollback;

  -- ---- Scenario E2: delete an unpaid past-due row on on_hold deal ---
  -- Reconcile's "no auto-release" gate should keep the deal on_hold
  -- (accountant must promote manually).
  begin;
  do $$
  declare v_client uuid; v_deal uuid; v_row_del uuid; v_stage_after text;
  begin
    insert into public.clients (name) values ('edge_E2_' || gen_random_uuid()::text) returning id into v_client;
    insert into public.deals (client_id, code, title, payment_method,
      stage_id, accounting_stage_id)
      values (v_client, 'EDGE-E2', 'edge E2', 'cash',
              (select id from public.pipeline_stages where board='sales' and code='won'),
              (select id from public.pipeline_stages where board='accounting_onboarding' and code='on_hold'))
      returning id into v_deal;
    insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
      amount_net, vat_rate, start_date, end_date, status, created_at)
      values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
              current_date - 40, current_date - 10, 'overdue', now() - interval '30 days')
      returning id into v_row_del;

    delete from public.deal_payments where id = v_row_del;
    perform public.reconcile_block_lifecycle(false);

    select ps.code into v_stage_after from public.deals d
      join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;
    if v_stage_after <> 'on_hold' then
      raise exception 'RESULT :: FAIL E2 :: expected on_hold (no auto-release), got %', v_stage_after;
    end if;
    raise exception 'RESULT :: PASS E2 :: deleting past-due row does NOT auto-release from on_hold';
  end $$;
  rollback;

  -- ---- Scenario E3: manual INSERT of past-dated pending row ---------
  -- Layer 3 grace should protect paid_in_full for 24h.
  begin;
  do $$
  declare v_client uuid; v_deal uuid; v_stage_after text;
  begin
    insert into public.clients (name) values ('edge_E3_' || gen_random_uuid()::text) returning id into v_client;
    insert into public.deals (client_id, code, title, payment_method,
      stage_id, accounting_stage_id)
      values (v_client, 'EDGE-E3', 'edge E3', 'cash',
              (select id from public.pipeline_stages where board='sales' and code='won'),
              (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
      returning id into v_deal;
    insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
      amount_net, vat_rate, start_date, end_date, status, created_at)
      values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
              current_date - 40, current_date - 10, 'paid', now() - interval '30 days');
    insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
      amount_net, vat_rate, start_date, end_date, status, created_at)
      values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
              current_date - 5, current_date + 25, 'pending', now() - interval '1 hour');

    perform public.reconcile_block_lifecycle(false);

    select ps.code into v_stage_after from public.deals d
      join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;
    if v_stage_after <> 'paid_in_full' then
      raise exception 'RESULT :: FAIL E3 :: expected paid_in_full (L3 grace), got %', v_stage_after;
    end if;
    raise exception 'RESULT :: PASS E3 :: L3 grace protects paid_in_full from <24h past-dated insert';
  end $$;
  rollback;

  -- ---- Scenario E4: manual INSERT of a duplicate — L2 silently drops
  begin;
  do $$
  declare v_client uuid; v_deal uuid; v_new_id uuid;
  begin
    insert into public.clients (name) values ('edge_E4_' || gen_random_uuid()::text) returning id into v_client;
    insert into public.deals (client_id, code, title, payment_method,
      stage_id, accounting_stage_id)
      values (v_client, 'EDGE-E4', 'edge E4', 'cash',
              (select id from public.pipeline_stages where board='sales' and code='won'),
              (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
      returning id into v_deal;
    insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
      amount_net, vat_rate, start_date, end_date, status)
      values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
              current_date - 10, current_date + 20, 'paid');
    -- Try to insert a "correction" row for the same period
    insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
      amount_net, vat_rate, start_date, end_date, status)
      values (v_deal, 'ai_seo', 1, 'recurring_monthly', 90, 24,
              current_date - 10, current_date + 20, 'pending')
      returning id into v_new_id;

    if v_new_id is not null then
      raise exception 'RESULT :: FAIL E4 :: dup insert returned id %, expected NULL', v_new_id;
    end if;
    raise exception 'RESULT :: PASS E4 :: L2 silently drops duplicate insert';
  end $$;
  rollback;

  -- ---- Scenario E5: UPDATE to create a duplicate (L2 bypass!) -------
  -- L2 only fires on INSERT. Accountant edits a row's start_date to
  -- MATCH another existing row's period — creates a duplicate that L2
  -- doesn't catch. L4 audit is the only defense.
  begin;
  do $$
  declare v_client uuid; v_deal uuid; v_row1 uuid; v_row2 uuid; v_alerts int;
  begin
    insert into public.clients (name) values ('edge_E5_' || gen_random_uuid()::text) returning id into v_client;
    insert into public.deals (client_id, code, title, payment_method,
      stage_id, accounting_stage_id)
      values (v_client, 'EDGE-E5', 'edge E5', 'cash',
              (select id from public.pipeline_stages where board='sales' and code='won'),
              (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
      returning id into v_deal;
    insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
      amount_net, vat_rate, start_date, end_date, status)
      values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
              current_date - 40, current_date - 10, 'paid')
      returning id into v_row1;
    insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
      amount_net, vat_rate, start_date, end_date, status)
      values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
              current_date - 10, current_date + 20, 'paid')
      returning id into v_row2;

    -- Accountant edits row1 to overlap row2's period
    update public.deal_payments
       set start_date = current_date - 10, end_date = current_date + 20
     where id = v_row1;

    -- L4 audit should catch it
    select public.reconcile_payment_integrity() into v_alerts;
    if v_alerts < 1 then
      raise exception 'RESULT :: FAIL E5 :: L2 bypass via UPDATE not caught by L4 audit';
    end if;
    raise exception 'RESULT :: CONCERN E5 :: L2 bypassed via UPDATE (only L4 audit catches, next-day detection)';
  end $$;
  rollback;
  ```

- [ ] **Step 6: Commit the harness so far** (test-first discipline):

  ```
  git add supabase/tests/paid_in_full_flip_edgecases.sql
  git commit -m "$(cat <<'EOF'
  test(billing): edge-case matrix categories A-E (21 scenarios)

  Covers date modifications, amount changes, status flips, service
  classification changes, and row lifecycle (delete / insert / L2 bypass
  via UPDATE) against the four defense layers. Each scenario runs in a
  savepoint against prod; terminal RAISE EXCEPTION surfaces the result
  through MCP.
  EOF
  )"
  ```

  Do NOT push — commit alone lets us bisect if a scenario breaks in isolation later.

---

### Task 3: Write the remaining edge-case scenarios (Categories F–J: 14 scenarios)

**Files:**
- Modify: `supabase/tests/paid_in_full_flip_edgecases.sql`

- [ ] **Step 1: Append Category F — Deal-level modifications (4 scenarios).**

  ```sql
  -- ---- Scenario F1: deal.payment_method → null ---------------------
  begin;
  do $$
  declare v_client uuid; v_deal uuid; v_moved int;
  begin
    insert into public.clients (name) values ('edge_F1_' || gen_random_uuid()::text) returning id into v_client;
    insert into public.deals (client_id, code, title, payment_method,
      stage_id, accounting_stage_id)
      values (v_client, 'EDGE-F1', 'edge F1', 'cash',
              (select id from public.pipeline_stages where board='sales' and code='won'),
              (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
      returning id into v_deal;
    insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
      amount_net, vat_rate, start_date, end_date, status, created_at)
      values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
              current_date - 5, current_date + 25, 'overdue', now() - interval '5 days');

    update public.deals set payment_method = null where id = v_deal;
    select public.reconcile_block_lifecycle(false) into v_moved;
    -- Reconcile filters WHERE payment_method is not null → deal not evaluated
    if v_moved > 0 then
      raise exception 'RESULT :: FAIL F1 :: reconcile touched % deals with null payment_method', v_moved;
    end if;
    raise exception 'RESULT :: PASS F1 :: null payment_method excludes deal from reconcile';
  end $$;
  rollback;

  -- ---- Scenario F2: manually set to done stage --------------------
  begin;
  do $$
  declare v_client uuid; v_deal uuid; v_created int;
  begin
    insert into public.clients (name) values ('edge_F2_' || gen_random_uuid()::text) returning id into v_client;
    insert into public.deals (client_id, code, title, payment_method,
      stage_id, accounting_stage_id)
      values (v_client, 'EDGE-F2', 'edge F2', 'cash',
              (select id from public.pipeline_stages where board='sales' and code='won'),
              (select id from public.pipeline_stages where board='accounting_onboarding' and code='done'))
      returning id into v_deal;
    insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
      amount_net, vat_rate, start_date, end_date, status)
      values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
              current_date - 40, current_date - 10, 'paid');
    -- Cron filter: stage != 'closed' — 'done' is allowed. Cron may try
    -- to create next-period. We only check no flip-flop occurs.
    select public.ensure_recurring_payments() into v_created;
    raise exception 'RESULT :: INFO F2 :: cron created % rows on done-stage deal (info only)', v_created;
  end $$;
  rollback;

  -- ---- Scenario F3: archive deal ------------------------------------
  begin;
  do $$
  declare v_client uuid; v_deal uuid; v_created int;
  begin
    insert into public.clients (name) values ('edge_F3_' || gen_random_uuid()::text) returning id into v_client;
    insert into public.deals (client_id, code, title, payment_method,
      stage_id, accounting_stage_id)
      values (v_client, 'EDGE-F3', 'edge F3', 'cash',
              (select id from public.pipeline_stages where board='sales' and code='won'),
              (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
      returning id into v_deal;
    insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
      amount_net, vat_rate, start_date, end_date, status)
      values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
              current_date - 40, current_date - 10, 'paid');

    update public.deals set archived = true where id = v_deal;
    select public.ensure_recurring_payments() into v_created;
    if v_created > 0 then
      raise exception 'RESULT :: FAIL F3 :: cron touched archived deal (% new rows)', v_created;
    end if;
    raise exception 'RESULT :: PASS F3 :: archived deal excluded from cron';
  end $$;
  rollback;

  -- ---- Scenario F4: manual promote on_hold → paid_in_full with
  --      an unpaid past-due row still present ---------------------
  begin;
  do $$
  declare v_client uuid; v_deal uuid; v_stage_after text; v_paid_id uuid;
  begin
    insert into public.clients (name) values ('edge_F4_' || gen_random_uuid()::text) returning id into v_client;
    select id into v_paid_id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full';
    insert into public.deals (client_id, code, title, payment_method,
      stage_id, accounting_stage_id)
      values (v_client, 'EDGE-F4', 'edge F4', 'cash',
              (select id from public.pipeline_stages where board='sales' and code='won'),
              (select id from public.pipeline_stages where board='accounting_onboarding' and code='on_hold'))
      returning id into v_deal;
    -- Legitimately-old unpaid row (5 days ago)
    insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
      amount_net, vat_rate, start_date, end_date, status, created_at)
      values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
              current_date - 5, current_date + 25, 'overdue', now() - interval '5 days');

    -- Accountant manually flips to paid_in_full (bypasses release trigger)
    update public.deals set accounting_stage_id = v_paid_id where id = v_deal;

    -- Reconcile runs — should flip back to on_hold because the row is
    -- >24h old and target_accounting_stage returns 'on_hold'.
    perform public.reconcile_block_lifecycle(false);

    select ps.code into v_stage_after from public.deals d
      join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;
    if v_stage_after <> 'on_hold' then
      raise exception 'RESULT :: FAIL F4 :: manual promote to paid_in_full stuck at % despite real past-due', v_stage_after;
    end if;
    raise exception 'RESULT :: PASS F4 :: reconcile correctly reverses accidental manual promote';
  end $$;
  rollback;
  ```

- [ ] **Step 2: Append Category G — Trigger cascades (3 scenarios).**

  ```sql
  -- ---- Scenario G1: INSERT paid row → move_to_awaiting suppressed --
  begin;
  do $$
  declare v_client uuid; v_deal uuid; v_stage_after text;
  begin
    insert into public.clients (name) values ('edge_G1_' || gen_random_uuid()::text) returning id into v_client;
    insert into public.deals (client_id, code, title, payment_method,
      stage_id, accounting_stage_id)
      values (v_client, 'EDGE-G1', 'edge G1', 'cash',
              (select id from public.pipeline_stages where board='sales' and code='won'),
              (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
      returning id into v_deal;
    insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
      amount_net, vat_rate, start_date, end_date, status)
      values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
              current_date + 5, current_date + 35, 'paid');
    select ps.code into v_stage_after from public.deals d
      join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;
    -- move_to_awaiting only moves when the deal is in new/on_hold/partial —
    -- paid_in_full stays. Confirmed here.
    if v_stage_after <> 'paid_in_full' then
      raise exception 'RESULT :: FAIL G1 :: INSERT of paid row flipped stage to %', v_stage_after;
    end if;
    raise exception 'RESULT :: PASS G1 :: INSERT of paid row does not perturb paid_in_full';
  end $$;
  rollback;

  -- ---- Scenario G2: INSERT pending row → move_to_awaiting ---------
  begin;
  do $$
  declare v_client uuid; v_deal uuid; v_stage_after text;
  begin
    insert into public.clients (name) values ('edge_G2_' || gen_random_uuid()::text) returning id into v_client;
    insert into public.deals (client_id, code, title, payment_method,
      stage_id, accounting_stage_id)
      values (v_client, 'EDGE-G2', 'edge G2', 'cash',
              (select id from public.pipeline_stages where board='sales' and code='won'),
              (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
      returning id into v_deal;
    insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
      amount_net, vat_rate, start_date, end_date, status)
      values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
              current_date + 5, current_date + 35, 'pending');

    select ps.code into v_stage_after from public.deals d
      join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;
    -- move_to_awaiting fires: deal goes to awaiting_payment immediately.
    -- This is EXISTING behavior — L3 grace on reconcile is the corrector.
    if v_stage_after <> 'awaiting_payment' then
      raise exception 'RESULT :: INFO G2 :: expected awaiting_payment after INSERT, got % (documenting existing trigger behavior)', v_stage_after;
    end if;
    raise exception 'RESULT :: PASS G2 :: INSERT of pending row moves to awaiting_payment (existing behavior)';
  end $$;
  rollback;

  -- ---- Scenario G3: race — cron creates phantom, reconcile L3 fires
  begin;
  do $$
  declare v_client uuid; v_deal uuid; v_stage_after text;
  begin
    insert into public.clients (name) values ('edge_G3_' || gen_random_uuid()::text) returning id into v_client;
    insert into public.deals (client_id, code, title, payment_method,
      stage_id, accounting_stage_id)
      values (v_client, 'EDGE-G3', 'edge G3', 'cash',
              (select id from public.pipeline_stages where board='sales' and code='won'),
              (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
      returning id into v_deal;
    -- Simulate: cron just ran, created a fresh past-dated pending row
    insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
      amount_net, vat_rate, start_date, end_date, status, created_at)
      values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
              current_date - 40, current_date - 10, 'paid', now() - interval '30 days'),
             (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
              current_date - 10, current_date + 20, 'overdue', now() - interval '10 minutes');

    -- Reconcile runs 20 min later — L3 grace should force back to paid_in_full
    perform public.reconcile_block_lifecycle(false);
    select ps.code into v_stage_after from public.deals d
      join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;
    if v_stage_after <> 'paid_in_full' then
      raise exception 'RESULT :: FAIL G3 :: L3 grace failed (stage=%)', v_stage_after;
    end if;
    raise exception 'RESULT :: PASS G3 :: cron→reconcile chain with L3 grace holds paid_in_full';
  end $$;
  rollback;
  ```

- [ ] **Step 3: Append Category H — Concurrent modifications (3 scenarios).**

  ```sql
  -- ---- Scenario H1: two rapid updates on same row (last-write-wins)
  begin;
  do $$
  declare v_client uuid; v_deal uuid; v_row uuid; v_start_final date;
  begin
    insert into public.clients (name) values ('edge_H1_' || gen_random_uuid()::text) returning id into v_client;
    insert into public.deals (client_id, code, title, payment_method,
      stage_id, accounting_stage_id)
      values (v_client, 'EDGE-H1', 'edge H1', 'cash',
              (select id from public.pipeline_stages where board='sales' and code='won'),
              (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
      returning id into v_deal;
    insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
      amount_net, vat_rate, start_date, end_date, status)
      values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
              current_date - 10, current_date + 20, 'pending')
      returning id into v_row;

    update public.deal_payments set start_date = current_date - 5 where id = v_row;
    update public.deal_payments set start_date = current_date + 2 where id = v_row;

    select start_date into v_start_final from public.deal_payments where id = v_row;
    if v_start_final <> current_date + 2 then
      raise exception 'RESULT :: FAIL H1 :: LWW failed: expected +2, got %', v_start_final;
    end if;
    raise exception 'RESULT :: PASS H1 :: last-write-wins on rapid updates';
  end $$;
  rollback;

  -- ---- Scenario H2: cron advisory lock held --------------------
  -- Cannot easily simulate two connections in one savepoint; instead,
  -- verify the lock name is present so a second concurrent call would
  -- wait. Just call twice in sequence and confirm no error.
  begin;
  do $$
  declare v_a int; v_b int;
  begin
    select public.ensure_recurring_payments() into v_a;
    select public.ensure_recurring_payments() into v_b;
    raise exception 'RESULT :: INFO H2 :: sequential cron calls returned created=%, %; concurrent race not simulable in one session', v_a, v_b;
  end $$;
  rollback;

  -- ---- Scenario H3: two dup INSERTs — only one lands ------------
  begin;
  do $$
  declare v_client uuid; v_deal uuid; v_a uuid; v_b uuid;
  begin
    insert into public.clients (name) values ('edge_H3_' || gen_random_uuid()::text) returning id into v_client;
    insert into public.deals (client_id, code, title, payment_method,
      stage_id, accounting_stage_id)
      values (v_client, 'EDGE-H3', 'edge H3', 'cash',
              (select id from public.pipeline_stages where board='sales' and code='won'),
              (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
      returning id into v_deal;
    insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
      amount_net, vat_rate, start_date, end_date, status)
      values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
              current_date - 10, current_date + 20, 'pending')
      returning id into v_a;
    insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
      amount_net, vat_rate, start_date, end_date, status)
      values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
              current_date - 10, current_date + 20, 'pending')
      returning id into v_b;
    if v_a is null then
      raise exception 'RESULT :: FAIL H3 :: first INSERT was dropped';
    end if;
    if v_b is not null then
      raise exception 'RESULT :: FAIL H3 :: second INSERT was NOT dropped (id=%)', v_b;
    end if;
    raise exception 'RESULT :: PASS H3 :: L2 drops second dup INSERT, first survives';
  end $$;
  rollback;
  ```

- [ ] **Step 4: Append Category I — L3 grace boundary (4 scenarios).**

  ```sql
  -- ---- Scenario I1: row created exactly at 23h59m boundary --------
  begin;
  do $$
  declare v_client uuid; v_deal uuid; v_stage_after text;
  begin
    insert into public.clients (name) values ('edge_I1_' || gen_random_uuid()::text) returning id into v_client;
    insert into public.deals (client_id, code, title, payment_method,
      stage_id, accounting_stage_id)
      values (v_client, 'EDGE-I1', 'edge I1', 'cash',
              (select id from public.pipeline_stages where board='sales' and code='won'),
              (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
      returning id into v_deal;
    insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
      amount_net, vat_rate, start_date, end_date, status, created_at)
      values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
              current_date - 10, current_date + 20, 'overdue', now() - interval '23 hours 59 minutes');

    perform public.reconcile_block_lifecycle(false);
    select ps.code into v_stage_after from public.deals d
      join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;
    if v_stage_after <> 'paid_in_full' then
      raise exception 'RESULT :: FAIL I1 :: L3 grace failed at 23h59m boundary (stage=%)', v_stage_after;
    end if;
    raise exception 'RESULT :: PASS I1 :: grace holds at 23h59m';
  end $$;
  rollback;

  -- ---- Scenario I2: row created exactly at 24h01m boundary --------
  begin;
  do $$
  declare v_client uuid; v_deal uuid; v_stage_after text;
  begin
    insert into public.clients (name) values ('edge_I2_' || gen_random_uuid()::text) returning id into v_client;
    insert into public.deals (client_id, code, title, payment_method,
      stage_id, accounting_stage_id)
      values (v_client, 'EDGE-I2', 'edge I2', 'cash',
              (select id from public.pipeline_stages where board='sales' and code='won'),
              (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
      returning id into v_deal;
    insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
      amount_net, vat_rate, start_date, end_date, status, created_at)
      values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
              current_date - 10, current_date + 20, 'overdue', now() - interval '24 hours 1 minute');

    perform public.reconcile_block_lifecycle(false);
    select ps.code into v_stage_after from public.deals d
      join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;
    if v_stage_after <> 'on_hold' then
      raise exception 'RESULT :: FAIL I2 :: expected on_hold at 24h+1m (grace should have expired), got %', v_stage_after;
    end if;
    raise exception 'RESULT :: PASS I2 :: grace expires after 24h';
  end $$;
  rollback;

  -- ---- Scenario I3: accountant modifies created_at (superuser only)
  -- Cannot modify created_at via normal DML — it's declared NOT NULL
  -- with default now(). Bypassing via direct UPDATE: does it stick?
  begin;
  do $$
  declare v_client uuid; v_deal uuid; v_row uuid; v_created_at_after timestamptz;
  begin
    insert into public.clients (name) values ('edge_I3_' || gen_random_uuid()::text) returning id into v_client;
    insert into public.deals (client_id, code, title, payment_method,
      stage_id, accounting_stage_id)
      values (v_client, 'EDGE-I3', 'edge I3', 'cash',
              (select id from public.pipeline_stages where board='sales' and code='won'),
              (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
      returning id into v_deal;
    insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
      amount_net, vat_rate, start_date, end_date, status)
      values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
              current_date - 10, current_date + 20, 'overdue')
      returning id into v_row;

    update public.deal_payments set created_at = now() - interval '30 days' where id = v_row;
    select created_at into v_created_at_after from public.deal_payments where id = v_row;
    if v_created_at_after > now() - interval '29 days' then
      raise exception 'RESULT :: FAIL I3 :: created_at UPDATE did not stick (=%)', v_created_at_after;
    end if;
    raise exception 'RESULT :: CONCERN I3 :: created_at is UPDATE-able → grace can be bypassed by editing timestamp';
  end $$;
  rollback;

  -- ---- Scenario I4: dual rows one <24h and one >24h ---------------
  begin;
  do $$
  declare v_client uuid; v_deal uuid; v_stage_after text;
  begin
    insert into public.clients (name) values ('edge_I4_' || gen_random_uuid()::text) returning id into v_client;
    insert into public.deals (client_id, code, title, payment_method,
      stage_id, accounting_stage_id)
      values (v_client, 'EDGE-I4', 'edge I4', 'cash',
              (select id from public.pipeline_stages where board='sales' and code='won'),
              (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
      returning id into v_deal;
    -- One row >24h (legit overdue) + one <24h (phantom): reconcile should
    -- still flip to on_hold because the >24h row is a real past-due.
    insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
      amount_net, vat_rate, start_date, end_date, status, created_at)
      values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
              current_date - 40, current_date - 10, 'overdue', now() - interval '30 days'),
             (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
              current_date - 5, current_date + 25, 'pending', now() - interval '1 hour');
    perform public.reconcile_block_lifecycle(false);
    select ps.code into v_stage_after from public.deals d
      join public.pipeline_stages ps on ps.id = d.accounting_stage_id where d.id = v_deal;
    if v_stage_after <> 'on_hold' then
      raise exception 'RESULT :: FAIL I4 :: mixed-age rows should still flip (real past-due present), got %', v_stage_after;
    end if;
    raise exception 'RESULT :: PASS I4 :: legit past-due wins over fresh phantom in mixed case';
  end $$;
  rollback;
  ```

- [ ] **Step 5: Append Category J — L4 audit corner cases (3 scenarios).**

  ```sql
  -- ---- Scenario J1: duplicate created RIGHT before audit runs -----
  begin;
  do $$
  declare v_client uuid; v_deal uuid; v_alerts int; v_before int;
  begin
    insert into public.clients (name) values ('edge_J1_' || gen_random_uuid()::text) returning id into v_client;
    insert into public.deals (client_id, code, title, payment_method,
      stage_id, accounting_stage_id)
      values (v_client, 'EDGE-J1', 'edge J1', 'cash',
              (select id from public.pipeline_stages where board='sales' and code='won'),
              (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
      returning id into v_deal;
    alter table public.deal_payments disable trigger user;
    insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
      amount_net, vat_rate, start_date, end_date, status)
      values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
              current_date - 40, current_date - 10, 'paid'),
             (v_deal, 'ai_seo', 1, 'recurring_monthly', 100, 24,
              current_date - 40, current_date - 10, 'paid');
    alter table public.deal_payments enable trigger user;

    select count(*) into v_before from public.data_integrity_alerts;
    select public.reconcile_payment_integrity() into v_alerts;
    if v_alerts < 1 then
      raise exception 'RESULT :: FAIL J1 :: audit did not fire (alerts=%)', v_alerts;
    end if;
    raise exception 'RESULT :: PASS J1 :: L4 audit catches fresh duplicate';
  end $$;
  rollback;

  -- ---- Scenario J2: no dupes → no alerts --------------------------
  -- (Can't isolate against prod's existing alerts; just confirm the
  -- function tolerates a clean state by running it and confirming it
  -- doesn't crash.)
  begin;
  do $$
  declare v_alerts int;
  begin
    select public.reconcile_payment_integrity() into v_alerts;
    -- v_alerts reflects prod's current state; the assertion is
    -- "function ran without crashing".
    raise exception 'RESULT :: INFO J2 :: audit ran cleanly, returned alerts=%', v_alerts;
  end $$;
  rollback;

  -- ---- Scenario J3: RLS blocks non-admin from reading alerts ------
  begin;
  do $$
  declare v_client uuid; v_deal uuid; v_visible_by_anon int;
  begin
    -- Set role to anon to test RLS
    set local role anon;
    select count(*) into v_visible_by_anon from public.data_integrity_alerts;
    reset role;
    if v_visible_by_anon > 0 then
      raise exception 'RESULT :: FAIL J3 :: anon can read data_integrity_alerts (RLS breach)';
    end if;
    raise exception 'RESULT :: PASS J3 :: anon cannot read data_integrity_alerts';
  exception when others then
    reset role;
    -- Rethrow so the outer exception surfaces
    raise;
  end $$;
  rollback;
  ```

- [ ] **Step 6: Commit** (do NOT push):

  ```
  git add supabase/tests/paid_in_full_flip_edgecases.sql
  git commit -m "$(cat <<'EOF'
  test(billing): edge-case matrix categories F-J (14 scenarios)

  Covers deal-level modifications, trigger cascades, concurrency,
  L3 grace boundaries (23h59 vs 24h1), created_at editability, mixed-age
  rows, and L4 audit corner cases (fresh dup, clean state, RLS).
  EOF
  )"
  ```

---

### Task 4: Run all 35 scenarios against prod + capture results

**Files:**
- Modify: `docs/superpowers/reports/2026-07-01-flip-fix-edgecase-findings.md`

Context: `execute_sql` doesn't return `RAISE NOTICE` — only the terminal `RAISE EXCEPTION` surfaces. Each block ends with `raise exception 'RESULT :: <status> ... :: ...'`; the SQL error IS the result. Capture stderr/stdout for every scenario.

- [ ] **Step 1: Run categories A + B (9 scenarios)** — for each, submit its `begin;...rollback;` block via `mcp__plugin_supabase_supabase__execute_sql` (project_id `xujlrclyzxrvxszepquy`). Copy the `ERROR: P0001: RESULT :: <status> ...` message verbatim into the findings report table.

- [ ] **Step 2: Run categories C + D (7 scenarios)**. Same pattern.

- [ ] **Step 3: Run category E (5 scenarios)**. **Special attention to E5** — if it reports `CONCERN`, capture the details in the report; this is the known L2-bypass-via-UPDATE gap.

- [ ] **Step 4: Run categories F + G + H (10 scenarios)**. Category H is limited (concurrency can't be fully simulated in one session); H2 will report `INFO`.

- [ ] **Step 5: Run category I (4 scenarios)**. **Special attention to I3** — captures the `created_at` editability concern.

- [ ] **Step 6: Run category J (3 scenarios)**. J2 reports `INFO` reflecting prod's current alert count.

- [ ] **Step 7: Populate the findings report table.** For every scenario, one row:

  ```markdown
  | A | 1 | shorten paid end_date | ✅ PASS | shortened does not cause dup |
  | A | 2 | extend paid end_date | ✅ PASS | ... |
  | ... |
  | E | 5 | UPDATE creates dup (L2 bypass) | ⚠ CONCERN | L2 fires on INSERT only; UPDATE bypasses. L4 audit catches at 04:00 UTC. |
  | ... |
  | I | 3 | edit created_at | ⚠ CONCERN | created_at is UPDATE-able; grace can be bypassed. |
  ```

  Result markers: ✅ PASS, ❌ FAIL, ⚠ CONCERN, ℹ INFO.

---

### Task 5: Write the findings + mitigation report

**Files:**
- Modify: `docs/superpowers/reports/2026-07-01-flip-fix-edgecase-findings.md`

- [ ] **Step 1: Categorize.** In the report, split the results into 4 sections:
  - **PASS** — scenarios where the fix is bulletproof. Confirm expected behavior.
  - **FAIL** — scenarios where the fix does NOT hold. Each needs a mitigation proposal.
  - **CONCERN** — scenarios where the fix technically works but reveals a semantic gap (e.g., L2 bypass via UPDATE, editable `created_at`). Not urgent but worth flagging.
  - **INFO** — scenarios that document existing behavior without a hard assertion.

- [ ] **Step 2: For each FAIL and CONCERN, draft a mitigation.** Follow this template:

  ```markdown
  ### Concern E5 — L2 bypass via UPDATE

  **Scenario:** An accountant edits an existing row's `start_date` and `end_date` to
  match another row's period-key — creating a duplicate that L2's INSERT-only trigger
  cannot see. Only L4's nightly audit catches it (up to 24h detection lag).

  **Impact:** In practice, low — the L4 audit at 04:00 UTC daily catches it, and the
  audit inserts a `data_integrity_alerts` row + admin notification. Between the UPDATE
  and the audit, the deal's `deal_next_due` may reflect the duplicate; reconcile might
  briefly flip the deal (but L3 grace applies if the row was UPDATED recently — the
  original `created_at` is preserved on UPDATE).

  **Mitigation options:**
  1. Add a `BEFORE UPDATE` trigger with the same period-key check → prevents dupes at
     UPDATE time too. Silently drops the update (RETURN OLD) — matches L2's UX.
  2. Add a UNIQUE partial index `on (deal_id, service_type, billing_type, start_date,
     end_date) where billing_type in ('recurring_monthly','recurring_yearly')`. Hard
     DB-level guarantee; blocks both INSERT and UPDATE. Would break Scenario A2 style
     UPDATEs that don't touch dates but I don't see any legitimate reason to have two
     rows on the same period-key.
  3. Rely on L4 audit only. Accepted trade-off (24h detection lag).

  **Recommendation:** Option 2 (UNIQUE partial index). Cheap; catches the entire class
  at the DB layer without extra plpgsql. Deferred as a separate migration.
  ```

- [ ] **Step 3: Add an executive summary at the top** of the report:

  ```markdown
  ## Executive summary

  Ran 35 accounting mid-cycle modification scenarios against the shipped fix
  (migration 20260701010000_paid_in_full_flip_fix).

  | Result | Count |
  |---|---|
  | ✅ PASS | ... |
  | ❌ FAIL | ... |
  | ⚠ CONCERN | ... |
  | ℹ INFO | ... |

  **No FAIL → the fix is robust for accounting today.**

  Notable CONCERNs (see below): {list}.
  ```

- [ ] **Step 4: Commit the report** (do NOT push):

  ```
  git add docs/superpowers/reports/2026-07-01-flip-fix-edgecase-findings.md
  git commit -m "$(cat <<'EOF'
  docs(billing): flip-fix edge-case findings report

  35 scenarios run against prod (savepoint-rollback). Summary of PASS /
  FAIL / CONCERN / INFO. Includes mitigation drafts for every CONCERN.
  EOF
  )"
  ```

---

### Task 6: Optionally push + memory update

**Files:**
- Modify: `MEMORY.md` (index) + optionally a new memory file

- [ ] **Step 1: Push the three commits** (harness A–E + F–J, report) to `origin/main`:

  ```
  git push origin main
  ```

- [ ] **Step 2: If any FAILs surfaced**, draft a follow-up plan file at
  `docs/superpowers/plans/2026-07-02-flip-fix-mitigations.md` covering the specific
  fixes. Otherwise skip.

- [ ] **Step 3: Update `MEMORY.md`** with a one-liner:

  ```
  - [Flip-fix edge-case findings](reference_flip_fix_edgecase_findings.md) — 2026-07-01: ran 35 accounting mid-cycle scenarios against the shipped fix; N PASS / 0 FAIL / M CONCERN (L2 bypass via UPDATE + created_at editable); recommend UNIQUE partial index as follow-up
  ```

  Also create the memory file with the summary and a link to the report.

---

## Self-Review

**1. Spec coverage:**
- "Run a smoke and detailed test" — Task 1 runs the baseline smoke; Tasks 2–4 run 35 detailed scenarios.
- "Return me the results" — Task 4 populates the report table; Task 5 writes the executive summary.
- "Create any possible scenario that this fail and report it back" — 35 scenarios across 10 categories cover date changes, amount changes, status flips, service changes, row lifecycle (delete + insert + UPDATE bypass), deal-level changes, trigger cascades, concurrency, L3 grace boundaries, L4 audit corner cases.
- "Accounting may change dates, amounts, or do mid-cycle modifications" — categories A (dates), B (amounts), C (status), D (service classification), E (lifecycle) are all built around this.

**2. Placeholder scan:** no TBDs / "add validation" / "similar to task N".

**3. Type consistency:**
- Every scenario uses the same seed shape (client + deal in specific stage + one or more rows). SQL is verbatim, not summarized.
- Terminal exception format is consistent: `RESULT :: <STATUS> <letter>N :: <details>`.
- `execute_sql` behavior (swallows NOTICE, surfaces ERROR) is called out in Tasks 1 and 4.
- All function signatures used (`ensure_recurring_payments()`, `reconcile_block_lifecycle(boolean)`, `reconcile_payment_integrity()`) match what shipped in `20260701010000_paid_in_full_flip_fix.sql`.

**4. Robustness invariants:**
- **All scenarios are savepoint-rollback** — no prod data changes.
- **No new production code** in this plan — DIAGNOSTIC only.
- **Findings report is version-controlled** — commit trail lets future engineers see what was tested and when.
- **Every CONCERN has at least one proposed mitigation** — no vague "consider improving" left on the table.

**5. Memory caveats applied:**
- DDL / DML boundary respected — no `apply_migration` needed since we're not shipping schema changes.
- `execute_sql` swallows `NOTICE` — mitigation is the terminal `RAISE EXCEPTION` pattern (per `project_paid_in_full_flip_fix`).
- `deal_payments.status` CHECK enforces `pending|paid|overdue` — Scenario B4 asserts a negative amount is rejected; Category C only tests valid transitions.
- Push directly to `main`, no PR (per `feedback_no_prs`).
- No literal secrets (per `feedback_no_secrets_in_docs`).
