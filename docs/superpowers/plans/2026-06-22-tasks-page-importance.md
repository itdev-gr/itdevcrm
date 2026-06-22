# Tasks Page + Task Importance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a sidebar **Tasks** page listing every open task assigned to the current user (personal + deal/job), ordered by importance, and add a required **Importance** field (Low/Medium/High/Urgent) to both task-creation forms, with all existing tasks defaulting to Low.

**Architecture:** One additive migration adds an `importance` CHECK column to both `user_tasks` and `assigned_tasks` (DEFAULT `'low'` backfills existing rows). A small shared `importance` module + two presentational components (`ImportanceBadge`, `ImportanceSelect`) are reused by a new `MyTasksPage` (which unions the existing `useOpenUserTasks` + `useAssignedTasksOpen` hooks and sorts by importance) and by the two existing create dialogs. The Home widget is unchanged.

**Tech Stack:** React + TypeScript, TanStack Query, react-i18next, Vitest + React Testing Library, Supabase Postgres (migration applied to prod via the Management API).

---

## Execution ordering (IMPORTANT)

Task 1 changes the DB schema, and the UI code reads/writes the new `importance` column. So the controller must, **after Task 1's migration file is committed and BEFORE dispatching the Task 4+ code subagents:**

1. Apply the migration to prod (Management API).
2. Run `npm run types:gen` so `src/types/supabase.ts` includes `importance` on `user_tasks`/`assigned_tasks`, and commit it.

This keeps every later task type-checking against the real schema. (Tasks 2 & 3 — the importance module and i18n — have no schema dependency and can run before the apply.)

## File structure

| File | Responsibility | Action |
|------|----------------|--------|
| `supabase/migrations/20260622210000_task_importance.sql` | Add `importance` to both task tables | Create |
| `src/features/tasks/importance.ts` | Importance codes, options, rank, `importanceOf` reader | Create |
| `src/features/tasks/importance.test.ts` | Unit tests for rank/reader | Create |
| `src/features/tasks/ImportanceBadge.tsx` | Colored importance pill (page rows) | Create |
| `src/features/tasks/ImportanceSelect.tsx` | Required importance `<select>` (both dialogs) | Create |
| `src/i18n/locales/en/common.json` / `el/common.json` | `nav.tasks`, `importance.*`, `tasks_page.*` | Modify |
| `src/features/assigned_tasks/hooks/useAssignedTasksOpen.ts` | Add `importance` to SELECT + row type | Modify |
| `src/features/tasks/MyTasksPage.tsx` | The Tasks page (union + sort + rows + actions) | Create |
| `src/features/tasks/MyTasksPage.test.tsx` | Page tests | Create |
| `src/app/router.tsx` | Register `/tasks` route | Modify |
| `src/components/layout/Sidebar.tsx` | Add Tasks nav item under Home | Modify |
| `src/features/home/TaskDialog.tsx` + `hooks/useUpsertTask.ts` | Importance on personal-task form | Modify |
| `src/features/assigned_tasks/NewAssignedTaskDialog.tsx` + `hooks/useCreateAssignedTask.ts` | Importance on deal/job-task form | Modify |

---

## Task 1: Migration — add `importance` to both task tables

**Files:**
- Create: `supabase/migrations/20260622210000_task_importance.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260622210000_task_importance.sql`:

```sql
-- Tasks get a required Importance (Low/Medium/High/Urgent), stored as lowercase
-- codes with a CHECK constraint (matches the existing assigned_tasks.status
-- pattern). NOT NULL DEFAULT 'low' backfills every existing row to Low in one
-- statement — no separate UPDATE needed.
alter table public.user_tasks
  add column importance text not null default 'low'
  check (importance in ('low','medium','high','urgent'));

alter table public.assigned_tasks
  add column importance text not null default 'low'
  check (importance in ('low','medium','high','urgent'));

-- ROLLBACK:
--   alter table public.user_tasks drop column importance;
--   alter table public.assigned_tasks drop column importance;
```

- [ ] **Step 2: Commit (file only — prod apply is a controller step, see "Execution ordering")**

```bash
git add supabase/migrations/20260622210000_task_importance.sql
git commit -m "feat(tasks): add importance column to user_tasks + assigned_tasks"
```

> **Controller (not the subagent):** after this commit, apply the SQL to prod via the Management API (`POST /v1/projects/xujlrclyzxrvxszepquy/database/query`), verify both columns exist and all existing rows are `'low'`, then run `npm run types:gen` and commit `src/types/supabase.ts`.

Verify query (controller, read-only):
```sql
select table_name, count(*) filter (where importance='low') as low, count(*) as total
from (
  select 'user_tasks' as table_name, importance from public.user_tasks
  union all select 'assigned_tasks', importance from public.assigned_tasks
) s group by table_name;
-- expect low == total for both tables
```

---

## Task 2: Importance module + unit tests

**Files:**
- Create: `src/features/tasks/importance.ts`
- Create: `src/features/tasks/importance.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/features/tasks/importance.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { importanceRank, importanceOf, IMPORTANCE_OPTIONS } from './importance';

describe('importance', () => {
  it('ranks urgent highest (lowest number) and low lowest', () => {
    expect(importanceRank('urgent')).toBeLessThan(importanceRank('high'));
    expect(importanceRank('high')).toBeLessThan(importanceRank('medium'));
    expect(importanceRank('medium')).toBeLessThan(importanceRank('low'));
  });

  it('sorts a mixed list urgent-first, low-last by rank', () => {
    const sorted = ['low', 'urgent', 'medium', 'high']
      .sort((a, b) => importanceRank(a as never) - importanceRank(b as never));
    expect(sorted).toEqual(['urgent', 'high', 'medium', 'low']);
  });

  it('importanceOf reads the column and defaults unknown/null to low', () => {
    expect(importanceOf({ importance: 'urgent' })).toBe('urgent');
    expect(importanceOf({ importance: null })).toBe('low');
    expect(importanceOf({ importance: 'bogus' })).toBe('low');
  });

  it('offers the four options in ascending severity', () => {
    expect(IMPORTANCE_OPTIONS).toEqual(['low', 'medium', 'high', 'urgent']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/features/tasks/importance.test.ts`
Expected: FAIL — "Failed to resolve import './importance'".

- [ ] **Step 3: Implement the module**

Create `src/features/tasks/importance.ts`:

```ts
export type ImportanceCode = 'low' | 'medium' | 'high' | 'urgent';

/** Order the options appear in the create-form select (ascending severity). */
export const IMPORTANCE_OPTIONS: ImportanceCode[] = ['low', 'medium', 'high', 'urgent'];

/** Sort key — urgent first (0), low last (3). */
const RANK: Record<ImportanceCode, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

export function importanceRank(code: ImportanceCode): number {
  return RANK[code] ?? RANK.low;
}

/** Read a task row's importance, defaulting null/unknown to 'low'. */
export function importanceOf(row: { importance?: string | null }): ImportanceCode {
  const v = row.importance;
  return v === 'urgent' || v === 'high' || v === 'medium' || v === 'low' ? v : 'low';
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/features/tasks/importance.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/importance.ts src/features/tasks/importance.test.ts
git commit -m "feat(tasks): importance codes + rank helper"
```

---

## Task 3: i18n strings (nav + importance + page)

**Files:**
- Modify: `src/i18n/locales/en/common.json`
- Modify: `src/i18n/locales/el/common.json`

These live in `common.json` (the default namespace) so they're reachable from every component without registering a new namespace.

- [ ] **Step 1: English**

In `src/i18n/locales/en/common.json`, add `"tasks": "Tasks"` to the `nav` object (after `"home": "Home"`), and add two new top-level blocks after the `nav` object:

```json
  "importance": {
    "label": "Importance",
    "placeholder": "Select importance…",
    "low": "Low",
    "medium": "Medium",
    "high": "High",
    "urgent": "Urgent"
  },
  "tasks_page": {
    "title": "Tasks",
    "subtitle": "All tasks assigned to you.",
    "empty": "No tasks assigned to you.",
    "empty_admin": "No open tasks for the team."
  },
```

So `nav` becomes:
```json
  "nav": {
    "home": "Home",
    "tasks": "Tasks",
    "login": "Login",
    ...
  },
```

- [ ] **Step 2: Greek**

In `src/i18n/locales/el/common.json`, add `"tasks": "Εργασίες"` to the `nav` object (after `"home": "Αρχική"`), and add:

```json
  "importance": {
    "label": "Σπουδαιότητα",
    "placeholder": "Επιλέξτε σπουδαιότητα…",
    "low": "Χαμηλή",
    "medium": "Μεσαία",
    "high": "Υψηλή",
    "urgent": "Επείγουσα"
  },
  "tasks_page": {
    "title": "Εργασίες",
    "subtitle": "Όλες οι εργασίες που σας έχουν ανατεθεί.",
    "empty": "Δεν σας έχουν ανατεθεί εργασίες.",
    "empty_admin": "Δεν υπάρχουν ανοιχτές εργασίες για την ομάδα."
  },
```

- [ ] **Step 3: Verify JSON parses**

Run: `node -e "JSON.parse(require('fs').readFileSync('src/i18n/locales/en/common.json','utf8'));JSON.parse(require('fs').readFileSync('src/i18n/locales/el/common.json','utf8'));console.log('ok')"`
Expected: `ok`.

- [ ] **Step 4: Commit**

```bash
git add src/i18n/locales/en/common.json src/i18n/locales/el/common.json
git commit -m "i18n(tasks): nav.tasks + importance + tasks page strings"
```

---

## Task 4: ImportanceBadge + ImportanceSelect components

**Files:**
- Create: `src/features/tasks/ImportanceBadge.tsx`
- Create: `src/features/tasks/ImportanceSelect.tsx`
- Create: `src/features/tasks/ImportanceControls.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/features/tasks/ImportanceControls.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

import { ImportanceBadge } from './ImportanceBadge';
import { ImportanceSelect } from './ImportanceSelect';

describe('ImportanceBadge', () => {
  it('renders the importance label', () => {
    render(<ImportanceBadge importance="urgent" />);
    expect(screen.getByText('importance.urgent')).toBeInTheDocument();
  });
});

describe('ImportanceSelect', () => {
  it('shows a disabled placeholder + the four options and reports changes', () => {
    const onChange = vi.fn();
    render(<ImportanceSelect id="imp" value="" onChange={onChange} />);
    expect(screen.getByText('importance.placeholder')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'importance.low' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'importance.urgent' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'high' } });
    expect(onChange).toHaveBeenCalledWith('high');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/features/tasks/ImportanceControls.test.tsx`
Expected: FAIL — cannot resolve `./ImportanceBadge`.

- [ ] **Step 3: Implement ImportanceBadge**

Create `src/features/tasks/ImportanceBadge.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { ImportanceCode } from './importance';

const CLASS: Record<ImportanceCode, string> = {
  low: 'bg-muted text-muted-foreground',
  medium: 'bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-200',
  high: 'bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200',
  urgent: 'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-200',
};

export function ImportanceBadge({ importance }: { importance: ImportanceCode }) {
  const { t } = useTranslation('common');
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', CLASS[importance])}>
      {t(`importance.${importance}`)}
    </span>
  );
}
```

- [ ] **Step 4: Implement ImportanceSelect**

Create `src/features/tasks/ImportanceSelect.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { IMPORTANCE_OPTIONS, type ImportanceCode } from './importance';

export function ImportanceSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: ImportanceCode | '';
  onChange: (v: ImportanceCode) => void;
}) {
  const { t } = useTranslation('common');
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value as ImportanceCode)}
      required
      className="block h-9 w-full rounded-lg border border-input/80 bg-background px-3 text-sm shadow-sm transition-colors focus:border-[#1a9696]/40 focus:outline-none focus:ring-2 focus:ring-[#1a9696]/20"
    >
      <option value="" disabled>
        {t('importance.placeholder')}
      </option>
      {IMPORTANCE_OPTIONS.map((code) => (
        <option key={code} value={code}>
          {t(`importance.${code}`)}
        </option>
      ))}
    </select>
  );
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run src/features/tasks/ImportanceControls.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/features/tasks/ImportanceBadge.tsx src/features/tasks/ImportanceSelect.tsx src/features/tasks/ImportanceControls.test.tsx
git commit -m "feat(tasks): ImportanceBadge + ImportanceSelect components"
```

---

## Task 5: Surface `importance` on the assigned-tasks query

**Files:**
- Modify: `src/features/assigned_tasks/hooks/useAssignedTasksOpen.ts`

`useOpenUserTasks` already uses `select('*')`, so it returns `importance` automatically once types are regenerated (Task 1 controller step). The assigned-tasks hook uses an explicit SELECT + a hand-written row type, so add the column to both.

- [ ] **Step 1: Add `importance` to the row type**

In `src/features/assigned_tasks/hooks/useAssignedTasksOpen.ts`, in the `AssignedTaskRow` type, add an `importance` field after `created_at`:

```ts
  status: 'open' | 'resolved';
  resolved_at: string | null;
  resolved_by_user_id: string | null;
  created_at: string;
  importance: string;
  department_group_id: string | null;
```

- [ ] **Step 2: Add `importance` to the SELECT**

In the same file, change the `SELECT` constant to include `importance`:

```ts
const SELECT = `
  id, title, description,
  deal_id, job_id, client_id, source_code,
  assignee_user_id, created_by_user_id,
  status, resolved_at, resolved_by_user_id, created_at, importance,
  department_group_id,
  client:client_id ( id, name ),
  department:department_group_id ( id, code, display_names, position )
`;
```

- [ ] **Step 3: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (the home widget that also uses `AssignedTaskRow` is unaffected — it just ignores the new field).

- [ ] **Step 4: Commit**

```bash
git add src/features/assigned_tasks/hooks/useAssignedTasksOpen.ts
git commit -m "feat(tasks): include importance in open assigned-tasks query"
```

---

## Task 6: The Tasks page + route + sidebar

**Files:**
- Create: `src/features/tasks/MyTasksPage.tsx`
- Create: `src/features/tasks/MyTasksPage.test.tsx`
- Modify: `src/app/router.tsx`
- Modify: `src/components/layout/Sidebar.tsx`

- [ ] **Step 1: Write the failing page test**

Create `src/features/tasks/MyTasksPage.test.tsx`:

```tsx
import type { ReactNode } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

const { useOpenUserTasks } = vi.hoisted(() => ({ useOpenUserTasks: vi.fn() }));
const { useAssignedTasksOpen } = vi.hoisted(() => ({ useAssignedTasksOpen: vi.fn() }));
const complete = vi.fn();
const resolve = vi.fn();
vi.mock('@/features/home/hooks/useOpenUserTasks', () => ({ useOpenUserTasks }));
vi.mock('@/features/assigned_tasks/hooks/useAssignedTasksOpen', () => ({ useAssignedTasksOpen }));
vi.mock('@/features/home/hooks/useDeleteTask', () => ({
  useToggleTaskComplete: () => ({ mutate: complete, isPending: false }),
}));
vi.mock('@/features/assigned_tasks/hooks/useResolveAssignedTask', () => ({
  useResolveAssignedTask: () => ({ mutate: resolve, isPending: false }),
}));
vi.mock('@/features/assigned_tasks/DepartmentChip', () => ({ DepartmentChip: () => null }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { resolvedLanguage: 'en' } }),
}));
vi.mock('react-router-dom', () => ({ Link: ({ children }: { children: ReactNode }) => <a>{children}</a> }));
vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) =>
    sel({ isAdmin: false, user: { id: 'me' } }),
}));

import { MyTasksPage } from './MyTasksPage';

describe('MyTasksPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('unions both task types, sorts urgent before low, and shows badges', () => {
    useOpenUserTasks.mockReturnValue({
      data: [
        { id: 'p1', title: 'Low personal', user_id: 'me', due_at: '2026-07-01T10:00:00Z', notes: null, importance: 'low' },
      ],
    });
    useAssignedTasksOpen.mockReturnValue({
      data: [
        { id: 'a1', title: 'Urgent assigned', assignee_user_id: 'me', source_code: 'D-1', deal_id: 'd1', job_id: null, description: null, client: null, department: null, importance: 'urgent' },
      ],
    });
    render(<MyTasksPage />);
    const titles = screen.getAllByText(/personal|assigned/i).map((n) => n.textContent);
    // urgent assigned task must appear before the low personal task
    expect(titles.indexOf('Urgent assigned')).toBeLessThan(titles.indexOf('Low personal'));
    expect(screen.getByText('importance.urgent')).toBeInTheDocument();
    expect(screen.getByText('importance.low')).toBeInTheDocument();
  });

  it('resolves an assigned task and completes a personal task', () => {
    useOpenUserTasks.mockReturnValue({
      data: [{ id: 'p1', title: 'P', user_id: 'me', due_at: '2026-07-01T10:00:00Z', notes: null, importance: 'low' }],
    });
    useAssignedTasksOpen.mockReturnValue({
      data: [{ id: 'a1', title: 'A', assignee_user_id: 'me', source_code: 'D-1', deal_id: 'd1', job_id: null, description: null, client: null, department: null, importance: 'high' }],
    });
    render(<MyTasksPage />);
    const buttons = screen.getAllByRole('button', { name: /assigned_tasks.resolve/ });
    fireEvent.click(buttons[0]); // assigned task (high) sorts first
    expect(resolve).toHaveBeenCalledWith({ id: 'a1' });
    fireEvent.click(buttons[1]); // personal task
    expect(complete).toHaveBeenCalledWith({ id: 'p1', completed: true });
  });

  it('shows the empty state when there are no tasks', () => {
    useOpenUserTasks.mockReturnValue({ data: [] });
    useAssignedTasksOpen.mockReturnValue({ data: [] });
    render(<MyTasksPage />);
    expect(screen.getByText('tasks_page.empty')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/features/tasks/MyTasksPage.test.tsx`
Expected: FAIL — cannot resolve `./MyTasksPage`.

- [ ] **Step 3: Implement the page**

Create `src/features/tasks/MyTasksPage.tsx`:

```tsx
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/lib/stores/authStore';
import { useOpenUserTasks } from '@/features/home/hooks/useOpenUserTasks';
import { useToggleTaskComplete } from '@/features/home/hooks/useDeleteTask';
import {
  useAssignedTasksOpen,
  type AssignedTaskRow,
} from '@/features/assigned_tasks/hooks/useAssignedTasksOpen';
import { useResolveAssignedTask } from '@/features/assigned_tasks/hooks/useResolveAssignedTask';
import { DepartmentChip } from '@/features/assigned_tasks/DepartmentChip';
import type { UserTaskRow } from '@/features/home/hooks/useUserTasks';
import { importanceOf, importanceRank, type ImportanceCode } from './importance';
import { ImportanceBadge } from './ImportanceBadge';

type Item =
  | { kind: 'personal'; task: UserTaskRow; importance: ImportanceCode }
  | { kind: 'assigned'; task: AssignedTaskRow; importance: ImportanceCode };

// Kept out of the component body so the `Date.now` read stays out of render purity
// (see AssignedTasksColumn for the same pattern).
function isOverdue(dueIso: string): boolean {
  return new Date(dueIso).getTime() < Date.now();
}
function formatDue(dueIso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  }).format(new Date(dueIso));
}
function sourceHref(task: AssignedTaskRow): string {
  if (task.deal_id) return `/deals/${task.deal_id}`;
  if (task.job_id) return `/jobs/${task.job_id}`;
  return '#';
}

export function MyTasksPage() {
  const { t } = useTranslation('common');
  const { t: th, i18n } = useTranslation('home');
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const userId = useAuthStore((s) => s.user?.id ?? '');
  const [showAll, setShowAll] = useState(false);
  const assigneeUserId = isAdmin && showAll ? null : userId || null;
  const { data: personal = [] } = useOpenUserTasks({ assigneeUserId });
  const { data: assigned = [] } = useAssignedTasksOpen({ assigneeUserId });
  const complete = useToggleTaskComplete();
  const resolve = useResolveAssignedTask();
  const locale = i18n.resolvedLanguage === 'el' ? 'el-GR' : 'en-US';

  // personal first (already due-asc), then assigned (created-desc); a STABLE sort
  // by importance rank keeps that intra-importance order while putting urgent on top.
  const items: Item[] = [
    ...personal.map((task) => ({ kind: 'personal' as const, task, importance: importanceOf(task) })),
    ...assigned.map((task) => ({ kind: 'assigned' as const, task, importance: importanceOf(task) })),
  ].sort((a, b) => importanceRank(a.importance) - importanceRank(b.importance));

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('tasks_page.title')}</h1>
          <p className="text-sm opacity-70">{t('tasks_page.subtitle')}</p>
        </div>
        {isAdmin && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              showAll
                ? 'border-primary/30 bg-primary/10 text-primary'
                : 'border-border/70 bg-muted/40 text-muted-foreground hover:text-foreground',
            )}
          >
            {th('assigned_tasks.all_team_title')}
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <p className="rounded border border-dashed p-6 text-center text-sm opacity-70">
          {showAll ? t('tasks_page.empty_admin') : t('tasks_page.empty')}
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) =>
            item.kind === 'personal' ? (
              <li key={`p-${item.task.id}`}>
                <div className="flex items-start gap-3 rounded-lg border border-border/60 bg-background px-3 py-3 shadow-sm">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium">{item.task.title}</span>
                      <ImportanceBadge importance={item.importance} />
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {th('assigned_tasks.personal')}
                      </span>
                      <span
                        className={cn(
                          'text-[11px]',
                          isOverdue(item.task.due_at) ? 'font-medium text-destructive' : 'text-muted-foreground',
                        )}
                      >
                        {isOverdue(item.task.due_at) ? `${th('assigned_tasks.overdue')} · ` : ''}
                        {formatDue(item.task.due_at, locale)}
                      </span>
                    </div>
                    {item.task.notes && (
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.task.notes}</p>
                    )}
                  </div>
                  {(isAdmin || item.task.user_id === userId) && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="shrink-0"
                      onClick={() => complete.mutate({ id: item.task.id, completed: true })}
                      disabled={complete.isPending}
                    >
                      <CheckCircle2 className="size-3.5" />
                      {th('assigned_tasks.resolve')}
                    </Button>
                  )}
                </div>
              </li>
            ) : (
              <li key={`a-${item.task.id}`}>
                <div className="flex items-start gap-3 rounded-lg border border-border/60 bg-background px-3 py-3 shadow-sm">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium">{item.task.title}</span>
                      <ImportanceBadge importance={item.importance} />
                      <DepartmentChip department={item.task.department} />
                      <Link
                        to={sourceHref(item.task)}
                        className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
                      >
                        {item.task.source_code ?? '—'}
                      </Link>
                    </div>
                    {item.task.client && (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{item.task.client.name}</p>
                    )}
                    {item.task.description && (
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.task.description}</p>
                    )}
                  </div>
                  {(isAdmin || item.task.assignee_user_id === userId) && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="shrink-0"
                      onClick={() => resolve.mutate({ id: item.task.id })}
                      disabled={resolve.isPending}
                    >
                      <CheckCircle2 className="size-3.5" />
                      {th('assigned_tasks.resolve')}
                    </Button>
                  )}
                </div>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/features/tasks/MyTasksPage.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Register the route**

In `src/app/router.tsx`, add the lazy import after the `HomePage` line (line 21):

```ts
const MyTasksPage = lazyPage(() => import('@/features/tasks/MyTasksPage'), 'MyTasksPage');
```

Then add the route inside the `ShellLayout` children, immediately after `{ path: '/', element: <HomePage /> }` (line 163):

```tsx
          { path: '/', element: <HomePage /> },
          { path: 'tasks', element: <MyTasksPage /> },
```

- [ ] **Step 6: Add the sidebar entry**

In `src/components/layout/Sidebar.tsx`, add `ListChecks` to the lucide import block (line 3-21, keep alphabetical-ish next to the others):

```ts
  Home,
  ListChecks,
  Megaphone,
```

Then add a `NavLink` directly after the Home link (line 97):

```tsx
      <NavLink to="/" end className={({ isActive }) => sidebarLinkClass(isActive)}>
        <Home className="size-4 shrink-0 opacity-80" />
        {t('nav.home')}
      </NavLink>

      <NavLink to="/tasks" className={({ isActive }) => sidebarLinkClass(isActive)}>
        <ListChecks className="size-4 shrink-0 opacity-80" />
        {t('nav.tasks')}
      </NavLink>
```

- [ ] **Step 7: Verify build + tests**

Run: `npx tsc --noEmit && npx vitest run src/features/tasks`
Expected: PASS (tsc clean; all tasks tests green).

- [ ] **Step 8: Commit**

```bash
git add src/features/tasks/MyTasksPage.tsx src/features/tasks/MyTasksPage.test.tsx src/app/router.tsx src/components/layout/Sidebar.tsx
git commit -m "feat(tasks): Tasks page (union, importance-sorted) + route + sidebar"
```

---

## Task 7: Importance on the personal-task form

**Files:**
- Modify: `src/features/home/hooks/useUpsertTask.ts`
- Modify: `src/features/home/TaskDialog.tsx`
- Modify (test): create `src/features/home/TaskDialog.test.tsx`

- [ ] **Step 1: Add `importance` to the upsert input + payload**

In `src/features/home/hooks/useUpsertTask.ts`, import the type and extend `Input` + `payload`:

Add the import at the top:
```ts
import type { ImportanceCode } from '@/features/tasks/importance';
```

In the `Input` type, add:
```ts
  due_at: string; // ISO
  importance: ImportanceCode;
  completed_at?: string | null;
```

In the `payload` object (inside the mutationFn), add `importance`:
```ts
        const payload = {
          user_id: input.user_id,
          title: input.title.trim(),
          notes: input.notes,
          due_at: input.due_at,
          importance: input.importance,
          completed_at: input.completed_at ?? null,
          ...(input.created_by !== undefined ? { created_by: input.created_by } : {}),
        };
```

- [ ] **Step 2: Write the failing dialog test**

Create `src/features/home/TaskDialog.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

const upsert = vi.fn().mockResolvedValue('id1');
vi.mock('./hooks/useUpsertTask', () => ({ useUpsertTask: () => ({ mutateAsync: upsert, isPending: false }) }));
vi.mock('./hooks/useDeleteTask', () => ({ useDeleteTask: () => ({ mutateAsync: vi.fn(), isPending: false }) }));
vi.mock('@/features/leads/hooks/useAssignableOwners', () => ({
  useAssignableOwners: () => ({ data: [{ user_id: 'me', full_name: 'Me', email: 'me@x.gr' }] }),
}));
vi.mock('@/lib/stores/authStore', () => ({ useAuthStore: (sel: (s: unknown) => unknown) => sel({ user: { id: 'me' } }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? k }) }));

import { TaskDialog } from './TaskDialog';

describe('TaskDialog importance', () => {
  beforeEach(() => vi.clearAllMocks());

  it('requires importance before Save is enabled, then includes it in the payload', async () => {
    render(<TaskDialog open onOpenChange={() => {}} />);
    // Title + due are prefilled (due defaults to now); importance starts empty → Save disabled.
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'My task' } });
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Importance'), { target: { value: 'high' } });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ importance: 'high', title: 'My task' }));
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/features/home/TaskDialog.test.tsx`
Expected: FAIL — no "Importance" field / Save not gated on it.

- [ ] **Step 4: Wire importance into TaskDialog**

In `src/features/home/TaskDialog.tsx`:

Add imports:
```ts
import { ImportanceSelect } from '@/features/tasks/ImportanceSelect';
import { importanceOf, type ImportanceCode } from '@/features/tasks/importance';
```

Add state (after `const [assigneeId, setAssigneeId] = useState('');`, line 47):
```ts
  const [importance, setImportance] = useState<ImportanceCode | ''>('');
```

In the reset `useEffect`, set importance for both branches:
```ts
    if (task) {
      setTitle(task.title);
      setNotes(task.notes ?? '');
      setDueAt(toLocalInputValue(new Date(task.due_at)));
      setCompleted(!!task.completed_at);
      setAssigneeId(task.user_id);
      setImportance(importanceOf(task));
    } else {
      setTitle('');
      setNotes('');
      setDueAt(toLocalInputValue(defaultDueAt ?? new Date()));
      setCompleted(false);
      setAssigneeId(userId);
      setImportance('');
    }
```

In `onSave`, guard on importance and add it to the payload:
```ts
  async function onSave() {
    if (!userId || !title.trim() || !dueAt || !importance) return;
    const assignee = assigneeId || userId;
    const payload = {
      user_id: assignee,
      ...(assignee !== userId ? { created_by: task?.created_by ?? userId } : {}),
      title: title.trim(),
      notes: notes.trim() || null,
      due_at: new Date(dueAt).toISOString(),
      importance,
      completed_at: completed ? task?.completed_at ?? new Date().toISOString() : null,
    };
    await upsert.mutateAsync(task?.id ? { ...payload, id: task.id } : payload);
    onOpenChange(false);
  }
```

Add the Importance field in the form, immediately after the Due field block (after line 149's closing `</div>`):
```tsx
          <div className="space-y-1.5">
            <Label htmlFor="task-importance">{t('importance.label', { ns: 'common' })}</Label>
            <ImportanceSelect id="task-importance" value={importance} onChange={setImportance} />
          </div>
```

Update the Save button's `disabled` to require importance (line 191):
```tsx
              disabled={!title.trim() || !dueAt || !importance || upsert.isPending || del.isPending}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run src/features/home/TaskDialog.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/home/TaskDialog.tsx src/features/home/hooks/useUpsertTask.ts src/features/home/TaskDialog.test.tsx
git commit -m "feat(tasks): required Importance on the personal-task form"
```

---

## Task 8: Importance on the deal/job-task form

**Files:**
- Modify: `src/features/assigned_tasks/hooks/useCreateAssignedTask.ts`
- Modify: `src/features/assigned_tasks/NewAssignedTaskDialog.tsx`
- Modify (test): create `src/features/assigned_tasks/NewAssignedTaskDialog.test.tsx`

- [ ] **Step 1: Add `importance` to the create input + insert**

In `src/features/assigned_tasks/hooks/useCreateAssignedTask.ts`:

Add the import:
```ts
import type { ImportanceCode } from '@/features/tasks/importance';
```

Add to `CreateAssignedTaskInput`:
```ts
  assigneeUserId: string;
  departmentId: string;
  importance: ImportanceCode;
```

Add `importance` to the insert object (inside `.insert({ ... } as never)`):
```ts
          assignee_user_id: input.assigneeUserId,
          created_by_user_id: user.id,
          department_group_id: input.departmentId,
          importance: input.importance,
```

- [ ] **Step 2: Write the failing dialog test**

Create `src/features/assigned_tasks/NewAssignedTaskDialog.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

const create = vi.fn().mockResolvedValue('id1');
vi.mock('./hooks/useCreateAssignedTask', () => ({ useCreateAssignedTask: () => ({ mutateAsync: create }) }));
vi.mock('@/features/leads/hooks/useAssignableOwners', () => ({
  useAssignableOwners: () => ({ data: [{ user_id: 'u1', full_name: 'User One', email: 'u1@x.gr' }] }),
}));
vi.mock('@/features/groups/hooks/useGroups', () => ({
  useGroups: () => ({ data: [{ id: 'g1', display_names: { en: 'Web SEO', el: 'Web SEO' } }] }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { resolvedLanguage: 'en' } }),
}));

import { NewAssignedTaskDialog } from './NewAssignedTaskDialog';

describe('NewAssignedTaskDialog importance', () => {
  beforeEach(() => vi.clearAllMocks());

  it('requires importance and sends it in the create payload', async () => {
    render(<NewAssignedTaskDialog open onOpenChange={() => {}} source={{ kind: 'deal', id: 'd1' }} />);
    fireEvent.change(screen.getByLabelText('assigned_tasks.title_placeholder'), { target: { value: 'Task A' } });
    fireEvent.change(screen.getByLabelText('assigned_tasks.assignee_label'), { target: { value: 'u1' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Web SEO' }));
    const submit = screen.getByRole('button', { name: 'assigned_tasks.create' });
    expect(submit).toBeDisabled(); // importance still empty
    fireEvent.change(screen.getByLabelText('importance.label'), { target: { value: 'urgent' } });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ importance: 'urgent', title: 'Task A', assigneeUserId: 'u1', departmentId: 'g1' })),
    );
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/features/assigned_tasks/NewAssignedTaskDialog.test.tsx`
Expected: FAIL — no "importance.label" field; submit not gated on it.

- [ ] **Step 4: Wire importance into NewAssignedTaskDialog**

In `src/features/assigned_tasks/NewAssignedTaskDialog.tsx`:

Add imports:
```ts
import { Label } from '@/components/ui/label';
import { ImportanceSelect } from '@/features/tasks/ImportanceSelect';
import type { ImportanceCode } from '@/features/tasks/importance';
```
(`Label` is already imported — keep the existing one; do not duplicate.)

Add state (after `const [departmentId, setDepartmentId] = useState<string | null>(null);`, line 29):
```ts
  const [importance, setImportance] = useState<ImportanceCode | ''>('');
```

In `onSubmit`, guard + pass importance, and reset it on success:
```ts
  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || !assigneeUserId || !departmentId || !importance) return;
    setSubmitting(true);
    try {
      await create.mutateAsync({
        source,
        title: title.trim(),
        description: description.trim() || null,
        assigneeUserId,
        departmentId,
        importance,
      });
      setTitle('');
      setDescription('');
      setAssigneeUserId('');
      setDepartmentId(null);
      setImportance('');
      onOpenChange(false);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }
```

Update `canSubmit` (line 56):
```ts
  const canSubmit = !!title.trim() && !!assigneeUserId && !!departmentId && !!importance;
```

Add the Importance field after the department block (after its closing `</div>`, line 123):
```tsx
          <div className="space-y-1.5">
            <Label htmlFor="at-importance">
              {t('importance.label', { ns: 'common' })} <span className="text-red-600 dark:text-red-400">*</span>
            </Label>
            <ImportanceSelect id="at-importance" value={importance} onChange={setImportance} />
          </div>
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run src/features/assigned_tasks/NewAssignedTaskDialog.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/assigned_tasks/NewAssignedTaskDialog.tsx src/features/assigned_tasks/hooks/useCreateAssignedTask.ts src/features/assigned_tasks/NewAssignedTaskDialog.test.tsx
git commit -m "feat(tasks): required Importance on the deal/job-task form"
```

---

## Task 9: Full verification + push

- [ ] **Step 1: Full build + targeted tests**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: all PASS (no type errors, no lint errors, production build succeeds).

Run: `npx vitest run src/features/tasks src/features/home src/features/assigned_tasks`
Expected: PASS (all task-related suites green, including the new tests).

- [ ] **Step 2: Push to main**

```bash
git push origin main
```

- [ ] **Step 3: Live re-verify on prod after deploy**

After Vercel deploys (hard-refresh to dodge stale chunks):
1. Sidebar shows **Tasks** under Home; clicking it loads `/tasks` with your open tasks, urgent first, each with an importance badge; Complete/Resolve buttons work.
2. Creating a personal task (Home → New task) requires choosing an Importance before Save enables.
3. Creating a deal/job task (deal/job page → New task) requires an Importance before Create enables.
4. Console shows zero errors.

Expected: all four behave as described.

---

## Changes / Revert

- **DB:** one additive migration (`20260622210000_task_importance.sql`), applied to prod via the Management API. Rollback = `alter table public.user_tasks drop column importance;` + same for `assigned_tasks`. `src/types/supabase.ts` regenerated.
- **Code:** atomic commits (migration, importance module, i18n, components, query, page+route+sidebar, both forms). Each reverts cleanly with `git revert`. No data migration beyond the column default.

---

## Self-Review

- **Spec coverage:** Tasks page (both types, view + complete/resolve, importance-first, admin toggle) → Task 6. Importance on both forms (required) → Tasks 7 & 8. Backfill existing → Low → Task 1 (`DEFAULT 'low'`). Sidebar under Home + i18n → Tasks 3 & 6. Importance column on both tables → Task 1. ✅
- **Placeholder scan:** every code/SQL step shows full content; no TBD/"handle errors"/"similar to". ✅
- **Type consistency:** `ImportanceCode` defined in Task 2, imported by Tasks 4/6/7/8. `importanceOf`/`importanceRank` signatures match across page + tests. `useUpsertTask` Input gains `importance: ImportanceCode`; `CreateAssignedTaskInput` gains `importance: ImportanceCode`; `AssignedTaskRow` gains `importance: string` (read via `importanceOf`). `ImportanceSelect` props (`id`, `value: ImportanceCode | ''`, `onChange: (v: ImportanceCode) => void`) match both dialogs' usage. i18n keys `nav.tasks`, `importance.*`, `tasks_page.*` defined in Task 3 and used in Tasks 4/6/7/8. ✅
