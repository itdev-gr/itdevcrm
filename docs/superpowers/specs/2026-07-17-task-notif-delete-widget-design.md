# Task system: assignment/close notifications, delete rights, widget dual-resolve parity

**Date:** 2026-07-17
**Source:** Full combinational task-system audit (2026-07-17, all-roles×all-roles, rolled-back prod harnesses — all green). Owner picked findings #1, #2, #3, #5 to fix.

## Problems

1. **Delegated personal tasks are silent.** Creating a `user_tasks` row for someone else produces no notification and no email to the assignee (`assigned_tasks` has both: `task_assigned` notif + `internal_new_task` email). The assignee only discovers the task by visiting /tasks or the home widget.
2. **Close-notification asymmetry.** When the second resolve stamp closes a task, only the *creator* gets `task_resolved`, and only when they weren't the closer. The assignee never learns the task fully closed when the creator (or an admin force-close) lands the final stamp.
3. **Assignee can delete a delegated personal task.** `user_tasks_delete` policy is `uid = user_id OR uid = created_by`, so an assignee can delete a task delegated to them — bypassing dual-resolve. (`assigned_tasks` correctly restricts delete to creator/admin.) The TaskDialog Delete button shows on every edit, and `useDeleteTask` doesn't check the deleted row count, so an RLS block would look like success.
4. **Home widget resolve drift.** `AssignedTasksColumn` hides Resolve from the delegating creator (`canResolve = isAdmin || assignee`) and is not dual-resolve aware — always a plain "Resolve" with no withdraw/confirm/awaiting affordance, unlike the board and detail dialogs.

## Decisions (owner-confirmed 2026-07-17)

- #1: **in-app + email** (full parity with assigned tasks).
- #2: **notify all parties except the closer** (unified rule; covers admin force-close → both parties notified).
- #3: **creator-only delete** for delegated tasks; assignee keeps delete on own personal/self tasks; admin unchanged (still cannot delete others' personal tasks).
- #5: **widget only** — no board-drag change; admin force-close stays dialog-only.

## Design

### Fix 1 — migration `user_tasks_assign_notifs` (DB only)

Two AFTER-INSERT triggers on `user_tasks`, mirroring the `assigned_tasks` pair. Both skip when `created_by IS NULL OR created_by = user_id`.

- `user_tasks_notify_assignee()` (secdef, `search_path=public`): insert `notifications(user_id=NEW.user_id, type='task_assigned', payload={task_kind:'user_task', task_id, parent_type:'user_task', parent_id:NEW.id, author_id:NEW.created_by, title})`.
  - No frontend change needed: `readPath()` already routes `task_kind='user_task'` → `/tasks?open=user:<id>`; the `task_assigned` presenter renders title (source_code absent → chip simply omitted).
- `user_tasks_email_notify_new_task()`: look up assignee email from `profiles`; insert `email_outbox('internal', email, 'internal_new_task', {title, task_id, kind:'user'}, dedupe 'task:<id>')`.
  - No template change: `internal_new_task` in `supabase/functions/send-email/templates.ts` already branches on `kind==='user'` and builds `/tasks?open=user:<id>`. The existing outbox pulse handles instant send.

### Fix 2 — migration `task_close_notify_parties` (DB only)

Replace the bodies of `user_tasks_notify_creator()` and `assigned_tasks_notify_creator()` (trigger names and timing unchanged). New unified rule on the open→terminal transition:

- actor: `user_tasks` → `coalesce(auth.uid(), NEW.user_id)`; `assigned_tasks` → `coalesce(NEW.resolved_by_user_id, auth.uid())`.
- notify **creator** with `task_resolved` when `created_by IS NOT NULL AND created_by <> assignee AND created_by <> actor`.
- notify **assignee** with `task_resolved` when `assignee <> actor` (or actor unknown).
- payloads keep the existing shape (+`task_kind`); assigned keeps `source_code`/`target_job_id`.
- Net effect: creator closes second → assignee notified; admin force-close → both notified; self tasks silent unless a third-party admin closes them (then the owner is notified). Previous behavior (creator notified when assignee closes) is preserved.
- Migration header carries the verbatim previous function bodies for rollback.

### Fix 3 — migration `user_tasks_delete_creator_only` + UI

- Policy: `alter policy user_tasks_delete` to
  `uid = created_by OR (uid = user_id AND (created_by IS NULL OR created_by = user_id))`.
- `TaskDialog.tsx`: show the Delete button only when the current user may delete (me == created_by, or me == user_id and the task is personal/self-created). Needs the edit task's `created_by` + `user_id` (already on the row).
- `useDeleteTask.ts`: add `.select('id')` and throw when zero rows come back, so a silent RLS block surfaces as an error instead of fake success.

### Fix 5 — `AssignedTasksColumn` dual-resolve parity (UI only)

- `Row` (assigned) + `PersonalRow` (user) switch their ad-hoc gates to the shared `resolveAction(dualState, meId, isAdmin)` from `src/features/tasks/dualResolve.ts`:
  - button visible whenever `resolveAction` returns an action (creator now gets one; admin force-close preserved);
  - label per action: resolve / confirm_close ("Confirm & close") / withdraw — reusing the board/dialog i18n keys;
  - resolve/confirm → `useResolveTask`, withdraw → `useUnresolveTask` (same hooks as the board);
  - "awaiting other side" badge via `awaitingLabelParty` where a side is already stamped.
- The widget's data hooks (`useOpenUserTasks`, `useAssignedTasksOpen`) must select the dual-resolve stamp columns (`creator_resolved_at/by`, `assignee_resolved_at/by`) if they don't already.
- No board/drag changes.

## Testing

- DB fixes verified with the proven rolled-back DO-block harness on prod (impersonation via `request.jwt.claims`; `raise exception` carries results and forces rollback): assignment notif+email fire for delegated only; close notifs hit exactly the non-closer parties in every ordering (assignee-first, creator-first, admin force-close, self); delete matrix (creator ok, assignee-on-delegated blocked, assignee-on-own ok).
- Frontend: vitest unit tests for the TaskDialog delete gate, useDeleteTask zero-row throw, and widget resolveAction wiring/labels; full suite + `npm run build` (strict) before push.

## Rollback

Each fix is one atomic commit; each migration header contains its inverse SQL (drop triggers/functions, restore verbatim bodies, restore old policy). UI commits revert cleanly with `git revert`.
