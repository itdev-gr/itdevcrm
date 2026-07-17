# Task Lifecycle v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Half-resolved dual-resolve tasks leave the stamper's board (viewer-relative Resolved column + widget), can be un-stamped by drag, and auto-close after 7 idle days with in-app notifications — AI summary keeps firing via the existing open→terminal triggers.

**Architecture:** Pure board logic changes in `taskCard.ts`/`dualResolve.ts` (viewer side encoded by the existing `relation` field), a `withdraw` branch in the board-actions mutation (`unresolve_task` RPC + importance write), client-side filters on the home widget lists, one new notification type in the presenter, and one SQL migration adding `auto_close_stale_tasks()` + a nightly pg_cron job. No changes to the RPCs, guard triggers, or summary pipeline.

**Tech Stack:** React+TS, @tanstack/react-query, Vitest + Testing Library, Supabase (Postgres, pg_cron), plpgsql.

**Spec:** `docs/superpowers/specs/2026-07-17-task-lifecycle-v2-design.md`

## Global Constraints

- `npm run build` must pass (tsc -b + eslint `--max-warnings=0`).
- Do NOT run the full vitest suite (parts hit production); run only the test files named per step.
- One commit per task; push and DB apply happen only in Task 6 (main session).
- No changes to `resolve_task`/`unresolve_task` RPCs, terminal-guard triggers, or the summary outbox/edge fn.
- The migration file is AUTHORED in Task 5 but APPLIED to prod only in Task 6 by the controller.
- Notification presenters use hardcoded English text (existing pattern) — no i18n keys for them.
- Auto-close activity rule (verbatim from spec): candidates have exactly one side stamped and `greatest(updated_at, coalesce(max(task_comments.created_at), updated_at)) < now() - interval '7 days'`.

---

### Task 1: taskCard.ts — viewerSideStamped, viewer-relative columnOf, withdraw drag action

**Files:**
- Modify: `src/features/tasks/taskCard.ts` (columnOf ~line 128, DragAction ~line 154, resolveDrag ~line 161)
- Test: `src/features/tasks/taskCard.test.ts` (append)

**Interfaces:**
- Consumes: existing `TaskCard` type (fields `relation`, `resolved`, `creatorResolvedAt`, `assigneeResolvedAt`, `importance`), `isDraggable`.
- Produces: `viewerSideStamped(card: TaskCard): boolean`; `columnOf` unchanged signature, new precedence replies > terminal > viewer-stamped > importance; `DragAction` union gains `{ type: 'withdraw'; importance: ImportanceCode }`; `resolveDrag` returns `withdraw` for open viewer-stamped cards dropped on an importance column and `noop` when they're dropped on `resolved`. Task 2 consumes the `withdraw` action; Task 3 consumes the same viewer-side idea via `sideStampedFor` (defined in Task 3).

- [ ] **Step 1: Write the failing tests**

Append to `src/features/tasks/taskCard.test.ts` (use this self-contained fixture; do not reuse the file's existing fixtures so the block stands alone):

```ts
import { viewerSideStamped } from './taskCard';

const vCard = (over: Partial<TaskCard>): TaskCard => ({
  key: 'assigned:t1', kind: 'assigned', id: 't1', title: 'T', importance: 'medium',
  relation: 'mine', resolved: false, assigneeId: 'A', creatorId: 'C',
  createdAtIso: null, dueAt: null, resolvedAt: null, startedAtIso: null,
  sourceCode: null, link: null, notes: null, clientName: null, leadName: null,
  creatorResolvedAt: null, assigneeResolvedAt: null, summary: null,
  ...over,
});

describe('viewerSideStamped', () => {
  it('assignee viewer with assignee stamp → true', () => {
    expect(viewerSideStamped(vCard({ relation: 'mine', assigneeResolvedAt: '2026-07-01T00:00:00Z' }))).toBe(true);
  });
  it('assignee viewer with only the creator stamp → false', () => {
    expect(viewerSideStamped(vCard({ relation: 'mine', creatorResolvedAt: '2026-07-01T00:00:00Z' }))).toBe(false);
  });
  it('creator viewer with creator stamp → true', () => {
    expect(viewerSideStamped(vCard({ relation: 'delegated', creatorResolvedAt: '2026-07-01T00:00:00Z' }))).toBe(true);
  });
  it('non-party viewer → false', () => {
    expect(viewerSideStamped(vCard({ relation: 'other', creatorResolvedAt: '2026-07-01T00:00:00Z', assigneeResolvedAt: '2026-07-01T00:00:00Z' }))).toBe(false);
  });
});

describe('columnOf — viewer-relative resolved', () => {
  const stamped = vCard({ relation: 'mine', assigneeResolvedAt: '2026-07-01T00:00:00Z', importance: 'high' });
  it('open card with MY side stamped → resolved column', () => {
    expect(columnOf(stamped)).toBe('resolved');
  });
  it('unread replies still win over my stamp', () => {
    expect(columnOf(stamped, true)).toBe('replies');
  });
  it('open card with only the OTHER side stamped → stays on importance', () => {
    expect(columnOf(vCard({ relation: 'mine', creatorResolvedAt: '2026-07-01T00:00:00Z', importance: 'high' }))).toBe('high');
  });
});

describe('resolveDrag — withdraw', () => {
  const stamped = vCard({ relation: 'mine', assigneeResolvedAt: '2026-07-01T00:00:00Z', importance: 'medium' });
  it('viewer-stamped open card dropped on an importance column → withdraw with that importance', () => {
    expect(resolveDrag(stamped, 'high')).toEqual({ type: 'withdraw', importance: 'high' });
  });
  it('viewer-stamped open card dropped on resolved → noop (already there for me)', () => {
    expect(resolveDrag(stamped, 'resolved')).toEqual({ type: 'noop' });
  });
  it('terminal card dropped on an importance column still reopens', () => {
    expect(resolveDrag(vCard({ resolved: true, importance: 'medium' }), 'high')).toEqual({ type: 'reopen', importance: 'high' });
  });
});
```

(`columnOf`, `resolveDrag`, and `TaskCard` are already imported by the existing file — extend its import line only with `viewerSideStamped`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/tasks/taskCard.test.ts`
Expected: FAIL — `viewerSideStamped` not exported; the columnOf/resolveDrag cases fail on current behavior.

- [ ] **Step 3: Implement**

In `src/features/tasks/taskCard.ts`, add above `columnOf`:

```ts
/** True when the viewer's own side of the dual-resolve is stamped. The card's
 *  `relation` already encodes the viewer ('mine' = assignee, 'delegated' =
 *  creator); 'other' (admin observer) has no side. */
export function viewerSideStamped(card: TaskCard): boolean {
  if (card.relation === 'mine') return card.assigneeResolvedAt != null;
  if (card.relation === 'delegated') return card.creatorResolvedAt != null;
  return false;
}
```

Replace `columnOf`'s body:

```ts
export function columnOf(card: TaskCard, hasUnreadReplies = false): ColumnKey {
  if (card.resolved) return 'resolved';
  if (hasUnreadReplies) return 'replies';
  // Viewer-relative: my side is stamped → finished FOR ME, park it in Resolved
  // while it awaits the other party. Replies win above, so the other party's
  // comment still resurfaces the (still-open) card.
  if (viewerSideStamped(card)) return 'resolved';
  return card.importance;
}
```

(Terminal stays first — the base board's own test 'resolved wins over replies'
defines that; replies precede the viewer stamp so requirement #2 holds for
half-resolved cards. As built in commit d5e1f51.)

Extend `DragAction`:

```ts
export type DragAction =
  | { type: 'noop' }
  | { type: 'set-importance'; importance: ImportanceCode }
  | { type: 'resolve' }
  | { type: 'withdraw'; importance: ImportanceCode }
  | { type: 'reopen'; importance: ImportanceCode };
```

Replace `resolveDrag`:

```ts
/** Decide what dropping `card` onto column `target` should do. */
export function resolveDrag(card: TaskCard, target: ColumnKey): DragAction {
  if (target === 'replies') return { type: 'noop' };
  if (!isDraggable(card)) return { type: 'noop' };
  if (target === 'resolved') {
    // Terminal, or my side already stamped → already sits in Resolved for me.
    if (card.resolved || viewerSideStamped(card)) return { type: 'noop' };
    return { type: 'resolve' };
  }
  if (card.resolved) return { type: 'reopen', importance: target };
  // Open card leaving MY Resolved column = withdraw my stamp (+ new priority).
  if (viewerSideStamped(card)) return { type: 'withdraw', importance: target };
  if (card.importance === target) return { type: 'noop' };
  return { type: 'set-importance', importance: target };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/tasks/taskCard.test.ts`
Expected: PASS (all pre-existing tests in the file must stay green too).

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/taskCard.ts src/features/tasks/taskCard.test.ts
git commit -m "feat(tasks): viewer-relative Resolved column + withdraw drag action

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Board actions — execute the withdraw drag

**Files:**
- Modify: `src/features/tasks/hooks/useTaskBoardActions.ts`
- Create: `src/features/tasks/hooks/useTaskBoardActions.test.tsx`

**Interfaces:**
- Consumes: `DragAction` with `withdraw` (Task 1); `unresolve_task(p_kind, p_task_id)` RPC (existing).
- Produces: the board mutation handles `{type:'withdraw'}` by calling `unresolve_task` then a direct `importance` update; returns `null` (no popup). Board wiring (`TasksKanbanBoard.fire`) needs no change — its popup only fires for `action.type === 'resolve'`.

- [ ] **Step 1: Write the failing test**

Create `src/features/tasks/hooks/useTaskBoardActions.test.tsx`:

```tsx
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';

const rpc = vi.fn();
const eq = vi.fn();
const update = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ update }));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: (...a: unknown[]) => from(...a),
  },
}));
vi.mock('@/lib/sentry/captureMutation', () => ({
  captureMutation: (_domain: string, _op: string, fn: unknown) => fn,
}));

import { useTaskBoardActions } from './useTaskBoardActions';
import type { TaskCard } from '../taskCard';

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useTaskBoardActions — withdraw', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpc.mockResolvedValue({ data: null, error: null });
    eq.mockResolvedValue({ error: null });
  });

  it('assigned card: unresolve_task RPC then importance update', async () => {
    const card = { kind: 'assigned', id: 't1' } as TaskCard;
    const { result } = renderHook(() => useTaskBoardActions(), { wrapper });
    result.current.mutate({ card, action: { type: 'withdraw', importance: 'high' } });
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('unresolve_task', { p_kind: 'assigned', p_task_id: 't1' }),
    );
    await waitFor(() => expect(update).toHaveBeenCalledWith({ importance: 'high' }));
    expect(from).toHaveBeenCalledWith('assigned_tasks');
  });

  it('user card routes the importance update to user_tasks', async () => {
    const card = { kind: 'user', id: 'u1' } as TaskCard;
    const { result } = renderHook(() => useTaskBoardActions(), { wrapper });
    result.current.mutate({ card, action: { type: 'withdraw', importance: 'low' } });
    await waitFor(() => expect(from).toHaveBeenCalledWith('user_tasks'));
    expect(rpc).toHaveBeenCalledWith('unresolve_task', { p_kind: 'user', p_task_id: 'u1' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/tasks/hooks/useTaskBoardActions.test.tsx`
Expected: FAIL — the hook has no `withdraw` branch (TypeScript may also error until the branch exists; that's the failure signal).

- [ ] **Step 3: Implement**

In `src/features/tasks/hooks/useTaskBoardActions.ts`, insert after the `resolve` branch (which `return`s) and before the `card.kind === 'user'` block:

```ts
      if (action.type === 'withdraw') {
        // Un-stamp my side via the RPC (direct stamp writes are blocked), then
        // land the card on the chosen priority column — importance writes are
        // not guarded, so that part stays a direct per-table update.
        const { error: rpcError } = await supabase.rpc('unresolve_task' as never, {
          p_kind: card.kind,
          p_task_id: card.id,
        } as never);
        if (rpcError) throw new Error(rpcError.message);
        const table = card.kind === 'user' ? 'user_tasks' : 'assigned_tasks';
        const { error } = await supabase.from(table).update({ importance: action.importance }).eq('id', card.id);
        if (error) throw new Error(error.message);
        return null;
      }
```

Note: if `exactOptionalPropertyTypes` complains about the shared `.update({ importance })` across tables, split into two branches mirroring the existing set-importance/reopen pattern (each branch typed with that table's Update type). Also extend the hook's doc comment: withdraw goes RPC-then-importance.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/tasks/hooks/useTaskBoardActions.test.tsx src/features/tasks/taskCard.test.ts src/features/tasks/TasksKanbanBoard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/hooks/useTaskBoardActions.ts src/features/tasks/hooks/useTaskBoardActions.test.tsx
git commit -m "feat(tasks): board executes withdraw drag via unresolve_task

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Home widget hides my-side-stamped rows

**Files:**
- Modify: `src/features/tasks/dualResolve.ts` (new helper)
- Modify: `src/features/tasks/dualResolve.test.ts` (append)
- Modify: `src/features/assigned_tasks/AssignedTasksColumn.tsx` (filter both lists)
- Test: `src/features/assigned_tasks/AssignedTasksColumn.test.tsx` (append)

**Interfaces:**
- Consumes: `DualResolveState` (existing).
- Produces: `sideStampedFor(s: DualResolveState, uid: string | null): boolean` — true when `uid`'s own side is stamped on a still-open task. The widget filters rows with it; the board does NOT use it (board uses `viewerSideStamped` from Task 1).

- [ ] **Step 1: Write the failing helper tests**

Append to `src/features/tasks/dualResolve.test.ts` (extend the existing './dualResolve' import with `sideStampedFor`):

```ts
describe('sideStampedFor', () => {
  const base = {
    creatorResolvedAt: null, assigneeResolvedAt: null,
    creatorId: 'C', assigneeId: 'A', closed: false,
  };
  it('assignee with own stamp on an open task → true', () => {
    expect(sideStampedFor({ ...base, assigneeResolvedAt: '2026-07-01T00:00:00Z' }, 'A')).toBe(true);
  });
  it('creator when only the assignee stamped → false', () => {
    expect(sideStampedFor({ ...base, assigneeResolvedAt: '2026-07-01T00:00:00Z' }, 'C')).toBe(false);
  });
  it('closed task → false (terminal rows are not widget rows)', () => {
    expect(sideStampedFor({ ...base, assigneeResolvedAt: '2026-07-01T00:00:00Z', closed: true }, 'A')).toBe(false);
  });
  it('non-party or missing uid → false', () => {
    expect(sideStampedFor({ ...base, creatorResolvedAt: '2026-07-01T00:00:00Z' }, 'X')).toBe(false);
    expect(sideStampedFor(base, null)).toBe(false);
  });
});
```

Run: `npx vitest run src/features/tasks/dualResolve.test.ts` — expect FAIL (not exported).

- [ ] **Step 2: Implement the helper**

Append to `src/features/tasks/dualResolve.ts`:

```ts
/**
 * True when `uid`'s own side is stamped while the task is still open — i.e.
 * finished FOR THIS USER, awaiting the other party. Open-task widgets hide
 * such rows for that user (the board's Resolved column shows them instead).
 * Assignee is checked first, mirroring `relationOf`.
 */
export function sideStampedFor(s: DualResolveState, uid: string | null): boolean {
  if (s.closed || !uid) return false;
  if (uid === s.assigneeId) return !!s.assigneeResolvedAt;
  if (uid === s.creatorId) return !!s.creatorResolvedAt;
  return false;
}
```

Run: `npx vitest run src/features/tasks/dualResolve.test.ts` — expect PASS.

- [ ] **Step 3: Filter the widget lists (failing component test first)**

Append to `src/features/assigned_tasks/AssignedTasksColumn.test.tsx` a test following that file's existing render harness and row fixtures (adapt fixture/mock names to the file — the assertion is what matters):

```tsx
it('hides an open assigned task whose viewer side is already stamped', () => {
  // Fixture: an assigned_tasks row where the viewer is the assignee and
  // assignee_resolved_at is set (status still 'open'). Render the column as
  // that viewer and assert the row's title is NOT in the document, while an
  // unstamped control row IS.
});
```

Fill the body concretely using the file's existing mocked-hook setup (`useAssignedTasksOpen` / `useOpenUserTasks` mocks): one stamped row (`assignee_resolved_at: '2026-07-01T00:00:00Z'`, viewer = assignee), one unstamped row; `expect(screen.queryByText(<stamped title>)).not.toBeInTheDocument()` and `expect(screen.getByText(<control title>)).toBeInTheDocument()`. Run the file — the new test must FAIL before the component change.

Then in `src/features/assigned_tasks/AssignedTasksColumn.tsx`: where the `useAssignedTasksOpen` rows and the `useOpenUserTasks` rows are prepared for rendering, filter each list with `sideStampedFor`, building the state exactly as the existing `Row` component does:

```ts
// assigned_tasks rows
.filter((task) => !sideStampedFor({
  creatorResolvedAt: task.creator_resolved_at,
  assigneeResolvedAt: task.assignee_resolved_at,
  creatorId: task.created_by_user_id,
  assigneeId: task.assignee_user_id,
  closed: task.status === 'resolved',
}, meId))

// user_tasks rows (personal/delegated): assignee = user_id, creator = created_by
.filter((task) => !sideStampedFor({
  creatorResolvedAt: task.creator_resolved_at ?? null,
  assigneeResolvedAt: task.assignee_resolved_at ?? null,
  creatorId: task.created_by ?? null,
  assigneeId: task.user_id,
  closed: task.completed_at != null,
}, meId))
```

(If the user-task rows' select does not include the stamp columns, extend the hook's `select` to include `creator_resolved_at, assignee_resolved_at` — check `useOpenUserTasks.ts`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/assigned_tasks/AssignedTasksColumn.test.tsx src/features/tasks/dualResolve.test.ts`
Expected: PASS (pre-existing tests stay green).

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/dualResolve.ts src/features/tasks/dualResolve.test.ts src/features/assigned_tasks/AssignedTasksColumn.tsx src/features/assigned_tasks/AssignedTasksColumn.test.tsx
git commit -m "feat(tasks): home widget hides tasks the viewer already resolved

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

(Include `src/features/home/hooks/useOpenUserTasks.ts` in the add list if its select needed the stamp columns.)

---

### Task 4: `task_auto_closed` notification presenter

**Files:**
- Modify: `src/features/notifications/notification-presenters.tsx` (NotifIcon switch ~line 68; content block near the `task_confirm_pending` block ~line 169)
- Test: `src/features/notifications/notification-presenters.test.ts` (append)

**Interfaces:**
- Consumes: payload `{task_kind: 'user_task'|'assigned_task', task_id, title}` (inserted by Task 5's SQL). Deep-linking needs NO change — `readPath()` already routes any payload with `task_id`/`task_kind`.
- Produces: bell rendering for type `task_auto_closed`. Do NOT add it to `toastableTypes` (no toast).

- [ ] **Step 1: Write the failing test**

Append to `src/features/notifications/notification-presenters.test.ts`, following the file's existing render/assert pattern for presenter cases (adapt harness names):

```ts
it('task_auto_closed renders the auto-close copy with the task title', () => {
  // render CompactNotificationContent with
  //   type: 'task_auto_closed',
  //   payload: { task_kind: 'assigned_task', task_id: 't1', title: 'Fix logo' }
  // assert the output contains /closed automatically/i and 'Fix logo'
});
```

Fill the body concretely per the file's existing tests. Run: `npx vitest run src/features/notifications/notification-presenters.test.ts` — expect FAIL (falls through to the default presenter).

- [ ] **Step 2: Implement**

In `NotifIcon`'s switch add (next to the other task cases):

```tsx
    case 'task_auto_closed':
      return <Clock className={cn(iconClass, 'text-muted-foreground')} />;
```

(`Clock` — add to the existing lucide-react import if absent.)

In `CompactNotificationContent`, next to the `task_confirm_pending` block, add:

```tsx
  if (type === 'task_auto_closed') {
    const title = readString(payload, 'title');
    return (
      <>
        <p className={cn('min-w-0', titleClass)}>
          Task closed automatically after 7 days of inactivity
          {title && (
            <>
              {' '}&mdash; &ldquo;<span className="font-semibold">{title}</span>&rdquo;
            </>
          )}
        </p>
        <p className="mt-0.5 text-[10px] text-muted-foreground">{when}</p>
      </>
    );
  }
```

(Reuse the block's existing `when`/`titleClass` locals exactly as `task_confirm_pending` does.)

- [ ] **Step 3: Run tests to verify they pass**

Run: `npx vitest run src/features/notifications/notification-presenters.test.ts src/features/notifications/toastableTypes.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/features/notifications/notification-presenters.tsx src/features/notifications/notification-presenters.test.ts
git commit -m "feat(notifications): render task_auto_closed (7-day inactivity close)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Migration — `auto_close_stale_tasks()` + nightly cron (file only)

**Files:**
- Create: `supabase/migrations/20260717150000_task_auto_close.sql`

**Interfaces:**
- Consumes: `tasks_guard_terminal` GUC contract (`app.task_resolve_rpc = '1'`, txn-local); `enqueue_task_summary` AFTER-UPDATE triggers (fire automatically on the open→terminal transition — do not touch them); `notifications(user_id, type, payload)`.
- Produces: `public.auto_close_stale_tasks()` and cron job `auto_close_stale_tasks` at `35 2 * * *`. Task 6 applies and first-runs it.

- [ ] **Step 1: Write the migration file exactly**

```sql
-- Auto-close half-resolved tasks with no activity for 7 days (owner decision
-- 2026-07-17): exactly one side stamped + updated_at AND task comments quiet
-- for 7 days → stamp the missing side (its *_resolved_by stays NULL = closed
-- automatically), close the task, notify both parties in-app. The existing
-- enqueue_task_summary AFTER-UPDATE triggers fire on the open→terminal
-- transition, so the AI summary pipeline runs unchanged.

create or replace function public.auto_close_stale_tasks()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cutoff timestamptz := now() - interval '7 days';
begin
  -- Same txn-local GUC the resolve/unresolve RPCs set; lets the terminal
  -- guard triggers accept these UPDATEs.
  perform set_config('app.task_resolve_rpc', '1', true);

  with cand as (
    select t.id, t.title, t.user_id as assignee_id, t.created_by as creator_id
    from public.user_tasks t
    where t.completed_at is null
      and (t.creator_resolved_at is null) <> (t.assignee_resolved_at is null)
      and greatest(
            t.updated_at,
            coalesce((select max(c.created_at) from public.task_comments c
                      where c.user_task_id = t.id), t.updated_at)
          ) < v_cutoff
  ), closed as (
    update public.user_tasks t
    set creator_resolved_at  = coalesce(t.creator_resolved_at,  now()),
        assignee_resolved_at = coalesce(t.assignee_resolved_at, now()),
        completed_at = now()
    from cand
    where t.id = cand.id
    returning t.id, t.title, cand.assignee_id, cand.creator_id
  )
  insert into public.notifications (user_id, type, payload)
  select p.uid, 'task_auto_closed',
         jsonb_build_object('task_kind', 'user_task', 'task_id', c.id, 'title', c.title)
  from closed c
  cross join lateral (
    select distinct u.uid
    from unnest(array[c.assignee_id, c.creator_id]) as u(uid)
    where u.uid is not null
  ) p;

  with cand as (
    select t.id, t.title, t.assignee_user_id as assignee_id, t.created_by_user_id as creator_id
    from public.assigned_tasks t
    where t.status = 'open'
      and (t.creator_resolved_at is null) <> (t.assignee_resolved_at is null)
      and greatest(
            t.updated_at,
            coalesce((select max(c.created_at) from public.task_comments c
                      where c.assigned_task_id = t.id), t.updated_at)
          ) < v_cutoff
  ), closed as (
    update public.assigned_tasks t
    set creator_resolved_at  = coalesce(t.creator_resolved_at,  now()),
        assignee_resolved_at = coalesce(t.assignee_resolved_at, now()),
        status = 'resolved',
        resolved_at = now()
    from cand
    where t.id = cand.id
    returning t.id, t.title, cand.assignee_id, cand.creator_id
  )
  insert into public.notifications (user_id, type, payload)
  select p.uid, 'task_auto_closed',
         jsonb_build_object('task_kind', 'assigned_task', 'task_id', c.id, 'title', c.title)
  from closed c
  cross join lateral (
    select distinct u.uid
    from unnest(array[c.assignee_id, c.creator_id]) as u(uid)
    where u.uid is not null
  ) p;
end $$;

-- Nightly/cron-only helper: no client role may call it (grant-boundary rule).
revoke all on function public.auto_close_stale_tasks() from public, anon, authenticated;

select cron.schedule(
  'auto_close_stale_tasks',
  '35 2 * * *',
  'select public.auto_close_stale_tasks();'
);

-- Rollback:
--   select cron.unschedule('auto_close_stale_tasks');
--   drop function if exists public.auto_close_stale_tasks();
```

- [ ] **Step 2: Sanity-check the SQL locally (no DB)**

Re-read the file checking: dollar-quoting closes; the two CTE pipelines differ only in table/columns/terminal-write; `revoke` present; cron command is a plain quoted string (no nested `$$`).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260717150000_task_auto_close.sql
git commit -m "feat(tasks): auto_close_stale_tasks migration + nightly cron (file only)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: MAIN SESSION — apply, verify, ship, backfill

(Controller runs this; not a subagent task.)

- [ ] Apply `supabase/migrations/20260717150000_task_auto_close.sql` to prod (`apply_migration`, project `xujlrclyzxrvxszepquy`).
- [ ] Verify: function exists, `cron.job` has `auto_close_stale_tasks` @ `35 2 * * *`.
- [ ] Dry-run candidates (both tables) with the SAME predicate as the function; show the owner the list (count + titles + idle days) before any manual run.
- [ ] `npm run build` + `npx vitest run` on ALL test files named in Tasks 1-4. Push to main.
- [ ] After owner sees the dry-run list: `select public.auto_close_stale_tasks();` once, then verify — closed counts match candidates, notifications rows exist, `task_summary_outbox` gained rows (drain runs within 10 min).
- [ ] Update ledger + memory.

---

## Revert

- Frontend: `git revert` the four feature commits.
- DB: `select cron.unschedule('auto_close_stale_tasks'); drop function if exists public.auto_close_stale_tasks();` — auto-closed tasks can be reopened from the UI (terminal→open remains allowed); notification rows are inert.
