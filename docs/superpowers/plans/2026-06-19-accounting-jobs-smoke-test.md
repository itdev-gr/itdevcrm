# Accounting ↔ Jobs Full Smoke-Test Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to execute this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove that every accounting status/category/option and every job board status/lane/option works, and that all *accounting → jobs* propagations (and the two real *jobs → accounting* paths) fire correctly — using disposable live test data on prod, then hard-deleting it so the in-progress re-seed is left exactly as found.

**Architecture:** Create a small set of throwaway test clients + deals (tagged with a recognizable prefix), drive each accounting stage move (via the real UI kanban where the point is "the UI works", via SQL where the point is "the data propagated"), and assert the resulting job/payment/deal state after every move. The sync is **one-way by design** (accounting drives jobs; jobs drive accounting only via price→deal-totals and billing→recurring-payments) — the plan verifies the directions that exist and explicitly records the gaps. Everything is keyed to test client IDs so cleanup is exact.

**Tech Stack:** React + TanStack Query frontend, Supabase Postgres (RLS, triggers, pg_cron, RPCs). Test driver = Supabase MCP `execute_sql` for setup/assert/cleanup + Playwright MCP for UI verification. Admin login: `info@itdev.gr` (password in the test-accounts memory, not stored here).

---

## ⚠️ Safety Contract (read before Task 1)

1. **Prod is mid-reseed:** jobs = 0, deal_payments = 0, all deals €0. Backups live in `*_backup_20260619` tables. **Do not touch** any non-test row.
2. **Every test row is tagged.** Test clients use name prefix `ZZ_SMOKE_`. Every deal/job/payment created is a child of a `ZZ_SMOKE_` client, so cleanup deletes strictly by `client_id IN (test ids)`.
3. **Baseline counts are snapshotted in Task 1 and re-asserted in Task 21.** If final counts ≠ baseline, cleanup is incomplete — stop and report.
4. **No DDL.** This plan only does DML + RPC calls + UI. No migrations, no schema changes.
5. **If any assertion fails:** record it in the results log with the actual value, the relevant source file (listed under each task), and a one-line hypothesis. Do **not** "fix" production behavior inside this smoke test — findings go in the report.

---

## Reference: the values being tested (from source)

**Accounting stages** (`pipeline_stages`, `board='accounting_onboarding'`): `new`(10), `documents_verified`(20), `invoice_issued`(30), `awaiting_payment`(40), `partial_payment`(50), `paid_in_full`(60), `on_hold`(70), `refunded`(80), `closed`(90).

**Payment status** (`deal_payments.status`): `pending`, `paid`, `overdue`.
**Billing type** (`deal_payments.billing_type` / `jobs.billing_type`): `one_time`, `recurring_monthly`, `recurring_yearly`.
**Payment method** (`deals.payment_method`): `cash`, `online`, `null`.
**VAT:** Greece `24.00`, Cyprus `0.00`, default `24.00`. `vat_amount` + `amount_gross` are generated columns.

**Job service types** (`jobs.service_type` CHECK): `web_seo`, `local_seo`, `web_dev`, `social_media`, `ai_seo`, `hosting`, `ads`, `other`.
**Job status** (`jobs.status` CHECK): `active`, `paused`, `cancelled`, `completed`.
**Job blocked reasons** seen in code: `partial_payment_pending`, `account_on_hold`, `manual`.

**Terminal lanes per board** (board / terminal codes):
- `web_dev`: `live`(110), `closed`(120)
- `web_seo`: `done`(160), `closed`
- `local_seo`: `done`(80), `closed`(110)
- `social_media`: `cancelled`(50), `closed`(60)
- `hosting`: `cancelled`(40), `closed`(50)
- `ads`: `cancelled`(50), `closed`(60)
- `ai_seo` (canonical on web_seo stages): `cancelled`(50)

**The 8 accounting → jobs mechanisms + 2 jobs → accounting paths** under test:
| # | Direction | Mechanism | Source |
|---|-----------|-----------|--------|
| 1 | acct→jobs | won deal → spawn off-board jobs + payments | `20260617000013_jobs_at_won_cutover.sql` |
| 2 | acct→jobs | `partial_payment` → place jobs on boards, block non-web_dev (`partial_payment_pending`) | `20260504000001_jobs_blocked_state.sql`, `20260610000003_release_jobs_first_stage.sql` |
| 3 | acct→jobs | `paid_in_full` → clear `partial_payment_pending` | `20260504000001_jobs_blocked_state.sql` |
| 4 | acct→jobs | `on_hold` → block `web_seo`/`local_seo`/`ai_seo` only (`account_on_hold`); leave on_hold → release | `20260618000014_onhold_holds_seo_jobs_only.sql` |
| 5 | acct→jobs | `close_deal(deal,jobs)` → jobs `completed` + moved to terminal lane | `20260618000006_deal_close_jobs.sql` |
| 6 | acct→jobs | deal stage → `clients.status` sync | `20260503000020_client_status_auto_transitions.sql` |
| 7 | acct→jobs | `block_client`/`unblock_client` → prevent job stage moves | `20260502000016_block_client_rpcs.sql` |
| 8 | acct→jobs | `create_custom_job` → job + payments | `20260617000011_job_billing_rpcs.sql` |
| 9 | jobs→acct | job price/billing change → `deals.one_time_value` / `recurring_monthly_value` | `20260617000014_sync_deal_pricing_from_jobs.sql` |
| 10 | jobs→acct | `billing_active` / `end_job` → recurring-payment generation includes/skips job | `20260617000015_recurring_payments_emit_lines.sql`, `20260617000011_job_billing_rpcs.sql` |

**Known one-way GAPS to confirm & document (not fix):** marking a job `completed`/`completed_at` does NOT move the deal's accounting stage; `is_blocked=true` by itself does NOT stop payments or prevent stage moves (only `client_blocks` prevents moves); `client_blocks` does NOT set `is_blocked`.

---

## File Structure

This plan creates **no application code**. It produces two artifacts:

- **This plan:** `docs/superpowers/plans/2026-06-19-accounting-jobs-smoke-test.md` (the script).
- **Results log:** `docs/superpowers/plans/2026-06-19-accounting-jobs-smoke-test-RESULTS.md` — the executor creates this in Task 1 and fills one row per checkbox with PASS/FAIL + actual value. This is the deliverable the user reads.

All SQL is run against the connected prod Supabase project via `execute_sql`. All UI checks use Playwright against `https://www.itdevcrm.com` (confirm exact app URL in Task 1).

---

# Phase A — Setup & Safety

### Task 1: Confirm environment, snapshot baseline, create results log

**Files:** none modified. Reference: memory note `project_jobs_payments_wiped` (backups `*_backup_20260619`).

- [ ] **Step 1: Confirm the prod project & wiped state**

Run via `execute_sql`:
```sql
select
  (select count(*) from public.jobs)                       as jobs,
  (select count(*) from public.deal_payments)              as deal_payments,
  (select count(*) from public.deal_payment_lines)         as payment_lines,
  (select count(*) from public.deals)                      as deals,
  (select count(*) from public.clients)                    as clients,
  (select count(*) from public.client_blocks where unblocked_at is null) as open_client_blocks;
```
Expected: `jobs = 0`, `deal_payments = 0`, `payment_lines = 0` (the wiped state). `deals`/`clients` are non-zero. **Record all six numbers as BASELINE** — Task 21 must restore them exactly.

- [ ] **Step 2: Confirm the backup tables exist (so we know the safety net is intact)**

```sql
select table_name from information_schema.tables
where table_schema='public' and table_name like '%\_backup\_20260619' escape '\';
```
Expected: 4 rows (the jobs/payments backup tables). If 0 rows, **stop and tell the user** — the safety net is gone.

- [ ] **Step 3: Confirm app login works (UI)**

Playwright: navigate to `https://www.itdevcrm.com`, log in as `info@itdev.gr` (use the admin password from the test-accounts memory). Expected: lands on an authenticated page (home/dashboard). Record the actual app base URL and the route to the accounting board (expected `/accounting/onboarding`) and a jobs board (expected `/tech/web-dev`).

- [ ] **Step 4: Create the results log**

Create `docs/superpowers/plans/2026-06-19-accounting-jobs-smoke-test-RESULTS.md` with a header (date, executor, baseline counts from Step 1) and a `## Findings` section. Append one line per checkbox as you go: `Task N Step M — PASS/FAIL — <actual value or note>`.

- [ ] **Step 5: Commit the empty results log**
```bash
git add docs/superpowers/plans/2026-06-19-accounting-jobs-smoke-test.md docs/superpowers/plans/2026-06-19-accounting-jobs-smoke-test-RESULTS.md
git commit -m "test(accounting-jobs): add smoke-test plan + results log scaffold"
```

---

### Task 2: Create tagged test clients + learn the deal/services_planned shape

**Files:** Reference `20260502000008_deals_jobs.sql` (deals/jobs schema), `20260617000013_jobs_at_won_cutover.sql` (won→spawn).

- [ ] **Step 1: Learn the exact `services_planned` JSON shape from a real deal** (do NOT fabricate keys)

```sql
select id, code, services_planned, one_time_value, recurring_monthly_value, currency
from public.deals
where services_planned is not null and jsonb_array_length(services_planned) > 0
limit 3;
```
**Record the exact key names** in each service object (e.g. `service_type`, `billing_type`, `amount_net`, `setup_fee`, `vat_rate`, …). Every `services_planned` you build below MUST mirror these keys exactly. Also record the `deals` columns you'll need to populate (run `select column_name, is_nullable, column_default from information_schema.columns where table_schema='public' and table_name='deals' order by ordinal_position;`).

- [ ] **Step 2: Learn how an existing deal is wired to a client + sales stage**
```sql
select d.id, d.code, d.client_id, d.accounting_stage_id, d.stage_id,
       ps_acct.code as acct_code, ps_sales.code as sales_code
from public.deals d
left join public.pipeline_stages ps_acct on ps_acct.id = d.accounting_stage_id
left join public.pipeline_stages ps_sales on ps_sales.id = d.stage_id
limit 5;
```
Record which column holds the accounting stage (`accounting_stage_id`) and the sales stage (`stage_id`), and an example "won" sales stage id/code.

- [ ] **Step 3: Create two tagged test clients (Greece + Cyprus, for the VAT test)**

Mirror the `clients` insert columns to whatever is NOT NULL (run a quick `information_schema.columns` check first if unsure). Minimal version:
```sql
insert into public.clients (name, country, status)
values ('ZZ_SMOKE_GR Ltd', 'Greece', 'new'),
       ('ZZ_SMOKE_CY Ltd', 'Cyprus', 'new')
returning id, name, country;
```
**Record both client IDs.** Call them `:gr_client` and `:cy_client` in later tasks.

- [ ] **Step 4: Verify the tag is queryable**
```sql
select id, name, country, status from public.clients where name like 'ZZ_SMOKE_%';
```
Expected: 2 rows. This is the master key for cleanup.

- [ ] **Step 5: Commit (results log only)**
```bash
git add docs/superpowers/plans/2026-06-19-accounting-jobs-smoke-test-RESULTS.md
git commit -m "test(accounting-jobs): record schema shapes + test client ids"
```

---

# Phase B — Static inventory: every stage/lane/option renders

### Task 3: Accounting board renders all 9 stages + options present

**Files:** `src/features/accounting/AccountingOnboardingKanbanPage.tsx`, `src/features/accounting/CloseDealDialog.tsx`, `20260502000002_pipeline_stages.sql`, `20260617000002_accounting_closed_stage.sql`.

- [ ] **Step 1: Assert all 9 accounting stages exist in DB**
```sql
select code, name_en, position, is_terminal
from public.pipeline_stages
where board='accounting_onboarding'
order by position;
```
Expected exactly these 9 codes in order: `new, documents_verified, invoice_issued, awaiting_payment, partial_payment, paid_in_full, on_hold, refunded, closed`. Record any missing/extra.

- [ ] **Step 2: Assert the board UI renders all 9 columns (UI)**

Playwright: open `/accounting/onboarding`. Expected: 9 columns visible with the localized labels (New, Documents Verified, Invoice Issued, Awaiting Payment, Partial Payment, Paid In Full, On Hold, Refunded, Closed). Screenshot. Record any column missing from the UI even though present in DB.

- [ ] **Step 3: Assert accounting sub-pages load (UI)**

Navigate each and confirm it renders without error: `/accounting/clients`, `/accounting/recurring`, `/accounting/report` (admin), `/accounting/expenses` (admin), `/accounting/docs`. Record HTTP/console errors if any.

---

### Task 4: All 7 job boards render their lanes

**Files:** `src/features/jobs/JobsKanbanPage.tsx`, `src/features/jobs/kanbanGrouping.ts`, board stage migrations (`20260615000001`, `20260615000002`, `20260610000002`, `20260502000023`, `20260511000001`, `20260618000010/11`).

- [ ] **Step 1: Assert lane sets per board in DB**
```sql
select board, string_agg(code, ' → ' order by position) as lanes
from public.pipeline_stages
where board in ('web_dev','web_seo','local_seo','social_media','hosting','ads')
group by board order by board;
```
Expected (spot-check the terminals): `web_dev` ends `… live, closed`; `web_seo` ends `… done, closed`; `local_seo` ends `… done, suspended, verification, closed`; `social_media` ends `… cancelled, closed`; `hosting` ends `… cancelled, closed`; `ads` ends `… cancelled, closed`. Record full lane lists.

- [ ] **Step 2: Render each board (UI)**

Playwright: visit `/tech/web-dev`, `/tech/web-seo`, `/tech/local-seo`, `/tech/social-media`, `/tech/hosting`, `/tech/ads`. For each: confirm columns render and match the DB lane list. For `web_seo` and `local_seo` confirm a trailing **Blocked** (`__blocked__`) virtual column exists. Screenshot each. (Boards will be empty of cards — that's fine; we're verifying columns.)

- [ ] **Step 3: Confirm AI SEO dual-rendering**

On `/tech/web-seo` and `/tech/local-seo`, confirm the board accepts `ai_seo` jobs (no dedicated route). Record that AI SEO has no own board (expected, per `kanbanGrouping.ts`).

---

# Phase C — Accounting → Jobs forward sync (the core)

> Test deal **D1** uses a 5-service mix to exercise every rule at once: `web_dev` (one_time), `web_seo` (recurring_monthly), `local_seo` (recurring_monthly), `hosting` (one_time), `social_media` (recurring_monthly).

### Task 5: Create won test deal D1 → off-board jobs + payments spawn

**Files:** `20260617000013_jobs_at_won_cutover.sql`, `20260617000015_recurring_payments_emit_lines.sql`.

- [ ] **Step 1: Insert deal D1 for `:gr_client`** — mirror the column + `services_planned` shape learned in Task 2 Step 1. Set `stage_id` = a "won" sales stage, `accounting_stage_id` = the `new` accounting stage, `currency='EUR'`. `services_planned` array = the 5 services above, each using the exact keys discovered.

```sql
-- Template — replace key names/values with the EXACT shape from Task 2 Step 1.
insert into public.deals (client_id, code, currency, stage_id, accounting_stage_id, services_planned, one_time_value, recurring_monthly_value)
values (
  '<:gr_client>',
  'ZZSMOKE1',
  'EUR',
  (select id from public.pipeline_stages where board='sales' and code='<won_code_from_task2>'),
  (select id from public.pipeline_stages where board='accounting_onboarding' and code='new'),
  '<services_planned json mirroring real shape: web_dev one_time 1000, web_seo recurring_monthly 200, local_seo recurring_monthly 150, hosting one_time 120, social_media recurring_monthly 180>'::jsonb,
  0, 0
)
returning id, code;
```
**Record deal id as `:d1`.** (If the app requires deal creation through a "won" transition trigger rather than a direct insert, instead create the deal at an earlier sales stage and `update … set stage_id = won` so the won-trigger fires — record which path was needed.)

- [ ] **Step 2: Assert jobs spawned (off-board) for every service**
```sql
select service_type, billing_type, amount_net, stage_id, status, is_blocked, code
from public.jobs where deal_id = '<:d1>' order by service_type;
```
Expected: 5 jobs, one per service. Record whether `stage_id` is NULL (off-board, per the won-cutover model) or already set. Status `active`. Record `is_blocked` for each (expected all `false` at this point — nothing placed/blocked yet).

- [ ] **Step 3: Assert payments + lines seeded**
```sql
select p.service_type, p.billing_type, p.amount_net, p.vat_rate, p.vat_amount, p.amount_gross, p.status,
       (select count(*) from public.deal_payment_lines l where l.payment_id = p.id) as lines
from public.deal_payments p where p.deal_id = '<:d1>' order by p.service_type;
```
Expected: a payment row per service; `vat_rate=24.00` (GR client); `vat_amount` and `amount_gross` computed (e.g. net 200 → vat 48 → gross 248); `status='pending'`; each header has ≥1 line linked to the matching job. Record actuals.

- [ ] **Step 4: Assert job codes generated**

Expected each `jobs.code` matches `^ZZSMOKE1-[A-Z]+` (e.g. `ZZSMOKE1-WEBDEV`, `ZZSMOKE1-WEBSEO`). Record the actual suffix used for each service_type.

- [ ] **Step 5: Assert local_seo owner force-assign**

Expected the `local_seo` job's `owner_user_id` = `b73d8761-cbae-4ac8-a239-878d1f2151d8` (dtzouvaras). Record actual. Source: `20260619000001_local_seo_owner_dtzouvaras.sql`.

---

### Task 6: D1 → `partial_payment` → jobs placed on boards, non-web_dev blocked

**Files:** `20260504000001_jobs_blocked_state.sql`, `20260610000003_release_jobs_first_stage.sql`.

- [ ] **Step 1: Move D1 to `partial_payment`** (drive via the accounting kanban UI to smoke-test the UI; SQL fallback below)

UI: on `/accounting/onboarding`, drag D1's card from its current column into **Partial Payment**. (SQL fallback if D1 isn't visible/owned:
```sql
update public.deals set accounting_stage_id =
  (select id from public.pipeline_stages where board='accounting_onboarding' and code='partial_payment')
where id = '<:d1>';
```)

- [ ] **Step 2: Assert jobs now placed on their boards**
```sql
select j.service_type, j.is_blocked, j.blocked_reason, ps.code as stage_code, ps.board
from public.jobs j left join public.pipeline_stages ps on ps.id = j.stage_id
where j.deal_id = '<:d1>' order by j.service_type;
```
Expected: every job now has a non-null `stage_id` on the first lane of its board (`web_dev→new_project`, `web_seo→new_project`, `local_seo→new_project`, `hosting→setup`, `social_media→onboarding`). Record actuals.

- [ ] **Step 3: Assert blocking rule — only non-`web_dev` blocked**

Expected: `web_dev` job `is_blocked=false`; `web_seo`, `local_seo`, `hosting`, `social_media` jobs `is_blocked=true` with `blocked_reason='partial_payment_pending'`. Record each. **This is the key partial-payment rule.**

- [ ] **Step 4: Assert blocked jobs appear in the Blocked column (UI)**

Playwright: open `/tech/web-seo` and `/tech/local-seo` — the D1 web_seo/local_seo jobs should sit in the trailing **Blocked** virtual column. Open `/tech/web-dev` — the D1 web_dev job should be in `new_project` (NOT blocked). Screenshot.

---

### Task 7: D1 → `paid_in_full` → `partial_payment_pending` blocks cleared

**Files:** `20260504000001_jobs_blocked_state.sql`, `20260502000013_complete_accounting_rpc.sql`.

- [ ] **Step 1: Move D1 to `paid_in_full`** (UI drag, or SQL update to the `paid_in_full` stage as in Task 6 fallback).

- [ ] **Step 2: Assert all `partial_payment_pending` blocks cleared**
```sql
select service_type, is_blocked, blocked_reason from public.jobs
where deal_id = '<:d1>' order by service_type;
```
Expected: every job `is_blocked=false`, `blocked_reason=null`. Record actuals. (If any job retained a different block reason, that's correct — only `partial_payment_pending` should clear.)

- [ ] **Step 3: Assert jobs still on their boards, status active**

Expected: jobs unchanged on lanes, `status='active'`. Record.

---

### Task 8: D1 → `on_hold` → SEO-only block; leave on_hold → release

**Files:** `20260618000014_onhold_holds_seo_jobs_only.sql`.

- [ ] **Step 1: Move D1 to `on_hold`** (UI drag or SQL update to `on_hold` stage).

- [ ] **Step 2: Assert ONLY web_seo/local_seo/ai_seo blocked**
```sql
select service_type, is_blocked, blocked_reason from public.jobs
where deal_id = '<:d1>' order by service_type;
```
Expected: `web_seo` + `local_seo` → `is_blocked=true`, `blocked_reason='account_on_hold'`. `web_dev`, `hosting`, `social_media` → `is_blocked=false`. Record each. **This is the narrowed on-hold rule.**

- [ ] **Step 3: Move D1 OFF on_hold (back to `paid_in_full`)** and assert release
```sql
select service_type, is_blocked, blocked_reason from public.jobs
where deal_id = '<:d1>' order by service_type;
```
Expected: the two SEO jobs `is_blocked=false`, `blocked_reason=null` (released because reason was `account_on_hold`). Record actuals.

---

### Task 9: D1 → `closed` via `close_deal` → jobs completed + moved to terminal lanes

**Files:** `20260618000006_deal_close_jobs.sql`, `src/features/accounting/CloseDealDialog.tsx`, `src/features/accounting/closeTargets.ts`.

- [ ] **Step 1: Resolve terminal target stage ids for D1's jobs**
```sql
select j.id as job_id, j.service_type, ps.board,
       (select id from public.pipeline_stages t
         where t.board = ps.board and t.is_terminal and t.code = 'closed' limit 1) as closed_stage_id,
       (select id from public.pipeline_stages t
         where t.board = ps.board and t.is_terminal and t.code = 'live' limit 1) as live_stage_id
from public.jobs j join public.pipeline_stages ps on ps.id = j.stage_id
where j.deal_id = '<:d1>' order by j.service_type;
```
Build the `p_jobs` jsonb: web_dev → `live_stage_id` (test the web_dev "Live" choice), the other four → their `closed_stage_id`.

- [ ] **Step 2: Call `close_deal`**
```sql
select public.close_deal(
  '<:d1>'::uuid,
  '[{"job_id":"<web_dev_id>","target_stage_id":"<web_dev_live_id>"},
    {"job_id":"<web_seo_id>","target_stage_id":"<web_seo_closed_id>"},
    {"job_id":"<local_seo_id>","target_stage_id":"<local_seo_closed_id>"},
    {"job_id":"<hosting_id>","target_stage_id":"<hosting_closed_id>"},
    {"job_id":"<social_media_id>","target_stage_id":"<social_closed_id>"}]'::jsonb
);
```
Expected return: `{"ok": true, "deal_id": "<:d1>", "closed_jobs": 5}`. Record.

- [ ] **Step 3: Assert jobs completed + on terminal lanes**
```sql
select j.service_type, j.status, j.completed_at is not null as done_stamped, ps.code as stage_code
from public.jobs j join public.pipeline_stages ps on ps.id = j.stage_id
where j.deal_id = '<:d1>' order by j.service_type;
```
Expected: all `status='completed'`, `done_stamped=true`; web_dev on `live`, others on `closed`. Record actuals.

- [ ] **Step 4: Assert deal moved to accounting `closed`**
```sql
select ps.code from public.deals d join public.pipeline_stages ps on ps.id = d.accounting_stage_id
where d.id = '<:d1>';
```
Expected: `closed`. Record.

- [ ] **Step 5: Negative check — same-board / terminal guard**

Confirm `close_deal` refused to move a job to another board (it didn't, since Step 3 passed). Note in the log that cross-board/non-terminal targets are rejected by the RPC (`tgt.board = cur.board and tgt.is_terminal`).

---

### Task 10: Deal stage → `clients.status` sync

**Files:** `20260503000020_client_status_auto_transitions.sql`.

- [ ] **Step 1: Re-read client status after D1's journey**
```sql
select c.name, c.status from public.clients c where c.id = '<:gr_client>';
```
Note: D1 ended at `closed`. The trigger maps `partial_payment`/`paid_in_full`→`active`, `on_hold`→`blocked`, `done`→`done`. `closed` is not in the map, so status is whatever the last *mapped* transition set (expected `active` from paid_in_full). Record the actual `clients.status` and whether it matches the documented mapping.

- [ ] **Step 2: Spot-test the on_hold→blocked mapping** using a fresh throwaway deal D2 for `:gr_client`:
   - Insert minimal D2 (one `web_seo` service), move it to `on_hold`. Assert `clients.status='blocked'`.
   - Move D2 to `paid_in_full`. Assert `clients.status='active'`.
   - Record both. Keep D2 for Task 13 (gap check), then it's cleaned up in Task 21.

---

# Phase D — Jobs → Accounting (the two real paths + the gaps)

### Task 11: Job price change → deal totals sync

**Files:** `20260617000014_sync_deal_pricing_from_jobs.sql`, `20260617000011_job_billing_rpcs.sql` (`update_job_billing`).

- [ ] **Step 1: Snapshot D2's deal totals + its web_seo job**
```sql
select d.one_time_value, d.recurring_monthly_value from public.deals d where d.id = '<:d2>';
select id, amount_net, billing_type from public.jobs where deal_id='<:d2>';
```
Record current `recurring_monthly_value` (should equal the job's recurring net).

- [ ] **Step 2: Change the job price via RPC**
```sql
select public.update_job_billing('<d2_web_seo_job_id>'::uuid, null, null, 333.00, null, null, null, false);
```

- [ ] **Step 3: Assert deal totals re-synced**
```sql
select one_time_value, recurring_monthly_value from public.deals where id='<:d2>';
```
Expected: `recurring_monthly_value = 333.00` (sum of active recurring_monthly job nets). Record. **This is jobs→accounting path #9.**

- [ ] **Step 4: Add a one_time custom job, assert one_time_value sync** — covered together with Task 17 (`create_custom_job`); cross-reference there.

---

### Task 12: Recurring payment generation includes active jobs, `end_job` stops it

**Files:** `20260617000015_recurring_payments_emit_lines.sql`, `20260617000011_job_billing_rpcs.sql` (`end_job`), `src/features/accounting/hooks/useAccountingKanbanRealtime.ts`.

- [ ] **Step 1: Create a near-due recurring payment on D2** so the renewal engine will act:
```sql
update public.deal_payments
set end_date = current_date  -- within the 7-day renewal window
where deal_id = '<:d2>' and billing_type = 'recurring_monthly';
```
Record how many rows updated, and confirm no successor exists yet:
```sql
select count(*) from public.deal_payments where deal_id='<:d2>';
```

- [ ] **Step 2: Run the renewal engine**
```sql
select public.ensure_recurring_payments();
```
Record the integer returned (number of periods created, expected ≥1).

- [ ] **Step 3: Assert a successor period was created with a line linked to the job**
```sql
select p.start_date, p.end_date, p.amount_net,
       (select count(*) from public.deal_payment_lines l where l.payment_id=p.id and l.job_id is not null) as job_linked_lines
from public.deal_payments p where p.deal_id='<:d2>' order by p.start_date;
```
Expected: a new row with `start_date >= old end_date`, `end_date` one month later, and a line whose `job_id` points at the D2 web_seo job. Record actuals. **This is jobs→accounting path #10.**

- [ ] **Step 4: Stop billing via `end_job`, assert no further renewal**
```sql
select public.end_job('<d2_web_seo_job_id>'::uuid);
select billing_active, status, completed_at is not null as done from public.jobs where id='<d2_web_seo_job_id>';
```
Expected: `billing_active=false`, `status='completed'`, `done=true`. Then push the newest payment's `end_date = current_date` and re-run `ensure_recurring_payments()`; assert **no new period** is created for this now-ended job (record count before/after). Note: v1 reads `deal_payments`, so document whether v1 actually honors `billing_active` here vs only v2 — record which engine skipped it.

---

### Task 13: GAP confirmation — job completion does NOT move the deal (document, don't fix)

**Files:** none (confirming absence). Cross-ref: memory `reference_recurring_payments`, sync map gaps.

- [ ] **Step 1: On D2, mark a still-active job completed directly (no `close_deal`)**

D2 currently sits at `paid_in_full`. Pick any non-ended D2 job (create a fresh `web_dev` custom job on D2 if needed) and:
```sql
update public.jobs set status='completed', completed_at=now() where id='<job_id>';
select ps.code from public.deals d join public.pipeline_stages ps on ps.id=d.accounting_stage_id where d.id='<:d2>';
```
Expected: deal stage **unchanged** (`paid_in_full`) — completing a job does NOT advance accounting. Record. **Document as a by-design gap**, not a bug.

- [ ] **Step 2: Confirm `is_blocked` alone blocks nothing**

Set a D2 job `is_blocked=true, blocked_reason='manual'` via `block_job`, then attempt a stage move on it (UI drag or `update jobs set stage_id=...`). Expected: the move **succeeds** (is_blocked does not gate moves); the job simply shows in the Blocked column on web_seo/local_seo boards. Record. Source: `useMoveJobStage.ts`, `kanbanGrouping.ts`.

- [ ] **Step 3: Confirm `client_blocks` DOES gate moves**

`select public.block_client('<:gr_client>'::uuid, 'ZZ_SMOKE manual block');` then attempt a non-admin job stage move. As admin the move is allowed; the guard (`enforce_no_stage_move_when_blocked`) only blocks non-admins — record that admin bypass is expected. Then `select public.unblock_client('<:gr_client>'::uuid);`. Record both.

---

# Phase E — Categories / options matrix

### Task 14: Payment status transitions (pending → overdue → paid) + overdue→on_hold

**Files:** `20260610000004_money_seeding_and_overdue.sql` (`mark_overdue_payments`), `20260503000019_auto_kanban_payment_status.sql` (`move_overdue_deals_to_on_hold`).

- [ ] **Step 1: Create deal D3 for `:gr_client`** with one `web_seo` recurring service, at accounting stage `awaiting_payment`. Set its payment `status='pending'`, `end_date = current_date - 5`.

- [ ] **Step 2: Run `mark_overdue_payments()`**, assert status flips
```sql
select public.mark_overdue_payments();
select status from public.deal_payments where deal_id='<:d3>';
```
Expected: `overdue`. Record.

- [ ] **Step 3: Run `move_overdue_deals_to_on_hold()`**, assert deal moved
```sql
select public.move_overdue_deals_to_on_hold();
select ps.code from public.deals d join public.pipeline_stages ps on ps.id=d.accounting_stage_id where d.id='<:d3>';
```
Expected: `on_hold`. Record. (And per Task 8 rule, D3's web_seo job should now be `account_on_hold` blocked — assert it.)

- [ ] **Step 4: Mark the payment paid (UI or SQL), assert `paid` + `paid_at`**
```sql
update public.deal_payments set status='paid', paid_at=now() where deal_id='<:d3>';
select status, paid_at is not null as stamped from public.deal_payments where deal_id='<:d3>';
```
Expected: `paid`, `stamped=true`. Record. (If the UI has a "mark paid" button, use it instead and confirm the same DB result.)

---

### Task 15: Billing types + VAT (GR 24% vs CY 0%) generated columns

**Files:** `20260601000005_deal_payments_vat.sql`, `20260503000010_deal_payments.sql`.

- [ ] **Step 1: Create deal D4 for `:cy_client`** (Cyprus) with one `web_seo` recurring_monthly service, `amount_net=200`.

- [ ] **Step 2: Assert Cyprus VAT = 0**
```sql
select amount_net, vat_rate, vat_amount, amount_gross from public.deal_payments where deal_id='<:d4>';
```
Expected: `vat_rate=0.00`, `vat_amount=0.00`, `amount_gross=200.00`. Record.

- [ ] **Step 3: Compare to GR deal D1 payments** (already vat_rate 24, gross = net×1.24). Record the contrast (GR net 200 → gross 248; CY net 200 → gross 200).

- [ ] **Step 4: Assert all three billing types are representable** — D1 has `one_time` (web_dev/hosting) and `recurring_monthly` (others). Create one `recurring_yearly` payment line on D4 and confirm `end_date = start_date + 1 year` semantics via a manual insert mirroring the seed (or via a yearly custom job). Record that all three `billing_type` values round-trip.

---

### Task 16: Payment method gate (cash/online)

**Files:** `20260503000008_payment_method.sql`, accounting board move rules.

- [ ] **Step 1: On a deal at `awaiting_payment` with `payment_method=null`**, attempt to advance it to `partial_payment`/`paid_in_full` via the UI. Expected: the UI requires a payment method first (or the move is blocked). Record the exact behavior (blocked + prompt, or allowed). Set `deals.payment_method='cash'` then `'online'` and confirm both are accepted values:
```sql
update public.deals set payment_method='cash' where id='<:d3>';
update public.deals set payment_method='online' where id='<:d3>';
select payment_method from public.deals where id='<:d3>';
```
Record any CHECK-constraint rejection of other values.

---

### Task 17: Custom job + billing-only job via `create_custom_job` → payments + totals

**Files:** `20260617000011_job_billing_rpcs.sql` (`create_custom_job`, `generate_payments_for_deal`).

- [ ] **Step 1: Create a board custom job on D2** (a `web_dev` one_time, €500)
```sql
select public.create_custom_job('<:d2>'::uuid, 'ZZ_SMOKE custom dev', 'test', 'web_dev', 'one_time', 500, 24, 0, false);
```
Expected return `{ok:true, job_id:...}`. Assert: job exists with `is_custom=true`, `service_type='web_dev'`, `stage_id` = first web_dev lane, a unique `code`, and a generated payment. Record.

- [ ] **Step 2: Create a billing-only job on D2** (no board, €99 one_time)
```sql
select public.create_custom_job('<:d2>'::uuid, 'ZZ_SMOKE billing only', 'test', 'web_dev', 'one_time', 99, 24, 0, true);
```
Expected: job with `service_type='other'`, `billing_only=true`, `stage_id=null` (never on a board), payment generated. Record.

- [ ] **Step 3: Assert deal one_time_value re-synced** (closes Task 11 Step 4)
```sql
select one_time_value from public.deals where id='<:d2>';
```
Expected: increased by 500 + 99 (active one_time job nets + setup fees). Record.

---

### Task 18: Expense categories (15) + expense status

**Files:** `20260601000001_expense_categories.sql`, `20260601000002_expenses.sql`, `/accounting/expenses` page.

- [ ] **Step 1: Assert all 15 expense categories exist**
```sql
select code from public.expense_categories order by code;
```
Expected 15 codes: `accountant_fees, ads_spend, bank_fees, equipment, freelancers, hosting_domains, marketing, other, rent, salaries, software, taxes_vat, training, travel, utilities`. Record any missing.

- [ ] **Step 2: Expenses page renders all categories in the dropdown (UI)**

Open `/accounting/expenses`, open the "new expense" form, confirm the category dropdown lists all 15 and billing-type + status (`pending`/`paid`) options render. Screenshot. (Do not save an expense — read-only on this page to avoid extra cleanup. If you must, create one tagged `ZZ_SMOKE expense` and delete it in Task 21.)

---

### Task 19: Per-service Info tab fields (details JSONB)

**Files:** `src/features/jobs/serviceInfoFields.ts`, `src/features/jobs/JobDetailPage.tsx`, memory `project_job_info_tab`.

- [ ] **Step 1: Web SEO job Info tab fields (UI)**

Open D1's web_seo job detail (`/jobs/<id>`), Info tab. Expected fields: `website_username`, `website_password`, `web_report_url`, `seo_notes`. Enter test values, save, then assert persisted:
```sql
select details from public.jobs where id='<d1_web_seo_job_id>';
```
Expected: keys present with the values entered. Record.

- [ ] **Step 2: Local SEO + Web Dev + AI SEO field sets**

Spot-check: local_seo Info tab has `profile_url`, `local_report_url`, `local_notes`; web_dev has `webdev_notes, hosting, supabase_name, temp_url, live_url, email`; a (throwaway) ai_seo job shows BOTH local + web sections. Confirm `social_media`/`hosting`/`ads` show **no** Info tab. Record per service.

- [ ] **Step 3: Deal overview shows notes/reports but NOT credentials**

Open D1's deal overview. Expected: the shared `*_report_url` and `*_notes` surface; `website_password`/creds do NOT. Record (per memory `project_job_info_tab`).

---

### Task 20: Job codes — format, uniqueness, global search

**Files:** `20260618130000` (code trigger + unique index), `global_search` jobs branch, memory `project_job_codes`.

- [ ] **Step 1: Assert format + uniqueness across all test jobs**
```sql
select code, count(*) from public.jobs where deal_id in ('<:d1>','<:d2>','<:d3>','<:d4>')
group by code having count(*) > 1;
```
Expected: 0 rows (all codes unique). And every code matches `^<deal_code>-[A-Z]+(-\d+)?$`. Record.

- [ ] **Step 2: Global search finds a job by code (UI)**

Use the app's global search for one D1 job code (e.g. `ZZSMOKE1-WEBSEO`). Expected: the job appears in results and links to its detail page. Record.

---

# Phase F — Cleanup (restore the wiped baseline exactly)

### Task 21: Hard-delete all test data, verify baseline restored

**Files:** `20260618000030_delete_jobs_rpc.sql` (`delete_jobs`), FK cascade behavior.

- [ ] **Step 1: Collect every test id**
```sql
with c as (select id from public.clients where name like 'ZZ_SMOKE_%')
select
  (select array_agg(id) from c) as client_ids,
  (select array_agg(id) from public.deals where client_id in (select id from c)) as deal_ids,
  (select array_agg(id) from public.jobs where client_id in (select id from c)) as job_ids;
```
Record all arrays. Sanity-check the deal/job counts equal what you created (D1–D4 + custom jobs).

- [ ] **Step 2: Delete jobs via the RPC** (clears comments/attachments, nulls payment lines' job_id)
```sql
select public.delete_jobs((select array_agg(id) from public.jobs where client_id in
  (select id from public.clients where name like 'ZZ_SMOKE_%')));
```
Record returned `deleted_count`.

- [ ] **Step 3: Delete payments, lines, blocks, deals, clients** (children first)
```sql
delete from public.deal_payment_lines l using public.deal_payments p
  where l.payment_id = p.id and p.deal_id in
  (select id from public.deals where client_id in (select id from public.clients where name like 'ZZ_SMOKE_%'));
delete from public.deal_payments where deal_id in
  (select id from public.deals where client_id in (select id from public.clients where name like 'ZZ_SMOKE_%'));
delete from public.client_blocks where client_id in (select id from public.clients where name like 'ZZ_SMOKE_%');
delete from public.deals where client_id in (select id from public.clients where name like 'ZZ_SMOKE_%');
-- delete any tagged expenses if created in Task 18
delete from public.expenses where description like 'ZZ_SMOKE%' or notes like 'ZZ_SMOKE%';
delete from public.clients where name like 'ZZ_SMOKE_%';
```
Run each; record rows affected. (If a FK error fires, record the blocking table — it reveals an un-cascaded relationship — then delete those child rows and retry.)

- [ ] **Step 4: Re-assert BASELINE counts (must match Task 1 Step 1 exactly)**
```sql
select
  (select count(*) from public.jobs)               as jobs,
  (select count(*) from public.deal_payments)      as deal_payments,
  (select count(*) from public.deal_payment_lines) as payment_lines,
  (select count(*) from public.deals)              as deals,
  (select count(*) from public.clients)            as clients,
  (select count(*) from public.client_blocks where unblocked_at is null) as open_client_blocks;
```
Expected: identical to BASELINE (jobs/payments/lines back to their wiped values; deals/clients back to original). **If anything differs, the cleanup is incomplete — stop and report exactly which table is off.**

- [ ] **Step 5: Confirm no `ZZ_SMOKE` residue anywhere**
```sql
select 'clients' t, count(*) c from public.clients where name like 'ZZ_SMOKE%'
union all select 'deals', count(*) from public.deals where code like 'ZZSMOKE%'
union all select 'jobs', count(*) from public.jobs where code like 'ZZSMOKE%';
```
Expected: all `0`. Record.

- [ ] **Step 6: Finalize the results log + commit**

Write a `## Summary` at the top of the results log: total checks, PASS count, FAIL count, the confirmed one-way GAPS (Task 13), and any surprises. Then:
```bash
git add docs/superpowers/plans/2026-06-19-accounting-jobs-smoke-test-RESULTS.md
git commit -m "test(accounting-jobs): full smoke-test results + cleanup verified"
```

---

## Self-Review (spec coverage)

- **"all the status … in accounting"** → Tasks 3, 14 (9 stages render + transitions), 10 (client.status).
- **"all the categories/options in accounting"** → Tasks 15 (billing types, VAT), 16 (payment method), 18 (15 expense categories + status), 14 (payment statuses).
- **"all the status/categories/options in the jobs"** → Tasks 4 (7 boards × lanes), 5 (service types, codes, status), 17 (custom/billing-only/`other`), 19 (Info-tab fields per service), 20 (codes).
- **"movements from accounting update the jobs"** → Tasks 5 (won→spawn), 6 (partial→block), 7 (paid→unblock), 8 (on_hold→SEO block/release), 9 (close→terminal lanes), 10 (client.status), 13 Step 3 (client_blocks→move gate).
- **"and the opposite"** → Tasks 11 (price→deal totals), 12 (billing→recurring generation), 13 (explicitly documents the gaps where jobs do NOT drive accounting).
- **"flawless operation"** → every task asserts exact expected values and records actuals; failures are logged with source file references.

**Placeholder note:** the only intentionally parameterized items are the discovered `services_planned` JSON shape (Task 2 Step 1) and captured IDs — these are *discovery* steps with exact queries, not TODOs. Do not invent JSON keys; mirror what the query returns.
