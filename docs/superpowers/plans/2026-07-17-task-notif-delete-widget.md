# Task notif/delete/widget fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Notify assignees when personal tasks are delegated to them (in-app + email), notify all non-closer parties when a task fully closes, restrict delegated-task deletion to the creator, and make the home widget dual-resolve aware.

**Architecture:** Three small prod migrations (two trigger changes, one policy change) mirroring existing `assigned_tasks` patterns, plus two frontend changes (TaskDialog/useDeleteTask delete gate; AssignedTasksColumn switches to the shared `resolveAction()` helpers). No template, presenter, or routing changes — `internal_new_task` (kind `'user'`), the `task_assigned` presenter, and `readPath()` already support user tasks.

**Tech Stack:** Postgres (Supabase, RLS + plpgsql triggers), React + TypeScript, react-query, vitest.

**Spec:** `docs/superpowers/specs/2026-07-17-task-notif-delete-widget-design.md`

## Global Constraints

- Migrations go in `supabase/migrations/` with `20260717…` timestamps and carry rollback SQL in a header comment (verbatim previous bodies where replacing).
- DB verification uses the rolled-back DO-block harness on prod (impersonation via `request.jwt.claims`; final `raise exception` returns results AND rolls back). Prod DB writes only via migrations applied through MCP `apply_migration`.
- `vitest run <file>` per task; full `npx vitest run` + `npm run build` (tsc -b + eslint, zero warnings) before push. NOTE: vitest runs against PROD env — only run unit/component tests with mocked supabase.
- One commit per task, push directly to main at the end.
- Test users for harnesses: admin info@ `9499eb7d-cfce-4038-b13b-30c9be793199`, admin marios@ `fb61d5f7-f5be-4fb2-9951-50b6f4e6567c`, sales azazas@ `050611aa-7076-4d84-8984-5041f71e6bc2`, accounting emarketaki@ `139f2b2d-3915-4f3a-91d9-f221247d598e`, local_seo dtzouvaras@ `b73d8761-cbae-4ac8-a239-878d1f2151d8`. Deal `76eb2092-16e1-451e-b8d8-717ef87862ef`, dept group web_seo `5f4e088d-b030-4486-8937-9bfe4048d327`.

---

### Task 1: Migration — assignment notification + email for delegated user_tasks

**Files:**
- Create: `supabase/migrations/20260717100000_user_tasks_assign_notifs.sql`

**Interfaces:**
- Produces: triggers `user_tasks_notify_assignee`, `user_tasks_email_notify_new_task` on `public.user_tasks` (AFTER INSERT). Consumed by nothing else in this plan.

- [ ] **Step 1: Write the migration file**

```sql
-- Delegated personal-task creation notifies the assignee (in-app + email),
-- mirroring assigned_tasks_notify_assignee + email_notify_new_task.
-- Frontend needs no change: readPath() routes task_kind 'user_task' to
-- /tasks?open=user:<id>, and the internal_new_task email template already
-- branches on kind==='user'.
--
-- ROLLBACK:
--   drop trigger if exists user_tasks_notify_assignee on public.user_tasks;
--   drop function if exists public.user_tasks_notify_assignee();
--   drop trigger if exists user_tasks_email_notify_new_task on public.user_tasks;
--   drop function if exists public.user_tasks_email_notify_new_task();

create or replace function public.user_tasks_notify_assignee()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.created_by is null or new.created_by = new.user_id then
    return new;
  end if;
  insert into public.notifications (user_id, type, payload)
  values (
    new.user_id,
    'task_assigned',
    jsonb_build_object(
      'task_kind', 'user_task',
      'task_id', new.id,
      'parent_type', 'user_task',
      'parent_id', new.id,
      'author_id', new.created_by,
      'title', new.title
    )
  );
  return new;
end $$;

drop trigger if exists user_tasks_notify_assignee on public.user_tasks;
create trigger user_tasks_notify_assignee
after insert on public.user_tasks
for each row execute function public.user_tasks_notify_assignee();

create or replace function public.user_tasks_email_notify_new_task()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare assignee_email text;
begin
  if new.created_by is null or new.created_by = new.user_id then
    return new;
  end if;
  select email into assignee_email from public.profiles where user_id = new.user_id;
  if assignee_email is null or assignee_email = '' then return new; end if;
  insert into public.email_outbox (identity, to_email, template_key, data, dedupe_key)
  values ('internal', assignee_email, 'internal_new_task',
          jsonb_build_object(
            'title',   new.title,
            'task_id', new.id,
            'kind',    'user'
          ),
          'task:' || new.id);
  return new;
end $$;

drop trigger if exists user_tasks_email_notify_new_task on public.user_tasks;
create trigger user_tasks_email_notify_new_task
after insert on public.user_tasks
for each row execute function public.user_tasks_email_notify_new_task();
```

- [ ] **Step 2: Apply to prod** via MCP `apply_migration` (project `xujlrclyzxrvxszepquy`, name `user_tasks_assign_notifs`).

- [ ] **Step 3: Verify with rolled-back harness** (MCP `execute_sql`): as admin insert a delegated task for azazas → expect 1 `task_assigned` notification (payload task_kind `user_task`) + 1 `email_outbox` row (`internal_new_task`, `kind:'user'`, dedupe `task:<id>`, to `azazas@itdev.gr`); as azazas insert a self task (created_by = self) and one with created_by null → expect 0 notifications, 0 emails. Harness ends `raise exception` with results.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260717100000_user_tasks_assign_notifs.sql
git commit -m "feat(tasks): notify assignee (in-app + email) on delegated personal-task creation"
```

---

### Task 2: Migration — close notifications to all non-closer parties

**Files:**
- Create: `supabase/migrations/20260717110000_task_close_notify_parties.sql`

**Interfaces:**
- Consumes: existing triggers `user_tasks_notify_creator` (AFTER UPDATE OF completed_at) and `assigned_tasks_notify_creator` (AFTER UPDATE OF status) — bodies replaced, trigger definitions untouched.

- [ ] **Step 1: Write the migration file** — replace both function bodies; header carries the verbatim previous bodies (from the 07-17 audit dump) as rollback:

```sql
-- On the final close of a task, notify every party except the closer:
--  * creator  — when not null, not the assignee, and not the closer
--  * assignee — when not the closer (or the closer is unknown)
-- Covers: creator closes second -> assignee now notified; admin force-close ->
-- both parties notified; self tasks stay silent unless a third-party admin
-- closes them (then the owner is notified). The previous behavior (creator
-- notified when the assignee closes) is preserved.
--
-- ROLLBACK: restore the previous bodies, verbatim:
-- [paste of the pre-change user_tasks_notify_creator + assigned_tasks_notify_creator
--  bodies exactly as captured by pg_get_functiondef on 2026-07-17]

create or replace function public.user_tasks_notify_creator()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_actor uuid := coalesce(auth.uid(), new.user_id);
begin
  if new.completed_at is null or old.completed_at is not null then
    return new;
  end if;
  if new.created_by is not null
     and new.created_by <> new.user_id
     and new.created_by <> v_actor then
    insert into public.notifications (user_id, type, payload)
    values (new.created_by, 'task_resolved', jsonb_build_object(
      'task_kind', 'user_task',
      'task_id', new.id,
      'parent_type', 'user_task',
      'parent_id', new.id,
      'author_id', v_actor,
      'title', new.title));
  end if;
  if new.user_id <> v_actor then
    insert into public.notifications (user_id, type, payload)
    values (new.user_id, 'task_resolved', jsonb_build_object(
      'task_kind', 'user_task',
      'task_id', new.id,
      'parent_type', 'user_task',
      'parent_id', new.id,
      'author_id', v_actor,
      'title', new.title));
  end if;
  return new;
end $$;

create or replace function public.assigned_tasks_notify_creator()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_actor uuid;
  v_parent_type text;
  v_parent_id uuid;
  v_target_job_id uuid;
  v_payload jsonb;
begin
  if new.status <> 'resolved' or old.status = 'resolved' then return new; end if;
  v_actor := coalesce(new.resolved_by_user_id, auth.uid());
  if new.deal_id is not null then
    v_parent_type := 'deal'; v_parent_id := new.deal_id;
  else
    v_parent_type := 'job';  v_parent_id := new.job_id;
  end if;
  v_target_job_id := public.task_target_job_id(new.deal_id, new.job_id, new.department_group_id);
  v_payload := jsonb_build_object(
    'task_kind', 'assigned_task',
    'task_id', new.id,
    'parent_type', v_parent_type,
    'parent_id', v_parent_id,
    'author_id', v_actor,
    'title', new.title,
    'source_code', new.source_code,
    'target_job_id', v_target_job_id);
  if new.created_by_user_id is not null
     and new.created_by_user_id <> new.assignee_user_id
     and (v_actor is null or new.created_by_user_id <> v_actor) then
    insert into public.notifications (user_id, type, payload)
    values (new.created_by_user_id, 'task_resolved', v_payload);
  end if;
  if v_actor is null or new.assignee_user_id <> v_actor then
    insert into public.notifications (user_id, type, payload)
    values (new.assignee_user_id, 'task_resolved', v_payload);
  end if;
  return new;
end $$;
```

- [ ] **Step 2: Apply to prod** via MCP `apply_migration` (name `task_close_notify_parties`).

- [ ] **Step 3: Verify with rolled-back harness**, both tables, all orderings (expected `task_resolved` recipients):
  - assignee stamps first, creator closes → assignee notified, creator NOT.
  - creator stamps first, assignee closes → creator notified, assignee NOT.
  - admin (marios) force-closes a delegated task → BOTH parties notified, admin NOT.
  - self task resolved by owner → 0 notifications.
  - self task force-closed by admin → owner notified once.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260717110000_task_close_notify_parties.sql
git commit -m "feat(tasks): task_resolved goes to every non-closer party on final close"
```

---

### Task 3: Migration — delegated user_tasks deletable by creator only

**Files:**
- Create: `supabase/migrations/20260717120000_user_tasks_delete_creator_only.sql`

**Interfaces:**
- Produces: tightened `user_tasks_delete` policy. Task 4's UI gate must match this rule exactly.

- [ ] **Step 1: Write the migration file**

```sql
-- Assignees can no longer delete tasks delegated to them (deletion bypassed
-- dual-resolve). Creator keeps delete; assignee keeps delete on personal/self
-- tasks (created_by null or self). Admin unchanged (no admin branch existed).
--
-- ROLLBACK:
--   alter policy user_tasks_delete on public.user_tasks
--     using ((( select auth.uid()) = user_id) or (( select auth.uid()) = created_by));

alter policy user_tasks_delete on public.user_tasks
  using (
    (( select auth.uid()) = created_by)
    or (
      (( select auth.uid()) = user_id)
      and (created_by is null or created_by = user_id)
    )
  );
```

- [ ] **Step 2: Apply to prod** via MCP `apply_migration` (name `user_tasks_delete_creator_only`).

- [ ] **Step 3: Verify with rolled-back harness**: creator deletes delegated task → row gone; assignee delete on a delegated task → row remains; assignee deletes own self task (created_by=self and created_by null variants) → rows gone.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260717120000_user_tasks_delete_creator_only.sql
git commit -m "fix(tasks): delegated personal tasks deletable by creator only (RLS)"
```

---

### Task 4: Frontend — delete gate in TaskDialog + zero-row guard in useDeleteTask

**Files:**
- Modify: `src/features/home/hooks/useDeleteTask.ts` (the `useDeleteTask` mutation only)
- Modify: `src/features/home/TaskDialog.tsx` (Delete button visibility)
- Test: `src/features/home/TaskDialog.delete.test.tsx` (create), extend hook coverage there too

**Interfaces:**
- Consumes: Task 3's policy rule — UI predicate must be identical: `me === created_by || (me === user_id && (created_by == null || created_by === user_id))`.
- Produces: exported pure helper `canDeleteUserTask(task: Pick<UserTaskRow, 'user_id' | 'created_by'>, meId: string): boolean` in `src/features/home/taskDialogRules.ts` (co-located with the other dialog rules) so the gate is unit-testable.

- [ ] **Step 1: Write failing tests** — `TaskDialog.delete.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { canDeleteUserTask } from './taskDialogRules';

describe('canDeleteUserTask', () => {
  it('creator can delete a delegated task', () => {
    expect(canDeleteUserTask({ user_id: 'b', created_by: 'a' }, 'a')).toBe(true);
  });
  it('assignee cannot delete a task delegated to them', () => {
    expect(canDeleteUserTask({ user_id: 'b', created_by: 'a' }, 'b')).toBe(false);
  });
  it('owner can delete own self-created task', () => {
    expect(canDeleteUserTask({ user_id: 'a', created_by: 'a' }, 'a')).toBe(true);
  });
  it('owner can delete legacy personal task (created_by null)', () => {
    expect(canDeleteUserTask({ user_id: 'a', created_by: null }, 'a')).toBe(true);
  });
  it('third party cannot delete', () => {
    expect(canDeleteUserTask({ user_id: 'b', created_by: 'a' }, 'c')).toBe(false);
  });
});
```

Plus a component assertion (in the same file, following the mocking pattern of `TaskDialog.test.tsx`): rendering the dialog in edit mode as the assignee of a delegated task does NOT show the Delete button; as the creator it does.

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/features/home/TaskDialog.delete.test.tsx` → FAIL (`canDeleteUserTask` not exported).

- [ ] **Step 3: Implement**
  - `taskDialogRules.ts`:

```ts
/** Mirrors the user_tasks_delete RLS policy: the creator may delete; the
 *  assignee may delete only personal/self tasks (never ones delegated to them). */
export function canDeleteUserTask(
  task: { user_id: string; created_by: string | null },
  meId: string,
): boolean {
  if (!meId) return false;
  if (task.created_by === meId) return true;
  return task.user_id === meId && (task.created_by == null || task.created_by === task.user_id);
}
```

  - `TaskDialog.tsx`: `const canDelete = !!task && canDeleteUserTask(task, userId);` and change the footer condition `isEdit ? (…Delete…)` to `isEdit && canDelete ? (…Delete…)`.
  - `useDeleteTask.ts`: surface silent RLS blocks —

```ts
const { data, error } = await supabase.from('user_tasks').delete().eq('id', id).select('id');
if (error) throw new Error(error.message);
if (!data || data.length === 0) throw new Error('Task was not deleted (no permission).');
```

- [ ] **Step 4: Run tests** — `npx vitest run src/features/home/TaskDialog.delete.test.tsx src/features/home/TaskDialog.test.tsx` → PASS (fix any pre-existing TaskDialog tests that render edit mode without a deletable task).

- [ ] **Step 5: Commit**

```bash
git add src/features/home/taskDialogRules.ts src/features/home/TaskDialog.tsx src/features/home/hooks/useDeleteTask.ts src/features/home/TaskDialog.delete.test.tsx
git commit -m "fix(tasks): hide Delete from delegated assignees + surface zero-row deletes"
```

---

### Task 5: Frontend — home widget dual-resolve parity

**Files:**
- Modify: `src/features/assigned_tasks/AssignedTasksColumn.tsx` (`Row`, `PersonalRow`, call sites)
- Test: `src/features/assigned_tasks/AssignedTasksColumn.test.tsx` (extend)

**Interfaces:**
- Consumes: `resolveAction`, `awaitingLabelParty`, `DualResolveState` from `src/features/tasks/dualResolve.ts`; `useResolveTask`, `useUnresolveTask` from `src/features/tasks/hooks/useResolveTask.ts`; i18n keys `tasks_page.resolve|confirm_close|withdraw|awaiting_confirmation_nameless` from the `common` namespace (en+el already exist).
- Data: `useAssignedTasksOpen` / `useOpenUserTasks` already return the dual-resolve stamp columns — no hook changes.

- [ ] **Step 1: Write failing tests** — extend `AssignedTasksColumn.test.tsx` (reuse its existing mocks; authStore mock pattern: `useAuthStore: (sel) => sel({ isAdmin: false, user: { id: 'me' } })`):
  - assigned task where I'm the assignee and MY stamp is set (`assignee_resolved_at` non-null) → button labeled "Withdraw ✓" and an "Awaiting confirmation" badge.
  - assigned task where the OTHER side stamped (`creator_resolved_at` non-null, mine null) → button labeled "Confirm & close".
  - personal task delegated to me, no stamps → button labeled "Resolve"; clicking calls `resolve_task` (kind `user`).
  - assigned task where I'm neither party and not admin → no button (rows for such tasks appear only in the admin all-team view, but the gate must hold).

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/features/assigned_tasks/AssignedTasksColumn.test.tsx` → new cases FAIL.

- [ ] **Step 3: Implement** — in `Row` and `PersonalRow`, replace the `canResolve` prop with `meId: string` + `isAdmin: boolean` and derive:

```tsx
// Row (assigned):
const dual: DualResolveState = {
  creatorResolvedAt: task.creator_resolved_at,
  assigneeResolvedAt: task.assignee_resolved_at,
  creatorId: task.created_by_user_id,
  assigneeId: task.assignee_user_id,
  closed: task.status === 'resolved',
};
// PersonalRow (user):
const dual: DualResolveState = {
  creatorResolvedAt: task.creator_resolved_at,
  assigneeResolvedAt: task.assignee_resolved_at,
  creatorId: task.created_by,
  assigneeId: task.user_id,
  closed: task.completed_at != null,
};
const action = resolveAction(dual, meId || null, isAdmin);
const awaiting = awaitingLabelParty(dual);
const { t: c } = useTranslation('common');
const label =
  action === 'withdraw' ? c('tasks_page.withdraw')
  : action === 'confirm_close' ? c('tasks_page.confirm_close')
  : c('tasks_page.resolve');
```

Button rendered when `action != null`; `onClick`: `action === 'withdraw'` → `unresolve.mutate({ kind, id: task.id })`, else `resolve.mutate({ kind, id: task.id })` (kind `'assigned'` in Row, `'user'` in PersonalRow — PersonalRow switches from `useToggleTaskComplete` to `useResolveTask`/`useUnresolveTask`). Awaiting badge next to the title chips when `awaiting != null`:

```tsx
{awaiting && (
  <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
    {c('tasks_page.awaiting_confirmation_nameless')}
  </span>
)}
```

Call sites pass `meId={userId} isAdmin={isAdmin}` instead of `canResolve`.

- [ ] **Step 4: Run tests** — `npx vitest run src/features/assigned_tasks/AssignedTasksColumn.test.tsx` → PASS (update any existing cases asserting the old `canResolve` prop).

- [ ] **Step 5: Commit**

```bash
git add src/features/assigned_tasks/AssignedTasksColumn.tsx src/features/assigned_tasks/AssignedTasksColumn.test.tsx
git commit -m "feat(tasks): home widget is dual-resolve aware (withdraw/confirm labels + awaiting badge)"
```

---

### Task 6: Full verification + push

- [ ] **Step 1:** `npx vitest run` → all green.
- [ ] **Step 2:** `npm run build` → zero errors/warnings.
- [ ] **Step 3:** `git pull --rebase && git push` (watch for parallel owner commits).
- [ ] **Step 4:** Post-deploy prod smoke: create a delegated personal task from the UI (admin → a sales rep), confirm bell notification + email_outbox row, then delete the task as the creator; confirm the widget shows the new labels.
