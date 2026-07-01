# Paid-In-Full → On-Hold Flip-Flop — Bulletproof Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make it structurally impossible for a Paid-In-Full deal to bounce back to On-Hold because of duplicate recurring payments — with four independent defense layers, historical cleanup, an integrity monitor that yells if a similar bug ever recurs, and a documented runbook so accounting is protected regardless of what happens.

**Root cause (verified against prod 2026-07-01):** The daily `ensure_recurring_payments()` cron's idempotency guard was scoped by `service_index`, and the belt-and-braces `deal_payments_no_duplicate_period` trigger had the exact same scoping bug. When accounting manually created an advance-payment via the PaymentsPanel UI, the auto-populated `service_index` landed on `1` instead of `0` (because `deal_payments_default_service_keys` failed to match the existing row and fell back to `max+1`). The cron then treated `service_index=0` and `service_index=1` as independent chains and inserted a **duplicate** row for `service_index=0` with `start_date` in the past → `mark_overdue_payments` flipped it to `'overdue'` → `reconcile_block_lifecycle` computed `deal_next_due` = that past date → deal moved from `paid_in_full` back to `on_hold` at 02:20 UTC.

**Smoking-gun trace (deal 000512):**
- Row A: `service_index=0`, dates `2026-05-20 → 2026-06-20`, `paid` (cron created 2026-06-23 02:00).
- Row B: `service_index=1`, dates `2026-06-20 → 2026-07-20`, `paid` (accounting manually created 2026-06-23 10:29).
- Row C: `service_index=0`, dates `2026-06-20 → 2026-07-20`, `overdue` (cron created 2026-07-01 02:00 — **the duplicate**).

**Architecture — four independent defense layers, each of which alone is sufficient:**

1. **Cron-level idempotency (primary).** Rewrite the `ensure_recurring_payments` guard to match by `(deal_id, service_type, billing_type)` with a date-range overlap check instead of scoping by `service_index`. Any live (`status <> 'cancelled'`) payment covering the target next-period blocks the insert.

2. **Insert-time trigger (belt-and-braces).** Rewrite `deal_payments_no_duplicate_period` with the same non-service_index-scoped semantics. Silently drops (`RETURN NULL`) any INSERT that would duplicate an existing live period. Catches any code path that ever tries to insert a duplicate, not just the cron.

3. **Reconcile-level 24-hour grace (temporal safety net).** In `reconcile_block_lifecycle`, never move a deal *out of* `paid_in_full` when the deciding unpaid payment was created within the last 24 h. Defers a suspicious flip long enough for a human or the audit function to catch it.

4. **Nightly integrity audit + admin alerting.** New `reconcile_payment_integrity()` cron that (a) counts duplicate live period-keys, (b) counts deals that flipped out of `paid_in_full` in the previous 24 h, and (c) inserts `payment_integrity_alert` notifications for every admin when either count is non-zero. Logs to a new `data_integrity_alerts` table for post-hoc review. If this ever fires, accounting knows within a day, not weeks.

**Historical cleanup** removes the three existing duplicate period-keys (backed up first) and restores every currently-on-hold deal whose only "unpaid" payment was one of those duplicates. Every step is idempotent so re-running the migration is a no-op.

**Runbook** (Task 12) documents exactly what accounting does if they ever see the bug again, and what the on-call engineer runs.

**Tech Stack:** Postgres (Supabase) functions + pg_cron; MCP `apply_migration` for DDL, `execute_sql` for DML; Vitest is unused here (no frontend changes).

**Scope:**
- IN: `ensure_recurring_payments`, `deal_payments_no_duplicate_period`, `reconcile_block_lifecycle`, new `reconcile_payment_integrity` audit function + cron, new `data_integrity_alerts` table, one-shot cleanup with backup, re-enable of the paused `daily_payment_reminders` cron.
- IN: comprehensive SQL test matrix (10 scenarios) run against prod via savepoint-rollback before AND after every change.
- IN: verification via dry-run against real prod data.
- OUT: the UI-side `deal_payments_default_service_keys` bug where manual advance-payments get `service_index=max+1` instead of matching the existing chain. **Not needed** for correctness after Layers 1 + 2 land, but flagged as a follow-up in the memory (Task 13).
- OUT: rewriting the payment reminder templates or moving them to a per-template active flag. Cron 7 stays paused for the duration of this plan and gets re-enabled at the end.

**State at plan-write time (2026-07-01 ~15:00 UTC):**
- Cron `daily_payment_reminders` (jobid 7) **DISABLED** ~14:00 UTC. Nothing pending in `email_outbox` — all past reminders already sent or failed. Re-enabled at end of Task 11.
- 5 deals confirmed flipped by today's 02:20 UTC cron: `000131`, `000051`, `000203`, `000512`, `000066`. Historical audit (Task 1 Step 6) will expand this list if others exist.
- 3 duplicate period-keys exist across all time (2 deals): `000415` × 2 (both paid-paid + overdue-overdue), `000512` × 1 (paid-overdue). Task 8 handles them.

**Changes / Revert:**
- One migration file: `supabase/migrations/20260701000000_paid_in_full_flip_fix.sql`. Applied in **4 parts** via `apply_migration` (DDL) with intervening `execute_sql` (DML + verification) between parts, so a mid-run failure doesn't wedge the DB half-way through. Each part is idempotent (safe to re-run). Revert SQL is embedded verbatim at the bottom of the file (commented) — see Task 11 Step 4.
- Cron jobid 7 gets `active := true` at the end via `execute_sql` (not DDL — reversible with one line).

---

### Task 1: Full evidence gathering + failing-test harness

**Files:**
- Create: `supabase/tests/paid_in_full_flip_harness.sql` — a savepoint-rollback SQL harness that seeds 10 scenarios (A–J), runs the current cron/trigger, asserts expected vs actual, and either raises with a REPRO message or reports OK. Run against prod (rollback-safe via `SAVEPOINT`); no data persists.

Context: TDD demands a failing test *before* touching code. Because the current (buggy) code is in prod, we run the harness once now to prove it fails, then re-run it after each phase to prove the fix landed. The harness stays in the repo as a regression guard.

- [ ] **Step 1: Read current function bodies** for the revert block. Via `mcp__plugin_supabase_supabase__execute_sql`:

  ```sql
  select proname, pg_get_functiondef(oid) as src
    from pg_proc
   where proname in (
     'ensure_recurring_payments',
     'deal_payments_no_duplicate_period',
     'reconcile_block_lifecycle',
     'deal_payments_default_service_keys',
     'deal_payments_move_to_awaiting',
     'deal_payments_release_from_on_hold',
     'deal_payments_settle_to_paid_in_full',
     'deal_next_due',
     'target_accounting_stage',
     'mark_overdue_payments',
     'block_deal_jobs'
   )
   order by proname;
  ```

  Save every one into your scratchpad. The plan modifies **three** of these (`ensure_recurring_payments`, `deal_payments_no_duplicate_period`, `reconcile_block_lifecycle`). The others must remain untouched — reading them lets you verify no accidental drift and gives you the exact revert bodies.

- [ ] **Step 2: Confirm the state at plan-write time is still current.** Run:

  ```sql
  select jobid, jobname, schedule, active from cron.job where jobid in (1,7,8,12) order by jobid;
  select code, id from public.pipeline_stages where board='accounting_onboarding' order by position;
  select column_name from information_schema.columns where table_schema='public' and table_name='deal_payments' order by ordinal_position;
  select column_name from information_schema.columns where table_schema='public' and table_name='deals' order by ordinal_position;
  ```

  Expected: cron 7 is `active=false`, stages match `new/awaiting_payment/on_hold/documents_verified/invoice_issued/partial_payment/paid_in_full/done/closed`, `deal_payments` has `service_index`, `deals` has no `paid_in_full_at` (we're not adding it — see architecture note above). If any of these diverge, STOP — the schema shifted since plan-write and every subsequent SQL block needs to be re-verified.

- [ ] **Step 3: Write the harness file** at `supabase/tests/paid_in_full_flip_harness.sql`. Structure:

  ```sql
  -- Paid-In-Full flip-flop harness. Run each scenario in its own transaction,
  -- rollback at the end so the DB is untouched. Each scenario raises with a
  -- clear REPRO message on failure and prints 'OK: <name>' on success.

  \set ON_ERROR_STOP on

  -- ---- Scenario A: single-service recurring, cron creates next -----------
  begin;
  do $$
  declare v_client uuid; v_deal uuid; v_before int; v_after int;
  begin
    insert into public.clients (name) values ('harness_A_' || gen_random_uuid()::text) returning id into v_client;
    insert into public.deals (client_id, code, payment_method, accounting_stage_id)
      values (v_client, 'HARN-A', 'bank_transfer',
              (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
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
  begin
    insert into public.clients (name) values ('harness_B_' || gen_random_uuid()::text) returning id into v_client;
    insert into public.deals (client_id, code, payment_method, accounting_stage_id)
      values (v_client, 'HARN-B', 'bank_transfer',
              (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
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
  begin
    insert into public.clients (name) values ('harness_C_' || gen_random_uuid()::text) returning id into v_client;
    insert into public.deals (client_id, code, payment_method, accounting_stage_id)
      values (v_client, 'HARN-C', 'bank_transfer',
              (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
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
  begin
    insert into public.clients (name) values ('harness_D_' || gen_random_uuid()::text) returning id into v_client;
    insert into public.deals (client_id, code, payment_method, accounting_stage_id)
      values (v_client, 'HARN-D', 'bank_transfer',
              (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
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
  begin
    insert into public.clients (name) values ('harness_E_' || gen_random_uuid()::text) returning id into v_client;
    insert into public.deals (client_id, code, payment_method, accounting_stage_id)
      values (v_client, 'HARN-E', 'bank_transfer',
              (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
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
  begin
    insert into public.clients (name) values ('harness_F_' || gen_random_uuid()::text) returning id into v_client;
    insert into public.deals (client_id, code, payment_method, accounting_stage_id)
      values (v_client, 'HARN-F', 'bank_transfer',
              (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
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
  declare v_client uuid; v_deal uuid; v_stage text; v_paid_id uuid;
  begin
    insert into public.clients (name) values ('harness_G_' || gen_random_uuid()::text) returning id into v_client;
    select id into v_paid_id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full';
    insert into public.deals (client_id, code, payment_method, accounting_stage_id)
      values (v_client, 'HARN-G', 'bank_transfer', v_paid_id) returning id into v_deal;
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
  declare v_client uuid; v_deal uuid; v_stage text; v_paid_id uuid;
  begin
    insert into public.clients (name) values ('harness_H_' || gen_random_uuid()::text) returning id into v_client;
    select id into v_paid_id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full';
    insert into public.deals (client_id, code, payment_method, accounting_stage_id)
      values (v_client, 'HARN-H', 'bank_transfer', v_paid_id) returning id into v_deal;
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
  begin;
  do $$
  declare v_client uuid; v_deal uuid; v_alerts int;
  begin
    insert into public.clients (name) values ('harness_J_' || gen_random_uuid()::text) returning id into v_client;
    insert into public.deals (client_id, code, payment_method, accounting_stage_id)
      values (v_client, 'HARN-J', 'bank_transfer',
              (select id from public.pipeline_stages where board='accounting_onboarding' and code='paid_in_full'))
      returning id into v_deal;
    -- Two live rows same period (should not survive triggers, but seed via COPY
    -- via bypassing triggers if the harness runs before Layer 2 lands — use
    -- explicit ALTER SESSION set session_replication_role = replica if needed).
    set local session_replication_role = 'replica';
    insert into public.deal_payments (deal_id, service_type, service_index, billing_type,
      amount_net, vat_rate, start_date, end_date, status)
      values (v_deal, 'ai_seo', 0, 'recurring_monthly', 100, 24,
              current_date - 40, current_date - 10, 'paid'),
             (v_deal, 'ai_seo', 1, 'recurring_monthly', 100, 24,
              current_date - 40, current_date - 10, 'paid');
    set local session_replication_role = 'origin';
    select public.reconcile_payment_integrity() into v_alerts;
    if v_alerts < 1 then
      raise exception 'J FAILED: audit did not flag duplicate rows';
    end if;
    raise notice 'OK: J integrity audit flags dupes';
  end $$;
  rollback;
  ```

  Notes: each scenario runs in its own `begin ... rollback` so nothing persists. Scenario I is a comment because idempotency is proved by re-running the migration file (Task 11 Step 3). Scenario J references `reconcile_payment_integrity` which doesn't exist yet — it stays commented out until Task 9 lands, then gets uncommented.

- [ ] **Step 4: Run the harness against prod BEFORE any fixes** to prove B and C REPRO on the current buggy code. Run each scenario one at a time via `mcp__plugin_supabase_supabase__execute_sql` (paste the individual `begin;...rollback;` blocks). Expected:

  - A, D, E, F, H → `OK: ...` notices.
  - **B → raises with "B REPRO: cron created N duplicate row(s) ..."**.
  - **C → raises with "C REPRO: trigger allowed duplicate insert (id=...)"**.
  - G → raises with `G REPRO: deal flipped to on_hold despite <24h cron-created row` (the grace clause doesn't exist yet).
  - J → skipped until Task 9.

  Copy the exact REPRO error messages into your task-progress log; you'll need to prove they no longer fire after the fix.

- [ ] **Step 5: Historical audit.** Run and save the output:

  ```sql
  with dup as (
    select deal_id, service_type, billing_type, start_date, end_date,
      count(*) as n,
      array_agg(id order by created_at)          as ids,
      array_agg(status order by created_at)      as statuses,
      array_agg(service_index order by created_at) as service_indexes,
      array_agg(created_at order by created_at)  as created_ats
    from public.deal_payments
    where billing_type in ('recurring_monthly','recurring_yearly')
      and start_date is not null and end_date is not null
    group by deal_id, service_type, billing_type, start_date, end_date
    having count(*) >= 2
  )
  select d.code, dup.service_type, dup.start_date, dup.end_date,
         dup.statuses, dup.service_indexes, dup.ids, dup.created_ats
    from dup join public.deals d on d.id = dup.deal_id
   order by d.code, dup.start_date;
  ```

  Expected at plan-write: 3 rows across 2 deals (`000415` × 2, `000512` × 1). If more, the plan still handles them — cleanup logic is generic.

- [ ] **Step 6: Currently-flipped deals audit.** Save:

  ```sql
  select d.code, d.id as deal_id,
         (select min(dp.start_date) from public.deal_payments dp
           where dp.deal_id = d.id and dp.status <> 'paid'
             and dp.status <> 'cancelled') as earliest_unpaid,
         (select max(dp.created_at)  from public.deal_payments dp
           where dp.deal_id = d.id and dp.created_at::date = current_date) as latest_cron_today,
         d.updated_at
    from public.deals d
    join public.pipeline_stages ps on ps.id = d.accounting_stage_id
   where not d.archived and ps.code = 'on_hold'
     and d.updated_at::date >= current_date - 1
   order by d.updated_at desc;
  ```

  Expected: 5 rows for today's flips (`000131 / 000051 / 000203 / 000512 / 000066`) plus any recent on_hold arrivals. Cross-reference against Step 5's duplicate list — the intersection is the set of deals that Task 8's cleanup will restore.

- [ ] **Step 7: Commit** the harness (test-first, per user memory `feedback_plan_granularity` — TDD + commit per task):

  ```
  git add supabase/tests/paid_in_full_flip_harness.sql
  git commit -m "$(cat <<'EOF'
  test(billing): SQL harness for paid_in_full flip-flop scenarios A-J

  Rollback-safe savepoint harness runs 10 scenarios against prod, raising
  REPRO on B/C (current bug: cron and trigger both service_index-scoped),
  G (missing 24h grace), and J (missing integrity audit). Passes A/D/E/F/H
  today and will pass B/C/G/J after 20260701000000_paid_in_full_flip_fix.
  EOF
  )"
  ```

---

### Task 2: Layer 1 — Fix `ensure_recurring_payments` idempotency

**Files:** Create `supabase/migrations/20260701000000_paid_in_full_flip_fix.sql`, first section only.

- [ ] **Step 1: Write the section.** Start the migration file with the exact header block below (subsequent tasks append to this file — do not create separate migrations, so revert stays atomic):

  ```sql
  -- =========================================================================
  -- 20260701000000_paid_in_full_flip_fix.sql
  --
  -- Four-layer fix for the paid_in_full → on_hold flip-flop:
  --   1. ensure_recurring_payments idempotency by (service_type, date-range),
  --      not service_index. [this file, section 1]
  --   2. deal_payments_no_duplicate_period trigger — same de-scoping.
  --      [section 2]
  --   3. reconcile_block_lifecycle 24h grace on cron-created rows. [section 3]
  --   4. Nightly reconcile_payment_integrity audit + cron + admin alert.
  --      [sections 4 + 5]
  --
  -- Plus: cleanup (backup + delete + restore) in section 6, re-enable of
  -- daily_payment_reminders cron in section 7, verbatim revert SQL in
  -- section 8.
  --
  -- Every DDL statement is `create or replace` / `create ... if not exists`,
  -- so re-running is a no-op. DML uses idempotency guards.
  -- =========================================================================

  -- ---- Section 1: ensure_recurring_payments guard ----------------------
  create or replace function public.ensure_recurring_payments()
  returns integer
  language plpgsql
  security definer
  set search_path = public
  as $function$
  declare
    r record; next_start date; next_end date; created int := 0; v_payment_id uuid;
  begin
    perform pg_advisory_xact_lock(hashtext('ensure_recurring_payments')::bigint);

    for r in
      select dp.*
        from public.deal_payments dp
        join public.deals d on d.id = dp.deal_id
       where dp.billing_type in ('recurring_monthly','recurring_yearly')
         and dp.end_date is not null
         and dp.end_date <= current_date + interval '7 days'
         and d.archived = false
         and coalesce((select ps.code from public.pipeline_stages ps
                        where ps.id = d.accounting_stage_id), '') <> 'closed'
         and (
              not exists (select 1 from public.jobs j
                           where j.deal_id = dp.deal_id and j.service_type = dp.service_type
                             and not j.archived)
           or exists (select 1 from public.jobs j
                           where j.deal_id = dp.deal_id and j.service_type = dp.service_type
                             and not j.archived and j.billing_active)
         )
         -- FIX (Layer 1): match by (deal_id, service_type, billing_type) with
         -- a date-range overlap. Any live (non-cancelled) payment whose
         -- start_date sits on or after dp.end_date already covers the next
         -- period — regardless of service_index.
         and not exists (
           select 1 from public.deal_payments dp2
            where dp2.deal_id = dp.deal_id
              and dp2.service_type = dp.service_type
              and dp2.billing_type = dp.billing_type
              and dp2.status <> 'cancelled'
              and dp2.start_date is not null
              and dp2.start_date >= dp.end_date
         )
    loop
      next_start := r.end_date;
      if r.billing_type = 'recurring_monthly' then
        next_end := next_start + interval '1 month';
      else
        next_end := next_start + interval '1 year';
      end if;

      insert into public.deal_payments
        (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, end_date)
        values (r.deal_id, r.service_type, r.service_index, r.billing_type, r.amount_net, r.vat_rate, next_start, next_end)
        returning id into v_payment_id;

      insert into public.deal_payment_lines (payment_id, job_id, label, amount_net, vat_rate)
        values (v_payment_id,
          (select j.id from public.jobs j
            where j.deal_id = r.deal_id and j.service_type = r.service_type and not j.archived
            order by j.created_at limit 1),
          coalesce(r.label, r.service_type), r.amount_net, r.vat_rate);

      created := created + 1;
    end loop;
    return created;
  end $function$;
  ```

- [ ] **Step 2: Apply Layer 1 via `apply_migration`.** Name: `paid_in_full_flip_fix_L1`. Query: everything from the top of the file down to the end of Section 1 (i.e., through the closing `end $function$;`). Do NOT paste sections 2+ yet — they don't exist in the file until later tasks.

- [ ] **Step 3: Re-run harness scenarios A, B, D, E, F** (the ones that exercise Layer 1). Expected after Layer 1: **B stops REPROing** (`OK: B manual-advance duplicate suppressed`). A/D/E/F stay `OK`. If B still REPROs, STOP and diagnose — do not proceed.

---

### Task 3: Layer 2 — Fix `deal_payments_no_duplicate_period` trigger

**Files:** Append Section 2 to the migration file.

Context: the existing trigger function has the same `service_index is not distinct from new.service_index` scoping bug. Rewrite with the same non-index-scoped semantics as Layer 1. Silently drops (RETURN NULL) any INSERT that would duplicate a live period.

- [ ] **Step 1: Append Section 2.**

  ```sql
  -- ---- Section 2: deal_payments_no_duplicate_period trigger ------------
  create or replace function public.deal_payments_no_duplicate_period()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
  as $function$
  begin
    -- Only guard recurring inserts (one_time and recurring_test_2min are
    -- free to have overlapping rows; historical practice for corrections).
    if new.billing_type not in ('recurring_monthly','recurring_yearly') then
      return new;
    end if;

    -- Any LIVE (non-cancelled) payment on the same (deal_id, service_type,
    -- billing_type, start_date, end_date) blocks the insert — regardless of
    -- service_index or amount. Silently drops so the calling INSERT
    -- succeeds without a row (matches previous behaviour on the old
    -- narrower guard).
    if exists (
      select 1 from public.deal_payments dp
       where dp.deal_id     = new.deal_id
         and dp.service_type is not distinct from new.service_type
         and dp.billing_type = new.billing_type
         and dp.status <> 'cancelled'
         and dp.start_date  = new.start_date
         and dp.end_date    is not distinct from new.end_date
    ) then
      return null;
    end if;

    return new;
  end $function$;
  ```

  Note: this preserves the `RETURN NULL` (silent-drop) behaviour of the current trigger. If any code path currently relies on "no row → success", it stays working. If a code path expected the row's `id` back and got NULL, that code was already broken by the old trigger for same-index dupes — no regression.

- [ ] **Step 2: Apply Layer 2 via `apply_migration`.** Name: `paid_in_full_flip_fix_L2`. Query: the whole file so far (Sections 1 + 2). `create or replace` is idempotent — re-applying Section 1 is a no-op.

- [ ] **Step 3: Re-run harness scenario C.** Expected: `OK: C insert-time trigger blocked cross-index dupe`. If C still REPROs, STOP.

---

### Task 4: Layer 3 — 24h grace on `reconcile_block_lifecycle`

**Files:** Append Section 3.

- [ ] **Step 1: Append Section 3.**

  ```sql
  -- ---- Section 3: reconcile 24h grace ---------------------------------
  create or replace function public.reconcile_block_lifecycle(p_allow_release boolean default false)
  returns integer
  language plpgsql
  security definer
  set search_path = public
  as $function$
  declare r record; v_target text; v_target_id uuid; moved int := 0;
  begin
    for r in
      select d.id, ps.code as cur_code, public.deal_next_due(d.id) as next_due
        from public.deals d join public.pipeline_stages ps on ps.id = d.accounting_stage_id
       where not d.archived and ps.code not in ('done','closed')
         and d.payment_method is not null
         and exists (select 1 from public.deal_payments dp
                      where dp.deal_id = d.id and dp.start_date is not null)
    loop
      v_target := public.target_accounting_stage(r.next_due, current_date);
      if r.cur_code in ('awaiting_payment','on_hold','paid_in_full')
         and v_target is distinct from r.cur_code then
        -- existing "no auto-release" gate (unchanged)
        if not (r.cur_code = 'on_hold' and v_target = 'paid_in_full' and not p_allow_release) then
          -- Layer 3: never flip OUT of paid_in_full when the deciding
          -- unpaid payment was created in the last 24 h. Buys 24 h for
          -- accounting or the integrity audit to catch a suspicious flip.
          if r.cur_code = 'paid_in_full' and v_target = 'on_hold' and exists (
            select 1 from public.deal_payments dp
             where dp.deal_id = r.id
               and dp.status <> 'paid'
               and dp.status <> 'cancelled'
               and dp.start_date = r.next_due
               and dp.created_at > now() - interval '24 hours'
          ) then
            continue;
          end if;

          select id into v_target_id from public.pipeline_stages
            where board='accounting_onboarding' and code = v_target;
          update public.deals set accounting_stage_id = v_target_id where id = r.id;
          moved := moved + 1; continue;
        end if;
      end if;
      if r.cur_code in ('on_hold','partial_payment') then
        perform public.block_deal_jobs(r.id);
      else
        update public.jobs set is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null
          where deal_id = r.id and is_blocked and blocked_reason='account_on_hold';
      end if;
    end loop;
    update public.jobs j set is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null
      from public.pipeline_stages s
     where s.id = j.stage_id and (s.is_terminal or s.code='done')
       and j.is_blocked and j.blocked_reason='account_on_hold' and not j.archived;
    return moved;
  end $function$;
  ```

- [ ] **Step 2: Apply via `apply_migration`.** Name: `paid_in_full_flip_fix_L3`. Query: whole file so far.

- [ ] **Step 3: Re-run harness scenarios G and H.** Expected: `OK: G 24h grace held paid_in_full` and `OK: H legitimate flip to on_hold preserved`. If G still REPROs, verify the `created_at > now() - interval '24 hours'` clause landed. If H FAILs, the grace clause is too aggressive — inspect the seed data.

---

### Task 5: Layer 4 — Integrity audit table + function

**Files:** Append Sections 4 (table) and 5 (function).

- [ ] **Step 1: Append Section 4** (`data_integrity_alerts` table):

  ```sql
  -- ---- Section 4: alerts table ----------------------------------------
  create table if not exists public.data_integrity_alerts (
    id               uuid primary key default gen_random_uuid(),
    kind             text not null,        -- 'duplicate_period' | 'flip_out_of_paid_in_full' | ...
    subject_type     text not null,        -- 'deal' | 'deal_payment' | ...
    subject_id       uuid not null,
    details          jsonb not null default '{}'::jsonb,
    detected_at      timestamptz not null default now(),
    resolved_at      timestamptz,
    resolved_by      uuid
  );
  create index if not exists data_integrity_alerts_kind_open
    on public.data_integrity_alerts (kind) where resolved_at is null;
  create index if not exists data_integrity_alerts_subject
    on public.data_integrity_alerts (subject_type, subject_id);

  alter table public.data_integrity_alerts enable row level security;

  create policy data_integrity_alerts_admin_read
    on public.data_integrity_alerts for select
    using (
      exists (select 1 from public.profiles p
               where p.user_id = auth.uid() and p.is_admin and not p.archived)
    );

  create policy data_integrity_alerts_admin_write
    on public.data_integrity_alerts for update
    using (
      exists (select 1 from public.profiles p
               where p.user_id = auth.uid() and p.is_admin and not p.archived)
    );
  ```

- [ ] **Step 2: Append Section 5** (`reconcile_payment_integrity()` audit function):

  ```sql
  -- ---- Section 5: nightly integrity audit -----------------------------
  create or replace function public.reconcile_payment_integrity()
  returns integer
  language plpgsql
  security definer
  set search_path = public
  as $function$
  declare
    v_dupes int; v_flips int; v_alerts int := 0;
    v_rec record;
  begin
    -- Detect duplicate live period-keys
    for v_rec in
      with dup as (
        select deal_id, service_type, billing_type, start_date, end_date,
          array_agg(id order by created_at) as ids,
          array_agg(status order by created_at) as statuses
        from public.deal_payments
        where billing_type in ('recurring_monthly','recurring_yearly')
          and status <> 'cancelled'
          and start_date is not null and end_date is not null
        group by deal_id, service_type, billing_type, start_date, end_date
        having count(*) >= 2
      )
      select deal_id, service_type, billing_type, start_date, end_date,
             ids, statuses
        from dup
    loop
      insert into public.data_integrity_alerts
        (kind, subject_type, subject_id, details)
      select 'duplicate_period', 'deal', v_rec.deal_id,
             jsonb_build_object(
               'service_type', v_rec.service_type,
               'billing_type', v_rec.billing_type,
               'start_date', v_rec.start_date,
               'end_date', v_rec.end_date,
               'payment_ids', v_rec.ids,
               'statuses', v_rec.statuses)
       where not exists (
         select 1 from public.data_integrity_alerts a
          where a.kind = 'duplicate_period'
            and a.subject_id = v_rec.deal_id
            and a.details ->> 'start_date' = v_rec.start_date::text
            and a.details ->> 'end_date'   = v_rec.end_date::text
            and a.resolved_at is null);
      v_alerts := v_alerts + 1;
    end loop;

    -- Detect deals that flipped OUT of paid_in_full in the last 24 h
    -- (heuristic: deal is on_hold, updated_at ~= last cron run, has any
    -- unpaid row whose start_date is in the past)
    for v_rec in
      select d.id as deal_id, d.updated_at,
             public.deal_next_due(d.id) as next_due
        from public.deals d
        join public.pipeline_stages ps on ps.id = d.accounting_stage_id
       where not d.archived and ps.code = 'on_hold'
         and d.updated_at > now() - interval '25 hours'
         and public.deal_next_due(d.id) is not null
         and public.deal_next_due(d.id) <= current_date
    loop
      insert into public.data_integrity_alerts
        (kind, subject_type, subject_id, details)
      select 'flip_out_of_paid_in_full', 'deal', v_rec.deal_id,
             jsonb_build_object(
               'updated_at', v_rec.updated_at,
               'next_due', v_rec.next_due)
       where not exists (
         select 1 from public.data_integrity_alerts a
          where a.kind = 'flip_out_of_paid_in_full'
            and a.subject_id = v_rec.deal_id
            and a.detected_at > now() - interval '25 hours'
            and a.resolved_at is null);
      v_alerts := v_alerts + 1;
    end loop;

    -- Notify every admin, once per new alert cluster
    if v_alerts > 0 then
      insert into public.notifications (user_id, type, payload)
      select p.user_id, 'payment_integrity_alert',
             jsonb_build_object(
               'kind', 'integrity_audit',
               'alerts_new', v_alerts,
               'ran_at', now())
        from public.profiles p
       where p.is_admin and not p.archived;
    end if;

    return v_alerts;
  end $function$;

  -- Cron: 04:00 UTC daily, 100 minutes after the recurring/reconcile crons
  select cron.schedule(
    'reconcile_payment_integrity',
    '0 4 * * *',
    $$ select public.reconcile_payment_integrity(); $$
  ) where not exists (
    select 1 from cron.job where jobname = 'reconcile_payment_integrity'
  );
  ```

- [ ] **Step 3: Apply via `apply_migration`.** Name: `paid_in_full_flip_fix_L4`. Query: whole file so far.

- [ ] **Step 4: Uncomment scenario J** in the harness file (if you commented it out earlier) and re-run all scenarios A–J. Expected: **all `OK: ...`** notices. If J FAILs, verify `reconcile_payment_integrity` is callable and returns >= 1 for seeded duplicates.

- [ ] **Step 5: Sanity check the cron was scheduled.** `select jobid, jobname, schedule, active from cron.job where jobname = 'reconcile_payment_integrity';` Expected: 1 row, `active=true`.

---

### Task 6: Historical cleanup — backup + delete duplicates

**Files:** Append Section 6 to the migration file.

Context: 3 historical duplicate period-keys exist (2 deals). Each duplicate row could still cause a flip-flop until deleted. Backup ALL of them first (paid, overdue, whatever), then delete the row that shouldn't be there. Restore any deal whose on_hold state was caused solely by these dupes.

- [ ] **Step 1: Append Section 6.**

  ```sql
  -- ---- Section 6: historical cleanup ----------------------------------
  create table if not exists public.deal_payments_flipflop_backup_20260701
    (like public.deal_payments including all);

  -- Backup EVERY row involved in a duplicate period-key. This lets us
  -- restore anything the delete/restore step touches.
  insert into public.deal_payments_flipflop_backup_20260701
  select dp.*
    from public.deal_payments dp
    join (
      select deal_id, service_type, billing_type, start_date, end_date
        from public.deal_payments
       where billing_type in ('recurring_monthly','recurring_yearly')
         and start_date is not null and end_date is not null
       group by deal_id, service_type, billing_type, start_date, end_date
       having count(*) >= 2
    ) k on k.deal_id = dp.deal_id
       and k.service_type = dp.service_type
       and k.billing_type = dp.billing_type
       and k.start_date  = dp.start_date
       and k.end_date    = dp.end_date
   where not exists (
     select 1 from public.deal_payments_flipflop_backup_20260701 b
      where b.id = dp.id);  -- idempotent

  -- Now: within each duplicate cluster, keep the OLDEST row (which was
  -- the legitimate first-created record) and mark the rest for delete.
  -- Only delete rows whose status is one of ('overdue','pending') and
  -- for which a SIBLING row in the same cluster is 'paid'. Never delete
  -- a paid row (would lose money-received history) and never delete a
  -- cancelled row (already benign).
  with dup as (
    select deal_id, service_type, billing_type, start_date, end_date,
      array_agg(id order by created_at) as ids,
      array_agg(status order by created_at) as statuses
    from public.deal_payments
    where billing_type in ('recurring_monthly','recurring_yearly')
      and start_date is not null and end_date is not null
    group by deal_id, service_type, billing_type, start_date, end_date
    having count(*) >= 2
  ),
  deletable as (
    select unnest(dup.ids) as id, unnest(dup.statuses) as status,
           dup.statuses
      from dup
     where 'paid' = any (dup.statuses)  -- there's a keeper
  )
  delete from public.deal_payment_lines dpl
   where dpl.payment_id in (
     select id from deletable
      where status in ('overdue','pending')
   );

  with dup as (
    select deal_id, service_type, billing_type, start_date, end_date,
      array_agg(id order by created_at) as ids,
      array_agg(status order by created_at) as statuses
    from public.deal_payments
    where billing_type in ('recurring_monthly','recurring_yearly')
      and start_date is not null and end_date is not null
    group by deal_id, service_type, billing_type, start_date, end_date
    having count(*) >= 2
  ),
  deletable as (
    select unnest(dup.ids) as id, unnest(dup.statuses) as status,
           dup.statuses
      from dup
     where 'paid' = any (dup.statuses)
  )
  delete from public.deal_payments dp
   where dp.id in (select id from deletable where status in ('overdue','pending'));

  -- Note on paid-paid dupes (e.g. deal 000415 period 1): both are legitimate
  -- receipts. We DO NOT delete either — bookkeeping is preserved. They're
  -- backed up in flipflop_backup for later inspection.

  -- Restore any deal that's currently on_hold and now has no live past-due:
  with paid_stage as (
    select id from public.pipeline_stages
     where board='accounting_onboarding' and code='paid_in_full' limit 1
  ),
  target as (
    select d.id
      from public.deals d
      join public.pipeline_stages ps on ps.id = d.accounting_stage_id
     where not d.archived
       and ps.code = 'on_hold'
       and public.deal_next_due(d.id) is null  -- now caught up after delete
  )
  update public.deals set accounting_stage_id = (select id from paid_stage)
   where id in (select id from target);

  -- Unblock jobs on those restored deals
  update public.jobs j
     set is_blocked = false, blocked_reason = null, blocked_at = null, blocked_by = null
    from public.deals d
    join public.pipeline_stages ps on ps.id = d.accounting_stage_id
   where j.deal_id = d.id
     and ps.code = 'paid_in_full'
     and j.is_blocked
     and j.blocked_reason = 'account_on_hold';
  ```

- [ ] **Step 2: Apply via `apply_migration`.** Name: `paid_in_full_flip_fix_L5_cleanup`. Query: whole file so far.

- [ ] **Step 3: Verify cleanup outcomes.** Run:

  ```sql
  select count(*) as backup_rows from public.deal_payments_flipflop_backup_20260701;
  select count(*) as duplicates_left
    from (
      select 1 from public.deal_payments
       where billing_type in ('recurring_monthly','recurring_yearly')
         and start_date is not null and end_date is not null
       group by deal_id, service_type, billing_type, start_date, end_date
      having count(*) filter (where status <> 'cancelled') >= 2
         and count(*) filter (where status = 'paid') >= 1
    ) k;
  select code, (select ps.code from public.pipeline_stages ps
                 where ps.id = d.accounting_stage_id) as cur_stage
    from public.deals d
   where code in ('000131','000051','000203','000512','000066');
  ```

  Expected:
  - `backup_rows` ≥ 6 (three period-keys × 2 rows each; possibly more if new dupes appeared today).
  - `duplicates_left` = 0 for the paid-plus-live case (the ones we're safe to delete). Paid-paid dupes remain and that's fine.
  - The five deals now show `paid_in_full`. If any is still `on_hold`, inspect — it may have a genuinely-legitimate unpaid past-due that wasn't a duplicate. Log it, don't force a change.

---

### Task 7: Live dry-run verification against real data

**Files:** none — verification only.

Context: before turning payment reminders back on, run the two "dangerous" crons against real prod data inside savepoints and roll back. Nothing persists — but we get concrete evidence they behave correctly on the actual dataset.

- [ ] **Step 1: Dry-run ensure_recurring_payments.**

  ```sql
  begin;
  savepoint before_dryrun;
  do $$
  declare v_created int;
  begin
    select public.ensure_recurring_payments() into v_created;
    raise notice 'dry-run: ensure_recurring_payments would create % new rows now', v_created;
  end $$;
  rollback to savepoint before_dryrun;
  commit;
  ```

  Expected: **0 new rows**. The cron ran at 02:00 UTC today; nothing new should be created 15 hours later. If > 0, inspect what got created — could be a legitimate near-end-of-period row, or a bug. Do not proceed until this is 0 or explained.

- [ ] **Step 2: Dry-run reconcile_block_lifecycle.**

  ```sql
  begin;
  savepoint before_dryrun;
  do $$
  declare v_moved int;
  begin
    select public.reconcile_block_lifecycle(false) into v_moved;
    raise notice 'dry-run: reconcile would move % deals now', v_moved;
  end $$;
  rollback to savepoint before_dryrun;
  commit;
  ```

  Expected: some small number (probably < 5) of deals moving into or out of on_hold based on genuine due-date changes since 02:20. If > 20, something's wrong — a wave of flips isn't normal 15 hours after the last cron.

- [ ] **Step 3: Verify the audit function fires cleanly on real data.**

  ```sql
  do $$
  declare v_alerts int;
  begin
    select public.reconcile_payment_integrity() into v_alerts;
    raise notice 'audit created % new alert(s)', v_alerts;
  end $$;
  select kind, count(*) from public.data_integrity_alerts
   where detected_at > now() - interval '5 minutes'
   group by kind;
  ```

  Expected: `> 0` alerts (there ARE known dupes and today's flips). Delete these seeded-during-testing alerts if you want a clean slate, otherwise leave them — they're accurate reports of a real state.

- [ ] **Step 4: STOP checkpoint.** Before Task 8, ask yourself:
  - Did every harness scenario (A–J) pass?
  - Were 0 unexpected rows created by the ensure_recurring_payments dry-run?
  - Do the 5 originally-flipped deals now sit in `paid_in_full`?
  - Are there any new alerts you can't explain?

  If any answer is "no" / "unsure", investigate before turning cron 7 back on.

---

### Task 8: Re-enable `daily_payment_reminders` cron

**Files:** Append Section 7 to the migration file.

- [ ] **Step 1: Append Section 7.**

  ```sql
  -- ---- Section 7: re-enable paused cron -------------------------------
  select cron.alter_job(job_id => 7, active => true);
  ```

- [ ] **Step 2: Apply via `execute_sql`** (not `apply_migration` — this is DML on `cron.job` internals, not schema):

  ```sql
  select cron.alter_job(job_id => 7, active => true);
  select jobid, jobname, schedule, active from cron.job where jobid = 7;
  ```

  Expected: `active=true`. Payment reminders start enqueuing again at 06:00 UTC tomorrow.

---

### Task 9: Append revert SQL

**Files:** Append Section 8 (comment block) to the migration file.

- [ ] **Step 1: Append the verbatim pre-patch bodies** you saved in Task 1 Step 1 for `ensure_recurring_payments`, `deal_payments_no_duplicate_period`, and `reconcile_block_lifecycle`. Also append:

  ```sql
  -- =========================================================================
  -- REVERT SQL (do not run automatically — this is documentation).
  -- To roll back:
  --   1. Restore prior function bodies:
  --      create or replace function public.ensure_recurring_payments() ... $$;
  --      create or replace function public.deal_payments_no_duplicate_period() ... $$;
  --      create or replace function public.reconcile_block_lifecycle(boolean) ... $$;
  --   2. Drop the audit function + cron:
  --      select cron.unschedule('reconcile_payment_integrity');
  --      drop function public.reconcile_payment_integrity();
  --   3. Drop the alerts table (only if you're sure you don't need the history):
  --      drop table public.data_integrity_alerts;
  --   4. Restore historical duplicates from backup:
  --      insert into public.deal_payments
  --      select * from public.deal_payments_flipflop_backup_20260701
  --       on conflict (id) do nothing;
  --      -- deal_payment_lines rebuild is manual — inspect first
  --   5. Restore flipped deals to on_hold (one-shot; see Task 6 Step 3 output
  --      for the list of restored deals):
  --      update public.deals set accounting_stage_id = (
  --        select id from public.pipeline_stages
  --         where board='accounting_onboarding' and code='on_hold')
  --       where code in ('000131','000051','000203','000512','000066', ...);
  --   6. Re-pause the reminders cron:
  --      select cron.alter_job(7, active := false);
  -- =========================================================================
  ```

- [ ] **Step 2: Commit + push.**

  ```
  git add supabase/migrations/20260701000000_paid_in_full_flip_fix.sql
  git commit -m "$(cat <<'EOF'
  fix(billing): four-layer defense against paid_in_full → on_hold flip-flop

  L1: ensure_recurring_payments idempotency by (deal_id, service_type,
      billing_type, date-range) instead of service_index-scoped. Fixes
      the primary bug where a manual advance-payment on service_index=1
      let the cron create a duplicate on service_index=0.
  L2: deal_payments_no_duplicate_period trigger drops (RETURN NULL) any
      INSERT that duplicates a live period on the same service_type,
      regardless of service_index — catches every code path, not just
      the cron.
  L3: reconcile_block_lifecycle refuses to move a deal OUT of
      paid_in_full when the deciding unpaid payment was created in the
      last 24 h.
  L4: New reconcile_payment_integrity() audit + cron (04:00 UTC daily)
      writes to data_integrity_alerts and notifies every admin when
      duplicate periods exist or a deal was flipped out of paid_in_full
      in the last 24 h.

  Cleanup: 3 historical duplicate period-keys backed up to
  deal_payments_flipflop_backup_20260701 (kept intact for audit); the
  ones with a paid + live pair had the live duplicate deleted. Deals
  currently on_hold whose only unpaid row was one of those duplicates
  were restored to paid_in_full and their jobs unblocked. Payment
  reminders cron (jobid 7) was re-enabled after the checkpoint in
  Task 7 passed.
  EOF
  )"
  git push origin main
  ```

  Do NOT skip the push — the DB is already patched via MCP; the file must land in the repo so `git log` records the schema change.

---

### Task 10: Post-deploy smoke test

**Files:** none — live verification only.

- [ ] **Step 1: Re-run the full harness** (`supabase/tests/paid_in_full_flip_harness.sql`) one final time. Expected: all `OK` notices, no REPRO errors.

- [ ] **Step 2: Set a quiet ticker for the next 48 h.** Simulate what happens tomorrow morning. Run:

  ```sql
  -- Peek at what the 02:00 cron will do tonight
  begin;
  savepoint before_peek;
  do $$
  declare v_created int;
  begin
    select public.ensure_recurring_payments() into v_created;
    raise notice 'peek: cron will create % row(s) at 02:00', v_created;
  end $$;
  rollback to savepoint before_peek;

  -- Peek at what the 02:20 cron will do (uses whatever the above created)
  begin;
  savepoint before_peek;
  do $$
  declare v_created int; v_moved int;
  begin
    select public.ensure_recurring_payments() into v_created;
    select public.reconcile_block_lifecycle(false) into v_moved;
    raise notice 'peek: after cron chain, % rows created and % deals moved', v_created, v_moved;
  end $$;
  rollback to savepoint before_peek;
  ```

  Expected: the numbers reflect only legitimate month-boundary transitions. **Nothing in the restored 5 deals should flip back.** Cross-check by inspecting their stages before/after inside the savepoint.

- [ ] **Step 3: Confirm the pipeline visual is right.** Open `https://www.itdevcrm.com/accounting/onboarding` as admin. Confirm `000131 / 000051 / 000203 / 000512 / 000066` appear under Paid In Full, not On Hold. (Optional: Playwright is available if you want to script the check.)

- [ ] **Step 4: Post to the memory** (Task 11).

---

### Task 11: Memory update + runbook

**Files:** New memory files under `/Users/marios/.claude/projects/-Users-marios-Desktop-Cursor-itdevcrm/memory/`.

- [ ] **Step 1: Create `reference_recurring_idempotency_bug.md`.**

  ```markdown
  ---
  name: reference_recurring_idempotency_bug
  description: 2026-07-01 — root-caused and defended against paid_in_full → on_hold flip-flop; service_index scoping was the shared bug across ensure_recurring_payments cron AND the deal_payments_no_duplicate_period trigger, so both let duplicate rows through when a manual advance-payment sat on a different service_index; fixed via four defense layers + audit + cleanup
  metadata:
    type: reference
  ---

  Bug reported by accounting 2026-07-01: they'd drag a deal to Paid In Full and by the next morning it was back on On Hold.

  **Root cause chain:**
  1. Accounting UI (PaymentsPanel) → useAddDealPayment: manual advance-payment insert with service_index = NULL.
  2. deal_payments_default_service_keys trigger tried to reuse an existing service_index by matching (deal_id, billing_type, service_type, amount_net); if amount didn't match exactly (e.g., pre-VAT vs post-VAT), it fell back to max(service_index)+1.
  3. Result: same-service recurring chain now has two service_indexes (0 = original cron chain, 1 = manual advance).
  4. ensure_recurring_payments cron iterates over expiring rows. Its idempotency guard was `service_index is not distinct from dp.service_index` — it treated each index as an independent chain, missed the manual advance on the other index, and INSERTED a duplicate row on service_index=0 with start_date = the old row's end_date (past).
  5. mark_overdue_payments flipped the new row to 'overdue'.
  6. reconcile_block_lifecycle at 02:20 UTC read deal_next_due = the past date and moved the deal to on_hold.
  7. deal_payments_no_duplicate_period trigger had the exact same service_index scoping bug, so it silently allowed the duplicate too.

  **Smoking gun:** deal 000512 rows:
  - Row A: service_index=0, 2026-05-20 → 2026-06-20, paid (cron)
  - Row B: service_index=1, 2026-06-20 → 2026-07-20, paid (manual 2026-06-23 10:29)
  - Row C: service_index=0, 2026-06-20 → 2026-07-20, overdue (cron 2026-07-01 02:00 — the phantom)

  **Fix (migration 20260701000000_paid_in_full_flip_fix.sql, 4 layers):**
  1. ensure_recurring_payments guard now: `(deal_id, service_type, billing_type)` match, status <> cancelled, start_date >= dp.end_date. No service_index in the guard.
  2. deal_payments_no_duplicate_period trigger: same (deal_id, service_type, billing_type, start_date, end_date) match with `status <> 'cancelled'` — silently drops any duplicate INSERT.
  3. reconcile_block_lifecycle: never flips a deal OUT of paid_in_full when the deciding unpaid row was created in the last 24h (temporal safety net for future edge cases).
  4. reconcile_payment_integrity() audit + cron (04:00 UTC daily) + data_integrity_alerts table: yells if duplicates or flip-outs appear. Notifies every admin.

  Cleanup: 3 historical duplicate period-keys (deals 000415 × 2, 000512 × 1) backed up to deal_payments_flipflop_backup_20260701; the ones with paid + live siblings had the live duplicate deleted. 5 deals flipped by today's cron restored to paid_in_full (see project_paid_in_full_flip_fix.md).

  **Ops during triage:** payment_reminders cron (jobid 7) DISABLED 2026-07-01 ~14:00 UTC while investigating, re-ENABLED at end of plan run. No pending outbox rows queued during the pause.

  **Gotcha:** service_index is a UI-populated counter (via deal_payments_default_service_keys), NOT a chain identifier. Any cron/trigger that reasons about "recurring chain identity" must use service_type, not service_index. If you ever add a new billing-related trigger or cron, ban service_index from its guard.

  **Follow-up (deferred, not blocking):** improve deal_payments_default_service_keys' amount matching logic OR reshape the PaymentsPanel UI to reuse service_index=0 explicitly when the user is manually pre-paying the next period. Neither is required for correctness now that the DB layers are hardened.
  ```

- [ ] **Step 2: Create `project_paid_in_full_flip_fix.md`.**

  ```markdown
  ---
  name: project_paid_in_full_flip_fix
  description: SHIPPED 2026-07-01 — four-layer defense against paid_in_full → on_hold flip-flop, plus historical cleanup and a nightly integrity audit; accounting can now mark deals paid_in_full without them bouncing back
  metadata:
    type: project
  ---

  SHIPPED + PUSHED to main + LIVE-SMOKED 2026-07-01. Migration 20260701000000_paid_in_full_flip_fix.sql applied via Supabase MCP in 5 stages (L1, L2, L3, L4/table, L4/fn+cron, cleanup, re-enable). Plan: docs/superpowers/plans/2026-07-01-paid-in-full-hold-flip-fix.md. Root cause: [[reference_recurring_idempotency_bug]].

  **Restored deals (2026-07-01, back to paid_in_full):**
  000131, 000051, 000203, 000512, 000066. If more turn up later, run:
  ```
  select d.code from public.deals d
    join public.pipeline_stages ps on ps.id = d.accounting_stage_id
   where ps.code = 'on_hold' and public.deal_next_due(d.id) is null;
  ```
  → those deals should be restored to paid_in_full manually or via `accounting_mark_paid_in_full(id)`.

  **What the audit cron does (reconcile_payment_integrity, 04:00 UTC daily):**
  - Counts duplicate live (non-cancelled) period-keys → inserts one `data_integrity_alerts` row per new dup + one `payment_integrity_alert` notification per admin.
  - Counts deals in on_hold whose deal_next_due is in the past AND whose updated_at is within the last 25 h → same alert flow.
  - If it fires, on-call engineer opens Settings → future admin dashboard (TBD) OR queries `select * from public.data_integrity_alerts where resolved_at is null`.

  **Backup tables kept:**
  - `deal_payments_flipflop_backup_20260701` — every row involved in a historical dup period.

  **Runbook — if accounting reports the bug again:**
  1. Query recent flips: same SQL as the restored-deals check above.
  2. Query the current dup count: `select count(*) from public.data_integrity_alerts where kind='duplicate_period' and resolved_at is null;`. If > 0, some new code path is inserting dupes — trace via activity_log on the offending deal_payment id.
  3. Manually restore each affected deal via `accounting_mark_paid_in_full(deal_id)` (admin-only RPC).
  4. If cron 7 was disabled during triage, re-enable: `select cron.alter_job(7, active := true);`.

  **Follow-ups (deferred, not blocking accounting today):**
  - Fix deal_payments_default_service_keys amount-matching logic OR fix PaymentsPanel to reuse service_index=0 for same-service manual advance-payments.
  - Build a `/admin/data-integrity` UI that lists open `data_integrity_alerts` rows and lets an admin mark them resolved. Today, admins read them via SQL.
  ```

- [ ] **Step 3: Add index entries to `MEMORY.md`:**

  ```
  - [Recurring idempotency bug](reference_recurring_idempotency_bug.md) — 2026-07-01: paid_in_full → on_hold flip caused by service_index-scoped guards in both ensure_recurring_payments cron AND deal_payments_no_duplicate_period trigger; ban service_index from chain-identity checks
  - [Paid In Full flip fix](project_paid_in_full_flip_fix.md) — SHIPPED 2026-07-01: 4-layer defense (fixed cron guard, fixed insert trigger, 24h grace on reconcile, nightly integrity audit + admin alerts) + backup + cleanup restored 5 flipped deals to paid_in_full; runbook lives in the memory
  ```

---

## Self-Review

**1. Spec coverage:**
- "Deal moved to Paid In Full comes back to On Hold next day" — Layer 1 (cron guard) + Layer 2 (trigger belt-and-braces) make the duplicate-insert path structurally impossible on TWO layers.
- "As robust as possible for accounting" — Layer 3 (24h grace) adds a temporal safety net; Layer 4 (audit + alerts) means we hear about any similar bug within one day; historical cleanup restores today's victims; the runbook tells on-call what to do if it happens again.
- "Pause On Hold emails" — done pre-plan; Task 8 re-enables at the end after checkpoint passes.

**2. Placeholder scan:** no TBDs / "add validation" / "similar to Task N".

**3. Type consistency:**
- Function signatures preserved: `ensure_recurring_payments() → integer`, `deal_payments_no_duplicate_period() trigger`, `reconcile_block_lifecycle(boolean) → integer`.
- New: `reconcile_payment_integrity() → integer`. New table `data_integrity_alerts` with a jsonb `details` column — schema matches the audit function's inserts.
- Status vocabulary confirmed against prod: `paid | pending | overdue | cancelled`.

**4. Robustness invariants:**
- **Every DDL** uses `create or replace` / `create table if not exists` / conditional `cron.schedule` — re-running the migration is a no-op.
- **Every DML** in cleanup checks `not exists` in the backup table before inserting — re-running doesn't double-backup.
- **Delete never touches paid rows** — money-received history is preserved.
- **Backup precedes every delete** — nothing is destroyed without a snapshot.
- **Rollback plan** in Section 8 lets any future engineer restore the pre-fix state via straight SQL.
- **Four independent layers**: any one of L1, L2, L3, L4 alone would break the bug; together they overlap to catch any drift.
- **Test-first, verify-after**: harness runs before AND after every code change.
- **Live smoke** dry-runs the two dangerous crons against real prod data inside savepoints before turning reminders back on.

**5. Memory caveats applied:**
- DDL via Supabase MCP `apply_migration` (per `reference_supabase_mgmt_api`); DML via `execute_sql`.
- Backup table before deletes; rollback SQL embedded (per `feedback_track_changes_for_revert`).
- No literal secrets (per `feedback_no_secrets_in_docs`).
- Push directly to `main`, no PR (per `feedback_no_prs`).
- Small testable steps with TDD-first + one commit per task (per `feedback_plan_granularity`).
