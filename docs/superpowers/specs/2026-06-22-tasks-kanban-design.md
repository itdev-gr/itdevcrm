# Tasks Kanban + Resolved Archive — Design

Date: 2026-06-22
Status: Approved-pending-review
Area: `/tasks` page (`src/features/tasks/MyTasksPage.tsx`)

## Goal

Turn the `/tasks` page from a sorted list into a **kanban board** organised by urgency,
let every user also see **tasks they created for someone else**, add a **Resolved**
column, make resolving notify the task's creator, and add a separate **Resolved
archive** sub-page for full history.

## Background (what already exists)

- `/tasks` (`MyTasksPage.tsx`) renders a single sorted list unioning two tables:
  - `user_tasks` — personal/calendar tasks. Assignee = `user_id`, creator = `created_by`,
    done = `completed_at` is set. Has `importance`.
  - `assigned_tasks` — deal/job tasks. Assignee = `assignee_user_id`, creator =
    `created_by_user_id`, done = `status='resolved'` (trigger stamps `resolved_at` /
    `resolved_by_user_id`). Has `importance`, `department_group_id`, `deal_id`/`job_id`,
    `source_code`.
- `importance` values: `low | medium | high | urgent` (`src/features/tasks/importance.ts`,
  rank urgent→low).
- A **persistent in-app notification system** exists (`notifications` table + bell:
  `NotificationsBell.tsx`, `NotificationsColumn.tsx`, presenters in
  `notification-presenters.tsx`, realtime hook). Types include `task_assigned` and
  `task_resolved`.
- `assigned_tasks` **already** notifies the creator on resolve
  (`assigned_tasks_notify_creator()` trigger). `user_tasks` does **not** notify on complete.
- **RLS already supports creator visibility** on both tables — no RLS change needed:
  - `user_tasks_select`: `auth.uid() = user_id OR auth.uid() = created_by OR is_admin`.
  - `assigned_tasks_select`: `auth.uid() = assignee_user_id OR auth.uid() = created_by_user_id OR is_admin`.
  - Matching UPDATE policies allow the creator (and admin) to update too.
  - No department/board scoping on these policies.
- Drag-and-drop pattern to reuse: the sales kanban (`SalesKanbanPage/Column/Card.tsx`)
  using `@dnd-kit/core` (`DndContext`, `useDroppable` per column, `useDraggable` per card,
  `onDragEnd` handler, `DragOverlay`, `PointerSensor` 5px activation).

## Decisions (from brainstorming)

1. **Card movement** — drag-and-drop (reuse `@dnd-kit`). Existing resolve/complete buttons
   stay as a fallback.
2. **Delegated tasks** — single board with a `To me / By me / All` filter; delegated cards
   carry an `→ {assignee}` badge. Visibility is for **everyone**, not admin-gated.
3. **Resolved column** — recent only (~last 30 days).
4. **Notify on resolve** — in-app bell only (no email).
5. **Resolved archive** — a second view inside Tasks (tab) listing **all** tasks the current
   user has resolved, full history, read-only.
6. **Delegated cards are read-only on the board (v1)** — only the assignee resolves them;
   no re-prioritising tasks you delegated. (Future change, out of scope now.)

## Design

### A. Board layout

Five columns, left→right: **Urgent · High · Medium · Low · Resolved**.

- Open cards sit in their urgency column. Recently-resolved cards (≤30 days) sit in
  **Resolved**.
- Top controls:
  - Segmented filter **To me / By me / All**.
    - *To me* = current user is the assignee.
    - *By me* = current user is the creator and **not** the assignee (delegated).
    - *All* = union of both.
  - **All team** admin toggle (kept) — admins can view everyone's tasks.
- Card shows: title, urgency dot, source tag (deal/job `source_code`, or "Personal" for
  `user_tasks`), due date (when present), and for delegated cards an **`→ {assignee name}`**
  badge.
- A card is **draggable only when the current user is the assignee** (i.e. "mine to act
  on"). Delegated cards and (in All-team view) other people's cards are read-only.

### B. Drag interactions (`onDragEnd`)

For a draggable card dropped on a target column:

- **Urgency column → other urgency column**: update `importance` to the target column's value.
  - `user_tasks`: `update importance`. `assigned_tasks`: `update importance`.
- **→ Resolved**: resolve the card.
  - `user_tasks`: set `completed_at = now()`.
  - `assigned_tasks`: set `status = 'resolved'` (existing trigger stamps who/when + notifies
    creator).
- **Resolved → urgency column**: re-open at that urgency.
  - `user_tasks`: `completed_at = null`, `importance = target`.
  - `assigned_tasks`: `status = 'open'`, `importance = target` (trigger clears resolve stamps).

The resolve/complete **buttons** remain available on each card as a non-drag path and do the
same mutations.

### C. Data layer

A single board hook composes the card list from the two tables for the active scope
(assignee filter + admin all-team), producing a unified card model:

```
TaskCard = {
  key, kind: 'user' | 'assigned', id,
  title, importance, dueAt,
  assigneeId, assigneeName, creatorId,
  relation: 'mine' | 'delegated' | 'other',   // mine = assignee==me
  resolved: boolean, resolvedAt,
  sourceTag,                                   // source_code | 'Personal'
  link,                                        // deal/job link, or null for personal
}
```

Queries needed (RLS already permits all of these):

- **Open, to me** — existing: `user_tasks` `completed_at is null` & `user_id=me`;
  `assigned_tasks` `status='open'` & `assignee_user_id=me`.
- **Open, by me (delegated)** — new: `user_tasks` `completed_at is null` & `created_by=me`
  & `user_id<>me`; `assigned_tasks` `status='open'` & `created_by_user_id=me`
  & `assignee_user_id<>me`.
- **Recently resolved (≤30d)** for the Resolved column — scoped to the active filter:
  - To me: `user_tasks` `completed_at >= now()-30d` & `user_id=me`;
    `assigned_tasks` `status='resolved'` & `resolved_at >= now()-30d` & `assignee_user_id=me`.
  - By me: same windows but creator-side (`created_by=me` & `user_id<>me`, etc.).
- **All team (admin)** — drop the user filters (existing admin behaviour), keep the 30d
  window on resolved.

The existing `useOpenUserTasks` / `useAssignedTasksOpen` keep working for the home widget;
the board gets its own composing hook(s) so the home widget is untouched.

### D. Notify creator when a personal task is resolved

`assigned_tasks` already notifies its creator on resolve. Add the equivalent for
`user_tasks`:

- New migration: trigger `user_tasks_notify_creator()` — `AFTER UPDATE` on `user_tasks`,
  fires when `completed_at` goes `null → not null` **and** `created_by IS NOT NULL`
  **and** `created_by <> user_id` (suppress self-completion). Inserts a `notifications`
  row of type `task_resolved` for `created_by`:
  ```
  payload = {
    task_id: new.id,
    parent_type: 'user_task',
    parent_id: new.id,
    author_id: new.user_id,   -- the assignee who completed it
    title: new.title
  }
  ```
- Frontend: extend `readPath()` in `notification-presenters.tsx` to map
  `parent_type='user_task'` → `/tasks`, so the bell notification is clickable. The existing
  `task_resolved` presenter already only needs `title`, so it renders correctly for both
  variants.

### E. Resolved archive sub-page (user request)

Inside `/tasks`, a tab strip: **[ Board ] [ Resolved archive ]** (in-page view switch, one
sidebar entry — no new route).

- Archive lists **every task the current user has resolved** (full history, both kinds),
  newest first, read-only:
  - `user_tasks`: `user_id=me` & `completed_at is not null` (the owner completes their own).
  - `assigned_tasks`: `resolved_by_user_id=me`.
- Columns/fields: title, source tag, urgency, resolved date, link back to the deal/job.
- Paginated (e.g. 100 with "load more") to stay bounded.
- Scope = tasks **I** resolved — not delegated tasks others closed (those arrive via the bell).

## Components / files (anticipated)

- `src/features/tasks/MyTasksPage.tsx` — becomes the board host + tab switch.
- New: `TasksKanbanBoard.tsx`, `TasksKanbanColumn.tsx`, `TaskKanbanCard.tsx`
  (modelled on the sales kanban trio).
- New: `ResolvedArchive.tsx` (the archive tab).
- New board data hook(s) under `src/features/tasks/hooks/`.
- New: `src/features/tasks/taskCard.ts` (unified card mapping + column bucketing helpers) —
  pure, unit-testable.
- New mutation hooks (or reuse existing): set-importance, resolve/complete, reopen for each
  table.
- Edit: `src/features/notifications/notification-presenters.tsx` (`readPath` adds
  `user_task`).
- New migration: `user_tasks_notify_creator` trigger.

## Testing

- Unit (pure): `taskCard.ts` — mapping both row types to the unified model; column
  bucketing (urgency vs resolved); `relation` classification (mine/delegated/other); the
  30-day resolved window predicate.
- Unit: drag-resolution logic — given (card kind, source column, target column) → the
  intended mutation (change-importance / resolve / reopen / blocked-because-delegated).
- Manual smoke (prod-like): create a task for a colleague → it shows under "By me" with the
  badge and is read-only; colleague resolves it → creator gets a bell notification; drag a
  personal task across urgency columns and into Resolved; archive tab lists resolved tasks.

## Non-goals (v1)

- Email on resolve.
- Editing/re-prioritising/resolving delegated tasks from the creator's board.
- Bulk actions, search/sort beyond the archive's basic ordering.
- Changing the two-table model or merging `user_tasks` + `assigned_tasks`.

## Changes / Revert

New, additive, low-risk. To revert:

- **DB**: drop trigger `user_tasks_notify_creator` and its function (rollback SQL included in
  the migration). No data migration, no column changes — nothing to back up.
- **Frontend**: revert the `MyTasksPage.tsx` rework + new components/hooks and the one-line
  `readPath` addition. The home Assigned-to-me widget and `useOpenUserTasks` /
  `useAssignedTasksOpen` are untouched, so reverting the board does not affect Home.
- No changes to existing RLS, existing notification types, or the email path.
