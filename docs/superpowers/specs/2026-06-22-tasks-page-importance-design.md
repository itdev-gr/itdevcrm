# Tasks Page + Task Importance — Design

**Date:** 2026-06-22
**Status:** Approved (verbal), pending implementation plan

## Goal

1. Add a **Tasks** item to the sidebar, directly under **Home**, that shows every open task assigned to the current user — both personal/calendar tasks and deal/job tasks — in one list, ordered by importance.
2. Add a **required Importance** field (Low / Medium / High / Urgent) to both task-creation forms.
3. Backfill all existing tasks to **Low**.

## Scope decisions (locked with the user)

- **Page scope:** Both task types — `user_tasks` (personal/calendar) **and** `assigned_tasks` (deal/job), i.e. the same union as the Home "assigned to me" widget.
- **Importance on:** Both creation forms (`TaskDialog` for personal, `NewAssignedTaskDialog` for deal/job).
- **Page actions:** View **and** complete/resolve inline (reuse the Home widget's mutations).
- **Ordering:** Importance first — Urgent → High → Medium → Low — then the existing intra-group order.
- **Existing rows:** all backfilled to Low.

## Existing system (from code map)

- **`user_tasks`** (personal/calendar): `user_id` (assignee), `created_by`, `title`, `notes`, `due_at`, `completed_at` (null = open). No status/priority column. RLS: select/insert/update where `auth.uid() ∈ {user_id, created_by}` or admin. Fetched open via `useOpenUserTasks` (`select('*')`, `completed_at is null`, order `due_at asc`). Created via `TaskDialog` → `useUpsertTask` (direct insert/update). Completed by setting `completed_at`.
- **`assigned_tasks`** (deal/job): `assignee_user_id`, `created_by_user_id`, `department_group_id`, `title`, `description`, `deal_id`/`job_id`, `client_id`+`source_code` (trigger-filled), `status` ('open'|'resolved' CHECK), `resolved_at`/`resolved_by_user_id` (trigger). RLS: select where `auth.uid() ∈ {assignee_user_id, created_by_user_id}` or admin. Fetched open via `useAssignedTasksOpen` (explicit SELECT incl. client + department relations, `status = 'open'`, order `created_at desc`). Created via `NewAssignedTaskDialog` → `useCreateAssignedTask` (direct insert). Resolved via the existing resolve mutation used by the widget.
- **Home widget** `AssignedTasksColumn` unions both (`personalTasks` then `assignedTasks`), has an admin "show all team" toggle that nullifies the assignee filter.
- **Sidebar** `src/components/layout/Sidebar.tsx` (`SidebarNav`): plain `NavLink`s; Home at the top. `nav.*` keys in `common.json` (en/el). Routes in `src/app/router.tsx`.
- No priority/importance concept exists anywhere yet.

## Data model

One additive migration adds the same column to **both** tables:

```sql
alter table public.user_tasks
  add column importance text not null default 'low'
  check (importance in ('low','medium','high','urgent'));

alter table public.assigned_tasks
  add column importance text not null default 'low'
  check (importance in ('low','medium','high','urgent'));
```

- `ADD COLUMN … NOT NULL DEFAULT 'low'` sets every existing row to `'low'` atomically → satisfies the backfill requirement; no separate UPDATE needed.
- Stored as lowercase **codes**; UI renders i18n labels.
- **RLS:** unchanged — policies are row-level, not column-level; the new column is covered automatically.
- **Decision:** CHECK constraint (matches the existing `assigned_tasks.status` pattern) rather than a Postgres ENUM type, which is harder to alter later.
- **Rollback:** `alter table public.user_tasks drop column importance;` + same for `assigned_tasks`.

## The Tasks page

- **Route:** `/tasks` (inside the authenticated layout). **Component:** `src/features/tasks/MyTasksPage.tsx`. Visible to all logged-in users (everyone can have tasks) — no role guard.
- **Data:** reuse `useOpenUserTasks` + `useAssignedTasksOpen`. Add `importance` to the explicit SELECT in `useAssignedTasksOpen` (harmless to the widget that also uses it); `useOpenUserTasks` already selects `*`.
- **Set shown:** open/active tasks only (personal `completed_at is null`, assigned `status='open'`). Completed/resolved are out of scope for v1 (matches the widget).
- **Ordering:** primary = importance rank (urgent=0, high=1, medium=2, low=3, ascending); secondary, within an importance bucket, personal tasks first (by `due_at asc`) then deal/job tasks (by `created_at desc`) — mirrors the widget's intra-group order.
- **Row content:** title; an **importance badge** (low = gray/muted, medium = blue, high = amber, urgent = red); existing metadata (personal: due date + "Overdue"/Personal badge; assigned: department chip + source code + client name + description); inline **Complete** (personal) / **Resolve** (assigned) button reusing the existing mutations, shown when the user can act.
- **Admin "show all team" toggle:** reuse the widget's pattern (admin nullifies the assignee filter to see the whole team's open tasks).
- **Empty state:** "No tasks assigned to you."

## Create forms

Add a **required** Importance `<select>` to both dialogs:

- **`TaskDialog`** (personal): new select after the existing fields; options Low/Medium/High/Urgent; **no pre-selected value** (placeholder "Select importance…"). Submit stays disabled until chosen — same required pattern as the existing required fields. `useUpsertTask` payload gains `importance`.
- **`NewAssignedTaskDialog`** (deal/job): same required select; label marked with the red asterisk like the existing `department` field. `useCreateAssignedTask` payload gains `importance`.
- Both selects share one small presentational component / option list so labels and ordering stay consistent.

## Sidebar + i18n

- **Sidebar:** add a `NavLink to="/tasks"` directly under Home in `SidebarNav`, lucide `ListChecks` icon, label `t('nav.tasks')`. No guard.
- **Router:** register `/tasks` → `MyTasksPage` in `src/app/router.tsx`, following the existing lazy-route pattern.
- **i18n:** add `nav.tasks` to `common.json` (en: "Tasks", el: "Εργασίες"). Add a small `tasks` namespace (`tasks.json` en/el) for: page title, empty state, the four importance labels (`importance.low/medium/high/urgent`), the "Select importance…" placeholder, and the admin "show all" toggle label (or reuse the widget's existing key).

## Out of scope (v1)

- Showing completed/resolved tasks on the Tasks page (open-only for now).
- Importance badge on the Home widget (page-only; can add later).
- Editing importance after creation from the Tasks page (edit still happens in the existing dialogs).
- Filtering/searching the Tasks list.

## Changes / Revert

- **DB:** one additive migration (two `ADD COLUMN` statements). Rollback = two `DROP COLUMN`. Applied to prod via Supabase Management API after the code is ready.
- **Code:** atomic commits — migration, hooks/types, page + route + sidebar, both forms, i18n. Each reverts cleanly with `git revert`.
