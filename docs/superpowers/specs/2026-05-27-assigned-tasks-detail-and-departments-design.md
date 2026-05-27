# Assigned-tasks detail modal + department — design

**Status:** Draft (awaiting user review)
**Author:** Marios (via Claude)
**Date:** 2026-05-27
**Revised:** 2026-05-27 — multi-select departments simplified to **single** department per task at user's request, so this drops the join table and the RPC.

## Goal

Make the rows in the Home "Assigned to me" column (and the Deal/Job "Tasks" tab) clickable. Clicking opens a read-only detail modal that shows the full task plus the major client/contact info. Also: on task creation, the creator must tag **one** department the task focuses on (Web Dev, Local SEO, etc.) and **one** assignee (today's behavior).

## Scope

Touches the existing `assigned_tasks` feature only — **not** the `user_tasks` calendar-todo system.

**In scope**
- New required column `assigned_tasks.department_group_id uuid not null references public.groups(id)`.
- `NewAssignedTaskDialog`: new required single-select "Department" chip field.
- `useCreateAssignedTask`: passes `departmentId` in the direct insert payload (no RPC needed — DB NOT NULL enforces it).
- `AssignedTasksColumn` (Home) + `AssignedTasksTab` (Deal/Job): each row becomes clickable; show the single department chip inline; click opens new detail modal.
- New `AssignedTaskDetailDialog` (read-only) showing task fields + client essentials + primary contact.
- i18n keys (EN + EL).
- TDD test coverage for every step.
- Backfill the existing 1 task that has no department, then flip the column to NOT NULL.

**Out of scope (v1)**
- Multi-department per task (rejected — single is the agreed model).
- Editing title/description/department/assignee after creation (modal is read-only in v1).
- Filtering the list by department.
- Surfacing `user_tasks` on the same detail surface.
- Changes to the existing source-code badge link or the Resolve mutation behavior.

## Data model

Add a single column to the existing table:

```sql
-- Phase 1 of the migration: nullable column, so existing rows survive.
alter table public.assigned_tasks
  add column if not exists department_group_id uuid
    references public.groups(id) on delete restrict;

create index if not exists assigned_tasks_department_group_id
  on public.assigned_tasks (department_group_id)
  where department_group_id is not null;

-- Phase 2 (same migration, after backfill in app code):
-- update public.assigned_tasks set department_group_id = <web_dev group id>
--   where department_group_id is null;
-- alter table public.assigned_tasks alter column department_group_id set not null;
```

Backfill of the 1 existing smoke task happens in **Task 0** of the plan (a one-line `update` via the service role) before the NOT NULL flip ships in the same migration file.

**Why a column over a join table:** the user explicitly asked for "one department" → no need for many-to-many. Single column = simpler RLS (inherits the parent row), simpler queries (no nested select), simpler UI (one chip, not a chip list).

**Rollback** (in the migration's `-- ROLLBACK:` block):

```sql
-- ROLLBACK:
-- alter table public.assigned_tasks drop column if exists department_group_id;
```

## RLS

No new RLS — `department_group_id` is just another column on `assigned_tasks` and is covered by the existing `assigned_tasks_select` / `_insert` / `_update` policies. The existing `revoke update` pattern from `profiles` is **not** copied here: anyone who can update the task (admin, assignee, creator) can in principle change its department, which we leave editable at the DB level for future-proofing even though v1 won't expose an edit UI.

## RPC change

**None.** The existing direct insert (`supabase.from('assigned_tasks').insert({...})`) keeps working. The new required column is enforced by `NOT NULL` at the DB. The `created_by_user_id` self-check in the existing insert policy stays untouched. Hook payload simply gains a `department_group_id: string` field.

## UI

### Row (Home column + Deal/Job tab)

```
┌─────────────────────────────────────────────────────────────┐
│ TEST — smoke task for MK  [Web Dev]   000017            │
│ Pindos Outdoor Gear · Christos Tsilis                       │
│ Created from test@test.gr to verify…             [Resolve]  │
└─────────────────────────────────────────────────────────────┘
```

- Whole row becomes a `<button type="button">` opening the detail modal.
- The source-code badge keeps linking to `/deals/:id` (or `/jobs/:id`); `e.stopPropagation()` on its `onClick`.
- The Resolve button keeps its current mutation; `e.stopPropagation()` on its `onClick`.
- Department chip: single, slate-100 background. Always exactly one (post-backfill + NOT NULL).

### Detail modal (`AssignedTaskDetailDialog`)

- Centered, ~520px wide, reuses the existing `Dialog` primitive.
- Sections in order: title → single department chip → meta (status, creator, created_at) → description → "Client" divider → client name + industry → primary contact name + phone + email → footer with `Resolve` + `Open deal/job` actions.
- Read-only — no inline editing.
- `Resolve` reuses the existing mutation and closes the modal on success.
- `Open deal/job` reuses `sourceHref(task)` and uses `react-router-dom` `Link`.

### Create dialog (`NewAssignedTaskDialog`)

Add a `Department *` block above the footer:

- Single-select chip row of all 9 groups, ordered by `groups.position`, labels from `display_names[locale]`. Clicking a chip toggles it as the selected one; clicking it again clears it; clicking another replaces it. Visually: selected chip uses amber background, others use slate.
- New state: `departmentId: string | null`.
- Submit button disabled until `title.trim() && assigneeUserId && !!departmentId`.

### Data fetching

- **New hook `useAssignedTaskDetail(taskId)`** — single query joining `assigned_tasks` → `clients` (name, industry, contact_first_name, contact_last_name, email, phone) → `department:department_group_id ( id, code, display_names, position )` → `creator:created_by_user_id ( user_id, full_name, email )`.
- The existing list hooks (`useAssignedTasksOpen`, `useAssignedTasksForSource`) get the nested `department` joined the same way.
- The existing `useGroups()` hook from `src/features/groups/hooks/useGroups.ts` is reused for the create dialog's chip list — no new hook needed.

## i18n

New keys in `home.json` (EN + EL):
- `assigned_tasks.detail_title` ("Task detail" / "Λεπτομέρειες εργασίας")
- `assigned_tasks.department_label` ("Department" / "Τμήμα")
- `assigned_tasks.client_section` ("Client" / "Πελάτης")
- `assigned_tasks.open_deal` / `assigned_tasks.open_job` (link labels)
- `assigned_tasks.loading`, `assigned_tasks.error_loading`, `assigned_tasks.created_by_label`, `assigned_tasks.created_label`

New keys in `deals.json` + `jobs.json` (EN + EL):
- `assigned_tasks.department_label` (same as above)
- `assigned_tasks.department_hint` ("Pick one" / "Επίλεξε ένα")

## Testing (TDD, one commit per step)

| # | Step                                                                                 | Test                                                                        |
|---|--------------------------------------------------------------------------------------|-----------------------------------------------------------------------------|
| 0 | Backfill the 1 existing task with a department (Web Dev) via service-role HTTP PATCH | Manual: HTTP 200; then `select` confirms `department_group_id is not null` |
| 1 | Migration: nullable column + index + NOT NULL after backfill                          | DB test (transactional): column exists; insert without department fails    |
| 2 | Hook: `useCreateAssignedTask` accepts `departmentId` and inserts it                   | Vitest mock — assert insert payload includes `department_group_id`         |
| 3 | UI: `NewAssignedTaskDialog` shows the single-select chip row + disabled-until logic   | RTL test                                                                   |
| 4 | List hook: `useAssignedTasksOpen` returns nested `department`                          | Vitest mock                                                                |
| 5 | List hook: `useAssignedTasksForSource` returns nested `department`                     | Vitest mock                                                                |
| 6 | Component: `DepartmentChip` renders the locale-appropriate label                       | (covered by consumer tests)                                                |
| 7 | Hook: `useAssignedTaskDetail` returns task + client essentials + department + creator   | Vitest mock                                                                |
| 8 | Component: `AssignedTaskDetailDialog` renders all sections + Resolve closes it         | RTL test                                                                   |
| 9 | Row update: chip, whole-row click opens modal, stopPropagation on badge + Resolve     | RTL tests on `AssignedTasksColumn` and `AssignedTasksTab`                  |

## Open questions / known limitations

- The detail modal is read-only in v1. Editing follows in a separate task if you want it.
- Major client info intentionally limited to name + industry + primary contact (name, phone, email). Website / city / additional contacts deferred.
- The existing 1 smoke task gets backfilled with "Web Dev" (arbitrary but unblocks the NOT NULL flip). If you want a different default, say so before Task 0.

## Changes / Revert (filled in during implementation)

- Migration: `supabase/migrations/<TIMESTAMP>_assigned_tasks_department.sql` — `alter table public.assigned_tasks drop column department_group_id;` to undo.
- Files touched: _appended per commit_.
- Commits: _appended per commit_ (full SHA list at the end so `git revert <range>` is one command).
