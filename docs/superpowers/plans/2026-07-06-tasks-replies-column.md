# 💬 Replies Column Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a derived leftmost "💬 Replies" column to the /tasks board that gathers every task with unread comment replies; opening the task returns it to its normal column.

**Architecture:** Pure-frontend, no storage. The board already computes `commentIndex` (unread comment counts per card key). `columnOf`/`isDraggable` gain an optional `hasUnreadReplies` flag (default false — legacy call sites unaffected); `BOARD_COLUMNS` gains `'replies'` first; `resolveDrag` no-ops on the new column; the board consults `commentIndex` when bucketing.

**Tech Stack:** React 18 + TypeScript (strict), vitest + testing-library, react-i18next.

**Spec:** `docs/superpowers/specs/2026-07-06-tasks-replies-column-design.md`

## Global Constraints

- Verify with `npm run build` (strict `tsc -b` + eslint `--max-warnings=0`).
- vitest runs against PROD — run ONLY the test files named in each task.
- No DB changes.
- Commit per task with explicit pathspecs; push directly to `main`.
- Column title exactly: en `"💬 Replies"`, el `"💬 Απαντήσεις"` under `tasks_page.column_replies`.
- Column order exactly: `['replies', 'urgent', 'high', 'medium', 'low', 'resolved']`.
- Replies beats Resolved: a resolved card with unread replies sits in Replies until opened.
- End commit messages with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Column logic in `taskCard.ts` (pure, TDD)

**Files:**
- Modify: `src/features/tasks/taskCard.ts` (ColumnKey ~line 6, BOARD_COLUMNS ~line 10, `columnOf` ~line 84, `isDraggable` ~line 89, `resolveDrag` ~line 113)
- Test: `src/features/tasks/taskCard.test.ts` (extend)

**Interfaces:**
- Consumes: nothing new.
- Produces (Task 2 relies on):
  - `type ColumnKey = ImportanceCode | 'resolved' | 'replies'`
  - `BOARD_COLUMNS: ColumnKey[]` = `['replies', 'urgent', 'high', 'medium', 'low', 'resolved']`
  - `columnOf(card: TaskCard, hasUnreadReplies = false): ColumnKey`
  - `isDraggable(card: TaskCard, hasUnreadReplies = false): boolean`
  - `resolveDrag(card, target)` returns `{ type: 'noop' }` when `target === 'replies'`.

- [ ] **Step 1: Write the failing tests.** In `src/features/tasks/taskCard.test.ts` — read the file first and reuse its existing `userRow()` / `assignedRow()` fixtures and `me` constant (follow the file's naming); add:

```ts
describe('replies column', () => {
  it('unread replies win over importance', () => {
    const c = userTaskToCard(userRow(), me);
    expect(columnOf(c, true)).toBe('replies');
    expect(columnOf(c, false)).toBe(columnOf(c)); // legacy default unchanged
  });

  it('unread replies win over resolved (resurfacing)', () => {
    const c = userTaskToCard(userRow({ completed_at: '2026-07-01T00:00:00Z' }), me);
    expect(columnOf(c)).toBe('resolved');
    expect(columnOf(c, true)).toBe('replies');
  });

  it('cards with unread replies are not draggable', () => {
    const c = userTaskToCard(userRow(), me); // relation mine -> normally draggable
    expect(isDraggable(c)).toBe(true);
    expect(isDraggable(c, true)).toBe(false);
  });

  it('dropping onto the replies column is a noop', () => {
    const c = userTaskToCard(userRow(), me);
    expect(resolveDrag(c, 'replies')).toEqual({ type: 'noop' });
  });

  it('replies is the first board column', () => {
    expect(BOARD_COLUMNS[0]).toBe('replies');
    expect(BOARD_COLUMNS).toHaveLength(6);
  });
});
```

Add `BOARD_COLUMNS` and any missing names to the file's existing import from `./taskCard`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/tasks/taskCard.test.ts`
Expected: FAIL (type error / 'replies' not assignable, BOARD_COLUMNS length 5).

- [ ] **Step 3: Implement in `taskCard.ts`.** Exact edits:

```ts
export type ColumnKey = ImportanceCode | 'resolved' | 'replies';
```

```ts
/** Left→right column order on the board. Replies is derived (unread comment
 *  notifications), not a stored state — see columnOf. */
export const BOARD_COLUMNS: ColumnKey[] = ['replies', 'urgent', 'high', 'medium', 'low', 'resolved'];
```

```ts
/** hasUnreadReplies (derived from unread comment notifications) wins over
 *  everything — including resolved, so a reply resurfaces a resolved task.
 *  Optional so non-board callers (client/lead tabs) keep legacy behavior. */
export function columnOf(card: TaskCard, hasUnreadReplies = false): ColumnKey {
  if (hasUnreadReplies) return 'replies';
  return card.resolved ? 'resolved' : card.importance;
}
```

```ts
/** Only tasks where I'm the assignee can be moved/resolved from my board.
 *  Cards sitting in Replies are read-first: not draggable until opened. */
export function isDraggable(card: TaskCard, hasUnreadReplies = false): boolean {
  return card.relation === 'mine' && !hasUnreadReplies;
}
```

In `resolveDrag`, insert as the FIRST line of the function body:

```ts
if (target === 'replies') return { type: 'noop' };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/tasks/taskCard.test.ts`
Expected: PASS (all existing tests too — legacy defaults preserved).

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/taskCard.ts src/features/tasks/taskCard.test.ts
git commit -m "feat(tasks): replies column logic (derived, wins over resolved)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -- src/features/tasks/taskCard.ts src/features/tasks/taskCard.test.ts
```

---

### Task 2: Board wiring + card draggable + locales

**Files:**
- Modify: `src/features/tasks/TasksKanbanBoard.tsx` (byColumn memo ~line 68; columnLabel ~line 130; column render ~line 168)
- Modify: `src/features/tasks/TaskKanbanCard.tsx` (draggable decision ~line 24)
- Modify: `src/i18n/locales/en/common.json`, `src/i18n/locales/el/common.json` (`tasks_page.column_replies`)
- Test: `src/features/tasks/TasksKanbanBoard.commentbadge.test.tsx` (extend)

**Interfaces:**
- Consumes (Task 1): `columnOf(card, hasUnreadReplies?)`, `isDraggable(card, hasUnreadReplies?)`, `BOARD_COLUMNS` incl. `'replies'`.
- Consumes (existing): `commentIndex` map in the board (built via `unreadCommentIndex`), `unreadComments` prop already threaded to `TaskKanbanCard`.
- Produces: user-visible feature complete.

- [ ] **Step 1: Write the failing board tests.** In `src/features/tasks/TasksKanbanBoard.commentbadge.test.tsx` (read it first — reuse its mocks/fixtures verbatim), add inside the existing describe:

```tsx
it('a card with unread replies sits in the Replies column, not its importance column', () => {
  useUnreadCommentNotifs.mockReturnValue({ data: [
    { id: 'n1', payload: { task_kind: 'assigned_task', task_id: 'a1' } },
  ] });
  render(<TasksKanbanBoard />);
  const replies = screen.getByTestId('tasks-col-replies');
  expect(within(replies).getByText('Mine urgent')).toBeInTheDocument();
  expect(within(screen.getByTestId('tasks-col-urgent')).queryByText('Mine urgent')).not.toBeInTheDocument();
});

it('returns to its importance column once the replies are read', () => {
  useUnreadCommentNotifs.mockReturnValue({ data: [] });
  render(<TasksKanbanBoard />);
  expect(within(screen.getByTestId('tasks-col-urgent')).getByText('Mine urgent')).toBeInTheDocument();
  expect(within(screen.getByTestId('tasks-col-replies')).queryByText('Mine urgent')).not.toBeInTheDocument();
});

it('renders Replies as the leftmost column', () => {
  useUnreadCommentNotifs.mockReturnValue({ data: [] });
  render(<TasksKanbanBoard />);
  const cols = screen.getAllByTestId(/tasks-col-/);
  expect(cols[0]).toHaveAttribute('data-testid', 'tasks-col-replies');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/tasks/TasksKanbanBoard.commentbadge.test.tsx`
Expected: FAIL (`tasks-col-replies` not found).

- [ ] **Step 3: Wire `TasksKanbanBoard.tsx`.** Read the file first (it has `commentIndex`, `openCardByKey`, and an `unreadCount` prop from the badge feature). Exact edits:

`byColumn` memo — pass the flag and add the dependency:
```tsx
const byColumn = useMemo(() => {
  const map = new Map<ColumnKey, TaskCard[]>(BOARD_COLUMNS.map((c) => [c, []]));
  for (const card of cards) {
    const hasUnread = (commentIndex.get(card.key)?.count ?? 0) > 0;
    if (matchesFilter(card, filter)) map.get(columnOf(card, hasUnread))!.push(card);
  }
  return map;
}, [cards, filter, commentIndex]);
```

`columnLabel` — add the replies case:
```tsx
const columnLabel = (c: ColumnKey) =>
  c === 'resolved' ? t('tasks_page.column_resolved')
  : c === 'replies' ? t('tasks_page.column_replies')
  : t(`importance.${c}`);
```

No other board change: the `unreadCount` prop already reaches each card, and dropping onto the new column is neutralized by `resolveDrag` (Task 1).

- [ ] **Step 4: Card draggable decision.** In `TaskKanbanCard.tsx` line ~24, change:

```tsx
const draggable = isDraggable(card, unreadComments > 0);
```

(the `unreadComments = 0` default already exists in the props from the badge feature).

- [ ] **Step 5: Locale keys.** In `tasks_page` of BOTH common.json files, next to `"column_resolved"`:
- en: `"column_replies": "💬 Replies",`
- el: `"column_replies": "💬 Απαντήσεις",`

- [ ] **Step 6: Run the board tests + affected neighbors**

Run: `npx vitest run src/features/tasks/TasksKanbanBoard.commentbadge.test.tsx src/features/tasks/TasksKanbanBoard.test.tsx src/features/tasks/TasksKanbanBoard.deeplink.test.tsx src/features/tasks/taskCard.test.ts`
Expected: PASS. If an existing test asserts on column count/order, fix its expectation to the new 6-column reality and report the change.

- [ ] **Step 7: Strict build**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/features/tasks/TasksKanbanBoard.tsx src/features/tasks/TaskKanbanCard.tsx src/features/tasks/TasksKanbanBoard.commentbadge.test.tsx src/i18n/locales/en/common.json src/i18n/locales/el/common.json
git commit -m "feat(tasks): 💬 Replies column gathers unread-reply tasks first on the board

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -- src/features/tasks/TasksKanbanBoard.tsx src/features/tasks/TaskKanbanCard.tsx src/features/tasks/TasksKanbanBoard.commentbadge.test.tsx src/i18n/locales/en/common.json src/i18n/locales/el/common.json
```

---

### Task 3: Final verification + push (MAIN session)

- [ ] **Step 1:** `npm run build` — exit 0.
- [ ] **Step 2:** `npx vitest run src/features/tasks/taskCard.test.ts src/features/tasks/TasksKanbanBoard.commentbadge.test.tsx src/features/tasks/TasksKanbanBoard.test.tsx src/features/tasks/TasksKanbanBoard.deeplink.test.tsx` — all PASS.
- [ ] **Step 3:** Live smoke (local Vite + prod DB): user A comments on a task assigned to B → B's board shows the task in 💬 Replies (leftmost) with the badge; B opens it → card returns to its importance column and the bell count drops; a resolved task with a reply resurfaces in Replies and returns to Resolved after opening. Clean up fixtures (delete smoke tasks + their comment notifications; comments cascade on task delete).
- [ ] **Step 4:** `git fetch && git log origin/main..HEAD --oneline` then `git push origin main`.
- [ ] **Step 5:** Update memory (`project_task_comment_badge.md` gains the Replies-column note + any new gotchas).
