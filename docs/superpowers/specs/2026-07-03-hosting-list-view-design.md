# Hosting board → 2-status list — design

**Date:** 2026-07-03 · **Status:** Approved (brainstorm) — pending implementation plan

## Context

The Hosting tech board is a 5-column kanban (Setup, Active, On Hold, Cancelled, Closed) rendered by the generic `JobsKanbanPage`. Hosting is a yearly-renewal service; the columns add friction and most jobs just sit in "Setup". The owner wants Hosting managed as a simple **list** with only **two statuses: Active and Done**.

## Scope

Two coupled changes:
1. **Data model** — reduce the hosting `pipeline_stages` to two lanes (Active, Done) and migrate existing jobs.
2. **UI** — render `/tech/hosting` as a table instead of the kanban.

Nothing else changes: the hosting job detail page, billing, yearly-renewal logic, sidebar nav, and `/tech/hosting/clients` are untouched.

## Data model

Current hosting stages: `setup`(10) → `active`(20) → `on_hold`(30) → `cancelled`(40, terminal/cancelled) → `closed`(50, terminal/completed). Jobs today: **22 in `setup`, 1 in `closed`**.

Target — two stages:

| code | display (en / el) | position | terminal | outcome |
|------|-------------------|----------|----------|---------|
| `active` | Active / Ενεργό | 10 | no | — |
| `closed` | **Done** / Ολοκληρωμένο | 20 | yes | completed |

- **Reuse existing rows** — rename the `active` stage's display to keep it first; **rename the `closed` stage's display to "Done" but KEEP its `code='closed'`**. `closeTargets.ts:closeTargetCode('hosting')` returns `'closed'` and `close_deal` moves hosting jobs there — keeping the code intact means deal-close/end-job keep working and still land in "Done". Completion is stamped by any terminal stage with `terminal_outcome='completed'` (this one), not a hardcoded code, so that keeps working too.
- **Migrate** the 22 `setup` jobs → `active`.
- **Archive** `setup`, `on_hold`, `cancelled` (all empty after the migration). Archiving (not deleting) preserves history and any FK references; the board reads only non-archived stages, so they vanish from the UI.
- **New hosting jobs** land in the first non-archived stage by position = `active`. **Verify** during implementation that no DB function hardcodes placing hosting jobs in `'setup'` (grep function bodies); if one does, repoint it to `'active'`.
- Migration ships with rollback SQL (un-archive the three stages, restore display names, move jobs back is NOT required — the down script just un-archives + restores labels).

## UI — `HostingListPage`

New component `src/features/hosting/HostingListPage.tsx`, routed at `/tech/hosting` (replacing `<JobsKanbanPage serviceType="hosting" />` in `router.tsx`). Modeled on `src/features/tech/TechMyClientsPage.tsx` (sticky-header table + `PageHeader`/`FilterBar` from `page-shell`).

**Data:** reuse `useJobs('hosting')` (jobs joined to clients/deals/stage) and `usePipelineStages()` filtered to `board==='hosting'`.

**Layout — one table + a status filter:**
- Header: title "Hosting", a **search box**, and a **status filter** (Active / Done / All; default **Active**).
- Columns: **Client** · **Domain/URL** · **Renewal due** · **Status**.
  - *Client* — client name, links to the hosting job detail (`/jobs/:id`), as cards do today.
  - *Domain/URL* — `details.live_url || details.hosting || clients.website` (first non-empty), shown as a link if a URL.
  - *Renewal due* — `period_due_date` (yearly renewal), formatted; blank if null. Rows sort by this ascending by default so the soonest renewal is on top.
  - *Status* — an inline control (dropdown or Active/Done toggle) that flips the job between `active` and `closed`.
- Empty state when no rows match.

**Status change:** the inline control calls the existing **`useMoveJobStage`** mutation with the target stage id (`active` or `closed`) — same path the kanban drag uses, so it already stamps/clears `completed_at` via `stageCompletion.ts` and updates optimistically. Marking Done is a stage move only; it does **not** stop billing (billing is ended/paused separately on the job, unchanged).

**Pure helper (unit-tested):** `src/features/hosting/hostingList.ts` — `filterAndSortHosting(jobs, { status, search })` returning the filtered+sorted rows (status filter, search across client/domain/code, sort by renewal due asc, nulls last). Tested in `hostingList.test.ts`.

## Out of scope / preserved

- Kanban for the other five tech boards — unchanged (`JobsKanbanPage` stays for them).
- No kanban/list view toggle — hosting is a list, full stop.
- Hosting job detail, Info tab, billing, `end_job`, `close_deal`, sidebar nav, `/tech/hosting/clients` — unchanged.

## Testing

- **Unit** (`hostingList.test.ts`): status filter (Active/Done/All), search match, renewal-due sort with nulls last.
- **Manual (prod, read-verify)**: after migration, `/tech/hosting` shows a table of 23 jobs (22 Active, 1 Done); flipping a smoke/hosting job Active↔Done moves it and stamps `completed_at`; new hosting job (via a paid deal) appears as Active; deal-close still lands a hosting job in Done.
- **Migration verification**: hosting has exactly 2 non-archived stages; 0 jobs in archived stages; `closeTargetCode('hosting')` still resolves (`code='closed'` present).

## Changes / Revert

**Changes** — migration: rename `active`/`closed` display_names, migrate `setup`→`active` jobs, archive `setup`/`on_hold`/`cancelled`. Frontend: new `HostingListPage` + `hostingList.ts` (+ test), swap the `/tech/hosting` route element. Possibly repoint one DB placement function `setup`→`active` if found.

**Revert** — migration down: un-archive the three stages, restore `closed`/`active` display names (ROLLBACK block in the migration). Frontend: restore `<JobsKanbanPage serviceType="hosting" />` on the route, delete the two new files.
