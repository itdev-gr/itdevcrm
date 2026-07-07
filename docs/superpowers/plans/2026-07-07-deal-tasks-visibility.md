# Deal Tasks Visibility (admin + accounting) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accounting (like admin) sees every task on a deal, and the deal's Tasks tab also lists the deal's job tasks (labeled with the job code).

**Architecture:** One RLS migration adds `current_user_in_group('accounting')` to the `assigned_tasks` SELECT policy (read-only widening — update/delete/comments unchanged). The deal Tasks tab's hook unions deal tasks with the deal's job tasks in a single `.or()` query (job ids fetched first) and joins the job code for a chip. The task detail dialog hides Resolve and the comment thread for non-parties so accounting's new read access never surfaces RLS errors.

**Tech Stack:** Postgres RLS (Supabase), React 18 + TypeScript, @tanstack/react-query, vitest.

**Spec:** `docs/superpowers/specs/2026-07-07-deal-tasks-visibility-design.md`

## Global Constraints

- Verify with `npm run build` (tsc -b strict + eslint --max-warnings=0); `!` on mock-call indexing.
- Tests fully mock `@/lib/supabase` — no network (suite runs against prod config).
- Prod DDL via Management API only from the main session, after the user's explicit go-ahead (checkpoint in Task 1).
- `user_tasks`, `task_comments` policies and `is_task_party` are NOT touched.
- Both i18n locales updated together.
- Push only after the migration is applied (frontend behavior doesn't depend on it, but ship them together so accounting sees the complete feature).

---

### Task 1: RLS migration file

**Files:**
- Create: `supabase/migrations/20260707130000_assigned_tasks_accounting_select.sql`

**Interfaces:**
- Produces: accounting group members pass the `assigned_tasks` SELECT policy. No frontend interface.

- [ ] **Step 1: Write the migration file** (exactly):

```sql
-- Admin + accounting must see ALL tasks on a deal. Admins already pass the
-- assigned_tasks SELECT policy; accounting members only saw tasks they created
-- or were assigned. Read-only widening: UPDATE/DELETE policies and the
-- task_comments / is_task_party rules are intentionally unchanged.

drop policy if exists assigned_tasks_select on public.assigned_tasks;
create policy assigned_tasks_select on public.assigned_tasks
  for select to authenticated
  using (
    auth.uid() = assignee_user_id
    or auth.uid() = created_by_user_id
    or public.current_user_is_admin()
    or public.current_user_in_group('accounting')
  );

-- ROLLBACK:
-- drop policy if exists assigned_tasks_select on public.assigned_tasks;
-- create policy assigned_tasks_select on public.assigned_tasks
--   for select to authenticated
--   using (
--     auth.uid() = assignee_user_id
--     or auth.uid() = created_by_user_id
--     or public.current_user_is_admin()
--   );
```

- [ ] **Step 2: Commit the file (not applied — main session applies after user go-ahead)**

```bash
git add supabase/migrations/20260707130000_assigned_tasks_accounting_select.sql
git commit -m "feat(tasks): accounting reads all assigned tasks (RLS migration file)"
```

- [ ] **Step 3 (main session): CHECKPOINT — user go-ahead, then apply via Management API**

- [ ] **Step 4 (main session): Rolled-back verification probes**

Run as ONE Management API query:

```sql
begin;
-- accounting member sees a task they're not party to
select set_config('request.jwt.claims',
  json_build_object('sub', (select ug.user_id from public.user_groups ug
                             join public.groups g on g.id = ug.group_id
                            where g.code = 'accounting'
                              and not exists (select 1 from public.profiles p where p.user_id = ug.user_id and p.is_admin)
                            limit 1),
                    'role', 'authenticated')::text, true);
set local role authenticated;
do $chk$
declare n int;
begin
  select count(*) into n from public.assigned_tasks
   where assignee_user_id <> auth.uid() and created_by_user_id <> auth.uid();
  if n = 0 then raise exception 'FAIL: accounting member sees 0 foreign tasks'; end if;
  -- update on a foreign task must hit 0 rows (policy unchanged)
  update public.assigned_tasks set title = title
   where assignee_user_id <> auth.uid() and created_by_user_id <> auth.uid();
  if found then raise exception 'FAIL: accounting could update a foreign task'; end if;
end $chk$;
reset role;
-- non-party sales rep still sees nothing foreign
select set_config('request.jwt.claims',
  json_build_object('sub', (select ug.user_id from public.user_groups ug
                             join public.groups g on g.id = ug.group_id
                            where g.code = 'sales'
                              and not exists (select 1 from public.profiles p where p.user_id = ug.user_id and p.is_admin)
                              and not exists (select 1 from public.user_groups ug2 join public.groups g2 on g2.id = ug2.group_id
                                               where ug2.user_id = ug.user_id and g2.code = 'accounting')
                            limit 1),
                    'role', 'authenticated')::text, true);
set local role authenticated;
do $chk$
declare n int;
begin
  select count(*) into n from public.assigned_tasks
   where assignee_user_id <> auth.uid() and created_by_user_id <> auth.uid();
  if n <> 0 then raise exception 'FAIL: sales rep sees % foreign tasks', n; end if;
end $chk$;
reset role;
rollback;
select 'ALL RLS CHECKS PASSED' as result;
```

Expected: `[{"result":"ALL RLS CHECKS PASSED"}]`.

---

### Task 2: Deal Tasks tab unions job tasks + job chip

**Files:**
- Modify: `src/features/assigned_tasks/hooks/useAssignedTasksOpen.ts` (type only)
- Modify: `src/features/assigned_tasks/hooks/useAssignedTasksForSource.ts`
- Modify: `src/features/assigned_tasks/AssignedTasksTab.tsx`
- Test: `src/features/assigned_tasks/hooks/useAssignedTasksForSource.test.tsx` (new)

**Interfaces:**
- Consumes: nothing new from Task 1 (RLS is server-side).
- Produces: `AssignedTaskRow` gains optional `job?: { id: string; code: string | null } | null`; deal-kind queries return deal tasks + the deal's job tasks; `TaskRow` renders a job-code chip for job tasks when the tab source is a deal.

- [ ] **Step 1: Write the failing hook test**

Create `src/features/assigned_tasks/hooks/useAssignedTasksForSource.test.tsx`:

```tsx
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { fromMock, state } = vi.hoisted(() => {
  const state = {
    jobIds: [] as { id: string }[],
    tasks: [] as unknown[],
    lastOr: null as string | null,
    lastEq: null as [string, string] | null,
  };
  // supabase.from('jobs') -> select().eq() resolves job ids;
  // supabase.from('assigned_tasks') -> select().or()/.eq().order() resolves tasks.
  const fromMock = vi.fn((table: string) => {
    if (table === 'jobs') {
      return {
        select: () => ({
          eq: () => Promise.resolve({ data: state.jobIds, error: null }),
        }),
      };
    }
    return {
      select: () => ({
        or: (expr: string) => {
          state.lastOr = expr;
          return { order: () => Promise.resolve({ data: state.tasks, error: null }) };
        },
        eq: (col: string, val: string) => {
          state.lastEq = [col, val];
          return { order: () => Promise.resolve({ data: state.tasks, error: null }) };
        },
      }),
    };
  });
  return { fromMock, state };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from: fromMock } }));

import { useAssignedTasksForSource } from './useAssignedTasksForSource';

function wrap(c: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{c}</QueryClientProvider>;
}

describe('useAssignedTasksForSource — deal kind', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.jobIds = [];
    state.tasks = [];
    state.lastOr = null;
    state.lastEq = null;
  });

  it('unions deal tasks with the deal jobs tasks when the deal has jobs', async () => {
    state.jobIds = [{ id: 'job-1' }, { id: 'job-2' }];
    const { result } = renderHook(
      () => useAssignedTasksForSource({ kind: 'deal', id: 'deal-1' }),
      { wrapper: ({ children }) => wrap(children) },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(state.lastOr).toBe('deal_id.eq.deal-1,job_id.in.(job-1,job-2)');
  });

  it('falls back to a plain deal_id filter when the deal has no jobs', async () => {
    const { result } = renderHook(
      () => useAssignedTasksForSource({ kind: 'deal', id: 'deal-1' }),
      { wrapper: ({ children }) => wrap(children) },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(state.lastEq).toEqual(['deal_id', 'deal-1']);
    expect(state.lastOr).toBeNull();
  });

  it('job kind is unchanged (no jobs pre-query)', async () => {
    const { result } = renderHook(
      () => useAssignedTasksForSource({ kind: 'job', id: 'job-9' }),
      { wrapper: ({ children }) => wrap(children) },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(state.lastEq).toEqual(['job_id', 'job-9']);
    expect(fromMock).not.toHaveBeenCalledWith('jobs');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/features/assigned_tasks/hooks/useAssignedTasksForSource.test.tsx`
Expected: first test FAILS (`lastOr` is null — hook currently uses `.eq` for deals); tests 2–3 pass.

- [ ] **Step 3: Implement the hook union + job join**

In `src/features/assigned_tasks/hooks/useAssignedTasksOpen.ts`, add to the `AssignedTaskRow` type (after `department`):
```ts
  job?: { id: string; code: string | null } | null;
```

In `src/features/assigned_tasks/hooks/useAssignedTasksForSource.ts`, replace the local `SELECT` constant with:
```ts
const SELECT = `
  id, title, description,
  deal_id, job_id, client_id, source_code,
  assignee_user_id, created_by_user_id,
  status, resolved_at, resolved_by_user_id, created_at,
  department_group_id,
  client:client_id ( id, name ),
  department:department_group_id ( id, code, display_names, position ),
  job:job_id ( id, code )
`;
```

Replace the `queryFn` body with:
```ts
    queryFn: async () => {
      let q = supabase.from('assigned_tasks').select(SELECT);
      if (useUnion) {
        q = q.or(
          `job_id.eq.${source.id},and(deal_id.eq.${deptMatch!.dealId},department_group_id.eq.${deptMatch!.departmentGroupId})`,
        );
      } else if (source.kind === 'deal') {
        // A deal's Tasks tab shows deal tasks AND its jobs' tasks.
        const { data: jobs, error: jobsError } = await supabase
          .from('jobs')
          .select('id')
          .eq('deal_id', source.id);
        if (jobsError) throw new Error(jobsError.message);
        const jobIds = (jobs ?? []).map((j) => j.id);
        if (jobIds.length > 0) {
          q = q.or(`deal_id.eq.${source.id},job_id.in.(${jobIds.join(',')})`);
        } else {
          q = q.eq('deal_id', source.id);
        }
      } else {
        q = q.eq(column, source.id);
      }
      const { data, error } = await q.order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as AssignedTaskRow[];
    },
```

- [ ] **Step 4: Run hook tests to verify they pass**

Run: `npx vitest run src/features/assigned_tasks/hooks/useAssignedTasksForSource.test.tsx`
Expected: 3/3 PASS.

- [ ] **Step 5: Job chip in TaskRow**

In `src/features/assigned_tasks/AssignedTasksTab.tsx`:

`TaskRow` gets a new optional prop `jobChip` — add to its props type and destructure with default:
```tsx
  jobChip = false,
```
and in the props type: `jobChip?: boolean;`

Render the chip right after the `<DepartmentChip …/>` line inside `TaskRow`:
```tsx
{jobChip && task.job?.code && (
  <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
    {task.job.code}
  </span>
)}
```

At both `<TaskRow …/>` call sites (open + resolved lists), add:
```tsx
jobChip={source.kind === 'deal' && task.job_id != null}
```

- [ ] **Step 6: Run the feature directory tests + build**

Run: `npx vitest run src/features/assigned_tasks/` and `npm run build`
Expected: PASS / clean.

- [ ] **Step 7: Commit**

```bash
git add src/features/assigned_tasks/hooks/useAssignedTasksOpen.ts \
        src/features/assigned_tasks/hooks/useAssignedTasksForSource.ts \
        src/features/assigned_tasks/hooks/useAssignedTasksForSource.test.tsx \
        src/features/assigned_tasks/AssignedTasksTab.tsx
git commit -m "feat(tasks): deal Tasks tab unions the deal's job tasks with job-code chips"
```

---

### Task 3: Detail dialog — party-gated Resolve + private comments note

**Files:**
- Modify: `src/features/tasks/TaskDetailShell.tsx`
- Modify: `src/features/assigned_tasks/AssignedTaskDetailDialog.tsx`
- Modify: `src/i18n/locales/en/common.json`, `src/i18n/locales/el/common.json`
- Test: `src/features/assigned_tasks/AssignedTaskDetailDialog.test.tsx` (new)

**Interfaces:**
- Consumes: `AssignedTaskRow.created_by_user_id` (already in the detail select — verify; if `useAssignedTaskDetail`'s select lacks it, add it there).
- Produces: `TaskDetailShell` gains optional `commentsReplacement?: ReactNode` — when set, it renders instead of `<TaskComments/>`. Dialog computes `isParty = isAdmin || assignee === me || creator === me`; non-parties get no Resolve button and the replacement note instead of the thread.

- [ ] **Step 1: Add i18n keys**

In `src/i18n/locales/en/common.json` under `tasks_page` add:
`"comments_participants_only": "Comments are visible to the task's participants only."`
In `src/i18n/locales/el/common.json` under `tasks_page` add:
`"comments_participants_only": "Τα σχόλια είναι ορατά μόνο στους συμμετέχοντες της εργασίας."`
(If the `tasks_page` object lives in a different common-namespace file, put the key wherever the dialog's existing `c('tasks_page.…')` keys resolve from — check `c('tasks_page.resolve')`.)

- [ ] **Step 2: Write the failing dialog tests**

Create `src/features/assigned_tasks/AssignedTaskDetailDialog.test.tsx`:

```tsx
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';
import '@/lib/i18n';

const { taskData, authState } = vi.hoisted(() => ({
  taskData: { current: null as Record<string, unknown> | null },
  authState: { current: { userId: 'me', isAdmin: false, groupCodes: ['accounting'] } },
}));

vi.mock('./hooks/useAssignedTaskDetail', () => ({
  useAssignedTaskDetail: () => ({ data: taskData.current, isLoading: false, error: null }),
}));
vi.mock('./hooks/useResolveAssignedTask', () => ({
  useResolveAssignedTask: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('./hooks/useDealServiceJob', () => ({
  useDealServiceJob: () => ({ data: null }),
}));
vi.mock('@/features/tasks/TaskComments', () => ({
  TaskComments: () => <p>COMMENTS_THREAD</p>,
}));
vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      user: { id: authState.current.userId },
      isAdmin: authState.current.isAdmin,
      groupCodes: authState.current.groupCodes,
    }),
}));

import { MemoryRouter } from 'react-router-dom';
import { AssignedTaskDetailDialog } from './AssignedTaskDetailDialog';

function wrap(ui: ReactNode) {
  const qc = new QueryClient();
  return (
    <MemoryRouter>
      <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
    </MemoryRouter>
  );
}

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: 't1',
    title: 'Do the thing',
    description: null,
    deal_id: 'deal-1',
    job_id: null,
    client_id: 'c1',
    source_code: '005230',
    assignee_user_id: 'other-user',
    created_by_user_id: 'another-user',
    status: 'open',
    resolved_at: null,
    resolved_by_user_id: null,
    created_at: '2026-07-07T00:00:00Z',
    importance: 'medium',
    started_at: null,
    department_group_id: null,
    client: null,
    department: null,
    assignee: { full_name: 'Other User', email: 'o@x.gr' },
    creator: { full_name: 'Another User', email: 'a@x.gr' },
    ...overrides,
  };
}

describe('AssignedTaskDetailDialog — non-party accounting viewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.current = { userId: 'me', isAdmin: false, groupCodes: ['accounting'] };
  });

  it('hides Resolve and shows the participants-only note for a non-party', () => {
    taskData.current = task();
    render(wrap(<AssignedTaskDetailDialog taskId="t1" onOpenChange={() => {}} />));
    expect(screen.queryByRole('button', { name: 'Resolve' })).toBeNull();
    expect(screen.queryByText('COMMENTS_THREAD')).toBeNull();
    expect(screen.getByText("Comments are visible to the task's participants only.")).toBeTruthy();
  });

  it('shows Resolve and the thread for the assignee', () => {
    taskData.current = task({ assignee_user_id: 'me' });
    render(wrap(<AssignedTaskDetailDialog taskId="t1" onOpenChange={() => {}} />));
    expect(screen.getByRole('button', { name: 'Resolve' })).toBeTruthy();
    expect(screen.getByText('COMMENTS_THREAD')).toBeTruthy();
  });

  it('shows Resolve and the thread for an admin', () => {
    authState.current = { userId: 'me', isAdmin: true, groupCodes: [] };
    taskData.current = task();
    render(wrap(<AssignedTaskDetailDialog taskId="t1" onOpenChange={() => {}} />));
    expect(screen.getByRole('button', { name: 'Resolve' })).toBeTruthy();
    expect(screen.getByText('COMMENTS_THREAD')).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run src/features/assigned_tasks/AssignedTaskDetailDialog.test.tsx`
Expected: test 1 FAILS (Resolve rendered; thread rendered); tests 2–3 pass.

- [ ] **Step 4: Implement**

In `src/features/tasks/TaskDetailShell.tsx`:
- Add to the props type: `commentsReplacement?: ReactNode;` and destructure it.
- Replace the `<TaskComments …/>` line with:
```tsx
{commentsReplacement ?? <TaskComments kind={commentsKind} taskId={commentsTaskId} locale={locale} />}
```

In `src/features/assigned_tasks/AssignedTaskDetailDialog.tsx`:
- Compute after `const { data: task … }`:
```tsx
const isParty = !!task && (isAdmin || task.assignee_user_id === meId || task.created_by_user_id === meId);
```
- Footer Resolve condition becomes `{task.status === 'open' && isParty && (…)}`.
- Pass to `TaskDetailShell`:
```tsx
commentsReplacement={
  isParty ? undefined : (
    <p className="text-xs italic text-muted-foreground">
      {c('tasks_page.comments_participants_only')}
    </p>
  )
}
```
- Verify `useAssignedTaskDetail`'s select includes `created_by_user_id` (it's in the list-select; if the detail select lacks it, add it).

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run src/features/assigned_tasks/AssignedTaskDetailDialog.test.tsx`
Expected: 3/3 PASS. Also run `npx vitest run src/features/tasks/` to confirm the shell change broke nothing.

- [ ] **Step 6: Commit**

```bash
git add src/features/tasks/TaskDetailShell.tsx \
        src/features/assigned_tasks/AssignedTaskDetailDialog.tsx \
        src/features/assigned_tasks/AssignedTaskDetailDialog.test.tsx \
        src/i18n/locales/en/common.json \
        src/i18n/locales/el/common.json
git commit -m "feat(tasks): party-gated resolve + participants-only comments note"
```

---

### Task 4: Verify, apply, deploy, live smoke (main session)

- [ ] **Step 1:** `npx vitest run src/features/assigned_tasks/ src/features/tasks/` → PASS; `npm run build` → clean.
- [ ] **Step 2:** Apply the Task 1 migration (after the user checkpoint) + run its RLS probes.
- [ ] **Step 3:** Push to main.
- [ ] **Step 4:** Live smoke: log in as an accounting member (see memory: test accounts), open a deal with tasks created by others → full list visible incl. job tasks with chips; open one → details visible, no Resolve, participants-only note; confirm a sales rep still sees only their own.
- [ ] **Step 5:** Report.
