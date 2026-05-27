# Assigned-tasks detail modal + departments — design

**Status:** Draft (awaiting user review)
**Author:** Marios (via Claude)
**Date:** 2026-05-27

## Goal

Make the rows in the Home "Assigned to me" column (and the Deal/Job "Tasks" tab) clickable. Clicking opens a read-only detail modal that shows the full task plus the major client/contact info. Also: on task creation, the creator must tag one or more **departments** the task focuses on (Web Dev, Local SEO, etc.).

## Scope

Touches the existing `assigned_tasks` feature only — **not** the `user_tasks` calendar-todo system.

**In scope**
- New many-to-many: `assigned_task_departments` (task ↔ group).
- `create_assigned_task` RPC change: accept and persist `department_ids[]`, reject empty.
- `NewAssignedTaskDialog`: new required multi-select "Departments" chip list.
- `AssignedTasksColumn` (Home) + `AssignedTasksTab` (Deal/Job): each row becomes clickable; show department chips inline; click opens new detail modal.
- New `AssignedTaskDetailDialog` (read-only) showing task fields + client essentials + primary contact.
- i18n keys (EN + EL).
- TDD test coverage for every step.

**Out of scope (v1)**
- Editing title/description/departments after creation (modal is read-only in v1).
- Filtering the list by department.
- Surfacing `user_tasks` on the same detail surface.
- Changes to the existing source-code badge link or the Resolve mutation behavior.

## Data model

New table:

```sql
create table public.assigned_task_departments (
  task_id  uuid not null references public.assigned_tasks(id) on delete cascade,
  group_id uuid not null references public.groups(id)         on delete restrict,
  primary key (task_id, group_id)
);
create index assigned_task_departments_group_id
  on public.assigned_task_departments (group_id);
```

**Why a join table over a `text[]`/`uuid[]` column:**
- Referential integrity with `groups` (you can't tag a deleted/renamed department).
- Matches the existing pattern (`user_groups`).
- Makes future filtering, per-department permissions, and reporting trivial.

**Required-on-create:** enforced inside the `create_assigned_task` RPC (`if array_length(p_department_ids, 1) is null then raise exception ...`). Not enforced via DB CHECK because the constraint lives across two tables.

**Existing rows:** the one smoke task created today (`499b1733-…`) has no department row. The detail modal renders "—" if empty; the row simply omits the chip area. We will manually delete + recreate it during testing — no data migration script for one row.

**Rollback:** comment in the migration top —

```sql
-- ROLLBACK:
-- drop table if exists public.assigned_task_departments;
```

## RLS

Mirror the parent task's visibility — no new permission model.

```sql
alter table public.assigned_task_departments enable row level security;

create policy atd_select on public.assigned_task_departments
  for select to authenticated
  using (
    exists (
      select 1 from public.assigned_tasks t
      where t.id = task_id
        and (
          t.assignee_user_id     = auth.uid()
          or t.created_by_user_id = auth.uid()
          or public.current_user_is_admin()
        )
    )
  );

-- No insert/update/delete policy → only the security-definer RPC can write.
grant select on public.assigned_task_departments to authenticated;
grant all    on public.assigned_task_departments to service_role;
```

**Drift safety:** at implementation time, copy the predicate inside `exists(...)` 1:1 from the live `assigned_tasks_select` policy. An RLS test asserts a non-assignee / non-creator / non-admin can't read department rows.

## RPC change — `create_assigned_task`

Add `p_department_ids uuid[]` (required, non-empty). The function:

1. Validates `p_department_ids` is non-null and `array_length >= 1`; raises `EXCEPTION` otherwise.
2. Inserts the task as today.
3. Inserts `(new_task_id, unnest(p_department_ids))` into `assigned_task_departments` in the same transaction.
4. Returns the same shape as before (the new departments are fetched via the detail/list query, not the RPC return value).

Hooks: `useCreateAssignedTask` gets a `departmentIds: string[]` arg; type updated in the corresponding `mutate` payload.

## UI

### Row (Home column + Deal/Job tab)

```
┌─────────────────────────────────────────────────────────────┐
│ TEST — smoke task for MK  [Web Dev] [Hosting]   000017  │
│ Pindos Outdoor Gear · Christos Tsilis                       │
│ Created from test@test.gr to verify…             [Resolve]  │
└─────────────────────────────────────────────────────────────┘
```

- Whole row becomes a `<button type="button">` opening the detail modal.
- The source-code badge keeps linking to `/deals/:id` (or `/jobs/:id`); `e.stopPropagation()` on its `onClick`.
- The Resolve button keeps its current mutation; `e.stopPropagation()` on its `onClick`.
- Department chips: small, slate-100 background, ordered by `groups.position`. Max 2 visible inline; "+N" overflow chip if more than 2.

### Detail modal (`AssignedTaskDetailDialog`)

- Centered, ~520px wide, reuses the existing `Dialog` primitive (same family as `NewAssignedTaskDialog`).
- Sections in order: title → department chips → meta (status, creator, created_at) → description → "Client" divider → client name + industry → primary contact name + phone + email → footer with `Resolve` + `Open deal/job` actions.
- Read-only — no inline editing.
- `Resolve` reuses the existing mutation and closes the modal on success.
- `Open deal/job` reuses `sourceHref(task)` and uses `react-router-dom` `Link`.

### Create dialog (`NewAssignedTaskDialog`)

Add a `Departments *` block above the footer:

- Inline togglable chip list of all 9 groups, ordered by `groups.position`, labels from `display_names[locale]`.
- New state: `departmentIds: string[]`.
- Submit button disabled until `title.trim() && assigneeUserId && departmentIds.length >= 1`.

### Data fetching

- **New hook `useAssignedTaskDetail(taskId)`** — single query joining `assigned_tasks` → `clients` (name, industry, contact_first_name, contact_last_name, email, phone) → `assigned_task_departments(group_id, groups(code, display_names))`.
- **New hook `useGroupsList()`** — `select code, display_names, position from groups where archived = false order by position`. Reused in the create dialog and as the chip-label source for the rows.

## i18n

New keys in `home.json` (EN + EL) for at least:
- `assigned_tasks.detail_title` ("Task detail" / "Λεπτομέρειες εργασίας")
- `assigned_tasks.departments_label` ("Departments" / "Τμήματα")
- `assigned_tasks.client_section` ("Client" / "Πελάτης")
- `assigned_tasks.open_deal` / `assigned_tasks.open_job` (link labels)

## Testing (TDD, one commit per step)

| # | Step                                                                              | Test                                                                       |
|---|-----------------------------------------------------------------------------------|----------------------------------------------------------------------------|
| 1 | Migration: `assigned_task_departments` + RLS                                       | DB test: service-role inserts, anon select=0, assignee select returns rows |
| 2 | RPC: `create_assigned_task` rejects empty `p_department_ids` and writes atomically | RPC integration test: invalid → error; valid → both rows present           |
| 3 | Hook: `useCreateAssignedTask` passes `departmentIds`                               | Vitest with mocked supabase client — assert RPC payload                    |
| 4 | UI: `NewAssignedTaskDialog` chip list + disabled-until-≥1 logic                    | RTL test                                                                   |
| 5 | Hook: `useAssignedTaskDetail(taskId)` shape                                        | Vitest with mocked supabase client                                         |
| 6 | Component: `AssignedTaskDetailDialog` renders all sections + Resolve closes it     | RTL test                                                                   |
| 7 | Row update: chips, whole-row click opens modal, stopPropagation on badge + Resolve | RTL test on `AssignedTasksColumn` and `AssignedTasksTab`                   |

## Open questions / known limitations

- The detail modal is read-only in v1. If you want inline editing of title/description/departments later, that becomes a separate task (probably a follow-up "edit mode" toggle in the same modal).
- "Major client info" intentionally limited to name + industry + primary contact (name, phone, email). Website/city/additional contacts deferred unless explicitly requested.
- Existing 1 smoke task will be deleted + recreated during manual UAT rather than auto-backfilled.

## Changes / Revert (filled in during implementation)

- Migration: `supabase/migrations/<TIMESTAMP>_assigned_task_departments.sql` — `drop table public.assigned_task_departments` to undo.
- Function update: `create_assigned_task` — old definition kept inline in a `-- ROLLBACK:` comment block above the new one.
- Files touched: _to be appended per commit_.
- Commits: _to be appended per commit_ (squashed list at the end so `git revert <range>` is one command).
