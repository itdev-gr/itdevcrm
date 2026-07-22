# Franchise service line — design

Date: 2026-07-22
Status: approved by owner (chat) — installments YES, proposed board columns OK

## Goal

`franchise` becomes a full service type: offerable by sales with three fixed one-time packages, selectable in lead/deal services, released as an accounting job on win, with its own kanban board like Web Dev.

## Owner decisions

- Packages (from the pricing page, one-time, fixed):
  1. **IT DEV Branch** — €50.000 — «Πλήρες franchise με δικό σου brand, περιοχή και ολόκληρο το σύστημα IT DEV.»
  2. **Powered by IT DEV** — €20.000 — «Το δικό σου brand με έτοιμες πωλήσεις, εργαλεία και παράδοση από την ομάδα μας.» (ΔΗΜΟΦΙΛΕΣ)
  3. **Wholesale Partner** — €5.000 — «Χονδρική συνεργασία για δίκτυα και συνεργάτες που θέλουν να ξεκινήσουν απλά.»
- **Installment plans: YES** — franchise one-time jobs get the Web Dev payment-plan mechanics (none / 50_50 / 50_25_25 / custom schedule).
- **Board columns:** Νέο → Εκπαίδευση → Setup → Ενεργό → Ολοκληρωμένο, plus On Hold / Ακυρωμένο / Closed (terminal, outcome completed). No `renewal` lane (one-time service; on Fully-Paid franchise follows the default unblock branch like web_dev — `release_deal_jobs` needs NO change).
- Group/team: DONE 2026-07-22 (migration 20260722100000) — group `franchise` + permissions + mkifokeris member & team lead (jobs auto-own to him).
- Sidebar: **top-level** "Franchise" entry in Technical (not nested like hosting/maintenance).
- Billing type: one-time ONLY in the sales services picker (like hosting is yearly-only).
- **No emails**: no franchise email automations of any kind; the franchise-source lead gate (enqueue_lead_email) stays closed. Client-level won emails unchanged (owner decides later).

## Architecture (per the maintenance-service blueprint, 20260717130000)

### DB — one migration
1. Widen 3 CHECKs: `jobs_service_type_check`, `service_packages_service_type_check`, `service_monthly_task_templates_service_type_check` (+ 'franchise'). No monthly-task template row (franchise has no monthly tasks).
2. Seed `pipeline_stages` board='franchise' (8 rows above; terminal `closed`/completed required by `end_job`).
3. Patch the LIVE bodies (pg_get_functiondef pre-images saved first — prod drifts):
   - `release_jobs_for_deal` + `release_billing_jobs_for_deal` (latest: 20260720170000): add 'franchise' to the service allow-lists — else won franchise deals silently produce no job.
   - `reconcile_offboard_jobs` (latest: 20260717130000): allow-list + franchise.
   - `accounting_integrity_alerts` (latest: 20260720150000): off_board_job service list + franchise.
   - Installments: `create_custom_job` plan gate (`p_department='web_dev'` → in ('web_dev','franchise')), `generate_payments_for_deal` web_dev fixed-plan + custom-schedule branches and the grouped-block exclusion (`service_type='web_dev'` → in ('web_dev','franchise')), and `update_job_billing` if its live body gates plans to web_dev.
   - `release_deal_jobs`: NO change (franchise falls to the default unblock branch).
4. Seed 3 `service_packages` rows (codes `franchise_branch`/`franchise_powered`/`franchise_wholesale`, `default_one_time_amount` 50000/20000/5000, monthly 0, setup 0, Greek descriptions above, sort 1-3, active).
5. `job_service_abbr` fallback already yields `-FRANCHISE` codes — no change.

### Frontend — enumerations (complete list from the codebase sweep)
`useJobs.ts` ServiceType · `rpc.ts` JobDepartment · `ServicesPlannedField.tsx` type + SERVICE_TYPES + one-time-only branch in `billingOptionsFor`/`defaultBillingFor` · `PaymentsPanel.tsx` SERVICE_OPTIONS · `AddCustomJobForm.tsx` departments + `planEligible` (web_dev → web_dev|franchise, one_time) · `ServiceTypeBadge.tsx` color (green family, matches franchise branding) · `JobsKanbanPage.tsx` SERVICE_LABELS (+ optional sort/search lists) · `JobsTab.tsx` SERVICE_TO_KANBAN · `kanbanGrouping.ts` BLOCKED_COLUMN_BOARDS (franchise blocks on hold like maintenance) · `Sidebar.tsx` TECH_GROUPS/LABELS/ICONS/ROUTES/CLIENTS_ROUTES, top-level (do NOT add to the hosting/maintenance nesting filter) · `router.tsx` RequireGroup list + `/tech/franchise` route · `TechMyClientsPage.tsx` labels + URL map · `OfferBuilderPage.tsx` + `ProFormaBuilderPage.tsx` CATEGORY_LABELS · `activity/format.ts` ENUM_LABELS · `canCreateAssignedTask.ts` departments · `ServicePackageDialog.tsx` SERVICE_TYPES · i18n en+el `services.types.franchise` = "Franchise" (+ any board-label keys).
JobsBillingPanel plan-dropdown gating: if plan editing is gated to web_dev anywhere in the panel, widen to franchise.

### Degrade-gracefully confirmations (no code, by design)
No SEO access buttons, no Info-tab fields, no service attachment areas, no deal comment channel tab, email bucket = technical (categoryOf fallback).

## Testing
- Rollback-wrapped prod harness: franchise-source lead → client+deal with `services_planned=[{service_type:'franchise', billing_type:'one_time', one_time_amount:50000, …}]` → assert: job created, code `…-FRANCHISE`, stage = first franchise stage (Νέο), group franchise, owner mkifokeris, payment €50.000 pending w/ country VAT; email outbox/log delta = 0.
- Installments harness: create_custom_job franchise + 50_50 → 2 installment payments; custom schedule sums validated.
- Frontend: file-scoped vitest for touched test files; `npm run build` clean.
- Browser smoke (read-only, no prod garbage): offer builder shows Franchise with the 3 cards & prices; services picker shows Franchise (one-time only); `/tech/franchise` board renders empty with the 8 columns; sidebar entry visible. The full win flow is proven by the rollback harness, NOT in the browser (deals cannot be deleted).

## Changes / Revert
- Migration rollback: restore constraint arrays, drop franchise pipeline_stages/service_packages rows, restore RPC pre-images (saved under `.superpowers/sdd/pre-franchise-svc-*.sql`).
- Frontend: revert commits.
- Rollback ordering — with franchise data present: delete/retype franchise jobs before re-adding the original jobs CHECK, and delete franchise jobs before dropping the franchise stages (or re-add the constraint NOT VALID).
