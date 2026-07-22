# Franchise Service Line Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `franchise` as a full service type — 3 fixed one-time offer packages, sales services picker, accounting job release with installment support, dedicated kanban board.

**Architecture:** Mirror of the maintenance-service blueprint (migration `20260717130000_maintenance_service.sql`): widen CHECKs, seed stages+packages, patch the LIVE bodies of the release/billing RPC allow-lists, then sweep the ~20 frontend enumeration sites. Spec: `docs/superpowers/specs/2026-07-22-franchise-service-design.md` (authoritative for every value: package names/prices/descriptions, stage list, decisions).

**Tech Stack:** Supabase Postgres (plpgsql, RPCs patched from `pg_get_functiondef` live bodies), React/TS, i18next en+el, vitest.

## Global Constraints

- Prod project CRM `xujlrclyzxrvxszepquy`; migrations applied to prod during implementation via MCP `apply_migration`.
- ALWAYS patch RPCs from their LIVE `pg_get_functiondef` bodies (prod drifts from files); save pre-images to `.superpowers/sdd/pre-franchise-svc-<fn>.sql` before editing; `create or replace` only, never drop.
- All harness test SQL inside `begin; … rollback;` — zero surviving rows; claims-before-role harness recipe; MCP returns last statement only (aggregate assertions).
- `npm run build` (tsc -b + eslint --max-warnings=0) must pass; vitest file-scoped ONLY (prod-hitting integration tests exist).
- No PRs — one commit per task, push to `main` (pull --rebase on rejection). Vercel auto-deploys.
- Commits end with the `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` trailer.
- NO email automation may be added or triggered for franchise anywhere.
- Group/permissions/team-lead already exist (migration `20260722100000_franchise_group.sql`) — do not re-create.

---

### Task 1: DB migration — franchise service type end-to-end

**Files:**
- Create: `supabase/migrations/20260722120000_franchise_service.sql`
- Create (scratch, not committed): `.superpowers/sdd/pre-franchise-svc-*.sql` pre-images

**Interfaces:**
- Consumes: existing `groups.code='franchise'` + team lead; `job_service_abbr` fallback (`-FRANCHISE` codes need no change); maintenance blueprint at `supabase/migrations/20260717130000_maintenance_service.sql` (constraint-widening shape :550-557, stage-seeding shape :574-586).
- Produces: service_type `'franchise'` valid in `jobs`/`service_packages`/`service_monthly_task_templates`; 8 `pipeline_stages` rows board='franchise' (codes/names per spec: neo/Νέο first, closed terminal+completed last); 3 `service_packages` rows (`franchise_branch` 50000 / `franchise_powered` 20000 / `franchise_wholesale` 5000 — names+Greek descriptions verbatim from spec); live RPCs accepting franchise: `release_jobs_for_deal`, `release_billing_jobs_for_deal` (allow-lists), `reconcile_offboard_jobs` (allow-list), `accounting_integrity_alerts` (off_board_job list), `create_custom_job` + `generate_payments_for_deal` + (if gated) `update_job_billing` (installment eligibility `'web_dev'` → `in ('web_dev','franchise')` in every plan gate/branch/grouped-block exclusion). `release_deal_jobs` deliberately UNCHANGED.

- [ ] **Step 1: Inspect + snapshot.** Read live `pipeline_stages` rows for board `'maintenance'` (column shape to mirror) and the live defs of every RPC above; Write each def to its pre-image file. Confirm via the maintenance rows which columns exist (code/name/position/is_terminal/terminal_outcome/archived).
- [ ] **Step 2: RED harness.** Rollback-wrapped: insert a franchise-source lead's client+deal with `services_planned=[{"service_type":"franchise","billing_type":"one_time","one_time_amount":50000,"monthly_amount":0,"setup_fee":0}]` → expect FAILURE or zero jobs (constraint rejects / allow-list skips). Record actual output.
- [ ] **Step 3: Write the migration** per the spec's DB section: 3 constraint widenings (drop+re-add, maintenance shape), 8 stage rows, 3 package rows (idempotent inserts), then each patched RPC body (from pre-images, minimal edits only). Header comment: spec path + full ROLLBACK section.
- [ ] **Step 4: Apply** via MCP `apply_migration` (name `franchise_service`). Expected: success.
- [ ] **Step 5: GREEN harness** (rollback-wrapped, one request, aggregated final assertions): same insert as Step 2 → assert job exists w/ code like `%-FRANCHISE`, `stage_id` = first franchise stage, `assigned_group_id` = franchise group, `owner_user_id` = team_lead_for_group('franchise'), one pending `deal_payments` row 50000 at the client's country VAT; email outbox/log delta 0 (franchise-source lead gate holds). Second rollback-wrapped harness: `create_custom_job` franchise one_time 20000 plan `50_50` → 2 installment payments 10000/10000 line-linked to the job; plan `custom` with schedule [15000,5000] → 2 payments; invalid custom schedule sum → `schedule_total_mismatch`.
- [ ] **Step 6: Re-verify untouched behavior.** `release_deal_jobs` live body unchanged (diff vs pre-image not needed — it was never edited; confirm by re-reading def). Sweep: `select proname from pg_proc where prosrc ilike '%franchise%'` — expected: only the RPCs deliberately patched (+ `enqueue_lead_email` from the lead-source work).
- [ ] **Step 7: Commit + push** the migration file only: `feat(franchise): service type end-to-end — packages, board stages, release + installment RPCs`.

### Task 2: Frontend — every enumeration site + i18n

**Files (complete list — spec section "Frontend — enumerations" has the per-file details and line anchors):**
- Modify: `src/features/jobs/hooks/useJobs.ts`, `src/lib/rpc.ts`, `src/features/deals/ServicesPlannedField.tsx`, `src/features/deals/PaymentsPanel.tsx`, `src/features/deals/AddCustomJobForm.tsx`, `src/components/ServiceTypeBadge.tsx`, `src/features/jobs/JobsKanbanPage.tsx`, `src/features/jobs/JobsTab.tsx`, `src/features/jobs/kanbanGrouping.ts`, `src/components/layout/Sidebar.tsx`, `src/app/router.tsx`, `src/features/tech/TechMyClientsPage.tsx`, `src/features/offers/OfferBuilderPage.tsx`, `src/features/proformas/ProFormaBuilderPage.tsx`, `src/features/activity/format.ts`, `src/features/assigned_tasks/canCreateAssignedTask.ts`, `src/features/admin/ServicePackageDialog.tsx` (locate by grep), `src/features/deals/JobsBillingPanel.tsx` (only if plan editing is web_dev-gated there), `src/i18n/locales/en/deals.json`, `src/i18n/locales/el/deals.json` (+ any board-label namespace the sidebar/kanban labels use).

**Interfaces:**
- Consumes: Task 1's live DB (board stages, packages) — franchise appears in offer builder automatically once labels exist.
- Produces: `'franchise'` in the `ServiceType`/`JobDepartment` unions and every list above; sales services picker offers franchise with **one-time only** billing (mirror the hosting yearly-only branch in `billingOptionsFor`/`defaultBillingFor`); `AddCustomJobForm` `planEligible` = `(department === 'web_dev' || department === 'franchise') && cadence === 'one_time'`; sidebar top-level Franchise entry (NOT added to the hosting/maintenance nesting filter at Sidebar.tsx:258); route `/tech/franchise` behind RequireGroup incl. `'franchise'`; badge in the green family; i18n `services.types.franchise` = "Franchise" both locales.

- [ ] **Step 1:** Sweep-verify the file list is complete: `grep -rn "'maintenance'" src/ --include="*.ts" --include="*.tsx"` — every hit either gains a `'franchise'` sibling or is provably irrelevant (list the irrelevant ones in the report: e.g. maintenance-specific nesting).
- [ ] **Step 2:** TDD where tests exist: extend the test files covering `ServicesPlannedField`/`AddCustomJobForm`/`kanbanGrouping`/badge if present (grep `*.test.tsx` siblings); new assertions first (franchise option present, one-time-only billing options, plan selector for franchise one-time), watch fail, implement, watch pass.
- [ ] **Step 3:** Implement all enumeration edits per Interfaces.
- [ ] **Step 4:** Run the touched test files (file-scoped) + `npm run build` — all green, zero warnings.
- [ ] **Step 5:** Commit + push: `feat(franchise): offer/services/board UI — packages, picker, kanban, sidebar`.

### Task 3: Verification + spec flip

- [ ] **Step 1:** `npm run build` + the Task 2 test files once more — green.
- [ ] **Step 2:** Browser smoke on prod after deploy (read-only, NO records created): offer builder shows Franchise category with the 3 cards at €50.000/€20.000/€5.000 (Powered marked popular ordering per sort); lead services picker lists Franchise with one-time only; `/tech/franchise` renders the 8 columns empty; sidebar shows Franchise top-level (as a franchise-group member AND as admin). Hard-refresh for stale chunks.
- [ ] **Step 3:** Spec `Status:` → `implemented 2026-07-22`; commit + push.
