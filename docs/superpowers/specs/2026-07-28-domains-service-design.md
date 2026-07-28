# "Domains" service category — full hosting mirror

**Date:** 2026-07-28
**Status:** Approved (design), pending implementation

## Goal

A new `domains` service type that behaves exactly like `hosting` end-to-end:
yearly domain renewals billed as normal jobs in accounting, surfaced on a
hosting-style list at `/tech/domains`, nested under Web Dev in the sidebar.

## Owner decisions

1. **Full hosting mirror**: yearly-only billing; releases on Partial Payment;
   never payment-blocked; 2-stage board (Active / Done); no monthly-task
   template; no service_packages seed; board starts EMPTY (no backfill).
2. **Domain field**: one text field "Domain" (`details.domain`) on the job Info
   tab — a deliberate deviation from hosting (which has no Info fields). The
   shared list's Domain column reads `details.domain` first, then the existing
   fallbacks (details.live_url → details.hosting → client.website).
3. **Label**: "Domains" in both EN and EL, sidebar icon Globe, nested under
   Web Dev next to Hosting and Support.

## DB migration (one file, maintenance/franchise playbook — see
`20260717130000_maintenance_service.sql` / `20260722120000_franchise_service.sql`)

1. **CHECK constraints** — add `'domains'` to all three:
   `jobs_service_type_check` (keep the existing stray `'other'`),
   `service_packages_service_type_check`,
   `service_monthly_task_templates_service_type_check`.
   Current live versions are in `20260722120000_franchise_service.sql:793-799`.
2. **Group + permissions** — insert `groups` row
   (`'domains'`, `{"en":"Domains","el":"Domains"}`, parent_label `'Technical'`,
   position `max+10`) and the 7 `group_permissions` rows for `board='domains'`
   (view, edit, move_stage, complete_job, comment, attach_file, assign_owner) —
   the cross-join pattern from `20260717130000_maintenance_service.sql:565-571`.
   NOTE: hosting itself lacks these rows (admin-only at RLS today); the new
   board follows the corrected pattern, we do NOT copy hosting's gap.
3. **Stages** — seed `pipeline_stages` for `board='domains'` mirroring hosting's
   LIVE 2-stage shape (`20260703060000_hosting_two_stages.sql`):
   `('domains','active','{"en":"Active","el":"Ενεργό"}',10,false,null)`,
   `('domains','closed','{"en":"Done","el":"Ολοκληρωμένο"}',20,true,'completed')`.
   The terminal `closed`/`completed` stage is required by `end_job` and
   `closeTargets.ts`.
4. **No** `service_monthly_task_templates` row (hosting has none).
5. **RPCs re-emitted** (live body via `pg_get_functiondef` at apply time — drift
   check against the repo's last known version, per parallel-session risk —
   with ONLY the `domains` additions):
   - `release_billing_jobs_for_deal` — add `'domains'` to the service allow-list.
   - `release_jobs_for_deal` — allow-list + BOTH hosting carve-outs:
     partial-payment early release `('web_dev','hosting','domains')` and
     `should_block` exclusion (same tuple).
   - `seed_deal_payments` — yearly coercion becomes
     `if st in ('hosting','domains') then bt := 'recurring_yearly'`.
   - `block_deal_jobs` — exclusion becomes
     `service_type not in ('web_dev','hosting','domains')`.
   - `reconcile_offboard_jobs` — add `'domains'` to its service list.
   - `accounting_integrity_alerts` — add `'domains'` to the `off_board_job`
     (check #20) service list.
   - `release_deal_jobs` — add `'domains'` to its allow-list.
6. **Job codes**: no change — `job_service_abbr` generic fallback already yields
   `<dealcode>-DOMAINS`.
7. **Rollback SQL** (recorded in the migration header): delete the
   `pipeline_stages`/`group_permissions`/`groups` rows for `domains`, restore
   the three CHECK constraints without `'domains'`, re-emit the 7 RPCs from the
   pre-change `pg_get_functiondef` snapshots taken at apply time (store them in
   the migration header as comments, maintenance-style MD5 audit).

## Frontend

- **`ServiceType` unions/arrays** — add `'domains'` to every hand-maintained
  list: `useJobs.ts:6`, `rpc.ts` (`JobDepartment`),
  `ServicesPlannedField.tsx` (`SERVICE_TYPES`; `billingOptionsFor` /
  `defaultBillingFor` return/force `recurring_yearly` for domains; billing
  Select disabled like hosting), `AddCustomJobForm.tsx` (`DEPARTMENTS`; cadence
  forced+disabled like hosting), `PaymentsPanel.tsx` (`SERVICE_OPTIONS`),
  `ServicePackageDialog.tsx` (`SERVICE_TYPES`).
- **Label maps** — `OfferBuilderPage`/`ProFormaBuilderPage` `CATEGORY_LABELS`,
  `TechMyClientsPage` (`SERVICE_LABELS` + `URL_TO_SERVICE` slug `domains`),
  `JobsTab.tsx` (`SERVICE_TO_KANBAN` → `/tech/domains`),
  `ServiceTypeBadge.tsx` (badge class), `activity/format.ts`
  (`ENUM_LABELS.service_type.domains = 'Domains'`), `JobsKanbanPage.tsx`
  `SERVICE_LABELS` (completeness; kanban never renders domains),
  i18n `deals.json` en+el `services.types.domains: "Domains"`.
- **Info tab** — `serviceInfoFields.ts`: `SERVICE_INFO_FIELDS.domains =
  [{ key: 'domain', labelEn: 'Domain', labelEl: 'Domain', type: 'text' }]`.
- **Shared list helper** — `jobsList.ts` `jobListDomain`: prepend `d.domain` to
  the candidates array (harmless for hosting/web_dev where the key is absent —
  EXCEPT web_dev jobs also have a free-text `hosting` field; `domain` simply
  wins when present, which is correct).
- **List page** — new `src/features/domains/DomainsListPage.tsx` wrapper over
  `JobsListPage`: `serviceType="domains"`, title `"Domains"`, description
  `"Yearly domain renewals — Active & Done."`, dueColumnLabel `"Renewal due"`,
  `doneStageCodes={['closed']}`, `showBlocked={false}`.
- **Sidebar** — `TECH_GROUPS` + `TECH_LABELS.domains = 'Domains'` +
  `TECH_ICONS.domains = Globe` + `TECH_ROUTES.domains = '/tech/domains'` +
  `TECH_CLIENTS_ROUTES.domains = '/tech/domains/clients'`; exclude `domains`
  from the top-level loop filter and render the nested link under Web Dev after
  Hosting/Support (same pattern).
- **Router** — add `'domains'` to the `/tech` `RequireGroup` list; lazy
  `DomainsListPage`; route `{ path: 'domains', element: <DomainsListPage /> }`.
  `:serviceType/clients` and `:serviceType/docs` are generic (slug map handles
  them).
- **Tasks** — `canCreateAssignedTask.ts` `ALLOWED_GROUPS`: add `'domains'`
  (hosting is in it).
- **Blocked column** — `BLOCKED_COLUMN_BOARDS`: domains excluded by omission
  (like hosting). No change.

## Out of scope

- No backfill/splitting of existing hosting deals.
- No emails, comment channels, attachment areas, monthly tasks, or SEO-access
  button for domains (hosting has none of these either).
- `tech_my_clients` DB view: verify at implementation time whether it filters
  by service type; if it passes services through generically post-franchise,
  no change — otherwise re-emit with `domains` added (the ads migration shows
  the pattern).

## Rollout order

1. Apply the DB migration to prod (Supabase MCP / owner-provided token; DDL is
   inert while no frontend references `domains`). Drift-check RPC bodies first.
2. Push frontend to main → Vercel deploy.
3. Owner assigns staff to the `domains` group in Settings (admins see the board
   immediately).
4. Live verify: create a throwaway deal with a Domains service via accounting,
   confirm job lands on `/tech/domains` with code `-DOMAINS`, yearly payment
   row exists, list status flip works; then delete the test data (delete_jobs
   RPC + deal cleanup) — get owner go-ahead before creating prod test data.

## Testing

- Unit: `ServicesPlannedField.billing.test.ts` (domains → yearly-only, like
  hosting cases), `serviceInfoFields.test.ts` (domains fields),
  `jobsList.test.ts` (`details.domain` precedence in `jobListDomain`),
  plus `domains` entries in the service-enumerating tests:
  `canCreateAssignedTask.test.ts`, `closeTargets.test.ts`,
  `kanbanGrouping.test.ts`, `seoAccessButton.test.ts`,
  `commentChannels.test.ts`, `serviceAreas.test.ts`.
- Build: `npm run build` strict gate.
- Manual: Playwright smoke on hosting (unchanged) + domains list rendering.

## Changes / Revert

- Frontend: atomic commits on `main`; revert = `git revert`.
- DB: rollback SQL in the migration header (constraints, seeds, RPC
  re-emission from apply-time snapshots). Stage/group rows are new — deleting
  them is safe while no domains jobs exist; once jobs exist, revert keeps rows
  and only restores RPCs/constraints after archiving those jobs.
