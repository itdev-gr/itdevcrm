# Highlight new (unopened) tasks until opened

**Date:** 2026-06-26
**Status:** Approved, ready for implementation plan

## Problem

When a task is created, staff have no quick way to spot which task on a board is the
new one. They want new tasks **highlighted** until they **open** that task, at which
point the highlight clears.

## Scope & decisions (confirmed with product owner)

- **Highlight rule:** a task highlights when it is **(a) not yet opened by me** AND
  **(b) created within the last 14 days**. So new tasks light up until opened; old
  backlog never floods, and an unopened task stops highlighting after 14 days.
- **"Open it" clears it** — viewing the task's detail marks it opened; the highlight
  clears **everywhere it appears at once** (shared state).
- **Per device** — the "opened" set is stored in localStorage (per user), matching the
  existing `tasksSeenStore`. No DB change.
- **Surfaces (all three):** the Tasks board (`/tasks`), the job & deal **Tasks tabs**,
  and the Home **"assigned to me"** widget.

## Grounding (current code)

- `src/features/tasks/tasksSeenStore.ts` — persisted zustand store (`seenByUser`,
  `markSeen`) for the sidebar "new since last visit" badge. We extend it.
- Tasks board: `TasksKanbanBoard` → `TasksKanbanColumn` → `TaskKanbanCard`
  (`onOpen(card)`; `card.createdAtIso`, `card.id`).
- Tasks tab: `AssignedTasksTab` → `TaskRow` (`onOpen(task.id)`; `task.created_at`,
  `task.id`).
- Home widget: `src/features/home/AssignedTasksColumn.tsx` (unions user_tasks +
  assigned_tasks; opens a detail/edit on click).
- `useAuthStore` gives the current user id on every surface.

## Architecture

### Store: extend `tasksSeenStore`

```ts
type TasksSeenState = {
  seenByUser: Record<string, string>;
  markSeen: (userId: string, iso: string) => void;
  // NEW:
  openedByUser: Record<string, Record<string, true>>; // userId -> { taskId: true }
  markOpened: (userId: string, taskId: string) => void;
};
```

`markOpened` adds `taskId` under the user's map. `openedByUser` defaults to `{}` (safe
shallow-merge on rehydrate of the existing persisted state). Keep the same persist
`name` (adding a field is backward-compatible).

### Pure rule: `src/features/tasks/taskHighlight.ts` (+ test)

```ts
export const HIGHLIGHT_WINDOW_DAYS = 14;

/** A task is "new" (highlight it) when the viewer hasn't opened it yet AND it was
 *  created within the highlight window. */
export function isTaskHighlighted(params: {
  createdAtIso: string | null;
  opened: boolean;
  cutoffMs: number; // now - HIGHLIGHT_WINDOW_DAYS days
}): boolean {
  const { createdAtIso, opened, cutoffMs } = params;
  if (opened || !createdAtIso) return false;
  const t = Date.parse(createdAtIso);
  return Number.isFinite(t) && t >= cutoffMs;
}
```

Tests: unopened+recent → true; opened+recent → false; unopened+old → false;
null createdAt → false.

### Shared highlight style: `src/features/tasks/taskHighlightStyle.tsx`

```tsx
export const NEW_TASK_RING = 'ring-2 ring-amber-400/70 dark:ring-amber-500/60';

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

Cards apply `NEW_TASK_RING`; rows/widget items show a left accent + `<NewTaskDot/>`.

### Surface integration (same pattern each)

Each surface, at its top level (has `userId`, the store, and a once-per-mount
`cutoffMs`):
- `const opened = useTasksSeenStore((s) => s.openedByUser[userId] ?? EMPTY);`
- `const [cutoffMs] = useState(() => Date.now() - HIGHLIGHT_WINDOW_DAYS * 86_400_000);`
- per item: `isTaskHighlighted({ createdAtIso, opened: !!opened[taskId], cutoffMs })`.
- on open: `markOpened(userId, taskId)` (alongside the existing open handler).

1. **Tasks board** — `TasksKanbanBoard` passes a per-card `highlight` boolean through
   `TasksKanbanColumn` to `TaskKanbanCard`, which adds `NEW_TASK_RING` + a `NewTaskDot`
   by the title. The board's open handler also calls `markOpened(meId, card.id)`.
2. **Tasks tab** — `AssignedTasksTab` computes highlight per task and passes a `isNew`
   boolean to `TaskRow` (left accent + dot); its `onOpen` calls `markOpened(meId, id)`.
3. **Home widget** — `AssignedTasksColumn` adds a dot to new items and calls
   `markOpened(meId, id)` on open.

Because all three read the same store, opening from one clears the highlight on all.
`EMPTY` is a module-level `{}` constant so the selector returns a stable reference.

## Error handling
- No user id (not signed in): `opened` map empty → nothing crashes; highlights show by
  recency only until sign-in resolves (transient).
- Unknown/old `createdAt`: rule returns false (no highlight).

## Testing
- **Unit:** `taskHighlight.test.ts` (4 cases above).
- `npm run build` green.
- **Live smoke:** create a task → it shows the ring/dot on the `/tasks` board, the
  matching job's/deal's Tasks tab, and the Home widget → open it once → the highlight
  clears on all three → reload → stays cleared (persisted). An old task (>14d) shows no
  highlight.

## Changes / Revert
**Changes:** extend `tasksSeenStore` (openedByUser + markOpened); new `taskHighlight.ts`
(+test) and `taskHighlightStyle.tsx`; edits to `TasksKanbanBoard`, `TasksKanbanColumn`,
`TaskKanbanCard`, `AssignedTasksTab`, `AssignedTasksColumn`.
**Revert:** `git revert` the frontend commits. No DB change; the extra localStorage
field is inert if unused.

## Out of scope (YAGNI)
- Cross-device "opened" sync (would need a server table) — per-device is enough.
- A "mark all as seen" button.
- Highlighting resolved tasks (only open tasks are shown on the board/widget anyway).
- Changing the existing sidebar "new since last visit" badge.
