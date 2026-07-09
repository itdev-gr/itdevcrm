# Design: Show a client's open tasks in the task-create dialog

**Date:** 2026-07-09
**Status:** Approved (design)

## Problem

When a user creates a personal task and selects a client, they have no visibility
into what work is already open on that client. This causes duplicate tasks and
missed context. We want the create dialog to surface the client's currently-open
tasks the moment a client is picked — and to show only the tasks that user is
allowed to see.

## Goal

In the personal task-create dialog (`TaskDialog`), when a client is selected,
render a compact list of that client's **open** tasks (both personal and
deal/job), each row clickable to open its detail dialog. Visibility must respect
each viewer's rights.

## Scope

- **In:** `TaskDialog` (personal `user_tasks` create flow), client-picker mode only.
- **Out:** lead picker (no list for leads); the deal/job `NewAssignedTaskDialog`
  (has no client picker); edit mode (see decision below).

## Key facts (from code exploration)

- **Visibility is 100% RLS-enforced at the DB.** A plain
  `select … eq('client_id', …)` from `user_tasks` / `assigned_tasks` returns only
  the rows the current viewer may see:
  - `user_tasks` SELECT: `user_id = auth.uid() OR created_by = auth.uid() OR admin`
    (`20260610000001_user_tasks_assignee.sql`).
  - `assigned_tasks` SELECT: `assignee OR creator OR admin OR in_group('accounting')`
    (`20260707130000_assigned_tasks_accounting_select.sql`).
  → "According to the rights each one has" comes for free. The query MUST NOT add
  any `user_id`/`created_by` filter that would narrow *below* RLS.
  → Accepted consequence: viewers with different scopes see different subsets
  (e.g. accounting sees all the client's deal/job tasks but only their own
  personal tasks). This is correct per-rights behavior.
- **Existing reuse is already in place** in `ClientTasksTab.tsx`:
  - `useClientTasks(clientId, meId)` (`src/features/clients/hooks/useClientTasks.ts`)
    fires the two client-scoped selects and unions them into `TaskCard[]` via
    `buildBoardCards` (`src/features/tasks/taskCard.ts`). Open vs resolved is
    derived client-side (`card.resolved`).
  - Row click sets an `openCard` and renders the matching detail dialog:
    `kind === 'assigned'` → `AssignedTaskDetailDialog taskId={card.id}` (fetches its
    own row); `kind === 'user'` → `UserTaskDetailDialog card={card}` (renders from
    the card). **Neither re-opens `TaskDialog`, so there is no dialog recursion.**

## Design

### New component: `src/features/tasks/ClientOpenTasksList.tsx`

Props: `{ clientId: string }`.

Behavior — a slimmed-down `ClientTasksTab` open-list:
1. `meId` from `useAuthStore`; `const { cards, isLoading } = useClientTasks(clientId, meId)`.
2. `const open = cards.filter((c) => !c.resolved)`.
3. States:
   - loading → subtle muted text ("…").
   - `open.length === 0` → muted "No open tasks on this client".
   - else → header count + list of rows.
4. Each row (mirror `ClientTasksTab` row): `<button onClick={() => setOpenCard(c)}>`
   showing `title`, `<ImportanceBadge>`, and `sourceCode` (deal/job code) when present.
5. Detail dialogs rendered from `openCard`, exactly as `ClientTasksTab` does:
   `AssignedTaskDetailDialog` for `assigned`, `UserTaskDetailDialog` for `user`,
   each clearing `openCard` on close.

Reuses (no new query/RLS logic): `useClientTasks`, `TaskCard`, `ImportanceBadge`,
`AssignedTaskDetailDialog`, `UserTaskDetailDialog`.

### Integration: `src/features/home/TaskDialog.tsx`

At the client-picker branch (currently lines 187–191), wrap the `ClientPicker`
and render the list under it, only in create mode with a selected client:

```tsx
) : (
  <div className="space-y-2">
    <ClientPicker value={client} onChange={setClient} id="task-client" />
    {!isEdit && client && <ClientOpenTasksList clientId={client.id} />}
  </div>
)}
```

`isEdit = !!task` already exists (line 126); `client: PickedClient | null` has `.id`.

### Decision: create-mode only

Render the list only when creating (`!isEdit`). Rationale: it directly serves the
stated need (awareness while adding a new task to a client), needs no
"exclude-self" logic, and keeps scope tight. Recursion is *not* the reason
(the detail dialogs avoid it) — so extending to edit mode later is a trivial
follow-up if wanted.

## Data flow

pick client → `ClientOpenTasksList` mounts with `clientId` → `useClientTasks`
selects `user_tasks` + `assigned_tasks` by `client_id` (RLS filters per viewer) →
union to cards → filter `!resolved` → render rows → click → stacked detail dialog
→ close returns to the create dialog (form intact).

## Error / empty / loading

- Loading: muted placeholder; never blocks the form.
- Empty: muted "No open tasks on this client".
- Query error: `useClientTasks` already tolerates failures (returns empty cards);
  the list simply shows empty. The list is purely informational and never gates Save.

## Testing (TDD)

Component tests for `ClientOpenTasksList` with a mocked `useClientTasks`:
1. Shows only open tasks (resolved cards excluded); header count matches.
2. Personal vs deal/job rows: deal/job rows show `sourceCode`; correct titles/badges.
3. Empty state renders the muted message when no open cards.
4. Click on a `user` card opens `UserTaskDetailDialog`; click on an `assigned`
   card opens `AssignedTaskDetailDialog`.

`TaskDialog` integration test:
5. List renders when a client is selected in create mode; hidden in lead mode and
   hidden in edit mode.

Visibility itself is DB/RLS-enforced and is **not** re-tested in the frontend
(tests use mocked hook data).

## Changes / Revert

**Changes (all frontend, no DB/migrations):**
- Add `src/features/tasks/ClientOpenTasksList.tsx`.
- Edit `src/features/home/TaskDialog.tsx` — render the list under the client picker
  (create mode + client selected).
- Add tests: `ClientOpenTasksList.test.tsx` (+ a `TaskDialog` case for
  render/hide conditions).
- Optional i18n strings ("No open tasks on this client", header) in the `tasks`/
  `home`/`clients` namespaces, following existing keys.

**Revert:** delete `ClientOpenTasksList.tsx` and its test, and revert the
`TaskDialog.tsx` edit (single atomic commit or two: component+test, then wiring).
No database, RLS, or data changes — nothing to roll back server-side.
