# Task-Card Unread-Comment Badge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Task cards on the /tasks board show a 💬 unread-comment count derived from existing `task_comment` bell notifications; opening the task clears the badge and the matching bell entries together.

**Architecture:** Frontend-only. A new uncapped query fetches the user's unread `task_comment` notifications (RLS-scoped); a pure helper groups them by board card key (`<kind>:<task_id>`); the board passes counts to cards and bulk-marks the rows read on either open path (card click or `?open=` deep link). The query key shares the `['notifications']` prefix so the bell's existing realtime subscription refreshes the badge live.

**Tech Stack:** React 18 + TypeScript (strict), TanStack Query, supabase-js, vitest + testing-library.

**Spec:** `docs/superpowers/specs/2026-07-06-task-card-comment-badge-design.md`

## Global Constraints

- Verify with `npm run build` (strict `tsc -b` + eslint `--max-warnings=0`) — stricter than `tsc --noEmit`.
- vitest runs against PROD — run ONLY the test files named in each task.
- No DB changes of any kind in this feature.
- Commit per task with explicit pathspecs; push directly to `main` (no PRs).
- `notifications.payload` for `task_comment` carries `task_kind` (`'user_task' | 'assigned_task'`) and `task_id` (uuid string); `TaskCard.key` format is `` `${'user'|'assigned'}:${id}` ``.
- End commit messages with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Grouping helper + query key + the two notification hooks

**Files:**
- Create: `src/features/tasks/commentBadge.ts`
- Test: `src/features/tasks/commentBadge.test.ts`
- Create: `src/features/notifications/hooks/useUnreadCommentNotifs.ts`
- Create: `src/features/notifications/hooks/useMarkNotificationsRead.ts`
- Modify: `src/lib/queryKeys.ts:28` (next to the existing `notifications` key)

**Interfaces:**
- Consumes: `queryKeys.notifications()` = `['notifications']` (existing); `captureMutation` from `@/lib/sentry/captureMutation` (existing — see `useMarkNotificationRead.ts` for the idiom).
- Produces (Task 2 imports all three):
  - `unreadCommentIndex(rows: UnreadCommentNotif[]): Map<string, UnreadCommentEntry>` with `UnreadCommentNotif = { id: string; payload: Record<string, unknown> }`, `UnreadCommentEntry = { count: number; notifIds: string[] }` — from `src/features/tasks/commentBadge.ts`.
  - `useUnreadCommentNotifs(): { data?: UnreadCommentNotif[] }` (react-query result).
  - `useMarkNotificationsRead(): { mutate: (ids: string[]) => void }` (react-query mutation).

- [ ] **Step 1: Write the failing helper test** — `src/features/tasks/commentBadge.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { unreadCommentIndex } from './commentBadge';

const notif = (id: string, task_kind: unknown, task_id: unknown) =>
  ({ id, payload: { task_kind, task_id } });

describe('unreadCommentIndex', () => {
  it('groups by card key with counts and notif ids', () => {
    const idx = unreadCommentIndex([
      notif('n1', 'user_task', 't1'),
      notif('n2', 'user_task', 't1'),
      notif('n3', 'assigned_task', 't2'),
    ]);
    expect(idx.get('user:t1')).toEqual({ count: 2, notifIds: ['n1', 'n2'] });
    expect(idx.get('assigned:t2')).toEqual({ count: 1, notifIds: ['n3'] });
  });

  it('keeps user_task and assigned_task with the same task id separate', () => {
    const idx = unreadCommentIndex([
      notif('n1', 'user_task', 'x'),
      notif('n2', 'assigned_task', 'x'),
    ]);
    expect(idx.get('user:x')?.count).toBe(1);
    expect(idx.get('assigned:x')?.count).toBe(1);
  });

  it('ignores malformed payloads', () => {
    const idx = unreadCommentIndex([
      notif('n1', 'bogus_kind', 't1'),
      notif('n2', 'user_task', 42),
      notif('n3', 'user_task', ''),
      { id: 'n4', payload: {} },
    ]);
    expect(idx.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/tasks/commentBadge.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/features/tasks/commentBadge.ts`**

```ts
export type UnreadCommentNotif = { id: string; payload: Record<string, unknown> };
export type UnreadCommentEntry = { count: number; notifIds: string[] };

const KIND_MAP: Record<string, 'user' | 'assigned'> = {
  user_task: 'user',
  assigned_task: 'assigned',
};

/** Group unread task_comment notifications by board card key (`<kind>:<task_id>`),
 *  matching TaskCard.key. Malformed payloads are skipped. */
export function unreadCommentIndex(rows: UnreadCommentNotif[]): Map<string, UnreadCommentEntry> {
  const map = new Map<string, UnreadCommentEntry>();
  for (const row of rows) {
    const kind = KIND_MAP[String(row.payload['task_kind'] ?? '')];
    const taskId = row.payload['task_id'];
    if (!kind || typeof taskId !== 'string' || !taskId) continue;
    const key = `${kind}:${taskId}`;
    const entry = map.get(key) ?? { count: 0, notifIds: [] };
    entry.count += 1;
    entry.notifIds.push(row.id);
    map.set(key, entry);
  }
  return map;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/tasks/commentBadge.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Add the query key.** In `src/lib/queryKeys.ts`, directly under `notifications: () => ['notifications'] as const,` (line 28):

```ts
// Shares the ['notifications'] prefix: the bell's realtime invalidation
// (useNotificationsRealtime) refreshes this key too.
unreadCommentNotifs: () => ['notifications', 'unread-comments'] as const,
```

- [ ] **Step 6: Write `src/features/notifications/hooks/useUnreadCommentNotifs.ts`**

```ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { UnreadCommentNotif } from '@/features/tasks/commentBadge';

/** Unread task_comment notifications for the signed-in user (RLS-scoped).
 *  Deliberately uncapped: the bell query is limited to the latest 20 rows
 *  across all types and would undercount older unread comments. */
export function useUnreadCommentNotifs() {
  return useQuery({
    queryKey: queryKeys.unreadCommentNotifs(),
    queryFn: async (): Promise<UnreadCommentNotif[]> => {
      const { data, error } = await supabase
        .from('notifications')
        .select('id, payload')
        .eq('type', 'task_comment')
        .is('read_at', null);
      if (error) throw new Error(error.message);
      return (data ?? []) as UnreadCommentNotif[];
    },
  });
}
```

- [ ] **Step 7: Write `src/features/notifications/hooks/useMarkNotificationsRead.ts`** (bulk sibling of the existing `useMarkNotificationRead.ts` — read that file first and mirror its idiom):

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { captureMutation } from '@/lib/sentry/captureMutation';

/** Bulk mark-read. Invalidates the ['notifications'] prefix so the bell,
 *  the notifications column and the task-card badge refresh together. */
export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: captureMutation('notifications', 'mark_read_bulk', async (ids: string[]) => {
      if (ids.length === 0) return;
      const { error } = await supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .in('id', ids);
      if (error) throw new Error(error.message);
    }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.notifications() }),
  });
}
```

- [ ] **Step 8: Verify strict build**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 9: Commit**

```bash
git add src/features/tasks/commentBadge.ts src/features/tasks/commentBadge.test.ts src/features/notifications/hooks/useUnreadCommentNotifs.ts src/features/notifications/hooks/useMarkNotificationsRead.ts src/lib/queryKeys.ts
git commit -m "feat(tasks): unread-comment index + notification hooks for card badge

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -- src/features/tasks/commentBadge.ts src/features/tasks/commentBadge.test.ts src/features/notifications/hooks/useUnreadCommentNotifs.ts src/features/notifications/hooks/useMarkNotificationsRead.ts src/lib/queryKeys.ts
```

---

### Task 2: Card chip + board wiring (both open paths)

**Files:**
- Modify: `src/features/tasks/TaskKanbanCard.tsx` (meta row, ~line 55-73)
- Modify: `src/features/tasks/TasksKanbanColumn.tsx`
- Modify: `src/features/tasks/TasksKanbanBoard.tsx` (imports; hooks ~line 52; onOpen ~line 151; deep-link effect ~line 77-85)
- Test: `src/features/tasks/TasksKanbanBoard.commentbadge.test.tsx` (create)

**Interfaces:**
- Consumes (from Task 1): `unreadCommentIndex` (`./commentBadge`), `useUnreadCommentNotifs` (`@/features/notifications/hooks/useUnreadCommentNotifs`), `useMarkNotificationsRead` (`@/features/notifications/hooks/useMarkNotificationsRead`) — exact signatures in Task 1's Produces block.
- Produces: `TaskKanbanCard` prop `unreadComments?: number`; `TasksKanbanColumn` prop `unreadCount?: (card: TaskCard) => number`.

- [ ] **Step 1: Write the failing board test** — `src/features/tasks/TasksKanbanBoard.commentbadge.test.tsx`. Read `src/features/tasks/TasksKanbanBoard.test.tsx` first — this file follows its mock idiom exactly, adding mocks for the two new hooks and stubbing the detail dialogs (card clicks open them):

```tsx
import type { ReactNode } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

const { useTaskBoardData } = vi.hoisted(() => ({ useTaskBoardData: vi.fn() }));
const { useMentionableUsers } = vi.hoisted(() => ({ useMentionableUsers: vi.fn() }));
const { useUnreadCommentNotifs } = vi.hoisted(() => ({ useUnreadCommentNotifs: vi.fn() }));
const markRead = vi.fn();
vi.mock('./hooks/useTaskBoardData', () => ({ useTaskBoardData, isoDaysAgo: () => '2026-05-23T00:00:00Z' }));
vi.mock('./hooks/useTaskBoardActions', () => ({ useTaskBoardActions: () => ({ mutate: vi.fn() }) }));
vi.mock('@/features/comments/hooks/useMentionableUsers', () => ({ useMentionableUsers }));
vi.mock('@/features/notifications/hooks/useUnreadCommentNotifs', () => ({ useUnreadCommentNotifs }));
vi.mock('@/features/notifications/hooks/useMarkNotificationsRead', () => ({
  useMarkNotificationsRead: () => ({ mutate: markRead }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o?.name ? `${k}:${o.name}` : k), i18n: { resolvedLanguage: 'en' } }),
}));
vi.mock('react-router-dom', () => ({
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
  useSearchParams: () => [new URLSearchParams(), () => {}] as const,
}));
vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ isAdmin: false, user: { id: 'me' } }),
}));
vi.mock('@/features/assigned_tasks/AssignedTaskDetailDialog', () => ({
  AssignedTaskDetailDialog: () => <div>assigned-dialog</div>,
}));
vi.mock('./UserTaskDetailDialog', () => ({ UserTaskDetailDialog: () => <div>user-dialog</div> }));

import { TasksKanbanBoard } from './TasksKanbanBoard';

const assignedRow = (o = {}) => ({
  id: 'a1', title: 'Mine urgent', assignee_user_id: 'me', created_by_user_id: 'me',
  status: 'open', resolved_at: null, importance: 'urgent', source_code: 'D-1',
  deal_id: 'd1', job_id: null, description: null, client: null, department: null, ...o,
});

describe('TasksKanbanBoard unread-comment badge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMentionableUsers.mockReturnValue({ data: [] });
    useTaskBoardData.mockReturnValue({ userRows: [], assignedRows: [assignedRow()], isLoading: false });
  });

  it('shows the 💬 count for a card with unread comments', () => {
    useUnreadCommentNotifs.mockReturnValue({ data: [
      { id: 'n1', payload: { task_kind: 'assigned_task', task_id: 'a1' } },
      { id: 'n2', payload: { task_kind: 'assigned_task', task_id: 'a1' } },
    ] });
    render(<TasksKanbanBoard />);
    expect(within(screen.getByTestId('tasks-col-urgent')).getByText('💬 2')).toBeInTheDocument();
  });

  it('shows no badge without unread comments', () => {
    useUnreadCommentNotifs.mockReturnValue({ data: [] });
    render(<TasksKanbanBoard />);
    expect(screen.queryByText(/💬/)).not.toBeInTheDocument();
  });

  it('opening the card marks exactly its notification ids read', () => {
    useUnreadCommentNotifs.mockReturnValue({ data: [
      { id: 'n1', payload: { task_kind: 'assigned_task', task_id: 'a1' } },
      { id: 'nOther', payload: { task_kind: 'assigned_task', task_id: 'zzz' } },
    ] });
    render(<TasksKanbanBoard />);
    fireEvent.click(within(screen.getByTestId('tasks-col-urgent')).getByText('Mine urgent'));
    expect(markRead).toHaveBeenCalledWith(['n1']);
  });

  it('opening a card without unread comments does not call mark-read', () => {
    useUnreadCommentNotifs.mockReturnValue({ data: [] });
    render(<TasksKanbanBoard />);
    fireEvent.click(within(screen.getByTestId('tasks-col-urgent')).getByText('Mine urgent'));
    expect(markRead).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/tasks/TasksKanbanBoard.commentbadge.test.tsx`
Expected: FAIL — `💬 2` not found (badge not implemented).

- [ ] **Step 3: Add the chip to `TaskKanbanCard.tsx`.**

Prop: extend the component signature (the props object at ~line 13-21):
```tsx
export function TaskKanbanCard({
  card, assigneeName, onAction, onOpen, highlight = false, unreadComments = 0,
}: {
  card: TaskCard;
  assigneeName: string;
  onAction: (action: DragAction) => void;
  onOpen: (card: TaskCard) => void;
  highlight?: boolean;
  unreadComments?: number;
}) {
```

Chip — in the meta row, immediately after the `card.link ? <Link…> : <span…Personal…>` ternary and before the `card.relation === 'delegated'` badge:
```tsx
{unreadComments > 0 && (
  <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
    💬 {unreadComments}
  </span>
)}
```

- [ ] **Step 4: Thread through `TasksKanbanColumn.tsx`.** Add an optional `unreadCount?: (card: TaskCard) => number` prop (after `isNew`), and pass it to each card:

```tsx
export function TasksKanbanColumn({
  column, label, cards, nameFor, onAction, onOpen, isNew, unreadCount,
}: {
  column: ColumnKey;
  label: string;
  cards: TaskCard[];
  nameFor: (id: string) => string;
  onAction: (card: TaskCard, action: DragAction) => void;
  onOpen: (card: TaskCard) => void;
  isNew?: (card: TaskCard) => boolean;
  unreadCount?: (card: TaskCard) => number;
}) {
```
…and on the `<TaskKanbanCard>` render add:
```tsx
unreadComments={unreadCount?.(c) ?? 0}
```

- [ ] **Step 5: Wire the board (`TasksKanbanBoard.tsx`).**

Imports — add:
```tsx
import { useUnreadCommentNotifs } from '@/features/notifications/hooks/useUnreadCommentNotifs';
import { useMarkNotificationsRead } from '@/features/notifications/hooks/useMarkNotificationsRead';
import { unreadCommentIndex } from './commentBadge';
```

After the `useTaskBoardData` line (~52):
```tsx
// Unread-comment badge: derived from unread task_comment bell notifications.
const { data: unreadNotifs = [] } = useUnreadCommentNotifs();
const markRead = useMarkNotificationsRead();
const commentIndex = useMemo(() => unreadCommentIndex(unreadNotifs), [unreadNotifs]);
```

Extract a shared open handler (above the deep-link effect) and use it in BOTH paths — card click and deep link. The deep-link effect currently bypasses `onOpen` and never cleared the new-task highlight (pre-existing gap this fixes):
```tsx
function openCardByKey(card: TaskCard) {
  if (meId) markOpened(meId, card.id);
  const unread = commentIndex.get(card.key);
  if (unread) markRead.mutate(unread.notifIds);
  setOpenKey(card.key);
}
```
Note: `openCardByKey` is used inside the deep-link `useEffect`; to satisfy `react-hooks/exhaustive-deps` either wrap it in `useCallback` with deps `[meId, markOpened, commentIndex, markRead]` and list it in the effect deps, or inline the logic in both places. Prefer `useCallback`. (`markRead.mutate` is referenced via the stable mutation object — depend on `markRead` itself.)

Deep-link effect body becomes:
```tsx
const raw = searchParams.get('open');
if (!raw) return;
const card = cards.find((c) => c.key === raw);
if (!card) return;
openCardByKey(card);
const next = new URLSearchParams(searchParams);
next.delete('open');
setSearchParams(next, { replace: true });
```
(with `openCardByKey` added to the dependency array).

Column render — replace the inline `onOpen` and add `unreadCount`:
```tsx
onOpen={openCardByKey}
isNew={isNew}
unreadCount={(c) => commentIndex.get(c.key)?.count ?? 0}
```

- [ ] **Step 6: Run the new test + existing board tests**

Run: `npx vitest run src/features/tasks/TasksKanbanBoard.commentbadge.test.tsx src/features/tasks/TasksKanbanBoard.test.tsx src/features/tasks/TasksKanbanBoard.deeplink.test.tsx`
Expected: PASS. (The deeplink test may need the two new hook mocks added if it renders the board — read it; if it fails on missing mocks, add the same `vi.mock` lines for `useUnreadCommentNotifs`/`useMarkNotificationsRead` to it and note the addition in your report. The hooks hit supabase, so unmocked they'd also be a prod query from tests — mock them there regardless if that file renders the board.)

- [ ] **Step 7: Strict build**

Run: `npm run build`
Expected: exit 0 (exhaustive-deps clean).

- [ ] **Step 8: Commit**

```bash
git add src/features/tasks/TaskKanbanCard.tsx src/features/tasks/TasksKanbanColumn.tsx src/features/tasks/TasksKanbanBoard.tsx src/features/tasks/TasksKanbanBoard.commentbadge.test.tsx
git commit -m "feat(tasks): 💬 unread-comment badge on board cards, cleared on open

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -- src/features/tasks/TaskKanbanCard.tsx src/features/tasks/TasksKanbanColumn.tsx src/features/tasks/TasksKanbanBoard.tsx src/features/tasks/TasksKanbanBoard.commentbadge.test.tsx
```
(If Step 6 required editing `TasksKanbanBoard.deeplink.test.tsx`, include it in both lists.)

---

### Task 3: Final verification + push (MAIN session)

**Files:** none (verification only).

- [ ] **Step 1: Strict build**

Run: `npm run build` — expected exit 0.

- [ ] **Step 2: Feature test files together**

Run: `npx vitest run src/features/tasks/commentBadge.test.ts src/features/tasks/TasksKanbanBoard.commentbadge.test.tsx src/features/tasks/TasksKanbanBoard.test.tsx src/features/tasks/TasksKanbanBoard.deeplink.test.tsx src/features/tasks/taskCard.test.ts`
Expected: all PASS.

- [ ] **Step 3: Live smoke** (local Vite + prod DB, Playwright): user A (e.g. azazas) comments on a task assigned to user B (e.g. emarketaki via a task A created for B, commenting as A) → B's board card shows 💬 1 (live, without reload if feasible); B opens the card → chip gone AND the bell unread count decremented; A sees no badge for A's own comment. Delete smoke tasks/comments after (task_comments rows cascade? verify: delete the task deletes its comments via FK cascade — check before deleting; notifications rows for it may remain — delete those too by payload task_id).

- [ ] **Step 4: Verify git state then push**

```bash
git fetch && git status && git log origin/main..HEAD --oneline
git push origin main
```

- [ ] **Step 5: Update memory** — extend the tasks-related memory with the badge mechanism (derived from task_comment notifications; bell/badge shared read state).
