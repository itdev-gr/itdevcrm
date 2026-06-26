# Highlight New (Unopened) Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Highlight a task (ring/accent + amber dot) on the Tasks board, the job/deal Tasks tabs, and the Home widget when it's unopened AND created within 14 days; opening it clears the highlight everywhere (per-device).

**Architecture:** Per-user "opened task ids" set added to the existing localStorage `tasksSeenStore`; a pure `isTaskHighlighted` rule; a shared style module. Each of the three surfaces computes the per-task highlight and calls `markOpened` when the task's detail is opened. No DB change.

**Tech Stack:** React + TypeScript (strict), zustand + persist, @tanstack/react-query, vitest. Verify with `npm run build`.

**Spec:** `docs/superpowers/specs/2026-06-26-new-task-highlight-design.md`

---

## File Structure
**Created:** `src/features/tasks/taskHighlight.ts` (+test), `src/features/tasks/taskHighlightStyle.tsx`.
**Modified:** `src/features/tasks/tasksSeenStore.ts`, `TasksKanbanBoard.tsx`, `TasksKanbanColumn.tsx`, `TaskKanbanCard.tsx`, `src/features/assigned_tasks/AssignedTasksTab.tsx`, `src/features/assigned_tasks/AssignedTasksColumn.tsx`.

---

## Task 1: Pure `isTaskHighlighted` (TDD)

**Files:** Create `src/features/tasks/taskHighlight.ts`; Test `src/features/tasks/taskHighlight.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { isTaskHighlighted, HIGHLIGHT_WINDOW_DAYS } from './taskHighlight';

const now = Date.parse('2026-06-26T12:00:00Z');
const cutoffMs = now - HIGHLIGHT_WINDOW_DAYS * 86_400_000;
const recent = '2026-06-25T12:00:00Z'; // 1 day ago
const old = '2026-05-01T12:00:00Z'; // > 14 days ago

describe('isTaskHighlighted', () => {
  it('unopened + recent → highlighted', () => {
    expect(isTaskHighlighted({ createdAtIso: recent, opened: false, cutoffMs })).toBe(true);
  });
  it('opened + recent → not highlighted', () => {
    expect(isTaskHighlighted({ createdAtIso: recent, opened: true, cutoffMs })).toBe(false);
  });
  it('unopened + old → not highlighted', () => {
    expect(isTaskHighlighted({ createdAtIso: old, opened: false, cutoffMs })).toBe(false);
  });
  it('null/invalid createdAt → not highlighted', () => {
    expect(isTaskHighlighted({ createdAtIso: null, opened: false, cutoffMs })).toBe(false);
    expect(isTaskHighlighted({ createdAtIso: 'nonsense', opened: false, cutoffMs })).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`Cannot find module './taskHighlight'`)
Run: `npx vitest run src/features/tasks/taskHighlight.test.ts`

- [ ] **Step 3: Implement** `src/features/tasks/taskHighlight.ts`

```ts
export const HIGHLIGHT_WINDOW_DAYS = 14;

/** A task is "new" (highlight it) when the viewer hasn't opened it yet AND it was
 *  created within the highlight window. `cutoffMs` = now - HIGHLIGHT_WINDOW_DAYS days. */
export function isTaskHighlighted(params: {
  createdAtIso: string | null;
  opened: boolean;
  cutoffMs: number;
}): boolean {
  const { createdAtIso, opened, cutoffMs } = params;
  if (opened || !createdAtIso) return false;
  const t = Date.parse(createdAtIso);
  return Number.isFinite(t) && t >= cutoffMs;
}
```

- [ ] **Step 4: Run — expect PASS**
Run: `npx vitest run src/features/tasks/taskHighlight.test.ts`

- [ ] **Step 5: Commit**
```bash
git add src/features/tasks/taskHighlight.ts src/features/tasks/taskHighlight.test.ts
git commit -m "feat(tasks): pure isTaskHighlighted rule + tests"
```

---

## Task 2: Extend `tasksSeenStore` with the opened set

**Files:** Modify `src/features/tasks/tasksSeenStore.ts`

- [ ] **Step 1: Add `openedByUser` + `markOpened`** — replace the file body with:

```ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Per-user, per-device task state in localStorage:
//  - seenByUser: when the user last opened the Tasks page (sidebar "new" badge).
//  - openedByUser: which individual tasks the user has opened (for the new-task
//    highlight — a task stays highlighted until opened).
type TasksSeenState = {
  seenByUser: Record<string, string>;
  markSeen: (userId: string, iso: string) => void;
  openedByUser: Record<string, Record<string, true>>;
  markOpened: (userId: string, taskId: string) => void;
};

export const useTasksSeenStore = create<TasksSeenState>()(
  persist(
    (set) => ({
      seenByUser: {},
      markSeen: (userId, iso) =>
        set((s) => ({ seenByUser: { ...s.seenByUser, [userId]: iso } })),
      openedByUser: {},
      markOpened: (userId, taskId) =>
        set((s) => ({
          openedByUser: {
            ...s.openedByUser,
            [userId]: { ...(s.openedByUser[userId] ?? {}), [taskId]: true },
          },
        })),
    }),
    { name: 'itdevcrm-tasks-seen-v1' },
  ),
);
```

- [ ] **Step 2: Typecheck**
Run: `npm run typecheck` → PASS.

- [ ] **Step 3: Commit**
```bash
git add src/features/tasks/tasksSeenStore.ts
git commit -m "feat(tasks): track opened task ids per user in tasksSeenStore"
```

---

## Task 3: Shared highlight style

**Files:** Create `src/features/tasks/taskHighlightStyle.tsx`

- [ ] **Step 1: Implement**

```tsx
/** Amber ring for kanban cards. */
export const NEW_TASK_RING = 'ring-2 ring-amber-400/70 dark:ring-amber-500/60';
/** Subtle amber tint for list rows. */
export const NEW_TASK_ROW = 'bg-amber-50 dark:bg-amber-950/20';

/** Small amber "new" dot shown next to a new task's title. */
export function NewTaskDot() {
  return (
    <span
      className="inline-block size-2 shrink-0 rounded-full bg-amber-500"
      aria-label="new"
      title="New"
    />
  );
}
```

- [ ] **Step 2: Typecheck + Commit**
Run: `npm run typecheck` → PASS.
```bash
git add src/features/tasks/taskHighlightStyle.tsx
git commit -m "feat(tasks): shared new-task highlight style (ring/tint + dot)"
```

---

## Task 4: Tasks board (`/tasks`)

**Files:** Modify `TaskKanbanCard.tsx`, `TasksKanbanColumn.tsx`, `TasksKanbanBoard.tsx`

- [ ] **Step 1: `TaskKanbanCard` — `highlight` prop → ring + dot**

Add imports:
```tsx
import { NEW_TASK_RING, NewTaskDot } from './taskHighlightStyle';
```
Extend the props:
```tsx
export function TaskKanbanCard({
  card, assigneeName, onAction, onOpen, highlight = false,
}: {
  card: TaskCard;
  assigneeName: string;
  onAction: (action: DragAction) => void;
  onOpen: (card: TaskCard) => void;
  highlight?: boolean;
}) {
```
Add the ring to the root `className`:
```tsx
      className={cn(
        'rounded-lg border border-border/60 bg-background px-3 py-2.5 shadow-sm',
        draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-default',
        highlight && NEW_TASK_RING,
      )}
```
Add the dot before the title:
```tsx
      <div className="flex flex-wrap items-center gap-1.5">
        {highlight && <NewTaskDot />}
        <span className="truncate text-sm font-medium">{card.title}</span>
        <ImportanceBadge importance={card.importance} />
      </div>
```

- [ ] **Step 2: `TasksKanbanColumn` — thread `isNew`**

Extend props + pass `highlight`:
```tsx
export function TasksKanbanColumn({
  column, label, cards, nameFor, onAction, onOpen, isNew,
}: {
  column: ColumnKey;
  label: string;
  cards: TaskCard[];
  nameFor: (id: string) => string;
  onAction: (card: TaskCard, action: DragAction) => void;
  onOpen: (card: TaskCard) => void;
  isNew?: (card: TaskCard) => boolean;
}) {
```
```tsx
          cards.map((c) => (
            <TaskKanbanCard
              key={c.key}
              card={c}
              assigneeName={nameFor(c.assigneeId)}
              onAction={(a) => onAction(c, a)}
              onOpen={onOpen}
              highlight={isNew?.(c) ?? false}
            />
          ))
```

- [ ] **Step 3: `TasksKanbanBoard` — compute highlight + markOpened on open**

Add imports:
```tsx
import { useTasksSeenStore } from './tasksSeenStore';
import { isTaskHighlighted, HIGHLIGHT_WINDOW_DAYS } from './taskHighlight';
```
Add a module-level stable empty map (top of file, after imports):
```tsx
const EMPTY_OPENED: Record<string, true> = {};
```
Inside the component (with the other hooks; `meId` already exists):
```tsx
  const opened = useTasksSeenStore((s) => s.openedByUser[meId] ?? EMPTY_OPENED);
  const markOpened = useTasksSeenStore((s) => s.markOpened);
  const [highlightCutoffMs] = useState(() => Date.now() - HIGHLIGHT_WINDOW_DAYS * 86_400_000);
  const isNew = (card: TaskCard) =>
    isTaskHighlighted({ createdAtIso: card.createdAtIso, opened: !!opened[card.id], cutoffMs: highlightCutoffMs });
```
Change the column's `onOpen` to also mark opened, and pass `isNew`:
```tsx
              <TasksKanbanColumn
                key={c}
                column={c}
                label={columnLabel(c)}
                cards={byColumn.get(c) ?? []}
                nameFor={nameFor}
                onAction={fire}
                onOpen={(card) => {
                  if (meId) markOpened(meId, card.id);
                  setOpenKey(card.key);
                }}
                isNew={isNew}
              />
```

- [ ] **Step 4: Build + tasks tests**
Run: `npm run build && npx vitest run src/features/tasks`
Expected: build green, tests pass.

- [ ] **Step 5: Commit**
```bash
git add src/features/tasks/TaskKanbanCard.tsx src/features/tasks/TasksKanbanColumn.tsx src/features/tasks/TasksKanbanBoard.tsx
git commit -m "feat(tasks): highlight new task cards on the board until opened"
```

---

## Task 5: Job & deal Tasks tabs

**Files:** Modify `src/features/assigned_tasks/AssignedTasksTab.tsx`

- [ ] **Step 1: Imports + per-row highlight + mark opened**

Add imports:
```tsx
import { useState as _useStateUnused } from 'react'; // (useState already imported; skip if present)
import { useTasksSeenStore } from '@/features/tasks/tasksSeenStore';
import { isTaskHighlighted, HIGHLIGHT_WINDOW_DAYS } from '@/features/tasks/taskHighlight';
import { NEW_TASK_ROW, NewTaskDot } from '@/features/tasks/taskHighlightStyle';
```
(Do NOT add a duplicate `useState` import — `AssignedTasksTab` already imports it.) Add a module-level constant near the top:
```tsx
const EMPTY_OPENED: Record<string, true> = {};
```

- [ ] **Step 2: `TaskRow` — `isNew` prop → tint + dot**

```tsx
function TaskRow({
  task,
  onOpen,
  fromDeal = false,
  isNew = false,
}: {
  task: AssignedTaskRow;
  onOpen: (id: string) => void;
  fromDeal?: boolean;
  isNew?: boolean;
}) {
```
Change the `<li>`:
```tsx
    <li className={cn('border-t first:border-t-0', isNew && NEW_TASK_ROW)}>
```
(add `import { cn } from '@/lib/utils';` if not present) and add the dot before the title:
```tsx
          <div className="flex items-center gap-2">
            {isNew && <NewTaskDot />}
            <span className="text-sm font-medium">{task.title}</span>
            <DepartmentChip department={task.department} />
```

- [ ] **Step 3: `AssignedTasksTab` — compute highlight + open handler**

Inside the component, after the existing hooks:
```tsx
  const userId = useAuthStore((s) => s.user?.id ?? '');
  const opened = useTasksSeenStore((s) => s.openedByUser[userId] ?? EMPTY_OPENED);
  const markOpened = useTasksSeenStore((s) => s.markOpened);
  const [highlightCutoffMs] = useState(() => Date.now() - HIGHLIGHT_WINDOW_DAYS * 86_400_000);
  const newFor = (task: AssignedTaskRow) =>
    isTaskHighlighted({ createdAtIso: task.created_at, opened: !!opened[task.id], cutoffMs: highlightCutoffMs });
  const handleOpen = (id: string) => {
    if (userId) markOpened(userId, id);
    setOpenTaskId(id);
  };
```
(`useAuthStore` is already imported; `useState` is already imported.) Update both `TaskRow` render sites to use `handleOpen` and `isNew`:
```tsx
          {open.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              onOpen={handleOpen}
              fromDeal={source.kind === 'job' && task.job_id == null}
              isNew={newFor(task)}
            />
          ))}
```
and the resolved list likewise (resolved tasks won't be "new" since they're not recently-unopened-open, but pass it for consistency):
```tsx
          {resolved.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              onOpen={handleOpen}
              fromDeal={source.kind === 'job' && task.job_id == null}
              isNew={newFor(task)}
            />
          ))}
```

- [ ] **Step 4: Build + assigned_tasks tests**
Run: `npm run build && npx vitest run src/features/assigned_tasks`
Expected: green.

- [ ] **Step 5: Commit**
```bash
git add src/features/assigned_tasks/AssignedTasksTab.tsx
git commit -m "feat(tasks): highlight new tasks in the job/deal Tasks tab until opened"
```

---

## Task 6: Home "assigned to me" widget

**Files:** Modify `src/features/assigned_tasks/AssignedTasksColumn.tsx`

- [ ] **Step 1: Imports + constant**

Add:
```tsx
import { useState } from 'react'; // already imported — keep single import
import { useTasksSeenStore } from '@/features/tasks/tasksSeenStore';
import { isTaskHighlighted, HIGHLIGHT_WINDOW_DAYS } from '@/features/tasks/taskHighlight';
import { NEW_TASK_ROW, NewTaskDot } from '@/features/tasks/taskHighlightStyle';
```
Module-level constant near the top:
```tsx
const EMPTY_OPENED: Record<string, true> = {};
```

- [ ] **Step 2: `Row` and `PersonalRow` — `isNew` prop → tint + dot**

`Row` (assigned): add `isNew = false` to props/type; change the `<button>` className to append `isNew && NEW_TASK_ROW` (wrap with `cn(...)`), and add `{isNew && <NewTaskDot />}` before the title `<span>`. Concretely the button:
```tsx
        className={cn(
          'flex w-full items-start gap-3 rounded-lg border border-border/60 bg-background px-3 py-3 text-left shadow-sm transition-colors hover:border-primary/20 hover:bg-primary/5',
          isNew && NEW_TASK_ROW,
        )}
```
and the title row:
```tsx
          <div className="flex flex-wrap items-center gap-2">
            {isNew && <NewTaskDot />}
            <span className="truncate text-sm font-medium">{task.title}</span>
```
Do the identical change in `PersonalRow`. (`cn` is already imported in this file.)

- [ ] **Step 3: `AssignedTasksColumn` — compute highlight + mark opened**

Inside the component (after `userId` is read):
```tsx
  const opened = useTasksSeenStore((s) => s.openedByUser[userId] ?? EMPTY_OPENED);
  const markOpened = useTasksSeenStore((s) => s.markOpened);
  const [highlightCutoffMs] = useState(() => Date.now() - HIGHLIGHT_WINDOW_DAYS * 86_400_000);
  const newForId = (id: string, createdAt: string) =>
    isTaskHighlighted({ createdAtIso: createdAt, opened: !!opened[id], cutoffMs: highlightCutoffMs });
  const openAssigned = (id: string) => {
    if (userId) markOpened(userId, id);
    setOpenTaskId(id);
  };
  const openPersonal = (task: UserTaskRow) => {
    if (userId) markOpened(userId, task.id);
    openEditTask(task);
  };
```
Update the list render to pass `isNew` + the new open handlers:
```tsx
            {items.map((item) =>
              item.kind === 'assigned' ? (
                <Row
                  key={`a-${item.task.id}`}
                  task={item.task}
                  canResolve={isAdmin || item.task.assignee_user_id === userId}
                  onOpen={openAssigned}
                  isNew={newForId(item.task.id, item.task.created_at)}
                />
              ) : (
                <PersonalRow
                  key={`p-${item.task.id}`}
                  task={item.task}
                  canResolve={isAdmin || item.task.user_id === userId}
                  onOpen={openPersonal}
                  isNew={newForId(item.task.id, item.task.created_at)}
                />
              ),
            )}
```

- [ ] **Step 4: Build**
Run: `npm run build` → green.

- [ ] **Step 5: Commit**
```bash
git add src/features/assigned_tasks/AssignedTasksColumn.tsx
git commit -m "feat(tasks): highlight new tasks in the Home assigned-to-me widget until opened"
```

---

## Task 7: Full verification, push, live smoke

- [ ] **Step 1:** `npm run build && npm run test:run` → green (incl. `taskHighlight.test.ts`).
- [ ] **Step 2:** Push: `git fetch origin && git pull --rebase origin main && git push origin HEAD:main` (commit only this plan's files).
- [ ] **Step 3: Live smoke** (local `npm run dev` → prod DB, or deployed once the chunk hash changes):
  1. As an admin, create a delegated task (assigned to yourself) on a deal with a department.
  2. On `/tasks` the new card shows the amber ring + dot; the deal's & matching job's **Tasks tab** rows show the tint + dot; the Home **assigned-to-me** widget row shows the dot.
  3. Open the task once (click it) → the highlight clears on all three; reload → still cleared (localStorage).
  4. An older task (created >14 days ago) shows no highlight.
  5. Clean up the smoke task. `browser_console_messages` level=error → 0. (If the test browser is locked by a parallel session, verify the store + rule logic via the unit tests and a quick localStorage inspection.)

---

## Self-Review (run before execution)
- **Spec coverage:** rule unopened+≤14d (Task 1) ✅; per-user opened set in localStorage (Task 2) ✅; shared ring/tint+dot (Task 3) ✅; board (Task 4), Tasks tabs (Task 5), Home widget (Task 6) ✅; opening clears everywhere via shared store (markOpened in 4/5/6) ✅; no DB change ✅; tests+build+smoke (Task 1/7) ✅.
- **Type consistency:** `isTaskHighlighted({ createdAtIso, opened, cutoffMs })` identical in Task 1 and Tasks 4/5/6. `markOpened(userId, taskId)` and `openedByUser[userId]` identical in Task 2 and consumers. `highlight`/`isNew` boolean props match between column/card (Task 4) and rows (Task 5/6). `EMPTY_OPENED` stable-ref constant in each consumer.
- **No placeholders:** every code step has complete code (the "_useStateUnused"/duplicate-import notes are guidance to NOT double-import, not code to paste).
