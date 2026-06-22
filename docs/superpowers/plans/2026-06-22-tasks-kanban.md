# Tasks Kanban + Resolved Archive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/tasks` into a kanban board grouped by urgency with a Resolved column, show every user the tasks they created for others, notify a personal task's creator on completion, and add a Resolved-archive sub-tab.

**Architecture:** A pure module (`taskCard.ts`) maps both task tables to one `TaskCard` model and decides every drag outcome; thin React-Query hooks fetch/mutate; a `@dnd-kit` board (cloned from the sales kanban) renders columns. One DB trigger mirrors the existing `assigned_tasks` resolve-notify for `user_tasks`. No change to the two-table model, existing RLS, or the Home widget.

**Tech Stack:** React, TypeScript, React-Query, `@dnd-kit/core`, Tailwind, Supabase/Postgres, Vitest, react-i18next.

---

## Spec

See `docs/superpowers/specs/2026-06-22-tasks-kanban-design.md`. Key facts verified in code:

- `/tasks` = `src/features/tasks/MyTasksPage.tsx` (named export; router uses `lazyPage(() => import('@/features/tasks/MyTasksPage'), 'MyTasksPage')` — keep the named export).
- `user_tasks`: assignee `user_id`, creator `created_by`, done = `completed_at` set, `importance`, `due_at`.
- `assigned_tasks`: assignee `assignee_user_id`, creator `created_by_user_id`, done = `status='resolved'` (trigger stamps `resolved_at`/`resolved_by_user_id`), `importance`, `source_code`, `deal_id`/`job_id`.
- RLS already lets creators **and** admins `SELECT`/`UPDATE` both tables — no RLS change needed.
- `assigned_tasks` already notifies its creator on resolve (`assigned_tasks_notify_creator`). `user_tasks` does not — Task 13 adds it.
- Tests: Vitest, colocated `*.test.ts(x)`, run with `npm run test:run`.

## File map

- Create `src/features/tasks/taskCard.ts` — pure model + mappers + filter + drag resolution.
- Create `src/features/tasks/taskCard.test.ts`.
- Modify `src/features/notifications/notification-presenters.tsx` — `readPath` handles `user_task`.
- Create `src/features/notifications/notification-presenters.test.ts`.
- Modify `src/lib/queryKeys.ts` — board + archive keys.
- Modify `src/features/assigned_tasks/hooks/useAssignedTasksOpen.ts` — export the SELECT string.
- Create `src/features/tasks/hooks/useTaskBoardData.ts`.
- Create `src/features/tasks/hooks/useTaskBoardActions.ts`.
- Create `src/features/tasks/hooks/useResolvedArchive.ts` (+ pure `mergeArchiveEntries`).
- Create `src/features/tasks/hooks/useResolvedArchive.test.ts`.
- Create `src/features/tasks/TaskKanbanCard.tsx`.
- Create `src/features/tasks/TasksKanbanColumn.tsx`.
- Create `src/features/tasks/TasksKanbanBoard.tsx` (+ test).
- Create `src/features/tasks/ResolvedArchive.tsx`.
- Rewrite `src/features/tasks/MyTasksPage.tsx` (host with tabs) + rewrite `MyTasksPage.test.tsx`.
- Modify `src/i18n/locales/en/common.json` + `src/i18n/locales/el/common.json`.
- Create `supabase/migrations/20260622280000_user_tasks_notify_creator.sql`.

---

### Task 1: Pure task-card model (`taskCard.ts`)

**Files:**
- Create: `src/features/tasks/taskCard.ts`
- Test: `src/features/tasks/taskCard.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/features/tasks/taskCard.test.ts
import { describe, it, expect } from 'vitest';
import {
  relationOf, userTaskToCard, assignedTaskToCard, columnOf, isDraggable,
  buildBoardCards, matchesFilter, resolveDrag, BOARD_COLUMNS, type TaskCard,
} from './taskCard';

const me = 'me';
const userRow = (o: Partial<Record<string, unknown>> = {}) => ({
  id: 'u1', title: 'P', user_id: me, created_by: me, completed_at: null,
  due_at: '2026-07-01T10:00:00Z', importance: 'low', ...o,
}) as never;
const assignedRow = (o: Partial<Record<string, unknown>> = {}) => ({
  id: 'a1', title: 'A', assignee_user_id: me, created_by_user_id: me, status: 'open',
  resolved_at: null, importance: 'high', source_code: 'D-1', deal_id: 'd1', job_id: null, ...o,
}) as never;

describe('taskCard', () => {
  it('classifies relation: mine / delegated / other', () => {
    expect(relationOf(me, 'x', me)).toBe('mine');
    expect(relationOf('x', me, me)).toBe('delegated');
    expect(relationOf('x', 'y', me)).toBe('other');
  });

  it('maps a user task to a card', () => {
    const c = userTaskToCard(userRow({ user_id: 'x' }), me);
    expect(c).toMatchObject({ kind: 'user', id: 'u1', importance: 'low', relation: 'delegated', resolved: false, link: null, sourceCode: null, key: 'user:u1' });
  });

  it('maps an assigned task to a card with a deal link', () => {
    const c = assignedTaskToCard(assignedRow(), me);
    expect(c).toMatchObject({ kind: 'assigned', relation: 'mine', link: '/deals/d1', sourceCode: 'D-1', key: 'assigned:a1' });
  });

  it('maps an assigned job task link', () => {
    const c = assignedTaskToCard(assignedRow({ deal_id: null, job_id: 'j1' }), me);
    expect(c.link).toBe('/jobs/j1');
  });

  it('columnOf returns importance when open, resolved when done', () => {
    expect(columnOf(userTaskToCard(userRow(), me))).toBe('low');
    expect(columnOf(userTaskToCard(userRow({ completed_at: '2026-07-02T00:00:00Z' }), me))).toBe('resolved');
    expect(columnOf(assignedTaskToCard(assignedRow({ status: 'resolved' }), me))).toBe('resolved');
  });

  it('isDraggable only for my own cards', () => {
    expect(isDraggable(assignedTaskToCard(assignedRow(), me))).toBe(true);
    expect(isDraggable(assignedTaskToCard(assignedRow({ assignee_user_id: 'x' }), me))).toBe(false);
  });

  it('matchesFilter: to_me / by_me / all', () => {
    const mine = assignedTaskToCard(assignedRow(), me);
    const delegated = assignedTaskToCard(assignedRow({ assignee_user_id: 'x', created_by_user_id: me }), me);
    const other = assignedTaskToCard(assignedRow({ assignee_user_id: 'x', created_by_user_id: 'y' }), me);
    expect(matchesFilter(mine, 'to_me')).toBe(true);
    expect(matchesFilter(delegated, 'to_me')).toBe(false);
    expect(matchesFilter(delegated, 'by_me')).toBe(true);
    expect(matchesFilter(other, 'all')).toBe(true);
    expect(matchesFilter(other, 'to_me')).toBe(false);
  });

  it('buildBoardCards unions both tables', () => {
    const cards = buildBoardCards([userRow()], [assignedRow()], me);
    expect(cards.map((c) => c.key).sort()).toEqual(['assigned:a1', 'user:u1']);
  });

  it('exposes the five columns urgent→resolved', () => {
    expect(BOARD_COLUMNS).toEqual(['urgent', 'high', 'medium', 'low', 'resolved']);
  });

  describe('resolveDrag', () => {
    const mine = (o = {}) => assignedTaskToCard(assignedRow(o), me) as TaskCard;
    it('noop for non-draggable cards', () => {
      expect(resolveDrag(mine({ assignee_user_id: 'x' }), 'urgent')).toEqual({ type: 'noop' });
    });
    it('open card dropped on Resolved → resolve', () => {
      expect(resolveDrag(mine(), 'resolved')).toEqual({ type: 'resolve' });
    });
    it('open card dropped on a different urgency → set-importance', () => {
      expect(resolveDrag(mine({ importance: 'high' }), 'urgent')).toEqual({ type: 'set-importance', importance: 'urgent' });
    });
    it('open card dropped on its own column → noop', () => {
      expect(resolveDrag(mine({ importance: 'high' }), 'high')).toEqual({ type: 'noop' });
    });
    it('resolved card dropped on an urgency → reopen at that urgency', () => {
      expect(resolveDrag(mine({ status: 'resolved', importance: 'low' }), 'high')).toEqual({ type: 'reopen', importance: 'high' });
    });
    it('resolved card dropped on Resolved → noop', () => {
      expect(resolveDrag(mine({ status: 'resolved' }), 'resolved')).toEqual({ type: 'noop' });
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/features/tasks/taskCard.test.ts`
Expected: FAIL — `Cannot find module './taskCard'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/features/tasks/taskCard.ts
import { importanceOf, type ImportanceCode } from './importance';
import type { UserTaskRow } from '@/features/home/hooks/useUserTasks';
import type { AssignedTaskRow } from '@/features/assigned_tasks/hooks/useAssignedTasksOpen';

export type TaskRelation = 'mine' | 'delegated' | 'other';
export type ColumnKey = ImportanceCode | 'resolved';
export type BoardFilter = 'to_me' | 'by_me' | 'all';

/** Left→right column order on the board. */
export const BOARD_COLUMNS: ColumnKey[] = ['urgent', 'high', 'medium', 'low', 'resolved'];

export type TaskCard = {
  key: string;            // 'user:<id>' | 'assigned:<id>'
  kind: 'user' | 'assigned';
  id: string;
  title: string;
  importance: ImportanceCode;
  relation: TaskRelation; // mine = I'm the assignee
  resolved: boolean;
  assigneeId: string;
  creatorId: string | null;
  dueAt: string | null;
  resolvedAt: string | null;
  sourceCode: string | null;
  link: string | null;    // deal/job link, or null for personal
};

export function relationOf(assigneeId: string, creatorId: string | null, meId: string): TaskRelation {
  if (assigneeId === meId) return 'mine';
  if (creatorId && creatorId === meId) return 'delegated';
  return 'other';
}

export function userTaskToCard(row: UserTaskRow, meId: string): TaskCard {
  const creatorId = row.created_by ?? null;
  return {
    key: `user:${row.id}`,
    kind: 'user',
    id: row.id,
    title: row.title,
    importance: importanceOf(row),
    relation: relationOf(row.user_id, creatorId, meId),
    resolved: row.completed_at != null,
    assigneeId: row.user_id,
    creatorId,
    dueAt: row.due_at ?? null,
    resolvedAt: row.completed_at ?? null,
    sourceCode: null,
    link: null,
  };
}

export function assignedTaskToCard(row: AssignedTaskRow, meId: string): TaskCard {
  const link = row.deal_id ? `/deals/${row.deal_id}` : row.job_id ? `/jobs/${row.job_id}` : null;
  return {
    key: `assigned:${row.id}`,
    kind: 'assigned',
    id: row.id,
    title: row.title,
    importance: importanceOf(row),
    relation: relationOf(row.assignee_user_id, row.created_by_user_id, meId),
    resolved: row.status === 'resolved',
    assigneeId: row.assignee_user_id,
    creatorId: row.created_by_user_id,
    dueAt: null,
    resolvedAt: row.resolved_at ?? null,
    sourceCode: row.source_code,
    link,
  };
}

export function columnOf(card: TaskCard): ColumnKey {
  return card.resolved ? 'resolved' : card.importance;
}

/** Only tasks where I'm the assignee can be moved/resolved from my board. */
export function isDraggable(card: TaskCard): boolean {
  return card.relation === 'mine';
}

export function buildBoardCards(userRows: UserTaskRow[], assignedRows: AssignedTaskRow[], meId: string): TaskCard[] {
  return [
    ...userRows.map((r) => userTaskToCard(r, meId)),
    ...assignedRows.map((r) => assignedTaskToCard(r, meId)),
  ];
}

export function matchesFilter(card: TaskCard, filter: BoardFilter): boolean {
  if (filter === 'to_me') return card.relation === 'mine';
  if (filter === 'by_me') return card.relation === 'delegated';
  return true;
}

export type DragAction =
  | { type: 'noop' }
  | { type: 'set-importance'; importance: ImportanceCode }
  | { type: 'resolve' }
  | { type: 'reopen'; importance: ImportanceCode };

/** Decide what dropping `card` onto column `target` should do. */
export function resolveDrag(card: TaskCard, target: ColumnKey): DragAction {
  if (!isDraggable(card)) return { type: 'noop' };
  if (target === 'resolved') {
    return card.resolved ? { type: 'noop' } : { type: 'resolve' };
  }
  if (card.resolved) return { type: 'reopen', importance: target };
  if (card.importance === target) return { type: 'noop' };
  return { type: 'set-importance', importance: target };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/features/tasks/taskCard.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/taskCard.ts src/features/tasks/taskCard.test.ts
git commit -m "feat(tasks): pure task-card model, relation + drag resolution"
```

---

### Task 2: Make the `task_resolved` bell notification clickable for personal tasks

**Files:**
- Modify: `src/features/notifications/notification-presenters.tsx:7-21` (`readPath`)
- Test: `src/features/notifications/notification-presenters.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/features/notifications/notification-presenters.test.ts
import { describe, it, expect } from 'vitest';
import { readPath } from './notification-presenters';

describe('readPath', () => {
  it('maps existing parent types', () => {
    expect(readPath('deal', 'd1')).toBe('/deals/d1');
    expect(readPath('job', 'j1')).toBe('/jobs/j1');
  });
  it('maps user_task to the tasks page', () => {
    expect(readPath('user_task', 'u1')).toBe('/tasks');
  });
  it('returns null for a non-string id', () => {
    expect(readPath('deal', null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/features/notifications/notification-presenters.test.ts`
Expected: FAIL — `readPath('user_task', 'u1')` returns `null`, expected `/tasks`.

- [ ] **Step 3: Add the `user_task` case**

In `src/features/notifications/notification-presenters.tsx`, inside `readPath`, add a case before `default`:

```ts
    case 'job':
      return `/jobs/${parentId}`;
    case 'user_task':
      return '/tasks';
    default:
      return null;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/features/notifications/notification-presenters.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/notifications/notification-presenters.tsx src/features/notifications/notification-presenters.test.ts
git commit -m "feat(notifications): route user_task resolved notifications to /tasks"
```

---

### Task 3: Query keys + export the assigned-task SELECT

**Files:**
- Modify: `src/lib/queryKeys.ts`
- Modify: `src/features/assigned_tasks/hooks/useAssignedTasksOpen.ts:32`

- [ ] **Step 1: Add query keys**

In `src/lib/queryKeys.ts`, add inside the object (after the `openUserTasks` entry, line 47):

```ts
  tasksBoardUser: (scope: string, cutoff: string) =>
    ['user-tasks', 'board', scope, cutoff] as const,
  tasksBoardAssigned: (scope: string, cutoff: string) =>
    ['assigned-tasks', 'board', scope, cutoff] as const,
  tasksArchive: (meId: string, limit: number) =>
    ['tasks', 'archive', meId, limit] as const,
```

- [ ] **Step 2: Export the SELECT string for reuse**

In `src/features/assigned_tasks/hooks/useAssignedTasksOpen.ts`, change line 32 from `const SELECT = \`` to:

```ts
export const ASSIGNED_TASK_SELECT = `
  id, title, description,
  deal_id, job_id, client_id, source_code,
  assignee_user_id, created_by_user_id,
  status, resolved_at, resolved_by_user_id, created_at, importance,
  department_group_id,
  client:client_id ( id, name ),
  department:department_group_id ( id, code, display_names, position )
`;
```

Then update its sole use on line 49 from `.select(SELECT)` to `.select(ASSIGNED_TASK_SELECT)`.

- [ ] **Step 3: Verify nothing broke**

Run: `npm run typecheck`
Expected: PASS (no type errors).

- [ ] **Step 4: Commit**

```bash
git add src/lib/queryKeys.ts src/features/assigned_tasks/hooks/useAssignedTasksOpen.ts
git commit -m "chore(tasks): board/archive query keys + export assigned-task select"
```

---

### Task 4: Board data hook (`useTaskBoardData`)

**Files:**
- Create: `src/features/tasks/hooks/useTaskBoardData.ts`

Fetches open + recently-resolved rows from both tables for the current scope. RLS already limits non-admins to their own (assignee or creator) rows; the explicit `.or` keeps admin "All team" off by default.

- [ ] **Step 1: Write the hook**

```ts
// src/features/tasks/hooks/useTaskBoardData.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { UserTaskRow } from '@/features/home/hooks/useUserTasks';
import { ASSIGNED_TASK_SELECT, type AssignedTaskRow } from '@/features/assigned_tasks/hooks/useAssignedTasksOpen';

/** ISO timestamp `days` before now. Call outside render (lazy state init). */
export function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

export function useTaskBoardData(params: { meId: string; allTeam: boolean; cutoffIso: string }) {
  const { meId, allTeam, cutoffIso } = params;
  const scope = allTeam ? 'all' : meId;

  const userTasks = useQuery<UserTaskRow[]>({
    queryKey: queryKeys.tasksBoardUser(scope, cutoffIso),
    queryFn: async () => {
      let q = supabase.from('user_tasks').select('*');
      if (!allTeam) q = q.or(`user_id.eq.${meId},created_by.eq.${meId}`);
      // open, or resolved within the window
      q = q.or(`completed_at.is.null,completed_at.gte.${cutoffIso}`);
      const { data, error } = await q.order('due_at', { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as UserTaskRow[];
    },
  });

  const assignedTasks = useQuery<AssignedTaskRow[]>({
    queryKey: queryKeys.tasksBoardAssigned(scope, cutoffIso),
    queryFn: async () => {
      let q = supabase.from('assigned_tasks').select(ASSIGNED_TASK_SELECT);
      if (!allTeam) q = q.or(`assignee_user_id.eq.${meId},created_by_user_id.eq.${meId}`);
      q = q.or(`status.eq.open,and(status.eq.resolved,resolved_at.gte.${cutoffIso})`);
      const { data, error } = await q.order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as AssignedTaskRow[];
    },
  });

  return {
    userRows: userTasks.data ?? [],
    assignedRows: assignedTasks.data ?? [],
    isLoading: userTasks.isLoading || assignedTasks.isLoading,
  };
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npm run typecheck`
Expected: PASS. (No bespoke unit test — query construction is exercised by Task 9's board test via mock and by manual smoke in Task 14. The pure mapping it feeds is covered by Task 1.)

- [ ] **Step 3: Commit**

```bash
git add src/features/tasks/hooks/useTaskBoardData.ts
git commit -m "feat(tasks): board data hook (open + recently-resolved, both tables)"
```

---

### Task 5: Board action mutation hook (`useTaskBoardActions`)

**Files:**
- Create: `src/features/tasks/hooks/useTaskBoardActions.ts`

- [ ] **Step 1: Write the hook**

```ts
// src/features/tasks/hooks/useTaskBoardActions.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { captureMutation } from '@/lib/sentry/captureMutation';
import type { Database } from '@/types/supabase';
import type { TaskCard, DragAction } from '../taskCard';

type Vars = { card: TaskCard; action: DragAction };
type UserUpdate = Database['public']['Tables']['user_tasks']['Update'];
type AssignedUpdate = Database['public']['Tables']['assigned_tasks']['Update'];

/** Apply a drag/button action to the underlying table. The decision lives in
 *  resolveDrag (pure); this only executes the resulting patch. Each table is
 *  updated in its own branch so the patch keeps that table's Update type
 *  (a cross-table union breaks under exactOptionalPropertyTypes). */
export function useTaskBoardActions() {
  const qc = useQueryClient();
  return useMutation<void, Error, Vars>({
    mutationFn: captureMutation<Vars, void>('task_board', 'apply', async ({ card, action }) => {
      if (action.type === 'noop') return;
      if (card.kind === 'user') {
        const patch: UserUpdate =
          action.type === 'set-importance'
            ? { importance: action.importance }
            : action.type === 'resolve'
              ? { completed_at: new Date().toISOString() }
              : { completed_at: null, importance: action.importance };
        const { error } = await supabase.from('user_tasks').update(patch).eq('id', card.id);
        if (error) throw new Error(error.message);
      } else {
        const patch: AssignedUpdate =
          action.type === 'set-importance'
            ? { importance: action.importance }
            : action.type === 'resolve'
              ? { status: 'resolved' }
              : { status: 'open', importance: action.importance };
        const { error } = await supabase.from('assigned_tasks').update(patch).eq('id', card.id);
        if (error) throw new Error(error.message);
      }
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['user-tasks'] });
      void qc.invalidateQueries({ queryKey: ['assigned-tasks'] });
      void qc.invalidateQueries({ queryKey: ['tasks'] }); // archive
    },
  });
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npm run typecheck`
Expected: PASS. (Behavior exercised by Task 9's board test, which mocks this hook and asserts `mutate` is called with the right `{card, action}`.)

- [ ] **Step 3: Commit**

```bash
git add src/features/tasks/hooks/useTaskBoardActions.ts
git commit -m "feat(tasks): board action mutation (set-importance / resolve / reopen)"
```

---

### Task 6: Resolved-archive hook + pure merge

**Files:**
- Create: `src/features/tasks/hooks/useResolvedArchive.ts`
- Test: `src/features/tasks/hooks/useResolvedArchive.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/features/tasks/hooks/useResolvedArchive.test.ts
import { describe, it, expect } from 'vitest';
import { mergeArchiveEntries } from './useResolvedArchive';

describe('mergeArchiveEntries', () => {
  const u = [{ id: 'u1', title: 'P', importance: 'low', completed_at: '2026-06-10T00:00:00Z' }];
  const a = [
    { id: 'a1', title: 'A', importance: 'high', resolved_at: '2026-06-12T00:00:00Z', deal_id: 'd1', job_id: null, source_code: 'D-1' },
    { id: 'a2', title: 'B', importance: 'low', resolved_at: '2026-06-08T00:00:00Z', deal_id: null, job_id: 'j1', source_code: 'J-1' },
  ];

  it('merges both kinds newest-first', () => {
    const out = mergeArchiveEntries(u as never, a as never, 10);
    expect(out.map((e) => e.id)).toEqual(['a1', 'u1', 'a2']);
  });

  it('builds links and keys per kind', () => {
    const out = mergeArchiveEntries(u as never, a as never, 10);
    const byId = Object.fromEntries(out.map((e) => [e.id, e]));
    expect(byId.u1).toMatchObject({ kind: 'user', key: 'user:u1', link: null });
    expect(byId.a1).toMatchObject({ kind: 'assigned', key: 'assigned:a1', link: '/deals/d1' });
    expect(byId.a2?.link).toBe('/jobs/j1');
  });

  it('respects the limit', () => {
    expect(mergeArchiveEntries(u as never, a as never, 1)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/features/tasks/hooks/useResolvedArchive.test.ts`
Expected: FAIL — module/function not found.

- [ ] **Step 3: Write the hook + pure merge**

```ts
// src/features/tasks/hooks/useResolvedArchive.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export type ArchiveEntry = {
  key: string;
  id: string;
  kind: 'user' | 'assigned';
  title: string;
  importance: string;
  resolvedAt: string;
  sourceCode: string | null;
  link: string | null;
};

type UserResolvedRow = { id: string; title: string; importance: string; completed_at: string };
type AssignedResolvedRow = {
  id: string; title: string; importance: string; resolved_at: string;
  deal_id: string | null; job_id: string | null; source_code: string | null;
};

export function mergeArchiveEntries(
  userRows: UserResolvedRow[],
  assignedRows: AssignedResolvedRow[],
  limit: number,
): ArchiveEntry[] {
  const entries: ArchiveEntry[] = [
    ...userRows.map((r) => ({
      key: `user:${r.id}`, id: r.id, kind: 'user' as const, title: r.title,
      importance: r.importance, resolvedAt: r.completed_at, sourceCode: null, link: null,
    })),
    ...assignedRows.map((r) => ({
      key: `assigned:${r.id}`, id: r.id, kind: 'assigned' as const, title: r.title,
      importance: r.importance, resolvedAt: r.resolved_at, sourceCode: r.source_code,
      link: r.deal_id ? `/deals/${r.deal_id}` : r.job_id ? `/jobs/${r.job_id}` : null,
    })),
  ];
  return entries
    .sort((x, y) => (x.resolvedAt < y.resolvedAt ? 1 : x.resolvedAt > y.resolvedAt ? -1 : 0))
    .slice(0, limit);
}

/** Every task the current user has resolved (full history), newest first. */
export function useResolvedArchive(params: { meId: string; limit: number }) {
  const { meId, limit } = params;
  return useQuery<ArchiveEntry[]>({
    queryKey: queryKeys.tasksArchive(meId, limit),
    enabled: meId.length > 0,
    queryFn: async () => {
      const [u, a] = await Promise.all([
        supabase
          .from('user_tasks')
          .select('id, title, importance, completed_at')
          .eq('user_id', meId)
          .not('completed_at', 'is', null)
          .order('completed_at', { ascending: false })
          .limit(limit),
        supabase
          .from('assigned_tasks')
          .select('id, title, importance, resolved_at, deal_id, job_id, source_code')
          .eq('resolved_by_user_id', meId)
          .order('resolved_at', { ascending: false })
          .limit(limit),
      ]);
      if (u.error) throw new Error(u.error.message);
      if (a.error) throw new Error(a.error.message);
      return mergeArchiveEntries(
        (u.data ?? []) as UserResolvedRow[],
        (a.data ?? []) as AssignedResolvedRow[],
        limit,
      );
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/features/tasks/hooks/useResolvedArchive.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/hooks/useResolvedArchive.ts src/features/tasks/hooks/useResolvedArchive.test.ts
git commit -m "feat(tasks): resolved-archive hook with pure merge"
```

---

### Task 7: Card component (`TaskKanbanCard`)

**Files:**
- Create: `src/features/tasks/TaskKanbanCard.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/features/tasks/TaskKanbanCard.tsx
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { CheckCircle2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ImportanceBadge } from './ImportanceBadge';
import { isDraggable, type TaskCard, type DragAction } from './taskCard';

export function TaskKanbanCard({
  card, assigneeName, onAction,
}: {
  card: TaskCard;
  assigneeName: string;
  onAction: (action: DragAction) => void;
}) {
  const { t } = useTranslation('common');
  const draggable = isDraggable(card);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: card.key, data: { card }, disabled: !draggable,
  });
  const style = transform
    ? { transform: CSS.Translate.toString(transform), opacity: isDragging ? 0.5 : 1 }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      // dnd-kit makes the draggable wrapper a role="button"; label it by the
      // task title so its accessible name doesn't swallow the inner buttons.
      aria-label={card.title}
      className={cn(
        'rounded-lg border border-border/60 bg-background px-3 py-2.5 shadow-sm',
        draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-default',
      )}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="truncate text-sm font-medium">{card.title}</span>
        <ImportanceBadge importance={card.importance} />
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
        {card.link ? (
          <Link to={card.link} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] hover:text-primary">
            {card.sourceCode ?? '—'}
          </Link>
        ) : (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">{t('tasks_page.personal')}</span>
        )}
        {card.relation === 'delegated' && (
          <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
            {t('tasks_page.assigned_to', { name: assigneeName })}
          </span>
        )}
      </div>
      {draggable && (
        <div className="mt-2">
          {card.resolved ? (
            <Button type="button" size="sm" variant="outline" className="h-7"
              onClick={() => onAction({ type: 'reopen', importance: card.importance })}>
              <RotateCcw className="size-3.5" />
              {t('tasks_page.reopen')}
            </Button>
          ) : (
            <Button type="button" size="sm" variant="outline" className="h-7"
              onClick={() => onAction({ type: 'resolve' })}>
              <CheckCircle2 className="size-3.5" />
              {t('tasks_page.resolve')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npm run typecheck`
Expected: PASS. (Behavior — resolve button visible only for `mine` cards — is asserted in Task 9's board test.)

- [ ] **Step 3: Commit**

```bash
git add src/features/tasks/TaskKanbanCard.tsx
git commit -m "feat(tasks): draggable kanban card with delegated badge + resolve/reopen"
```

---

### Task 8: Column component (`TasksKanbanColumn`)

**Files:**
- Create: `src/features/tasks/TasksKanbanColumn.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/features/tasks/TasksKanbanColumn.tsx
import { useTranslation } from 'react-i18next';
import { useDroppable } from '@dnd-kit/core';
import { cn } from '@/lib/utils';
import { TaskKanbanCard } from './TaskKanbanCard';
import type { ColumnKey, TaskCard, DragAction } from './taskCard';

export function TasksKanbanColumn({
  column, label, cards, nameFor, onAction,
}: {
  column: ColumnKey;
  label: string;
  cards: TaskCard[];
  nameFor: (id: string) => string;
  onAction: (card: TaskCard, action: DragAction) => void;
}) {
  const { t } = useTranslation('common');
  const { setNodeRef, isOver } = useDroppable({ id: column });
  return (
    <div
      ref={setNodeRef}
      data-testid={`tasks-col-${column}`}
      className={cn(
        'flex w-72 shrink-0 flex-col rounded-xl bg-card shadow-sm ring-1 ring-border/60',
        isOver && 'ring-primary/40',
      )}
    >
      <header className="flex items-center gap-2 border-b border-border/60 px-3 py-2.5">
        <span className="truncate text-sm font-semibold">{label}</span>
        <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-xs font-semibold">{cards.length}</span>
      </header>
      <div className="flex-1 space-y-2 overflow-y-auto p-2.5">
        {cards.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border/70 px-3 py-6 text-center text-xs text-muted-foreground">
            {t('tasks_page.board_empty')}
          </p>
        ) : (
          cards.map((c) => (
            <TaskKanbanCard key={c.key} card={c} assigneeName={nameFor(c.assigneeId)} onAction={(a) => onAction(c, a)} />
          ))
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/tasks/TasksKanbanColumn.tsx
git commit -m "feat(tasks): droppable kanban column"
```

---

### Task 9: Board component (`TasksKanbanBoard`) + behavior test

**Files:**
- Create: `src/features/tasks/TasksKanbanBoard.tsx`
- Test: `src/features/tasks/TasksKanbanBoard.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/features/tasks/TasksKanbanBoard.test.tsx
import { render, screen, fireEvent, within } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

const { useTaskBoardData } = vi.hoisted(() => ({ useTaskBoardData: vi.fn() }));
const { useAssignableOwners } = vi.hoisted(() => ({ useAssignableOwners: vi.fn() }));
const apply = vi.fn();
vi.mock('./hooks/useTaskBoardData', () => ({ useTaskBoardData, isoDaysAgo: () => '2026-05-23T00:00:00Z' }));
vi.mock('./hooks/useTaskBoardActions', () => ({ useTaskBoardActions: () => ({ mutate: apply }) }));
vi.mock('@/features/leads/hooks/useAssignableOwners', () => ({ useAssignableOwners }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o?.name ? `${k}:${o.name}` : k), i18n: { resolvedLanguage: 'en' } }),
}));
vi.mock('react-router-dom', () => ({ Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));
vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ isAdmin: false, user: { id: 'me' } }),
}));

import { TasksKanbanBoard } from './TasksKanbanBoard';

const assignedRow = (o = {}) => ({
  id: 'a1', title: 'Mine urgent', assignee_user_id: 'me', created_by_user_id: 'me',
  status: 'open', resolved_at: null, importance: 'urgent', source_code: 'D-1',
  deal_id: 'd1', job_id: null, description: null, client: null, department: null, ...o,
});

describe('TasksKanbanBoard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAssignableOwners.mockReturnValue({ data: [{ user_id: 'colleague', full_name: 'Colleague', email: 'c@x.gr' }] });
  });

  it('places my urgent task in the Urgent column and resolves via the button', () => {
    useTaskBoardData.mockReturnValue({ userRows: [], assignedRows: [assignedRow()], isLoading: false });
    render(<TasksKanbanBoard />);
    const urgent = screen.getByTestId('tasks-col-urgent');
    expect(within(urgent).getByText('Mine urgent')).toBeInTheDocument();
    fireEvent.click(within(urgent).getByRole('button', { name: /tasks_page.resolve/ }));
    expect(apply).toHaveBeenCalledWith({ card: expect.objectContaining({ id: 'a1' }), action: { type: 'resolve' } });
  });

  it('By me filter shows delegated tasks (read-only) and hides my own', () => {
    useTaskBoardData.mockReturnValue({
      userRows: [],
      assignedRows: [assignedRow(), assignedRow({ id: 'a2', title: 'Handed off', assignee_user_id: 'colleague', importance: 'high' })],
      isLoading: false,
    });
    render(<TasksKanbanBoard />);
    fireEvent.click(screen.getByText('tasks_page.filter_by_me'));
    expect(screen.queryByText('Mine urgent')).not.toBeInTheDocument();
    const high = screen.getByTestId('tasks-col-high');
    expect(within(high).getByText('Handed off')).toBeInTheDocument();
    // delegated card is read-only: no resolve button
    expect(within(high).queryByRole('button', { name: /tasks_page.resolve/ })).not.toBeInTheDocument();
    expect(within(high).getByText('tasks_page.assigned_to:Colleague')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/features/tasks/TasksKanbanBoard.test.tsx`
Expected: FAIL — `Cannot find module './TasksKanbanBoard'`.

- [ ] **Step 3: Write the component**

```tsx
// src/features/tasks/TasksKanbanBoard.tsx
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DndContext, DragOverlay, closestCorners, PointerSensor, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { useAuthStore } from '@/lib/stores/authStore';
import { useAssignableOwners } from '@/features/leads/hooks/useAssignableOwners';
import { SegmentedControl } from '@/components/layout/page-shell';
import { cn } from '@/lib/utils';
import { useTaskBoardData, isoDaysAgo } from './hooks/useTaskBoardData';
import { useTaskBoardActions } from './hooks/useTaskBoardActions';
import { TasksKanbanColumn } from './TasksKanbanColumn';
import {
  BOARD_COLUMNS, buildBoardCards, columnOf, matchesFilter, resolveDrag,
  type BoardFilter, type ColumnKey, type TaskCard, type DragAction,
} from './taskCard';

const RESOLVED_WINDOW_DAYS = 30;

export function TasksKanbanBoard() {
  const { t } = useTranslation('common');
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const meId = useAuthStore((s) => s.user?.id ?? '');
  const [allTeam, setAllTeam] = useState(false);
  const [filter, setFilter] = useState<BoardFilter>('to_me');
  const [activeCard, setActiveCard] = useState<TaskCard | null>(null);
  const [cutoffIso] = useState(() => isoDaysAgo(RESOLVED_WINDOW_DAYS));

  const { data: owners = [] } = useAssignableOwners();
  const nameById = useMemo(() => new Map(owners.map((o) => [o.user_id, o.full_name || o.email])), [owners]);
  const nameFor = (id: string) => nameById.get(id) ?? '—';

  const { userRows, assignedRows, isLoading } = useTaskBoardData({ meId, allTeam: isAdmin && allTeam, cutoffIso });
  const apply = useTaskBoardActions();

  const byColumn = useMemo(() => {
    const map = new Map<ColumnKey, TaskCard[]>(BOARD_COLUMNS.map((c) => [c, []]));
    for (const card of buildBoardCards(userRows, assignedRows, meId)) {
      if (matchesFilter(card, filter)) map.get(columnOf(card))!.push(card);
    }
    return map;
  }, [userRows, assignedRows, meId, filter]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function onDragStart(e: DragStartEvent) {
    setActiveCard((e.active.data.current as { card?: TaskCard } | undefined)?.card ?? null);
  }
  function fire(card: TaskCard, action: DragAction) {
    if (action.type !== 'noop') apply.mutate({ card, action });
  }
  function onDragEnd(e: DragEndEvent) {
    setActiveCard(null);
    const card = (e.active.data.current as { card?: TaskCard } | undefined)?.card;
    const target = e.over ? (String(e.over.id) as ColumnKey) : null;
    if (!card || !target) return;
    fire(card, resolveDrag(card, target));
  }

  const columnLabel = (c: ColumnKey) => (c === 'resolved' ? t('tasks_page.column_resolved') : t(`importance.${c}`));

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl
          value={filter}
          onChange={(v) => setFilter(v as BoardFilter)}
          options={[
            { value: 'to_me', label: t('tasks_page.filter_to_me') },
            { value: 'by_me', label: t('tasks_page.filter_by_me') },
            { value: 'all', label: t('tasks_page.filter_all') },
          ]}
        />
        {isAdmin && (
          <button
            type="button"
            onClick={() => setAllTeam((v) => !v)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              allTeam
                ? 'border-primary/30 bg-primary/10 text-primary'
                : 'border-border/70 bg-muted/40 text-muted-foreground hover:text-foreground',
            )}
          >
            {t('tasks_page.all_team')}
          </button>
        )}
      </div>
      {isLoading ? (
        <p className="p-8 text-center text-sm text-muted-foreground">…</p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={() => setActiveCard(null)}
        >
          <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-3">
            {BOARD_COLUMNS.map((c) => (
              <TasksKanbanColumn
                key={c}
                column={c}
                label={columnLabel(c)}
                cards={byColumn.get(c) ?? []}
                nameFor={nameFor}
                onAction={fire}
              />
            ))}
          </div>
          <DragOverlay>
            {activeCard ? (
              <div className="rounded-lg border bg-background px-3 py-2 text-sm font-medium shadow-md">
                {activeCard.title}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/features/tasks/TasksKanbanBoard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/TasksKanbanBoard.tsx src/features/tasks/TasksKanbanBoard.test.tsx
git commit -m "feat(tasks): kanban board (urgency columns + Resolved, filter, drag)"
```

---

### Task 10: Resolved-archive view (`ResolvedArchive`)

**Files:**
- Create: `src/features/tasks/ResolvedArchive.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/features/tasks/ResolvedArchive.tsx
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/lib/stores/authStore';
import { ImportanceBadge } from './ImportanceBadge';
import { importanceOf } from './importance';
import { useResolvedArchive } from './hooks/useResolvedArchive';

const PAGE = 100;

function formatDate(iso: string, locale: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
}

export function ResolvedArchive() {
  const { t, i18n } = useTranslation('common');
  const meId = useAuthStore((s) => s.user?.id ?? '');
  const [limit, setLimit] = useState(PAGE);
  const locale = i18n.resolvedLanguage === 'el' ? 'el-GR' : 'en-US';
  const { data: entries = [], isLoading } = useResolvedArchive({ meId, limit });

  if (isLoading) return <p className="p-8 text-center text-sm text-muted-foreground">…</p>;
  if (entries.length === 0) {
    return (
      <p className="rounded border border-dashed p-6 text-center text-sm opacity-70">
        {t('tasks_page.archive_empty')}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <ul className="space-y-2">
        {entries.map((e) => (
          <li key={e.key} className="flex items-center gap-3 rounded-lg border border-border/60 bg-background px-3 py-2.5 shadow-sm">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="truncate text-sm font-medium">{e.title}</span>
                <ImportanceBadge importance={importanceOf({ importance: e.importance })} />
                {e.link ? (
                  <Link to={e.link} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] hover:text-primary">
                    {e.sourceCode ?? '—'}
                  </Link>
                ) : (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">{t('tasks_page.personal')}</span>
                )}
              </div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {t('tasks_page.resolved_on', { date: formatDate(e.resolvedAt, locale) })}
              </p>
            </div>
          </li>
        ))}
      </ul>
      {entries.length >= limit && (
        <button
          type="button"
          onClick={() => setLimit((l) => l + PAGE)}
          className="block w-full rounded-lg border border-dashed border-border/70 py-2.5 text-center text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          {t('tasks_page.show_more')}
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/tasks/ResolvedArchive.tsx
git commit -m "feat(tasks): resolved-archive list view"
```

---

### Task 11: Tasks page host with tabs + update its test

**Files:**
- Rewrite: `src/features/tasks/MyTasksPage.tsx`
- Rewrite: `src/features/tasks/MyTasksPage.test.tsx`

- [ ] **Step 1: Replace the page test**

Replace the entire contents of `src/features/tasks/MyTasksPage.test.tsx` with:

```tsx
import type { ReactNode } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';

vi.mock('./TasksKanbanBoard', () => ({ TasksKanbanBoard: () => <div>BOARD</div> }));
vi.mock('./ResolvedArchive', () => ({ ResolvedArchive: () => <div>ARCHIVE</div> }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { resolvedLanguage: 'en' } }),
}));
vi.mock('@/lib/utils', () => ({ cn: (...a: unknown[]) => a.filter(Boolean).join(' ') }));

import { MyTasksPage } from './MyTasksPage';

const wrap = (ui: ReactNode) => render(<>{ui}</>);

describe('MyTasksPage', () => {
  it('shows the board by default and switches to the archive tab', () => {
    wrap(<MyTasksPage />);
    expect(screen.getByText('BOARD')).toBeInTheDocument();
    expect(screen.queryByText('ARCHIVE')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('tasks_page.tab_archive'));
    expect(screen.getByText('ARCHIVE')).toBeInTheDocument();
    expect(screen.queryByText('BOARD')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/features/tasks/MyTasksPage.test.tsx`
Expected: FAIL — the current list-based page has no `tasks_page.tab_archive` tab.

- [ ] **Step 3: Rewrite the page as a host**

Replace the entire contents of `src/features/tasks/MyTasksPage.tsx` with:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { TasksKanbanBoard } from './TasksKanbanBoard';
import { ResolvedArchive } from './ResolvedArchive';

type Tab = 'board' | 'archive';

export function MyTasksPage() {
  const { t } = useTranslation('common');
  const [tab, setTab] = useState<Tab>('board');

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-4">
      <div>
        <h1 className="text-xl font-semibold">{t('tasks_page.title')}</h1>
        <p className="text-sm opacity-70">{t('tasks_page.subtitle')}</p>
      </div>
      <div className="flex gap-1 border-b border-border/60">
        {(['board', 'archive'] as Tab[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              '-mb-px border-b-2 px-3 py-1.5 text-sm font-medium transition-colors',
              tab === key
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t(key === 'board' ? 'tasks_page.tab_board' : 'tasks_page.tab_archive')}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {tab === 'board' ? <TasksKanbanBoard /> : <ResolvedArchive />}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/features/tasks/MyTasksPage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/MyTasksPage.tsx src/features/tasks/MyTasksPage.test.tsx
git commit -m "feat(tasks): tasks page host with Board / Resolved archive tabs"
```

---

### Task 12: Translations (en + el)

**Files:**
- Modify: `src/i18n/locales/en/common.json:27-33`
- Modify: `src/i18n/locales/el/common.json` (the matching `tasks_page` block)

- [ ] **Step 1: Replace the English `tasks_page` block**

In `src/i18n/locales/en/common.json`, replace the `"tasks_page": { ... }` object (lines 27-33) with:

```json
  "tasks_page": {
    "title": "Tasks",
    "subtitle": "Your tasks and the ones you've assigned to others.",
    "empty": "No tasks assigned to you.",
    "empty_admin": "No open tasks for the team.",
    "created": "Created",
    "tab_board": "Board",
    "tab_archive": "Resolved archive",
    "all_team": "All team",
    "filter_to_me": "To me",
    "filter_by_me": "By me",
    "filter_all": "All",
    "column_resolved": "Resolved",
    "assigned_to": "→ {{name}}",
    "personal": "Personal",
    "resolve": "Resolve",
    "reopen": "Reopen",
    "board_empty": "Nothing here.",
    "archive_empty": "You haven't resolved any tasks yet.",
    "resolved_on": "Resolved {{date}}",
    "show_more": "Show more"
  },
```

- [ ] **Step 2: Replace the Greek `tasks_page` block**

In `src/i18n/locales/el/common.json`, replace the `"tasks_page": { ... }` object with:

```json
  "tasks_page": {
    "title": "Εργασίες",
    "subtitle": "Οι εργασίες σας και αυτές που αναθέσατε σε άλλους.",
    "empty": "Δεν σας έχουν ανατεθεί εργασίες.",
    "empty_admin": "Δεν υπάρχουν ανοιχτές εργασίες για την ομάδα.",
    "created": "Δημιουργήθηκε",
    "tab_board": "Πίνακας",
    "tab_archive": "Αρχείο επιλυμένων",
    "all_team": "Όλη η ομάδα",
    "filter_to_me": "Σε εμένα",
    "filter_by_me": "Από εμένα",
    "filter_all": "Όλες",
    "column_resolved": "Επιλύθηκαν",
    "assigned_to": "→ {{name}}",
    "personal": "Προσωπική",
    "resolve": "Επίλυση",
    "reopen": "Επαναφορά",
    "board_empty": "Τίποτα εδώ.",
    "archive_empty": "Δεν έχετε επιλύσει καμία εργασία ακόμη.",
    "resolved_on": "Επιλύθηκε {{date}}",
    "show_more": "Περισσότερα"
  },
```

- [ ] **Step 3: Verify JSON parses + lint passes**

Run: `npm run test:run -- src/features/tasks && npm run lint`
Expected: PASS (no JSON parse error, no lint errors).

- [ ] **Step 4: Commit**

```bash
git add src/i18n/locales/en/common.json src/i18n/locales/el/common.json
git commit -m "i18n(tasks): kanban board, filters, archive strings (en + el)"
```

---

### Task 13: Migration — notify a personal task's creator on completion

**Files:**
- Create: `supabase/migrations/20260622280000_user_tasks_notify_creator.sql`

Mirrors `assigned_tasks_notify_creator`. When a personal task created *for* someone (creator ≠ owner) is completed, insert a `task_resolved` bell notification for the creator.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260622280000_user_tasks_notify_creator.sql
-- =============================================================================
-- Notify the CREATOR of a personal (user_tasks) task when its assignee completes
-- it. Mirrors assigned_tasks_notify_creator. In-app bell only (type
-- 'task_resolved'); parent_type 'user_task' so readPath() links it to /tasks.
-- Suppressed when the creator completes their own task (created_by = user_id)
-- or when created_by is null (legacy rows).
-- =============================================================================

create or replace function public.user_tasks_notify_creator()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- fire only on the transition open -> completed
  if new.completed_at is null or old.completed_at is not null then
    return new;
  end if;
  -- only when someone else created the task for this user
  if new.created_by is null or new.created_by = new.user_id then
    return new;
  end if;
  insert into public.notifications (user_id, type, payload)
  values (
    new.created_by,
    'task_resolved',
    jsonb_build_object(
      'task_id', new.id,
      'parent_type', 'user_task',
      'parent_id', new.id,
      'author_id', new.user_id,
      'title', new.title
    )
  );
  return new;
end $$;

drop trigger if exists user_tasks_notify_creator on public.user_tasks;
create trigger user_tasks_notify_creator
  after update of completed_at on public.user_tasks
  for each row execute function public.user_tasks_notify_creator();

-- ---------------------------------------------------------------------------
-- Rollback:
--   drop trigger if exists user_tasks_notify_creator on public.user_tasks;
--   drop function if exists public.user_tasks_notify_creator();
-- ---------------------------------------------------------------------------
```

- [ ] **Step 2: Sanity-check the SQL locally**

Run: `git diff --stat` and re-read the file; confirm it references only existing objects (`public.notifications`, `user_tasks.created_by`, `user_tasks.user_id`, `user_tasks.completed_at`). No local DB apply in this step (prod apply is Task 14).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260622280000_user_tasks_notify_creator.sql
git commit -m "feat(tasks): notify creator when a personal task is completed"
```

---

### Task 14: Full verification, deploy, smoke

**Files:** none (verification + deploy)

- [ ] **Step 1: Run the full test suite**

Run: `npm run test:run`
Expected: PASS — all suites, including the new `taskCard`, `notification-presenters`, `useResolvedArchive`, `TasksKanbanBoard`, and rewritten `MyTasksPage` tests.

- [ ] **Step 2: Typecheck + lint + build**

Run: `npm run build`
Expected: PASS (`tsc -b` clean, `eslint --max-warnings=0` clean, `vite build` succeeds).

- [ ] **Step 3: Apply the migration to prod (requires user go-ahead)**

Per project workflow, prod DDL is applied with the Supabase MCP (`apply_migration`), not Bash/curl. Confirm with the user, then apply `20260622280000_user_tasks_notify_creator.sql` to the prod project. Verify the trigger exists:

```sql
select tgname from pg_trigger where tgrelid = 'public.user_tasks'::regclass and tgname = 'user_tasks_notify_creator';
```
Expected: one row.

- [ ] **Step 4: Push to main (deploys frontend on Vercel)**

```bash
git push origin main
```

- [ ] **Step 5: Manual smoke (prod, admin account)**

  1. `/tasks` shows the kanban with Urgent · High · Medium · Low · Resolved + the To me / By me / All filter.
  2. Drag a personal task between urgency columns → urgency badge changes and it sticks after refresh.
  3. Drag an open task into Resolved → it resolves and lands in Resolved.
  4. Drag it back to an urgency column → it re-opens there.
  5. Create a task for a colleague; under **By me** it shows with the `→ {name}` badge and **no** resolve button.
  6. As the colleague, complete that task → as the creator, a bell notification appears and clicking it opens `/tasks`.
  7. **Resolved archive** tab lists tasks you resolved, newest first, with resolved date + link.
  8. Confirm the Home "Assigned to me" widget still works (untouched).

---

## Self-Review

**Spec coverage:**
- Kanban by urgency + Resolved column → Tasks 1, 8, 9. ✓
- Drag-and-drop (change urgency / resolve / reopen) → Task 1 (`resolveDrag`) + Task 9. ✓
- See tasks I created for others, for everyone → Task 4 (`.or` creator) + Task 1 (`by_me`) + existing RLS. ✓
- Delegated cards read-only → Task 1 (`isDraggable`) + Task 7 (no button) + Task 9 test. ✓
- Resolved column recent ~30d → Task 4 cutoff. ✓
- Notify creator on resolve: assigned (exists) + personal (new) → Task 13 + Task 2 (clickable). ✓
- Resolved archive (full history, read-only) → Task 6 + Task 10 + Task 11 tab. ✓
- Non-goals respected (no email, no editing delegated, two-table model intact). ✓

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** `TaskCard`, `DragAction`, `ColumnKey`, `BoardFilter`, `BOARD_COLUMNS`, `ArchiveEntry`, `ASSIGNED_TASK_SELECT`, `isoDaysAgo`, `mergeArchiveEntries` are defined once and used with matching signatures across tasks. `MyTasksPage` stays a named export (router unchanged).

## Changes / Revert

- **DB**: `drop trigger if exists user_tasks_notify_creator on public.user_tasks; drop function if exists public.user_tasks_notify_creator();` (also in the migration footer). No data/columns touched.
- **Frontend**: revert the Task commits. New files are additive; the only edits to existing files are `notification-presenters.tsx` (one `case`), `queryKeys.ts` (3 keys), `useAssignedTasksOpen.ts` (export rename), `MyTasksPage.tsx` (+ test), and the two `common.json` files. Home widget, `useOpenUserTasks`, `useAssignedTasksOpen` query behavior, RLS, and the email path are untouched.
