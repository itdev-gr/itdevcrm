# Client's Open Tasks in Task-Create Dialog — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When creating a personal task and selecting a client, show that client's currently-open tasks (personal + deal/job), each clickable to open its detail — visibility filtered per viewer by existing RLS.

**Architecture:** New presentational component `ClientOpenTasksList` reuses the existing `useClientTasks` hook (two client-scoped selects unioned into `TaskCard[]`) and the existing `UserTaskDetailDialog` / `AssignedTaskDetailDialog`. It is rendered inside `TaskDialog` under the client picker, in create mode only. No new query or RLS logic; RLS already scopes the reads.

**Tech Stack:** React, TypeScript, TanStack Query, react-i18next, Vitest + @testing-library/react.

## Global Constraints

- Frontend only — **no** DB, migration, or RLS changes.
- The reads MUST stay as-is via `useClientTasks` (client_id filter only). Do **not** add any `user_id`/`created_by` filter — RLS is the sole visibility gate.
- Follow existing patterns from `src/features/clients/ClientTasksTab.tsx` (row markup, detail-dialog wiring) and `src/features/home/TaskDialog.leadmode.test.tsx` (test mocks).
- `npm run build` is stricter than `tsc --noEmit` (eslint `--max-warnings=0`); code must be warning-clean.

---

### Task 1: `ClientOpenTasksList` component + unit tests

**Files:**
- Create: `src/features/tasks/ClientOpenTasksList.tsx`
- Test: `src/features/tasks/ClientOpenTasksList.test.tsx`

**Interfaces:**
- Consumes:
  - `useClientTasks(clientId: string, meId: string): { cards: TaskCard[]; isLoading: boolean }` from `@/features/clients/hooks/useClientTasks`
  - `TaskCard` from `@/features/tasks/taskCard` (fields used: `key, kind, id, title, importance, resolved, sourceCode`)
  - `AssignedTaskDetailDialog({ taskId: string; onOpenChange: (o: boolean) => void })` from `@/features/assigned_tasks/AssignedTaskDetailDialog`
  - `UserTaskDetailDialog({ card: TaskCard; onOpenChange: (o: boolean) => void })` from `@/features/tasks/UserTaskDetailDialog`
  - `ImportanceBadge({ importance })` from `@/features/tasks/ImportanceBadge`
- Produces: `ClientOpenTasksList({ clientId: string })` (default-less named export).

- [ ] **Step 1: Write the failing test**

Create `src/features/tasks/ClientOpenTasksList.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { i18n } from '@/lib/i18n';
import type { TaskCard } from '@/features/tasks/taskCard';

vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (sel: (s: { user: { id: string } }) => unknown) => sel({ user: { id: 'me' } }),
}));

const hookRef: { cards: TaskCard[]; isLoading: boolean } = { cards: [], isLoading: false };
vi.mock('@/features/clients/hooks/useClientTasks', () => ({
  useClientTasks: () => hookRef,
}));
vi.mock('@/features/assigned_tasks/AssignedTaskDetailDialog', () => ({
  AssignedTaskDetailDialog: ({ taskId }: { taskId: string }) => <div>assigned-detail:{taskId}</div>,
}));
vi.mock('@/features/tasks/UserTaskDetailDialog', () => ({
  UserTaskDetailDialog: ({ card }: { card: TaskCard }) => <div>user-detail:{card.id}</div>,
}));

import { ClientOpenTasksList } from './ClientOpenTasksList';

function card(p: Partial<TaskCard>): TaskCard {
  return {
    key: p.key ?? `${p.kind ?? 'user'}:${p.id ?? 'x'}`,
    kind: p.kind ?? 'user',
    id: p.id ?? 'x',
    title: p.title ?? 'Task',
    importance: p.importance ?? 'low',
    relation: 'other',
    resolved: p.resolved ?? false,
    assigneeId: 'a',
    creatorId: null,
    createdAtIso: null,
    dueAt: null,
    resolvedAt: null,
    startedAtIso: null,
    sourceCode: p.sourceCode ?? null,
    link: null,
    notes: null,
    clientName: null,
    leadName: null,
  };
}

function wrap(node: React.ReactNode) {
  return <I18nextProvider i18n={i18n}>{node}</I18nextProvider>;
}

describe('ClientOpenTasksList', () => {
  beforeEach(() => {
    hookRef.cards = [];
    hookRef.isLoading = false;
  });

  it('shows only open tasks with a count and labels', () => {
    hookRef.cards = [
      card({ kind: 'user', id: 'u1', title: 'Open personal' }),
      card({ kind: 'user', id: 'u2', title: 'Done personal', resolved: true }),
      card({ kind: 'assigned', id: 'a1', title: 'Deal task', sourceCode: '000512-WEBSEO' }),
    ];
    render(wrap(<ClientOpenTasksList clientId="C1" />));
    expect(screen.getByText(/open tasks on this client/i)).toHaveTextContent('(2)');
    expect(screen.getByText('Open personal')).toBeInTheDocument();
    expect(screen.getByText('Deal task')).toBeInTheDocument();
    expect(screen.getByText('000512-WEBSEO')).toBeInTheDocument();
    expect(screen.queryByText('Done personal')).not.toBeInTheDocument();
  });

  it('renders the empty message when there are no open tasks', () => {
    hookRef.cards = [card({ kind: 'user', id: 'u2', resolved: true })];
    render(wrap(<ClientOpenTasksList clientId="C1" />));
    expect(screen.getByText(/no open tasks on this client/i)).toBeInTheDocument();
  });

  it('opens the user detail dialog when a personal row is clicked', () => {
    hookRef.cards = [card({ kind: 'user', id: 'u1', title: 'Open personal' })];
    render(wrap(<ClientOpenTasksList clientId="C1" />));
    fireEvent.click(screen.getByText('Open personal'));
    expect(screen.getByText('user-detail:u1')).toBeInTheDocument();
  });

  it('opens the assigned detail dialog when a deal/job row is clicked', () => {
    hookRef.cards = [card({ kind: 'assigned', id: 'a1', title: 'Deal task' })];
    render(wrap(<ClientOpenTasksList clientId="C1" />));
    fireEvent.click(screen.getByText('Deal task'));
    expect(screen.getByText('assigned-detail:a1')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/features/tasks/ClientOpenTasksList.test.tsx`
Expected: FAIL — cannot resolve `./ClientOpenTasksList` (module not found).

- [ ] **Step 3: Write the component**

Create `src/features/tasks/ClientOpenTasksList.tsx`:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/lib/stores/authStore';
import { AssignedTaskDetailDialog } from '@/features/assigned_tasks/AssignedTaskDetailDialog';
import { UserTaskDetailDialog } from '@/features/tasks/UserTaskDetailDialog';
import { ImportanceBadge } from '@/features/tasks/ImportanceBadge';
import type { TaskCard } from '@/features/tasks/taskCard';
import { useClientTasks } from '@/features/clients/hooks/useClientTasks';

/** Read-only awareness list of a client's OPEN tasks (personal + deal/job),
 *  each row clickable to open its detail dialog. Visibility is enforced by RLS
 *  inside useClientTasks — do not add any per-user filtering here. */
export function ClientOpenTasksList({ clientId }: { clientId: string }) {
  const { t } = useTranslation('home');
  const meId = useAuthStore((s) => s.user?.id ?? '');
  const { cards, isLoading } = useClientTasks(clientId, meId);
  const [openCard, setOpenCard] = useState<TaskCard | null>(null);

  if (isLoading) {
    return <p className="text-xs text-muted-foreground">…</p>;
  }

  const open = cards.filter((c) => !c.resolved);
  if (open.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {t('client_open_tasks.empty', { defaultValue: 'No open tasks on this client' })}
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">
        {t('client_open_tasks.header', { defaultValue: 'Open tasks on this client' })} ({open.length})
      </p>
      <ul className="max-h-40 overflow-y-auto rounded-md border bg-card">
        {open.map((c) => (
          <li key={c.key} className="border-t first:border-t-0">
            <button
              type="button"
              onClick={() => setOpenCard(c)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted"
            >
              <span className="truncate text-sm">{c.title}</span>
              <ImportanceBadge importance={c.importance} />
              {c.sourceCode && (
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                  {c.sourceCode}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {openCard?.kind === 'assigned' && (
        <AssignedTaskDetailDialog taskId={openCard.id} onOpenChange={(o) => !o && setOpenCard(null)} />
      )}
      {openCard?.kind === 'user' && (
        <UserTaskDetailDialog card={openCard} onOpenChange={(o) => !o && setOpenCard(null)} />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/features/tasks/ClientOpenTasksList.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/ClientOpenTasksList.tsx src/features/tasks/ClientOpenTasksList.test.tsx
git commit -m "feat(tasks): ClientOpenTasksList — client's open tasks, RLS-filtered, clickable"
```

---

### Task 2: Wire into `TaskDialog` (create mode) + integration tests

**Files:**
- Modify: `src/features/home/TaskDialog.tsx` (client-picker branch, ~lines 187-191; import at top)
- Test: `src/features/home/TaskDialog.clienttasks.test.tsx`

**Interfaces:**
- Consumes: `ClientOpenTasksList({ clientId })` from Task 1; existing `TaskDialog` props (`open`, `onOpenChange`, `task`, `defaultClient`, `defaultLead`).
- Produces: no new exports.

- [ ] **Step 1: Write the failing integration test**

Create `src/features/home/TaskDialog.clienttasks.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect } from 'vitest';
import { i18n } from '@/lib/i18n';
import type { UserTaskRow } from './hooks/useUserTasks';
import type { TaskCard } from '@/features/tasks/taskCard';

type AuthState = { user: { id: string } | null; isAdmin: boolean; groupCodes: string[] };
const authState: AuthState = { user: { id: 'me' }, isAdmin: false, groupCodes: ['sales'] };
vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (sel: (s: AuthState) => unknown) => sel(authState),
}));
vi.mock('@/features/comments/hooks/useMentionableUsers', () => ({
  useMentionableUsers: () => ({ data: [{ user_id: 'me', full_name: 'Me', email: 'me@x', is_admin: false, group_codes: ['sales'] }] }),
}));
vi.mock('./hooks/useUpsertTask', () => ({ useUpsertTask: () => ({ mutateAsync: vi.fn(), isPending: false }) }));
vi.mock('./hooks/useDeleteTask', () => ({ useDeleteTask: () => ({ mutateAsync: vi.fn(), isPending: false }) }));

const openCard: TaskCard = {
  key: 'user:u1', kind: 'user', id: 'u1', title: 'Sibling task', importance: 'low',
  relation: 'other', resolved: false, assigneeId: 'me', creatorId: 'me', createdAtIso: null,
  dueAt: null, resolvedAt: null, startedAtIso: null, sourceCode: null, link: null,
  notes: null, clientName: null, leadName: null,
};
vi.mock('@/features/clients/hooks/useClientTasks', () => ({
  useClientTasks: () => ({ cards: [openCard], isLoading: false }),
}));

import { TaskDialog } from './TaskDialog';

function wrap(node: React.ReactNode) {
  const qc = new QueryClient();
  return (
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>{node}</I18nextProvider>
    </QueryClientProvider>
  );
}

describe('TaskDialog — client open-tasks list', () => {
  it("lists the client's open tasks when a client is selected in create mode", () => {
    render(wrap(<TaskDialog open onOpenChange={() => {}} defaultClient={{ id: 'C1', name: 'ACME' }} />));
    expect(screen.getByText('Sibling task')).toBeInTheDocument();
  });

  it('hides the list in lead mode (no client selected)', () => {
    render(wrap(<TaskDialog open onOpenChange={() => {}} />));
    expect(screen.queryByText('Sibling task')).not.toBeInTheDocument();
  });

  it('hides the list in edit mode', () => {
    const task = {
      id: 'T1', title: 'Editing', notes: null, due_at: new Date().toISOString(),
      completed_at: null, user_id: 'me', created_by: 'me', client_id: 'C1', lead_id: null,
      importance: 'low', started_at: null, created_at: null,
    } as unknown as UserTaskRow;
    render(wrap(<TaskDialog open onOpenChange={() => {}} task={task} />));
    expect(screen.queryByText('Sibling task')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/features/home/TaskDialog.clienttasks.test.tsx`
Expected: FAIL — first case cannot find text "Sibling task" (list not wired in yet).

- [ ] **Step 3: Add the import**

In `src/features/home/TaskDialog.tsx`, add near the other `@/features` imports (e.g. after the `ClientPicker` import, ~line 23):

```tsx
import { ClientOpenTasksList } from '@/features/tasks/ClientOpenTasksList';
```

- [ ] **Step 4: Render the list under the client picker (create mode only)**

In `src/features/home/TaskDialog.tsx`, replace the picker branch (currently):

```tsx
          {mode === 'lead' ? (
            <LeadPicker value={lead} onChange={setLead} id="task-lead" />
          ) : (
            <ClientPicker value={client} onChange={setClient} id="task-client" />
          )}
```

with:

```tsx
          {mode === 'lead' ? (
            <LeadPicker value={lead} onChange={setLead} id="task-lead" />
          ) : (
            <div className="space-y-2">
              <ClientPicker value={client} onChange={setClient} id="task-client" />
              {!isEdit && client && <ClientOpenTasksList clientId={client.id} />}
            </div>
          )}
```

(`isEdit` is already defined at line 126; `client` is the existing `PickedClient | null` state.)

- [ ] **Step 5: Run the integration test to verify it passes**

Run: `npx vitest run src/features/home/TaskDialog.clienttasks.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Run the existing TaskDialog tests to check for regressions**

Run: `npx vitest run src/features/home/TaskDialog.test.tsx src/features/home/TaskDialog.leadmode.test.tsx`
Expected: PASS (no regressions).

- [ ] **Step 7: Typecheck + lint the changed files via build**

Run: `npm run build`
Expected: build succeeds with zero warnings/errors.

- [ ] **Step 8: Commit**

```bash
git add src/features/home/TaskDialog.tsx src/features/home/TaskDialog.clienttasks.test.tsx
git commit -m "feat(tasks): show client's open tasks in task-create dialog"
```

---

## Changes / Revert

**Changes (frontend only, no DB):**
- Add `src/features/tasks/ClientOpenTasksList.tsx` (+ test).
- Modify `src/features/home/TaskDialog.tsx` (import + render under client picker in create mode).
- Add `src/features/home/TaskDialog.clienttasks.test.tsx`.

**Revert:** `git revert` the two feature commits (Task 1, Task 2), or delete the new files and restore the picker branch in `TaskDialog.tsx`. No migrations, RLS, or data to roll back.

## Self-Review

- **Spec coverage:** create-mode-only list under client picker ✅ (Task 2 Step 4); both task types via `useClientTasks` union ✅; clickable → detail dialogs ✅ (Task 1); RLS-only visibility, no extra filters ✅ (constraint + component doc); empty/loading states ✅; tests for open-only filter, labels, click-routing, render/hide conditions ✅.
- **Placeholder scan:** none — all steps carry full code and exact commands.
- **Type consistency:** `useClientTasks(clientId, meId) → { cards, isLoading }`, `TaskCard` fields, and dialog prop names (`taskId` / `card`, `onOpenChange`) match `ClientTasksTab.tsx` usage and `taskCard.ts` definitions.
