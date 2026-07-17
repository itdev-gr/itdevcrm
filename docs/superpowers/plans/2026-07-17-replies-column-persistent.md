# Persistent Replies Column Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The 💬 Replies column on `/tasks` becomes a stable view of every OPEN task the viewer is a party to (assignee or creator) that has at least one comment from someone else — reading no longer removes the card; only resolution does.

**Architecture:** Frontend-only. A new query hook asks `task_comments` which of the board's candidate cards have a foreign comment (chunked `.in()` + `.range()` paging to dodge the PostgREST 1000-row cap); the pure `columnOf` routing flips precedence to `resolved > replies > importance`; drag is re-enabled for cards in Replies. The unread 💬 badge keeps its current notification-driven lifecycle untouched.

**Tech Stack:** React + TypeScript, @tanstack/react-query, supabase-js (PostgREST), vitest + @testing-library/react, dnd-kit.

**Spec:** `docs/superpowers/specs/2026-07-17-replies-column-persistent-design.md`

## Global Constraints

- Verification command is `npm run build` (tsc -b + eslint `--max-warnings 0`) — stricter than `tsc --noEmit`; also run `npx vitest run` (full suite; it uses mocks but the repo convention is to run everything).
- `react-hooks/purity` lint: never call `Date.now()`/`new Date()` in a component/hook render body.
- `exactOptionalPropertyTypes: true` and `noUncheckedIndexedAccess: true` are on.
- Do NOT touch `src/components/layout/Sidebar.tsx` — it carries a parallel session's uncommitted work. Stage files explicitly (`git add <paths>`), never `git add -A`.
- Commit after every task; do not push until the final task.
- No DB/RLS/migration changes anywhere in this plan.

---

### Task 1: Pure column/drag semantics (`taskCard.ts`)

**Files:**
- Modify: `src/features/tasks/taskCard.ts:21-23` (BOARD_COLUMNS comment), `:125-139` (`columnOf`, `isDraggable`)
- Modify: `src/features/tasks/TaskKanbanCard.tsx:25-27` (call site)
- Test: `src/features/tasks/taskCard.test.ts`

**Interfaces:**
- Consumes: existing `TaskCard` type (unchanged).
- Produces: `columnOf(card: TaskCard, hasReply = false): ColumnKey` — `resolved` wins over `replies`, `replies` wins over importance. `isDraggable(card: TaskCard): boolean` — single-param now; parties (`mine`/`delegated`) always drag. Task 4 relies on these exact signatures.

- [ ] **Step 1: Update the tests** — in `src/features/tasks/taskCard.test.ts`, replace the `replies column` describe-block tests that encode the old rules:

Replace the test `'unread replies win over resolved (resurfacing)'` (around line 123) with:

```ts
  it('resolved wins over replies — a closed task never renders in Replies', () => {
    const c = assignedTaskToCard(assignedRow({ status: 'resolved' }), me);
    expect(columnOf(c)).toBe('resolved');
    expect(columnOf(c, true)).toBe('resolved');
  });
```

Replace the test `'cards with unread replies are not draggable'` (around line 129) with:

```ts
  it('cards in Replies stay draggable for both parties', () => {
    expect(isDraggable(assignedTaskToCard(assignedRow(), me))).toBe(true); // mine
    expect(isDraggable(assignedTaskToCard(assignedRow({ assignee_user_id: 'x' }), me))).toBe(true); // delegated
    expect(
      isDraggable(assignedTaskToCard(assignedRow({ assignee_user_id: 'x', created_by_user_id: 'y' }), me)),
    ).toBe(false); // other
  });
```

Rename the test `'unread replies win over importance'` (around line 117) to `'a reply wins over importance on open tasks'` (body unchanged — `columnOf(c, true)` → `'replies'`, legacy default `columnOf(c, false) === columnOf(c)`).

- [ ] **Step 2: Run the test file to verify the new expectations fail**

Run: `npx vitest run src/features/tasks/taskCard.test.ts`
Expected: FAIL — `columnOf(c, true)` returns `'replies'` for the resolved card, and `isDraggable` still takes/uses a second parameter (TS error or assertion failure).

- [ ] **Step 3: Implement** — in `src/features/tasks/taskCard.ts` replace lines 125-139 with:

```ts
/** Replies membership (a foreign comment on an open task I'm party to) wins
 *  over importance but never over resolved — a closed task rests in Resolved
 *  even while discussed. Optional so non-board callers (client/lead tabs)
 *  keep legacy behavior. */
export function columnOf(card: TaskCard, hasReply = false): ColumnKey {
  if (card.resolved) return 'resolved';
  return hasReply ? 'replies' : card.importance;
}

/** A task is draggable by either party — the assignee ('mine') OR the creator
 *  ('delegated'), so the creator can also drag-to-stamp their side of a
 *  dual-resolve task. Cards in Replies drag like any other card. */
export function isDraggable(card: TaskCard): boolean {
  return card.relation === 'mine' || card.relation === 'delegated';
}
```

Update the `BOARD_COLUMNS` doc comment (lines 21-22) to:

```ts
/** Left→right column order on the board. Replies is derived (foreign comments
 *  on open party tasks), not a stored state — see columnOf. */
```

In `src/features/tasks/TaskKanbanCard.tsx` change line 25 from
`const draggable = isDraggable(card, unreadComments > 0);` to
`const draggable = isDraggable(card);`
and rewrite the stale comment on lines 26-27 to:

```ts
  // Resolve/Reopen is gated on assignment, not drag — the button and drag
  // coexist on every card, including ones parked in Replies.
```

(The `unreadComments` prop stays — it still renders the 💬 badge.)

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/features/tasks/taskCard.test.ts src/features/tasks/TasksKanbanBoard.commentbadge.test.tsx`
Expected: `taskCard.test.ts` PASSES. The commentbadge board test MAY now fail on routing assertions — that is expected and fixed in Task 4; if it fails, note it and move on (do not fix it here).

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/taskCard.ts src/features/tasks/taskCard.test.ts src/features/tasks/TaskKanbanCard.tsx
git commit -m "feat(tasks): replies routing precedence resolved>replies>importance; replies cards draggable"
```

---

### Task 2: Pure replies-index helpers (`repliesIndex.ts`)

**Files:**
- Create: `src/features/tasks/repliesIndex.ts`
- Test: `src/features/tasks/repliesIndex.test.ts`

**Interfaces:**
- Consumes: `TaskCard` from `./taskCard`.
- Produces (Task 3 depends on these exact names):
  - `type TaskCommentIdRow = { user_task_id: string | null; assigned_task_id: string | null }`
  - `chunkIds(ids: string[], size?: number): string[][]` (default size 100)
  - `foreignCommentKeys(rows: TaskCommentIdRow[]): Set<string>` — maps rows to card keys `user:<id>` / `assigned:<id>`
  - `replyCandidateIds(cards: TaskCard[]): { userIds: string[]; assignedIds: string[] }` — open party cards only, ids sorted

- [ ] **Step 1: Write the failing test** — create `src/features/tasks/repliesIndex.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { chunkIds, foreignCommentKeys, replyCandidateIds } from './repliesIndex';
import type { TaskCard } from './taskCard';

const card = (o: Partial<TaskCard>): TaskCard => ({
  key: 'assigned:a1', kind: 'assigned', id: 'a1', title: 't', importance: 'low',
  relation: 'mine', resolved: false, assigneeId: 'me', creatorId: 'boss',
  createdAtIso: null, dueAt: null, resolvedAt: null, startedAtIso: null,
  sourceCode: null, link: null, notes: null, clientName: null, leadName: null,
  creatorResolvedAt: null, assigneeResolvedAt: null, summary: null, ...o,
});

describe('chunkIds', () => {
  it('splits into chunks of the given size, no empty chunks', () => {
    expect(chunkIds(['a', 'b', 'c'], 2)).toEqual([['a', 'b'], ['c']]);
    expect(chunkIds([], 2)).toEqual([]);
  });
  it('defaults to chunks of 100', () => {
    const ids = Array.from({ length: 250 }, (_, i) => `id${i}`);
    expect(chunkIds(ids).map((c) => c.length)).toEqual([100, 100, 50]);
  });
});

describe('foreignCommentKeys', () => {
  it('maps id columns to card keys and dedupes', () => {
    const keys = foreignCommentKeys([
      { user_task_id: 'u1', assigned_task_id: null },
      { user_task_id: null, assigned_task_id: 'a1' },
      { user_task_id: null, assigned_task_id: 'a1' },
      { user_task_id: null, assigned_task_id: null },
    ]);
    expect(keys).toEqual(new Set(['user:u1', 'assigned:a1']));
  });
});

describe('replyCandidateIds', () => {
  it('keeps open party cards only (mine + delegated), sorted, split by kind', () => {
    const cards = [
      card({ key: 'assigned:a2', id: 'a2', relation: 'mine' }),
      card({ key: 'assigned:a1', id: 'a1', relation: 'delegated' }),
      card({ key: 'user:u1', id: 'u1', kind: 'user', relation: 'mine' }),
      card({ key: 'assigned:a3', id: 'a3', relation: 'other' }),      // excluded
      card({ key: 'assigned:a4', id: 'a4', resolved: true }),          // excluded
    ];
    expect(replyCandidateIds(cards)).toEqual({ userIds: ['u1'], assignedIds: ['a1', 'a2'] });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/features/tasks/repliesIndex.test.ts`
Expected: FAIL — module `./repliesIndex` not found.

- [ ] **Step 3: Implement** — create `src/features/tasks/repliesIndex.ts`:

```ts
import type { TaskCard } from './taskCard';

/** Slim task_comments row: only the two task-id columns the index needs. */
export type TaskCommentIdRow = {
  user_task_id: string | null;
  assigned_task_id: string | null;
};

/** Split ids into `.in()`-sized chunks (PostgREST URL-length safety). */
export function chunkIds(ids: string[], size = 100): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += size) chunks.push(ids.slice(i, i + size));
  return chunks;
}

/** Board card keys (`user:<id>` / `assigned:<id>`) present in comment rows. */
export function foreignCommentKeys(rows: TaskCommentIdRow[]): Set<string> {
  const keys = new Set<string>();
  for (const row of rows) {
    if (row.user_task_id) keys.add(`user:${row.user_task_id}`);
    if (row.assigned_task_id) keys.add(`assigned:${row.assigned_task_id}`);
  }
  return keys;
}

/** Replies-eligible cards: OPEN tasks the viewer is a party to (assignee or
 *  creator). Resolved tasks and relation 'other' never enter Replies. Sorted
 *  so the caller can reuse the lists in a stable query key. */
export function replyCandidateIds(cards: TaskCard[]): { userIds: string[]; assignedIds: string[] } {
  const userIds: string[] = [];
  const assignedIds: string[] = [];
  for (const c of cards) {
    if (c.resolved || (c.relation !== 'mine' && c.relation !== 'delegated')) continue;
    (c.kind === 'user' ? userIds : assignedIds).push(c.id);
  }
  return { userIds: userIds.sort(), assignedIds: assignedIds.sort() };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/features/tasks/repliesIndex.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/repliesIndex.ts src/features/tasks/repliesIndex.test.ts
git commit -m "feat(tasks): pure helpers for the persistent replies index"
```

---

### Task 3: `useTaskRepliesIndex` data hook

**Files:**
- Create: `src/features/tasks/hooks/useTaskRepliesIndex.ts`
- Test: `src/features/tasks/hooks/useTaskRepliesIndex.test.tsx`

**Interfaces:**
- Consumes: Task 2's `chunkIds`, `foreignCommentKeys`, `replyCandidateIds`, `TaskCommentIdRow`; existing `useUnreadCommentNotifs` (`@/features/notifications/hooks/useUnreadCommentNotifs`, returns `{ data: Array<{ id: string; payload: Record<string, unknown> }> }`).
- Produces: `useTaskRepliesIndex(cards: TaskCard[], meId: string): Set<string>` — set of card keys with ≥1 foreign comment. Task 4 calls exactly this.

- [ ] **Step 1: Write the failing test** — create `src/features/tasks/hooks/useTaskRepliesIndex.test.tsx`:

```tsx
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { TaskCard } from '../taskCard';

// Chainable PostgREST stub: every filter returns the builder; awaiting it
// resolves with the queued page. `calls` records the filter arguments.
const calls: Array<Record<string, unknown>> = [];
let pages: Array<{ user_task_id: string | null; assigned_task_id: string | null }[]> = [];
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => {
      const call: Record<string, unknown> = {};
      calls.push(call);
      const builder = {
        select: () => builder,
        in: (col: string, ids: string[]) => { call['in'] = [col, ids]; return builder; },
        neq: (col: string, v: string) => { call['neq'] = [col, v]; return builder; },
        range: (from: number, to: number) => { call['range'] = [from, to]; return builder; },
        then: (resolve: (r: { data: unknown; error: null }) => unknown) =>
          resolve({ data: pages.shift() ?? [], error: null }),
      };
      return builder;
    },
  },
}));
vi.mock('@/features/notifications/hooks/useUnreadCommentNotifs', () => ({
  useUnreadCommentNotifs: () => ({ data: [] }),
}));

import { useTaskRepliesIndex } from './useTaskRepliesIndex';

const card = (o: Partial<TaskCard>): TaskCard => ({
  key: 'assigned:a1', kind: 'assigned', id: 'a1', title: 't', importance: 'low',
  relation: 'mine', resolved: false, assigneeId: 'me', creatorId: 'boss',
  createdAtIso: null, dueAt: null, resolvedAt: null, startedAtIso: null,
  sourceCode: null, link: null, notes: null, clientName: null, leadName: null,
  creatorResolvedAt: null, assigneeResolvedAt: null, summary: null, ...o,
});

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useTaskRepliesIndex', () => {
  beforeEach(() => { calls.length = 0; pages = []; });

  it('returns the card keys that have foreign comments', async () => {
    pages = [[{ user_task_id: null, assigned_task_id: 'a1' }]];
    const { result } = renderHook(
      () => useTaskRepliesIndex([card({}), card({ key: 'assigned:a2', id: 'a2' })], 'me'),
      { wrapper },
    );
    await waitFor(() => expect(result.current.has('assigned:a1')).toBe(true));
    expect(result.current.has('assigned:a2')).toBe(false);
    // filters: scoped to the candidate ids, excluding my own comments
    expect(calls[0]?.['in']).toEqual(['assigned_task_id', ['a1', 'a2']]);
    expect(calls[0]?.['neq']).toEqual(['author_user_id', 'me']);
  });

  it('issues no query when there are no candidate cards', () => {
    const { result } = renderHook(
      () => useTaskRepliesIndex([card({ resolved: true }), card({ id: 'a9', key: 'assigned:a9', relation: 'other' })], 'me'),
      { wrapper },
    );
    expect(result.current.size).toBe(0);
    expect(calls.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/features/tasks/hooks/useTaskRepliesIndex.test.tsx`
Expected: FAIL — module `./useTaskRepliesIndex` not found.

- [ ] **Step 3: Implement** — create `src/features/tasks/hooks/useTaskRepliesIndex.ts`:

```ts
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useUnreadCommentNotifs } from '@/features/notifications/hooks/useUnreadCommentNotifs';
import { chunkIds, foreignCommentKeys, replyCandidateIds, type TaskCommentIdRow } from '../repliesIndex';
import type { TaskCard } from '../taskCard';

const PAGE = 1000; // PostgREST silently caps at 1000 rows — page explicitly.

async function fetchForeignCommentRows(
  column: 'user_task_id' | 'assigned_task_id',
  ids: string[],
  meId: string,
): Promise<TaskCommentIdRow[]> {
  const rows: TaskCommentIdRow[] = [];
  for (const chunk of chunkIds(ids)) {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('task_comments')
        .select('user_task_id, assigned_task_id')
        .in(column, chunk)
        .neq('author_user_id', meId)
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      const page = (data ?? []) as TaskCommentIdRow[];
      rows.push(...page);
      if (page.length < PAGE) break;
    }
  }
  return rows;
}

/** Card keys (`user:<id>` / `assigned:<id>`) of the viewer's open party tasks
 *  that have at least one comment from someone else — the persistent Replies
 *  set. RLS already scopes task_comments to parties, matching the rule. */
export function useTaskRepliesIndex(cards: TaskCard[], meId: string): Set<string> {
  const { userIds, assignedIds } = useMemo(() => replyCandidateIds(cards), [cards]);
  // Every foreign comment on my task also creates a task_comment notification
  // for me, and the bell's realtime invalidation refreshes that query — salt
  // the key with the unread ids so a brand-new reply refetches this index live.
  const { data: unreadNotifs = [] } = useUnreadCommentNotifs();
  const notifSalt = useMemo(
    () => unreadNotifs.map((n) => n.id).sort().join(','),
    [unreadNotifs],
  );
  const query = useQuery({
    queryKey: ['task-replies', meId, userIds.join(','), assignedIds.join(','), notifSalt],
    enabled: !!meId && (userIds.length > 0 || assignedIds.length > 0),
    queryFn: async () => {
      const [userRows, assignedRows] = await Promise.all([
        userIds.length ? fetchForeignCommentRows('user_task_id', userIds, meId) : Promise.resolve([]),
        assignedIds.length ? fetchForeignCommentRows('assigned_task_id', assignedIds, meId) : Promise.resolve([]),
      ]);
      return Array.from(foreignCommentKeys([...userRows, ...assignedRows]));
    },
  });
  return useMemo(() => new Set(query.data ?? []), [query.data]);
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/features/tasks/hooks/useTaskRepliesIndex.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/hooks/useTaskRepliesIndex.ts src/features/tasks/hooks/useTaskRepliesIndex.test.tsx
git commit -m "feat(tasks): useTaskRepliesIndex — foreign-comment key set (chunked + paged)"
```

---

### Task 4: Board wiring + board tests

**Files:**
- Modify: `src/features/tasks/TasksKanbanBoard.tsx:12-26` (imports), `:68-76` (byColumn)
- Modify: `src/features/tasks/TasksKanbanBoard.commentbadge.test.tsx`
- Modify (mock-only): `src/features/tasks/TasksKanbanBoard.test.tsx`, `src/features/tasks/TasksKanbanBoard.deeplink.test.tsx`, and any other test that renders `TasksKanbanBoard` unmocked (check `MyTasksPage*.test.tsx`)

**Interfaces:**
- Consumes: `useTaskRepliesIndex(cards, meId): Set<string>` (Task 3), `columnOf(card, hasReply)` (Task 1).
- Produces: final user-visible behavior; no new exports.

- [ ] **Step 1: Update `TasksKanbanBoard.commentbadge.test.tsx` first (failing tests).**

Add the hoisted mock next to the existing ones (after line 7):

```tsx
const { useTaskRepliesIndex } = vi.hoisted(() => ({ useTaskRepliesIndex: vi.fn() }));
```

and with the other `vi.mock` calls:

```tsx
vi.mock('./hooks/useTaskRepliesIndex', () => ({ useTaskRepliesIndex }));
```

In `beforeEach`, add the default:

```tsx
    useTaskRepliesIndex.mockReturnValue(new Set());
```

Then adjust the routing tests to the new model (badge tests stay as they are except where noted):

1. `'shows the 💬 count for a card with unread comments'` — the card must also be in the replies set for the old assertion to keep looking in the Replies column; add before `render`:
   ```tsx
   useTaskRepliesIndex.mockReturnValue(new Set(['assigned:a1']));
   ```
2. `'opening the card marks exactly its notification ids read'` — same one-line addition before `render`.
3. `'a card with unread replies sits in the Replies column, not its importance column'` — rename to `'a card with a foreign reply sits in Replies, not its importance column'` and drive it by the index instead of notifications:
   ```tsx
   useUnreadCommentNotifs.mockReturnValue({ data: [] });
   useTaskRepliesIndex.mockReturnValue(new Set(['assigned:a1']));
   ```
   (assertions unchanged).
4. Replace `'returns to its importance column once the replies are read'` with the new persistence test:
   ```tsx
   it('stays in Replies after its notifications are read', () => {
     useUnreadCommentNotifs.mockReturnValue({ data: [] });
     useTaskRepliesIndex.mockReturnValue(new Set(['assigned:a1']));
     render(<TasksKanbanBoard />);
     expect(within(screen.getByTestId('tasks-col-replies')).getByText('Mine urgent')).toBeInTheDocument();
     expect(within(screen.getByTestId('tasks-col-urgent')).queryByText('Mine urgent')).not.toBeInTheDocument();
   });
   ```
5. Add a resolved-precedence test:
   ```tsx
   it('a resolved task with replies renders in Resolved, not Replies', () => {
     useUnreadCommentNotifs.mockReturnValue({ data: [] });
     useTaskBoardData.mockReturnValue({
       userRows: [],
       assignedRows: [assignedRow({ status: 'resolved', resolved_at: '2026-07-16T00:00:00Z' })],
       isLoading: false,
     });
     useTaskRepliesIndex.mockReturnValue(new Set(['assigned:a1']));
     render(<TasksKanbanBoard />);
     expect(within(screen.getByTestId('tasks-col-resolved')).getByText('Mine urgent')).toBeInTheDocument();
     expect(within(screen.getByTestId('tasks-col-replies')).queryByText('Mine urgent')).not.toBeInTheDocument();
   });
   ```
6. `'a card in Replies keeps its Resolve button (not draggable, still actionable)'` — rename to `'a card in Replies keeps its Resolve button'`, and drive membership via `useTaskRepliesIndex.mockReturnValue(new Set(['assigned:a1']))` (keep the existing notif mock too; assertions unchanged — the aria-disabled check still passes now that the card is draggable).

- [ ] **Step 2: Add the same mock (default empty set) to the other board tests.** In `TasksKanbanBoard.test.tsx` and `TasksKanbanBoard.deeplink.test.tsx` (and any `MyTasksPage*.test.tsx` that renders the real board), add:

```tsx
vi.mock('./hooks/useTaskRepliesIndex', () => ({ useTaskRepliesIndex: () => new Set<string>() }));
```

(For `MyTasksPage*` the path is `./hooks/useTaskRepliesIndex` relative to `src/features/tasks/` — same literal. Skip files that already mock the whole board component.)

- [ ] **Step 3: Run the board tests to verify the new ones fail**

Run: `npx vitest run src/features/tasks/TasksKanbanBoard.commentbadge.test.tsx`
Expected: FAIL — the board still routes on unread notifications, so the persistence and resolved-precedence tests break.

- [ ] **Step 4: Wire the board.** In `src/features/tasks/TasksKanbanBoard.tsx`:

Add the import (with the other hook imports):

```tsx
import { useTaskRepliesIndex } from './hooks/useTaskRepliesIndex';
```

After the `cards` memo (line 63-66), add:

```tsx
  // Persistent Replies membership: open party tasks with a foreign comment.
  const replyKeys = useTaskRepliesIndex(cards, meId);
```

Replace the `byColumn` memo (lines 68-75) with:

```tsx
  const byColumn = useMemo(() => {
    const map = new Map<ColumnKey, TaskCard[]>(BOARD_COLUMNS.map((c) => [c, []]));
    for (const card of cards) {
      if (matchesFilter(card, filter)) map.get(columnOf(card, replyKeys.has(card.key)))!.push(card);
    }
    return map;
  }, [cards, filter, replyKeys]);
```

(`commentIndex` stays — it still feeds the 💬 badge `unreadCount` prop at line ~196 and the mark-read effect at lines 90-94.)

- [ ] **Step 5: Run the affected suites**

Run: `npx vitest run src/features/tasks/`
Expected: PASS (all tasks-feature tests, including the updated board tests).

- [ ] **Step 6: Commit**

```bash
git add src/features/tasks/TasksKanbanBoard.tsx src/features/tasks/TasksKanbanBoard.commentbadge.test.tsx src/features/tasks/TasksKanbanBoard.test.tsx src/features/tasks/TasksKanbanBoard.deeplink.test.tsx
git commit -m "feat(tasks): Replies column is persistent — party tasks with foreign replies stay until resolved"
```

(Add any `MyTasksPage*.test.tsx` you touched in Step 2 to the `git add` list.)

---

### Task 5: Full verification + push

**Files:** none new.

- [ ] **Step 1: Full test suite**

Run: `npx vitest run`
Expected: all green (roughly 700+ tests as of 07-17). Fix any regression before proceeding — do NOT skip tests.

- [ ] **Step 2: Build (strict)**

Run: `npm run build`
Expected: exit 0, zero eslint warnings, tsc -b clean.

- [ ] **Step 3: Verify clean staging and push.** `git status` must show only our committed work; `src/components/layout/Sidebar.tsx` must remain modified-unstaged (parallel session — leave it). Then:

```bash
git log --oneline origin/main..HEAD   # expect exactly the 4 commits from Tasks 1-4
git pull --rebase --autostash
git push origin main
```

- [ ] **Step 4: Report** — summarize behavior change + revert note (revert the 4 commits; no data migration).
