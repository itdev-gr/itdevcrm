# Client-linked Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any personal task optionally link to a client via a searchable picker, surface every client-linked task (personal + delegated) on a new client "Tasks" tab, and add a create button + click-to-detail on the `/tasks` page.

**Architecture:** Add a nullable `client_id` to `user_tasks` (delegated `assigned_tasks` already have it, auto-filled from their deal/job by a trigger). Build one reusable `ClientPicker` (debounced search) and wire it into the personal-task form. Add a `ClientTasksTab` that unions both task tables by `client_id`. Reuse the existing `AssignedTaskDetailDialog` for delegated cards and add a small `UserTaskDetailDialog` for personal cards.

**Tech Stack:** React + TypeScript, @tanstack/react-query, supabase-js, shadcn/ui dialogs, @dnd-kit, vitest + @testing-library/react, i18next (en + el), Supabase (Postgres, RLS).

**Spec:** `docs/superpowers/specs/2026-06-23-client-linked-tasks-design.md`

**Conventions in this repo:**
- Tests are colocated `*.test.ts(x)`, run with `npx vitest run <path>`.
- Component test harness: wrap in `MemoryRouter` + `QueryClientProvider` + `I18nextProvider i18n={i18n}` (`@/lib/i18n`).
- Hook test harness: `renderHook` + `QueryClientProvider`; mock `@/lib/supabase` with `vi.hoisted`.
- i18n files: `src/i18n/locales/{en,el}/<ns>.json`. Add the SAME keys to both languages.
- Prod DDL is applied via the Supabase MCP `apply_migration` (Bash/management-API DDL is blocked by the safety classifier). Project id: `xujlrclyzxrvxszepquy`.
- Commit after each task. Push to `main` (no PRs) only after the full plan's tests pass.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20260623100000_user_tasks_client_id.sql` | **Create** — add `user_tasks.client_id` + index (+ rollback) |
| `src/types/supabase.ts` | **Modify** — add `client_id` to `user_tasks` Row/Insert/Update |
| `src/features/clients/hooks/useClientSearch.ts` | **Create** — debounced client search query |
| `src/features/clients/hooks/useClientSearch.test.tsx` | **Create** — hook test |
| `src/features/clients/ClientPicker.tsx` | **Create** — searchable, clearable client picker |
| `src/features/clients/ClientPicker.test.tsx` | **Create** — component test |
| `src/features/home/hooks/useUpsertTask.ts` | **Modify** — accept/persist `client_id` |
| `src/features/home/TaskDialog.tsx` | **Modify** — add picker + `defaultClient` prop |
| `src/features/home/TaskDialog.test.tsx` | **Modify** — assert `client_id` submitted |
| `src/features/tasks/MyTasksPage.tsx` | **Modify** — "New task" button → `TaskDialog` |
| `src/features/tasks/UserTaskDetailDialog.tsx` | **Create** — read-only personal-task detail |
| `src/features/tasks/UserTaskDetailDialog.test.tsx` | **Create** — component test |
| `src/features/tasks/TaskKanbanCard.tsx` | **Modify** — card body click → `onOpen(card)` |
| `src/features/tasks/TasksKanbanBoard.tsx` | **Modify** — own detail dialog state |
| `src/features/clients/hooks/useClientTasks.ts` | **Create** — union user+assigned tasks by client |
| `src/features/clients/hooks/useClientTasks.test.tsx` | **Create** — hook test |
| `src/features/clients/ClientTasksTab.tsx` | **Create** — Open/Resolved list + New task |
| `src/features/clients/ClientDetailPage.tsx` | **Modify** — add Tasks tab |
| `src/lib/queryKeys.ts` | **Modify** — add `clientSearch`, `clientTasks` keys |
| `src/i18n/locales/{en,el}/common.json` | **Modify** — picker + `/tasks` strings |
| `src/i18n/locales/{en,el}/clients.json` | **Modify** — Tasks tab strings |

---

## Task 1: Migration — `user_tasks.client_id`

**Files:**
- Create: `supabase/migrations/20260623100000_user_tasks_client_id.sql`
- Modify: `src/types/supabase.ts:3194-3229` (user_tasks Row/Insert/Update)

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/20260623100000_user_tasks_client_id.sql`:

```sql
-- Personal tasks can optionally focus a client (delegated assigned_tasks already
-- carry client_id, filled from their deal/job). Nullable; on client delete the
-- task survives unlinked.
alter table public.user_tasks
  add column if not exists client_id uuid references public.clients(id) on delete set null;

create index if not exists user_tasks_client_id
  on public.user_tasks (client_id) where client_id is not null;

-- ROLLBACK (manual):
--   drop index if exists public.user_tasks_client_id;
--   alter table public.user_tasks drop column if exists client_id;
```

- [ ] **Step 2: Apply to prod via the Supabase MCP**

Use the MCP tool `apply_migration` (project_id `xujlrclyzxrvxszepquy`, name `user_tasks_client_id`) with the SQL above. Do NOT use Bash/management-API for the DDL — it is classifier-blocked.

- [ ] **Step 3: Verify the column + index exist and round-trip**

Run via MCP `execute_sql` (project_id `xujlrclyzxrvxszepquy`):

```sql
select column_name, is_nullable, data_type
from information_schema.columns
where table_schema='public' and table_name='user_tasks' and column_name='client_id';
```

Expected: one row, `client_id | YES | uuid`.

- [ ] **Step 4: Patch the generated types**

In `src/types/supabase.ts`, inside `user_tasks`, add `client_id` (alphabetical, next to `completed_at`) to all three shapes:
- `Row`: `          client_id: string | null`
- `Insert`: `          client_id?: string | null`
- `Update`: `          client_id?: string | null`

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no new errors.

```bash
git add supabase/migrations/20260623100000_user_tasks_client_id.sql src/types/supabase.ts
git commit -m "feat(tasks): add client_id to user_tasks (personal task client link)"
```

---

## Task 2: `useClientSearch` hook

**Files:**
- Create: `src/features/clients/hooks/useClientSearch.ts`
- Test: `src/features/clients/hooks/useClientSearch.test.tsx`
- Modify: `src/lib/queryKeys.ts`

- [ ] **Step 1: Add the query key**

In `src/lib/queryKeys.ts`, after the `myClients` line, add:

```ts
  clientSearch: (term: string) => ['client-search', term] as const,
```

- [ ] **Step 2: Write the failing hook test**

Create `src/features/clients/hooks/useClientSearch.test.tsx`:

```tsx
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { order, limit, eq, or, select, from } = vi.hoisted(() => {
  const order = vi.fn();
  const limit = vi.fn().mockReturnValue({ order });
  const or = vi.fn().mockReturnValue({ limit });
  const eq = vi.fn().mockReturnValue({ or });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  return { order, limit, eq, or, select, from };
});
vi.mock('@/lib/supabase', () => ({ supabase: { from } }));

import { useClientSearch } from './useClientSearch';

function wrap(c: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{c}</QueryClientProvider>;
}

describe('useClientSearch', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is idle (no query) for terms shorter than 2 chars', () => {
    const { result } = renderHook(() => useClientSearch('a'), {
      wrapper: ({ children }) => wrap(children),
    });
    expect(result.current.fetchStatus).toBe('idle');
    expect(from).not.toHaveBeenCalled();
  });

  it('searches clients by name/code and returns rows', async () => {
    order.mockResolvedValue({
      data: [{ id: 'c1', name: 'ACME', code: '004583' }],
      error: null,
    });
    const { result } = renderHook(() => useClientSearch('ac'), {
      wrapper: ({ children }) => wrap(children),
    });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(from).toHaveBeenCalledWith('clients');
    expect(eq).toHaveBeenCalledWith('archived', false);
    expect(result.current.data).toEqual([{ id: 'c1', name: 'ACME', code: '004583' }]);
  });
});
```

- [ ] **Step 3: Run the test, verify it fails**

Run: `npx vitest run src/features/clients/hooks/useClientSearch.test.tsx`
Expected: FAIL ("Cannot find module './useClientSearch'").

- [ ] **Step 4: Implement the hook**

Create `src/features/clients/hooks/useClientSearch.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export type ClientSearchRow = { id: string; name: string; code: string | null };

/** Debounced-friendly client typeahead. Disabled until `term` has >= 2 chars. */
export function useClientSearch(term: string) {
  const q = term.trim();
  return useQuery<ClientSearchRow[]>({
    queryKey: queryKeys.clientSearch(q.toLowerCase()),
    enabled: q.length >= 2,
    staleTime: 30_000,
    queryFn: async () => {
      const like = `%${q}%`;
      const { data, error } = await supabase
        .from('clients')
        .select('id, name, code')
        .eq('archived', false)
        .or(`name.ilike.${like},code.ilike.${like}`)
        .limit(20)
        .order('name', { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as ClientSearchRow[];
    },
  });
}
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `npx vitest run src/features/clients/hooks/useClientSearch.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/features/clients/hooks/useClientSearch.ts src/features/clients/hooks/useClientSearch.test.tsx src/lib/queryKeys.ts
git commit -m "feat(clients): useClientSearch typeahead hook"
```

---

## Task 3: `ClientPicker` component

**Files:**
- Create: `src/features/clients/ClientPicker.tsx`
- Test: `src/features/clients/ClientPicker.test.tsx`
- Modify: `src/i18n/locales/{en,el}/common.json`

- [ ] **Step 1: Add i18n strings**

In `src/i18n/locales/en/common.json` add a top-level block:

```json
  "client_picker": {
    "label": "Client (optional)",
    "search_placeholder": "Search client…",
    "none": "No client",
    "no_results": "No clients found",
    "clear": "Clear"
  }
```

In `src/i18n/locales/el/common.json` add the SAME keys:

```json
  "client_picker": {
    "label": "Πελάτης (προαιρετικά)",
    "search_placeholder": "Αναζήτηση πελάτη…",
    "none": "Χωρίς πελάτη",
    "no_results": "Δεν βρέθηκαν πελάτες",
    "clear": "Καθαρισμός"
  }
```

- [ ] **Step 2: Write the failing component test**

Create `src/features/clients/ClientPicker.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { i18n } from '@/lib/i18n';

const search = vi.fn();
vi.mock('./hooks/useClientSearch', () => ({
  useClientSearch: (term: string) => search(term),
}));

import { ClientPicker } from './ClientPicker';

function wrap(node: React.ReactNode) {
  return <I18nextProvider i18n={i18n}>{node}</I18nextProvider>;
}

describe('ClientPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    search.mockReturnValue({ data: [], isFetching: false });
  });

  it('shows the selected client name and a clear button', () => {
    const onChange = vi.fn();
    render(wrap(<ClientPicker value={{ id: 'c1', name: 'ACME' }} onChange={onChange} />));
    expect(screen.getByText('ACME')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /clear/i })).toBeInTheDocument();
  });

  it('selecting a result calls onChange with the client', async () => {
    const user = userEvent.setup();
    search.mockReturnValue({ data: [{ id: 'c9', name: 'Pindos', code: '004583' }], isFetching: false });
    const onChange = vi.fn();
    render(wrap(<ClientPicker value={null} onChange={onChange} />));
    await user.type(screen.getByPlaceholderText(/search client/i), 'pi');
    await user.click(screen.getByRole('option', { name: /Pindos/ }));
    expect(onChange).toHaveBeenCalledWith({ id: 'c9', name: 'Pindos' });
  });

  it('clear resets to null', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(wrap(<ClientPicker value={{ id: 'c1', name: 'ACME' }} onChange={onChange} />));
    await user.click(screen.getByRole('button', { name: /clear/i }));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
```

- [ ] **Step 3: Run the test, verify it fails**

Run: `npx vitest run src/features/clients/ClientPicker.test.tsx`
Expected: FAIL ("Cannot find module './ClientPicker'").

- [ ] **Step 4: Implement the component**

Create `src/features/clients/ClientPicker.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useClientSearch } from './hooks/useClientSearch';

export type PickedClient = { id: string; name: string };

type Props = {
  value: PickedClient | null;
  onChange: (c: PickedClient | null) => void;
  id?: string;
};

export function ClientPicker({ value, onChange, id }: Props) {
  const { t } = useTranslation('common');
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const h = setTimeout(() => setDebounced(term.trim()), 200);
    return () => clearTimeout(h);
  }, [term]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const { data: results = [], isFetching } = useClientSearch(debounced);

  if (value) {
    return (
      <div className="space-y-1.5">
        <Label>{t('client_picker.label')}</Label>
        <div className="flex items-center gap-2">
          <span className="rounded-md border bg-muted px-2 py-1 text-sm">{value.name}</span>
          <Button type="button" size="sm" variant="ghost" onClick={() => onChange(null)}>
            <X className="size-3.5" /> {t('client_picker.clear')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5" ref={boxRef}>
      <Label htmlFor={id}>{t('client_picker.label')}</Label>
      <div className="relative">
        <Input
          id={id}
          value={term}
          placeholder={t('client_picker.search_placeholder')}
          onChange={(e) => { setTerm(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          autoComplete="off"
        />
        {open && debounced.length >= 2 && (
          <ul role="listbox" className="absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-md border bg-popover shadow-md">
            {results.length === 0 && !isFetching ? (
              <li className="px-3 py-2 text-xs text-muted-foreground">{t('client_picker.no_results')}</li>
            ) : (
              results.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    onClick={() => { onChange({ id: c.id, name: c.name }); setOpen(false); setTerm(''); }}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                  >
                    <span className="truncate">{c.name}</span>
                    {c.code && <span className="font-mono text-[10px] text-muted-foreground">{c.code}</span>}
                  </button>
                </li>
              ))
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `npx vitest run src/features/clients/ClientPicker.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/features/clients/ClientPicker.tsx src/features/clients/ClientPicker.test.tsx src/i18n/locales/en/common.json src/i18n/locales/el/common.json
git commit -m "feat(clients): searchable ClientPicker component"
```

---

## Task 4: Personal-task client wiring (`useUpsertTask` + `TaskDialog`)

**Files:**
- Modify: `src/features/home/hooks/useUpsertTask.ts`
- Modify: `src/features/home/TaskDialog.tsx`
- Modify: `src/features/home/TaskDialog.test.tsx`

- [ ] **Step 1: Add `client_id` to the upsert input + payload**

In `src/features/home/hooks/useUpsertTask.ts`, add to the `Input` type (after `completed_at`):

```ts
  client_id?: string | null;
```

And in the `payload` object (after `completed_at: ...,`), add:

```ts
          ...(input.client_id !== undefined ? { client_id: input.client_id } : {}),
```

- [ ] **Step 2: Write/extend the failing test**

In `src/features/home/TaskDialog.test.tsx`, add a test that opening in create mode, filling a title + due + importance, picking a client, and saving calls `upsert.mutateAsync` with `client_id`. If the file mocks `useUpsertTask`, capture the arg. Add:

```tsx
it('submits the selected client_id on create', async () => {
  const user = userEvent.setup();
  // ClientPicker is mocked to immediately emit a client when its button is clicked.
  render(wrap(<TaskDialog open onOpenChange={() => {}} />));
  await user.type(screen.getByLabelText(/title/i), 'Call ACME');
  await user.click(screen.getByRole('button', { name: /pick-acme/i }));
  // importance + due default are required; set importance:
  // (importance select is native; choose 'low')
  await user.selectOptions(screen.getByLabelText(/importance/i), 'low');
  await user.click(screen.getByRole('button', { name: /save/i }));
  await waitFor(() => expect(upsert).toHaveBeenCalledWith(
    expect.objectContaining({ title: 'Call ACME', client_id: 'c-acme' }),
  ));
});
```

Add this mock near the top of the test file (with the other `vi.mock`s):

```tsx
vi.mock('@/features/clients/ClientPicker', () => ({
  ClientPicker: ({ onChange }: { onChange: (c: { id: string; name: string } | null) => void }) => (
    <button type="button" onClick={() => onChange({ id: 'c-acme', name: 'ACME' })}>pick-acme</button>
  ),
}));
```

(Check the existing test file's `upsert` mock variable name and reuse it; if `useUpsertTask` is not yet mocked there, mock it: `const upsert = vi.fn().mockResolvedValue('id'); vi.mock('./hooks/useUpsertTask', () => ({ useUpsertTask: () => ({ mutateAsync: upsert, isPending: false }) }));`)

- [ ] **Step 3: Run the test, verify it fails**

Run: `npx vitest run src/features/home/TaskDialog.test.tsx`
Expected: FAIL (no client picker rendered / `client_id` missing).

- [ ] **Step 4: Wire the picker into `TaskDialog`**

In `src/features/home/TaskDialog.tsx`:

Add imports:
```tsx
import { ClientPicker, type PickedClient } from '@/features/clients/ClientPicker';
```

Add a prop (in `Props`):
```tsx
  /** Pre-select a client when creating (e.g. from a client's Tasks tab). */
  defaultClient?: PickedClient | null;
```
Destructure it: `export function TaskDialog({ open, onOpenChange, task, defaultDueAt, defaultClient }: Props) {`

Add state:
```tsx
  const [client, setClient] = useState<PickedClient | null>(null);
```

In the `useEffect` reset block, set it for both branches:
- edit branch: `setClient(task.client_id ? { id: task.client_id, name: task.client_name ?? '' } : null);`
  - NOTE: `UserTaskRow` has `client_id` but not a joined name. Simplest: `setClient(task.client_id ? { id: task.client_id, name: '' } : null);` (the picker shows the id-less chip; acceptable, or fetch name later — out of scope). Prefer: leave `name: ''` and render falls back gracefully.
- create branch: `setClient(defaultClient ?? null);`
Also add `defaultClient` to the effect dep array.

In `onSave`, add `client_id: client?.id ?? null` to the `payload`.

Render the picker (place after the importance block, before notes):
```tsx
          <ClientPicker value={client} onChange={setClient} id="task-client" />
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `npx vitest run src/features/home/TaskDialog.test.tsx`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

Run: `npx tsc -p tsconfig.json --noEmit` → no new errors.

```bash
git add src/features/home/hooks/useUpsertTask.ts src/features/home/TaskDialog.tsx src/features/home/TaskDialog.test.tsx
git commit -m "feat(tasks): client picker on the personal task form"
```

---

## Task 5: `/tasks` "New task" button

**Files:**
- Modify: `src/features/tasks/MyTasksPage.tsx`
- Modify: `src/i18n/locales/{en,el}/common.json`

- [ ] **Step 1: Add i18n strings**

In both `common.json` files, inside the existing `tasks_page` block add:
- en: `"new_task": "New task"`
- el: `"new_task": "Νέα εργασία"`

- [ ] **Step 2: Write the failing test**

Create `src/features/tasks/MyTasksPage.newtask.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect } from 'vitest';
import { i18n } from '@/lib/i18n';

vi.mock('./TasksKanbanBoard', () => ({ TasksKanbanBoard: () => <div>board</div> }));
vi.mock('./ResolvedArchive', () => ({ ResolvedArchive: () => <div>archive</div> }));
const dialogOpen = vi.fn();
vi.mock('@/features/home/TaskDialog', () => ({
  TaskDialog: ({ open }: { open: boolean }) => { dialogOpen(open); return open ? <div>task-dialog</div> : null; },
}));

import { MyTasksPage } from './MyTasksPage';

function wrap(node: React.ReactNode) {
  const qc = new QueryClient();
  return <MemoryRouter><QueryClientProvider client={qc}><I18nextProvider i18n={i18n}>{node}</I18nextProvider></QueryClientProvider></MemoryRouter>;
}

describe('MyTasksPage New task button', () => {
  it('opens the task dialog', async () => {
    const user = userEvent.setup();
    render(wrap(<MyTasksPage />));
    expect(screen.queryByText('task-dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /new task/i }));
    expect(screen.getByText('task-dialog')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run the test, verify it fails**

Run: `npx vitest run src/features/tasks/MyTasksPage.newtask.test.tsx`
Expected: FAIL (no "New task" button).

- [ ] **Step 4: Add the button + dialog to `MyTasksPage`**

In `src/features/tasks/MyTasksPage.tsx`:
- import: `import { Button } from '@/components/ui/button';` and `import { TaskDialog } from '@/features/home/TaskDialog';`
- add state: `const [newOpen, setNewOpen] = useState(false);`
- in the header `<div>` (the title block), wrap title + a right-aligned button:

```tsx
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('tasks_page.title')}</h1>
          <p className="text-sm opacity-70">{t('tasks_page.subtitle')}</p>
        </div>
        <Button type="button" size="sm" onClick={() => setNewOpen(true)}>
          + {t('tasks_page.new_task')}
        </Button>
      </div>
```

- before the final `</div>`, render:
```tsx
      <TaskDialog open={newOpen} onOpenChange={setNewOpen} />
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `npx vitest run src/features/tasks/MyTasksPage.newtask.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/tasks/MyTasksPage.tsx src/features/tasks/MyTasksPage.newtask.test.tsx src/i18n/locales/en/common.json src/i18n/locales/el/common.json
git commit -m "feat(tasks): New task button on the /tasks page"
```

---

## Task 6: Card click → detail (`UserTaskDetailDialog` + wiring)

**Files:**
- Create: `src/features/tasks/UserTaskDetailDialog.tsx`
- Test: `src/features/tasks/UserTaskDetailDialog.test.tsx`
- Modify: `src/features/tasks/TaskKanbanCard.tsx`
- Modify: `src/features/tasks/TasksKanbanBoard.tsx`

- [ ] **Step 1: Write the failing detail-dialog test**

Create `src/features/tasks/UserTaskDetailDialog.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { describe, it, expect } from 'vitest';
import { i18n } from '@/lib/i18n';
import { UserTaskDetailDialog } from './UserTaskDetailDialog';

const card = {
  key: 'user:u1', kind: 'user' as const, id: 'u1', title: 'Call ACME',
  importance: 'high' as const, relation: 'mine' as const, resolved: false,
  assigneeId: 'me', creatorId: 'me', dueAt: '2026-07-01T09:00:00Z',
  resolvedAt: null, sourceCode: null, link: null,
  notes: 'ring after lunch', clientName: 'ACME',
};

function wrap(n: React.ReactNode) { return <I18nextProvider i18n={i18n}>{n}</I18nextProvider>; }

describe('UserTaskDetailDialog', () => {
  it('shows title, notes, and client', () => {
    render(wrap(<UserTaskDetailDialog card={card} onOpenChange={() => {}} />));
    expect(screen.getByText('Call ACME')).toBeInTheDocument();
    expect(screen.getByText('ring after lunch')).toBeInTheDocument();
    expect(screen.getByText(/ACME/)).toBeInTheDocument();
  });

  it('renders nothing when card is null', () => {
    const { container } = render(wrap(<UserTaskDetailDialog card={null} onOpenChange={() => {}} />));
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Extend the `TaskCard` model with display fields**

In `src/features/tasks/taskCard.ts`, add to the `TaskCard` type:
```ts
  notes: string | null;
  clientName: string | null;
```
In `userTaskToCard`, add: `notes: row.notes ?? null,` and `clientName: null,` (name not joined on the board query; the detail shows id-less when absent — acceptable, or wire a name later).
In `assignedTaskToCard`, add: `notes: row.description ?? null,` and `clientName: row.client?.name ?? null,`.
Update `src/features/tasks/taskCard.test.ts` `toMatchObject` expectations only if they assert exact full objects (they use `toMatchObject`, so new fields are fine — no change needed).

- [ ] **Step 3: Run the detail test, verify it fails**

Run: `npx vitest run src/features/tasks/UserTaskDetailDialog.test.tsx`
Expected: FAIL ("Cannot find module './UserTaskDetailDialog'").

- [ ] **Step 4: Implement `UserTaskDetailDialog`**

Create `src/features/tasks/UserTaskDetailDialog.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { ImportanceBadge } from './ImportanceBadge';
import type { TaskCard } from './taskCard';

export function UserTaskDetailDialog({
  card, onOpenChange,
}: {
  card: TaskCard | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, i18n } = useTranslation('home');
  const locale = i18n.resolvedLanguage === 'el' ? 'el-GR' : 'en-US';
  if (!card) return null;
  const due = card.dueAt
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(card.dueAt))
    : null;
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {card.title} <ImportanceBadge importance={card.importance} />
          </DialogTitle>
          <DialogDescription className="sr-only">{t('task.dialog_description')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          {due && (
            <p className="text-muted-foreground">
              {t('task.due_at', { defaultValue: 'Due' })}: <span className="text-foreground">{due}</span>
            </p>
          )}
          {card.clientName && (
            <p className="text-muted-foreground">
              {t('client_picker.label', { ns: 'common' })}: <span className="text-foreground">{card.clientName}</span>
            </p>
          )}
          {card.notes && <p className="whitespace-pre-wrap text-foreground">{card.notes}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 5: Run the detail test, verify it passes**

Run: `npx vitest run src/features/tasks/UserTaskDetailDialog.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Make the card body open the detail**

In `src/features/tasks/TaskKanbanCard.tsx`:
- add prop: `onOpen: (card: TaskCard) => void;` to the component props.
- add an `onClick` to the outer card `<div>` that calls `onOpen(card)` ONLY when the click did not originate from an interactive child:
```tsx
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('a,button')) return;
        onOpen(card);
      }}
```
(Place it alongside the existing props on the wrapper `<div>`; keep the dnd listeners.)

- [ ] **Step 7: Thread `onOpen` through the column to the board**

In `src/features/tasks/TasksKanbanColumn.tsx`, add an `onOpen` prop and pass it to each `<TaskKanbanCard onOpen={onOpen} … />`.
In `src/features/tasks/TasksKanbanBoard.tsx`:
- import `useState` already present; import `AssignedTaskDetailDialog` from `@/features/assigned_tasks/AssignedTaskDetailDialog` and `UserTaskDetailDialog` from `./UserTaskDetailDialog`.
- add state: `const [openCard, setOpenCard] = useState<TaskCard | null>(null);`
- pass `onOpen={setOpenCard}` to each `<TasksKanbanColumn … />`.
- before the closing `</div>` of the component, render:
```tsx
      {openCard?.kind === 'assigned' && (
        <AssignedTaskDetailDialog taskId={openCard.id} onOpenChange={(o) => !o && setOpenCard(null)} />
      )}
      {openCard?.kind === 'user' && (
        <UserTaskDetailDialog card={openCard} onOpenChange={(o) => !o && setOpenCard(null)} />
      )}
```

- [ ] **Step 8: Run the tasks tests + typecheck**

Run: `npx vitest run src/features/tasks/`
Expected: PASS (existing + new).
Run: `npx tsc -p tsconfig.json --noEmit` → no new errors.

- [ ] **Step 9: Commit**

```bash
git add src/features/tasks/UserTaskDetailDialog.tsx src/features/tasks/UserTaskDetailDialog.test.tsx src/features/tasks/taskCard.ts src/features/tasks/TaskKanbanCard.tsx src/features/tasks/TasksKanbanColumn.tsx src/features/tasks/TasksKanbanBoard.tsx
git commit -m "feat(tasks): click a card to view its full details"
```

---

## Task 7: Client "Tasks" tab

**Files:**
- Create: `src/features/clients/hooks/useClientTasks.ts`
- Test: `src/features/clients/hooks/useClientTasks.test.tsx`
- Create: `src/features/clients/ClientTasksTab.tsx`
- Modify: `src/features/clients/ClientDetailPage.tsx`
- Modify: `src/lib/queryKeys.ts`
- Modify: `src/i18n/locales/{en,el}/clients.json`

- [ ] **Step 1: Add the query key**

In `src/lib/queryKeys.ts` add (near the other task keys):
```ts
  clientTasks: (clientId: string) => ['client-tasks', clientId] as const,
```

- [ ] **Step 2: Write the failing hook test**

Create `src/features/clients/hooks/useClientTasks.test.tsx`:

```tsx
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { userResp, assignedResp } = vi.hoisted(() => ({
  userResp: { value: { data: [] as unknown[], error: null } },
  assignedResp: { value: { data: [] as unknown[], error: null } },
}));
const { from } = vi.hoisted(() => {
  const make = (resp: { value: { data: unknown[]; error: null } }) => {
    const order = vi.fn().mockImplementation(() => Promise.resolve(resp.value));
    const eq = vi.fn().mockReturnValue({ order });
    const select = vi.fn().mockReturnValue({ eq });
    return { select };
  };
  return {} as never;
});

// Simpler: route by table name.
vi.mock('@/lib/supabase', () => {
  const order = (resp: () => unknown) => vi.fn().mockImplementation(() => Promise.resolve(resp()));
  return {
    supabase: {
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            order: order(() =>
              table === 'user_tasks' ? userResp.value : assignedResp.value,
            ),
          }),
        }),
      }),
    },
  };
});

import { useClientTasks } from './useClientTasks';

function wrap(c: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{c}</QueryClientProvider>;
}

describe('useClientTasks', () => {
  beforeEach(() => {
    userResp.value = { data: [], error: null };
    assignedResp.value = { data: [], error: null };
  });

  it('unions personal + delegated tasks for the client', async () => {
    userResp.value = { data: [{ id: 'u1', title: 'P', user_id: 'me', created_by: 'me', completed_at: null, due_at: '2026-07-01T10:00:00Z', importance: 'low', client_id: 'c1' }], error: null };
    assignedResp.value = { data: [{ id: 'a1', title: 'A', assignee_user_id: 'me', created_by_user_id: 'me', status: 'open', resolved_at: null, importance: 'high', source_code: 'D-1', deal_id: 'd1', job_id: null, client_id: 'c1', description: null, client: { id: 'c1', name: 'ACME' } }], error: null };
    const { result } = renderHook(() => useClientTasks('c1', 'me'), { wrapper: ({ children }) => wrap(children) });
    await waitFor(() => expect(result.current.cards.length).toBe(2));
    expect(result.current.cards.map((c) => c.kind).sort()).toEqual(['assigned', 'user']);
  });
});
```

- [ ] **Step 3: Run the test, verify it fails**

Run: `npx vitest run src/features/clients/hooks/useClientTasks.test.tsx`
Expected: FAIL ("Cannot find module './useClientTasks'").

- [ ] **Step 4: Implement the hook (unions both task tables by client)**

Create `src/features/clients/hooks/useClientTasks.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { UserTaskRow } from '@/features/home/hooks/useUserTasks';
import { ASSIGNED_TASK_SELECT, type AssignedTaskRow } from '@/features/assigned_tasks/hooks/useAssignedTasksOpen';
import { buildBoardCards, type TaskCard } from '@/features/tasks/taskCard';

export function useClientTasks(clientId: string, meId: string) {
  const query = useQuery<TaskCard[]>({
    queryKey: queryKeys.clientTasks(clientId),
    enabled: !!clientId,
    queryFn: async () => {
      const [u, a] = await Promise.all([
        supabase.from('user_tasks').select('*').eq('client_id', clientId).order('due_at', { ascending: true }),
        supabase.from('assigned_tasks').select(ASSIGNED_TASK_SELECT).eq('client_id', clientId).order('created_at', { ascending: false }),
      ]);
      if (u.error) throw new Error(u.error.message);
      if (a.error) throw new Error(a.error.message);
      return buildBoardCards(
        (u.data ?? []) as UserTaskRow[],
        (a.data ?? []) as unknown as AssignedTaskRow[],
        meId,
      );
    },
  });
  return { cards: query.data ?? [], isLoading: query.isLoading, error: query.error };
}
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `npx vitest run src/features/clients/hooks/useClientTasks.test.tsx`
Expected: PASS.

- [ ] **Step 6: Add i18n strings for the tab**

In `src/i18n/locales/en/clients.json`, inside `tabs`, add `"tasks": "Tasks"`; add a `tasks_tab` block:
```json
  "tasks_tab": { "open": "Open", "resolved": "Resolved", "empty": "No tasks for this client yet.", "new": "New task" }
```
In `el/clients.json` add `"tasks": "Εργασίες"` and:
```json
  "tasks_tab": { "open": "Ανοιχτές", "resolved": "Ολοκληρωμένες", "empty": "Δεν υπάρχουν εργασίες για αυτόν τον πελάτη.", "new": "Νέα εργασία" }
```

- [ ] **Step 7: Implement `ClientTasksTab`**

Create `src/features/clients/ClientTasksTab.tsx`:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/lib/stores/authStore';
import { TaskDialog } from '@/features/home/TaskDialog';
import { AssignedTaskDetailDialog } from '@/features/assigned_tasks/AssignedTaskDetailDialog';
import { UserTaskDetailDialog } from '@/features/tasks/UserTaskDetailDialog';
import { ImportanceBadge } from '@/features/tasks/ImportanceBadge';
import type { TaskCard } from '@/features/tasks/taskCard';
import { useClientTasks } from './hooks/useClientTasks';

export function ClientTasksTab({ clientId, clientName }: { clientId: string; clientName: string }) {
  const { t } = useTranslation('clients');
  const meId = useAuthStore((s) => s.user?.id ?? '');
  const { cards, isLoading } = useClientTasks(clientId, meId);
  const [newOpen, setNewOpen] = useState(false);
  const [openCard, setOpenCard] = useState<TaskCard | null>(null);

  if (isLoading) return <div className="text-sm text-muted-foreground">…</div>;
  const open = cards.filter((c) => !c.resolved);
  const resolved = cards.filter((c) => c.resolved);

  const row = (c: TaskCard) => (
    <li key={c.key} className="border-t first:border-t-0">
      <button type="button" onClick={() => setOpenCard(c)} className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-muted">
        <span className="truncate text-sm font-medium">{c.title}</span>
        <ImportanceBadge importance={c.importance} />
        {c.sourceCode && <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{c.sourceCode}</span>}
      </button>
    </li>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          {t('tasks_tab.open')} ({open.length})
        </h2>
        <Button type="button" size="sm" onClick={() => setNewOpen(true)}>+ {t('tasks_tab.new')}</Button>
      </div>
      {open.length === 0 ? (
        <p className="rounded-md border bg-muted p-4 text-sm text-muted-foreground">{t('tasks_tab.empty')}</p>
      ) : (
        <ul className="rounded-md border bg-card">{open.map(row)}</ul>
      )}
      {resolved.length > 0 && (
        <>
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            {t('tasks_tab.resolved')} ({resolved.length})
          </h2>
          <ul className="rounded-md border bg-card opacity-70">{resolved.map(row)}</ul>
        </>
      )}

      <TaskDialog open={newOpen} onOpenChange={setNewOpen} defaultClient={{ id: clientId, name: clientName }} />
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

- [ ] **Step 8: Mount the tab on the client page**

In `src/features/clients/ClientDetailPage.tsx`:
- import: `import { ClientTasksTab } from './ClientTasksTab';`
- add a trigger after the `jobs` trigger:
```tsx
          <TabsTrigger value="tasks">{t('tabs.tasks')}</TabsTrigger>
```
- add the content (after the `jobs` TabsContent). Use the client name available on the page (the component already loads the client; reuse that variable — commonly `client.name`):
```tsx
        <TabsContent value="tasks" className="pt-4">
          <ClientTasksTab clientId={clientId} clientName={client?.name ?? ''} />
        </TabsContent>
```
(If the client object variable differs, pass the correct name field; `clientName` only seeds the picker default.)

- [ ] **Step 9: Run the clients tests + typecheck**

Run: `npx vitest run src/features/clients/`
Expected: PASS.
Run: `npx tsc -p tsconfig.json --noEmit` → no new errors.

- [ ] **Step 10: Commit**

```bash
git add src/features/clients/hooks/useClientTasks.ts src/features/clients/hooks/useClientTasks.test.tsx src/features/clients/ClientTasksTab.tsx src/features/clients/ClientDetailPage.tsx src/lib/queryKeys.ts src/i18n/locales/en/clients.json src/i18n/locales/el/clients.json
git commit -m "feat(clients): Tasks tab listing every task linked to the client"
```

---

## Task 8: Full verification + deploy

- [ ] **Step 1: Run the whole suite**

Run: `npx vitest run`
Expected: all pass (no regressions).

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc -p tsconfig.json --noEmit` then `npm run build`
Expected: both succeed.

- [ ] **Step 3: Confirm the prod migration is applied**

Via MCP `execute_sql` confirm `user_tasks.client_id` exists (Task 1 Step 3). If not yet applied, apply now.

- [ ] **Step 4: Push to main**

```bash
git push origin main
```

- [ ] **Step 5: Smoke test in prod (optional, like prior sessions)**

As an admin: create a personal task with a client on `/tasks`; open the client page → Tasks tab → confirm it appears; click a `/tasks` card → confirm the detail popup shows the info.

---

## Self-Review notes

- **Spec coverage:** A (migration → Task 1), B (`ClientPicker` → Tasks 2–3), C-personal (→ Task 4), C-delegated (no-op per trigger finding, documented), D (client tab → Task 7), E (`/tasks` button → Task 5), F (card detail → Task 6). All covered.
- **Type consistency:** `PickedClient {id,name}` used by `ClientPicker`, `TaskDialog.defaultClient`, and `ClientTasksTab`. `TaskCard` gains `notes`/`clientName` in Task 6, consumed by `UserTaskDetailDialog` and `ClientTasksTab` (which uses `buildBoardCards`). `useUpsertTask` `client_id` matches the migration column.
- **Known soft spot:** the board/edit paths don't join the client *name* onto `user_tasks` (only `client_id`), so a personal card's `clientName` is null on the `/tasks` board detail; the client name still shows on the client Tasks tab (delegated rows carry it) and on the picker chip after selection. Fetching the personal task's client name everywhere is out of scope; revisit only if the product owner wants the name on the `/tasks` personal-card popup.
```
