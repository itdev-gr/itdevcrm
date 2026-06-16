# Spec: Sales → Leads page (editable spreadsheet-style table)

## Context
The Sales section has a kanban board (`/sales/kanban`) for moving leads between pipeline
stages, but no flat, data-dense view for scanning and quickly editing many leads at once.
This adds a **"Leads"** page under Sales: an Excel-style table of all active leads with
inline-editable cells, plus search, per-column sorting, and Status/Assign-to filters. It
complements (does not replace) the kanban — same lead data, different workflow (bulk
triage/edit vs. visual stage movement).

## Goals
- A new `/sales/leads` page listing **active** leads (excludes converted + archived).
- Columns: Source, Lead title, Full Name, Email, Phone, Website, Company category, Company name, Assign to, Status (+ a read-only Code link to open the lead).
- **Every data cell is editable inline** (spreadsheet-style), saved on blur/change.
- Search box, sortable column headers, and Status + Assign-to dropdown filters.
- Reuse existing data/edit hooks and UI components; no new dependencies; no schema/DB changes.

## Non-goals (out of scope for v1)
- Creating new leads from this page (kanban/existing flows handle creation).
- Bulk/multi-row edit, column resize/reorder, CSV export, pagination (lead volume is small).
- Editing converted or archived leads (not shown).

## Scope of data
`useLeads({})` (`src/features/leads/hooks/useLeads.ts`) already returns active leads —
it excludes `archived` and `converted_at IS NOT NULL` by default. That is exactly the set
to show. Supporting data: `useAssignableOwners()` (owners), `usePipelineStages()` filtered
to `board='sales' && !archived` (statuses), `INDUSTRIES` from `src/lib/industries.ts`
(categories).

## Columns → fields → editor
| # | Column | `leads` field | Editor |
|---|---|---|---|
| 1 | Code (open ↗) | `code` | **read-only** link → `/leads/:id` |
| 2 | Source | `source` | `<select>`: meta / manual / import |
| 3 | Lead title | `title` | text — **required**; empty on blur reverts (column is NOT NULL) |
| 4 | Full Name | `contact_first_name` | text — writes `contact_first_name`, sets `contact_last_name = null` (mirrors `LeadForm` convention); displays `[first,last].filter(Boolean).join(' ')` |
| 5 | Email | `email` | text |
| 6 | Phone | `phone` | text |
| 7 | Website | `website` | text |
| 8 | Company category | `industry` | `<select>` from `INDUSTRIES` (+ "—" empty); unknown legacy values shown as-is |
| 9 | Company name | `company_name` | text |
| 10 | Assign to | `owner_user_id` | `<select>` owners + "Unassigned" (→ `null`) |
| 11 | Status | `stage_id` | `<select>` sales stages by `position`; options where `isStageMoveBlocked(stage, userId)` are **disabled** |

Empty text inputs save as `null` (except `title`, which reverts instead of clearing).

## Architecture / components (isolated units)
- **`src/features/leads/LeadsListPage.tsx`** — page shell. Owns toolbar state (search string, status filter, owner filter, sort `{key, dir}`). Fetches via `useLeads`, owners, stages. Computes the visible rows with `filterAndSortLeads(...)` and renders the toolbar + `<table>` (plain table, mirroring `ClientsListPage`). Clickable `<th>`s toggle sort.
- **`src/features/leads/leadsTableFilter.ts`** — pure `filterAndSortLeads(leads, opts)` helper (no React), unit-testable. See contract below.
- **`src/features/leads/LeadRowEditor.tsx`** — one `<tr>`. Holds local state per editable field initialized from the lead; commits a single-field patch via `useUpdateLead` on blur (text) / change (select); shows a subtle saving→saved indicator; on error alerts and reverts. Pattern mirrors `PaymentRow` in `src/features/deals/PaymentsPanel.tsx`.

Reused as-is: `Input`, `Select` (`src/components/ui/`), `useUpdateLead`, `useAssignableOwners`, `usePipelineStages`, `INDUSTRIES`, `isStageMoveBlocked` (`src/features/sales/stageAccess.ts`).

## `filterAndSortLeads` contract
```
filterAndSortLeads(leads, { search, statusId, ownerId, sort: { key, dir } }) -> LeadRow[]
```
- **search** (string): case-insensitive substring match across `title`, `contact_first_name`+`contact_last_name`, `email`, `company_name`. Empty = no filter.
- **statusId** (string|null): keep rows where `stage_id === statusId`. Null = all.
- **ownerId** (string|null|'__unassigned__'): `'__unassigned__'` → `owner_user_id == null`; a uuid → exact match; null = all.
- **sort**: by `key` ∈ {code, source, title, full_name, email, phone, website, industry, company_name, owner, status} in `dir` ∈ {asc, desc}. `owner`/`status` sort by their **display label**, not the raw id. **Default sort = `code` asc** (stable).

## Data flow & save behavior
1. `useLeads({})` → active leads. `LeadsListPage` runs `filterAndSortLeads` → visible rows.
2. Edit a cell → `LeadRowEditor` calls `useUpdateLead.mutateAsync({ id, patch: { <field>: value } })`.
3. On success, `useUpdateLead` invalidates `queryKeys.leads()` → refetch.
4. **Stable ordering:** `useLeads` orders by `updated_at` server-side, so an edit would re-sort the row to the top on refetch. The page **re-sorts client-side** (default `code` asc) so rows stay put while editing; a clicked header overrides the default.

## Status edit & restriction
`stage_id` edits go through `useUpdateLead` (equivalent to `useMoveLeadStage` for this field).
The `unique_lead` stage is restricted (`restricted_to_user_id`); its `<option>` is disabled
when `isStageMoveBlocked(stage, currentUserId)` is true, so it can't be selected by a
non-permitted user. The DB trigger remains the backstop. (Currently `mkifokeris` is the sole
user and the permitted one, so this is mostly a guard for the future.)

## Routing & nav
- `src/app/router.tsx`: add `{ path: 'leads', element: <LeadsListPage /> }` to the `sales`
  children (inside the existing `RequireGroup groups={['sales']}`). Lazy-load like the others.
- `src/components/layout/Sidebar.tsx`: add a **"Leads"** `NavLink` to `/sales/leads` in the
  Sales section (between "My Clients" and "Sales pipeline").

## i18n
Add column/toolbar keys to the `leads` namespace in both `src/i18n/locales/en/leads.json`
and `…/el/leads.json` (e.g. `columns.source`, `columns.title`, `columns.full_name`,
`columns.email`, `columns.phone`, `columns.website`, `columns.category`, `columns.company`,
`columns.assign`, `columns.status`, `columns.code`; reuse existing `filters.search`,
`owner.unassigned`, `title`). Greek values mirror English keys.

## Testing
- **TDD unit:** `leadsTableFilter.test.ts` covering `filterAndSortLeads` — search match,
  status filter, owner filter (incl. `__unassigned__`), sort by each key + direction,
  owner/status sort-by-label, default `code` sort.
- **Unit (optional but recommended):** `LeadRowEditor` calls `useUpdateLead` with the correct
  patch per column (e.g. Full Name → `{contact_first_name, contact_last_name:null}`; Assign
  "Unassigned" → `{owner_user_id:null}`; empty title → no save), mocking the hook like
  `useMoveJobStage.test.tsx`.
- **End-to-end (running app):** load `/sales/leads`; edit a text cell (blur → persists), a
  Status and an Assign-to dropdown (change → persists); verify search narrows rows, a column
  header sorts, and the Status/Assign filters work; confirm edited rows don't jump.

## Changes / Revert
- **New files:** `LeadsListPage.tsx`, `LeadRowEditor.tsx`, `leadsTableFilter.ts` (+ tests).
- **Edited files:** `src/app/router.tsx` (one route), `src/components/layout/Sidebar.tsx`
  (one nav link), `src/i18n/locales/{en,el}/leads.json` (column/toolbar keys).
- **No DB/schema/migration changes** — uses existing `leads` table, RLS, and hooks.
- **Revert:** `git revert` the implementation commit(s); nothing to undo in the database.
