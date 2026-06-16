# Spec: Sales → Leads page (editable table + round-robin distribution)

## Context
The Sales section has a kanban board (`/sales/kanban`) for moving leads between stages, but
no flat, data-dense view for scanning, editing, and **distributing** leads. This adds a
**"Leads"** page under Sales: an Excel-style table of all active leads with inline-editable
cells, search, per-column sorting, Status/Assign-to filters, **CSV export**, **bulk edit**,
and **round-robin auto-distribution** of incoming leads to salespeople. It is the intake
surface — leads from every source land here, then get distributed (manually now, optionally
auto later). It complements the kanban (same data, different workflow).

## Goals
- `/sales/leads` page listing **active** leads (excludes converted + archived).
- Columns: Source, Lead title, Full Name, Email, Phone, Website, Company category, Company name, Assign to, Status (+ read-only Code link to open the lead).
- **Every data cell editable inline**, saved on blur/change.
- Search box, sortable columns, Status + Assign-to filters.
- **CSV export** of the current (filtered + sorted) rows.
- **Bulk edit**: select rows → reassign owner / set status / archive.
- **Round-robin distribution** of unassigned leads to the Sales pool: a manual "Distribute" button always, plus an opt-in auto-on-create toggle (default OFF).

## Non-goals (out of scope for v1)
- Creating leads from this page (existing flows handle creation).
- **The ClickUp import itself** — a separate process. This spec only guarantees distribution
  is OFF by default and never overwrites a lead that already has an owner, so imported
  pre-assigned leads are untouched.
- Column resize/reorder, pagination (lead volume is small), editing converted/archived leads.

## Scope of data
`useLeads({})` already returns active leads (excludes `archived` and `converted_at IS NOT NULL`).
Supporting data: `useAssignableOwners()` (owners), `usePipelineStages()` filtered to
`board='sales' && !archived` (statuses), `INDUSTRIES` (`src/lib/industries.ts`) (categories).

## Columns → fields → editor
| # | Column | `leads` field | Editor |
|---|---|---|---|
| 1 | Code (open ↗) | `code` | **read-only** link → `/leads/:id` |
| 2 | Source | `source` | `<select>`: meta / manual / import |
| 3 | Lead title | `title` | text — **required**; empty on blur reverts (NOT NULL) |
| 4 | Full Name | `contact_first_name` | text — writes `contact_first_name`, sets `contact_last_name = null` (mirrors `LeadForm`); displays `[first,last].filter(Boolean).join(' ')` |
| 5 | Email | `email` | text |
| 6 | Phone | `phone` | text |
| 7 | Website | `website` | text |
| 8 | Company category | `industry` | `<select>` from `INDUSTRIES` (+ "—"); unknown legacy values shown as-is |
| 9 | Company name | `company_name` | text |
| 10 | Assign to | `owner_user_id` | `<select>` owners + "Unassigned" (→ `null`) |
| 11 | Status | `stage_id` | `<select>` sales stages by `position`; `isStageMoveBlocked` options disabled |

Empty text inputs save as `null` (except `title`, which reverts).

## Lead distribution (round-robin) — backend
**Default behavior is OFF.** Distribution only ever sets `owner_user_id` (never changes stage)
and only ever targets **unassigned** leads (`owner_user_id IS NULL`) — so manually-assigned
or imported leads are never reassigned.

**Rotation pool:** active, non-archived members of the **`sales` group** (via `user_groups` →
`groups.code='sales'`), ordered stably by `profiles.created_at`. *(Default — confirm on review;
alternative was a per-user "receives leads" flag.)*

**Rotation rule (matches the 5-leads/3-sales → 1,2,3,1,2 example):** keep a persisted
`last_assigned_user_id`; the next assignee is the pool member immediately after it in stable
order, wrapping to the first; if none/last-left-the-pool, start at the first. Each assignment
updates `last_assigned_user_id`.

**New migration adds:**
- `lead_distribution_state` — singleton table: `auto_enabled boolean NOT NULL DEFAULT false`,
  `last_assigned_user_id uuid NULL`, `updated_at`. Seed one row (`auto_enabled=false`).
- `pick_next_sales_assignee()` → uuid — returns the next pool member and advances
  `last_assigned_user_id`. `SECURITY DEFINER`.
- `leads_auto_distribute()` **BEFORE INSERT trigger** on `leads` — if
  `lead_distribution_state.auto_enabled` AND `NEW.owner_user_id IS NULL`, set
  `NEW.owner_user_id := pick_next_sales_assignee()`. No-op when disabled or already assigned.
  Covers every creation path (Meta webhook, manual, import) uniformly.
- `distribute_unassigned_leads()` → int — assigns every active, unassigned, non-converted,
  non-archived lead round-robin (advancing the rotation), returns the count. Used by the
  manual button regardless of the toggle. Permission: admin (and/or sales-manager) only.

**ROLLBACK SQL** (drop trigger, functions, table) included in the migration footer per repo convention.

## Lead distribution — frontend (toolbar)
- **Checkbox "Auto-distribute new leads"** bound to `lead_distribution_state.auto_enabled`
  (admin-only). Default unchecked. Turn ON after the ClickUp import.
- **Button "Distribute unassigned (N)"** — N = count of unassigned active leads; calls
  `distribute_unassigned_leads()`, then refetch. Disabled when N=0 or pool is empty.
- New hooks: `useLeadDistribution()` (read/set `auto_enabled`) and `useDistributeUnassigned()`
  (call the RPC).

## CSV export
- **"Export CSV"** button downloads the **current filtered + sorted rows** as a `.csv`
  (the visible columns; Assign-to and Status as display labels, not ids). Pure helper
  `leadsToCsv(rows, columns)` builds the text; client-side Blob download. No server round-trip.

## Bulk edit
- Per-row checkbox + a header "select all (filtered)" checkbox. When ≥1 selected, a bulk-action
  bar shows: **Reassign owner** (select), **Set status** (select), **Archive selected**.
  *(Default set — confirm on review.)*
- Applied via `useBulkUpdateLeads()` — a single `UPDATE … WHERE id IN (selectedIds)` for
  owner/status; Archive sets `archived = true` (drops them from the active list). Invalidates
  `queryKeys.leads()`.

## Architecture / components (isolated units)
- **`LeadsListPage.tsx`** — page shell: toolbar (search, Status filter, Assign-to filter,
  auto-distribute checkbox, Distribute button, Export CSV, bulk-action bar) + the `<table>`.
  Owns search/filter/sort/selection state. Computes visible rows via `filterAndSortLeads`.
- **`leadsTableFilter.ts`** — pure `filterAndSortLeads(leads, opts)` (unit-testable).
- **`leadsCsv.ts`** — pure `leadsToCsv(rows, columns)` (unit-testable).
- **`LeadRowEditor.tsx`** — one `<tr>`: checkbox + local cell state; commits single-field
  patches via `useUpdateLead` on blur/change; saving→saved indicator; reverts on error.
  Mirrors `PaymentRow` in `PaymentsPanel.tsx`.
- Hooks: `useLeadDistribution`, `useDistributeUnassigned`, `useBulkUpdateLeads` (new);
  reuse `useUpdateLead`, `useAssignableOwners`, `usePipelineStages`, `INDUSTRIES`,
  `isStageMoveBlocked`, `Input`, `Select`.

## `filterAndSortLeads` contract
`filterAndSortLeads(leads, { search, statusId, ownerId, sort:{key,dir} }) -> LeadRow[]`
- **search**: case-insensitive substring over `title`, `contact_first_name`+`contact_last_name`, `email`, `company_name`.
- **statusId**: keep `stage_id === statusId`; null = all.
- **ownerId**: `'__unassigned__'` → owner null; uuid → match; null = all.
- **sort key** ∈ {code, source, title, full_name, email, phone, website, industry, company_name, owner, status}; `owner`/`status` sort by display label. **Default = `code` asc** (stable, so edits don't reorder rows).

## Data flow & save behavior
1. `useLeads({})` → active leads; `filterAndSortLeads` → visible rows.
2. Edit a cell → `useUpdateLead.mutateAsync({ id, patch:{ <field>: value } })` → invalidate → refetch.
3. **Stable ordering:** page re-sorts client-side (default `code` asc) so rows don't jump on edit; a clicked header overrides.
4. Distribution sets `owner_user_id` server-side (trigger/RPC); the table reflects it on refetch.

## Routing & nav
- `router.tsx`: add `{ path: 'leads', element: <LeadsListPage /> }` to the `sales` children (lazy-loaded, inside `RequireGroup groups={['sales']}`).
- `Sidebar.tsx`: add a **"Leads"** `NavLink` to `/sales/leads` in the Sales section (between "My Clients" and "Sales pipeline").

## i18n
Add column/toolbar keys to the `leads` namespace (en + el): `columns.*`, plus
`distribute.auto_label`, `distribute.button`, `export_csv`, `bulk.reassign`, `bulk.set_status`,
`bulk.archive`, `bulk.selected`. Reuse `filters.search`, `owner.unassigned`, `title`.

## Permissions
- Inline edits / bulk edit: governed by existing leads RLS (admin or `can('sales','edit')`).
- Auto-distribute toggle + Distribute button + `distribute_unassigned_leads()`: **admin** (and/or sales-manager) only. Currently `mkifokeris` is the sole (admin) user.

## Testing
- **TDD unit:** `filterAndSortLeads` (search/status/owner/sort incl. label sort + default code sort).
- **TDD unit:** `leadsToCsv` (header row, label mapping for owner/status, escaping commas/quotes).
- **TDD unit:** `LeadRowEditor` patch mapping (Full Name → `{contact_first_name, contact_last_name:null}`; Assign "Unassigned" → `{owner_user_id:null}`; empty title → no save), and `useBulkUpdateLeads` builds correct `id IN (...)` patch — mock hooks like `useMoveJobStage.test.tsx`.
- **pgTAP** (`supabase/tests/lead_distribution.sql`): 5 unassigned leads + 3 sales users → owners come out 1,2,3,1,2; auto trigger is a no-op when `auto_enabled=false`; trigger skips a lead inserted with an owner already set; `distribute_unassigned_leads()` returns the right count. *(Runs in the project's `supabase test db`; can't execute in this sandbox — verified live after the migration is applied.)*
- **End-to-end (running app):** load `/sales/leads`; edit text/Status/Assign cells (persist, no row-jump); search/sort/filter; tick rows → bulk reassign + archive; Export CSV; toggle auto-distribute + click "Distribute unassigned" and confirm round-robin owners.

## Changes / Revert
- **New frontend files:** `LeadsListPage.tsx`, `LeadRowEditor.tsx`, `leadsTableFilter.ts`,
  `leadsCsv.ts`, hooks (`useLeadDistribution`, `useDistributeUnassigned`, `useBulkUpdateLeads`) (+ tests).
- **Edited frontend:** `router.tsx` (one route), `Sidebar.tsx` (one nav link), `i18n/locales/{en,el}/leads.json`.
- **New migration:** `lead_distribution_state` table + `pick_next_sales_assignee()` +
  `leads_auto_distribute` trigger + `distribute_unassigned_leads()` (with ROLLBACK SQL in footer).
  **Must be applied to prod** (CI doesn't run migrations) via `supabase db push`.
- **Revert:** `git revert` the implementation commit(s); run the migration's ROLLBACK SQL to drop the distribution objects. No changes to existing tables' data.

## Open items to confirm on review
1. Rotation pool = active **Sales-group** members (vs. a per-user "receives leads" flag)?
2. Bulk actions = **reassign owner / set status / archive** (add "set category"?)?
3. Who, besides admin, may toggle auto-distribute / run Distribute (e.g. a sales manager)?
