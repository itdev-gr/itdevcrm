# Department Tasks on the Matching Service Job — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A delegated task tagged with a department (e.g. web_seo) on a deal also surfaces on that deal's matching service job — in the job's Tasks tab and as a count badge on the kanban card.

**Architecture:** Read-side only, no schema/RLS change. A pure module maps `service_type → department group id` and builds per-deal/per-job open-task count maps. The job Tasks tab unions `job_id = thisJob OR (deal_id = thisJob.deal AND department = group(service_type))`. The kanban card reads one cached, RLS-limited board-level count query.

**Tech Stack:** React + TypeScript (strict: `noUncheckedIndexedAccess`, eslint `--max-warnings=0`), @tanstack/react-query, supabase-js (PostgREST `.or()`), vitest. Verify with `npm run build`.

**Spec:** `docs/superpowers/specs/2026-06-26-dept-task-on-service-job-design.md`

---

## File Structure

**Created:**
- `src/features/jobs/serviceTaskMatch.ts` (+ `serviceTaskMatch.test.ts`) — pure helpers.
- `src/features/jobs/hooks/useServiceTaskCounts.ts` — cached board-level count maps.

**Modified:**
- `src/features/assigned_tasks/hooks/useAssignedTasksForSource.ts` — optional `deptMatch`.
- `src/features/assigned_tasks/AssignedTasksTab.tsx` — thread `deptMatch` + "deal" chip.
- `src/features/jobs/JobDetailPage.tsx` — resolve group + pass `deptMatch`.
- `src/features/jobs/JobsKanbanCard.tsx` — count badge.
- `src/i18n/locales/en/jobs.json`, `src/i18n/locales/el/jobs.json` — "from deal" chip label.

---

## Task 1: Pure helpers (TDD)

**Files:**
- Create: `src/features/jobs/serviceTaskMatch.ts`
- Test: `src/features/jobs/serviceTaskMatch.test.ts`

- [ ] **Step 1: Write the failing test** `src/features/jobs/serviceTaskMatch.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { groupIdForServiceType, buildTaskCountMaps } from './serviceTaskMatch';

const groups = [
  { id: 'g-web', code: 'web_seo' },
  { id: 'g-local', code: 'local_seo' },
];

describe('groupIdForServiceType', () => {
  it('returns the group id whose code matches the service', () => {
    expect(groupIdForServiceType(groups, 'web_seo')).toBe('g-web');
    expect(groupIdForServiceType(groups, 'local_seo')).toBe('g-local');
  });
  it('returns null when no group matches (ai_seo / hosting / ads)', () => {
    expect(groupIdForServiceType(groups, 'hosting')).toBeNull();
  });
});

describe('buildTaskCountMaps', () => {
  it('counts deal-scoped dept-matched tasks into byDeal', () => {
    const rows = [
      { deal_id: 'd1', job_id: null, department_group_id: 'g-web' },
      { deal_id: 'd1', job_id: null, department_group_id: 'g-web' },
      { deal_id: 'd2', job_id: null, department_group_id: 'g-web' },
    ];
    const { byDeal, byJob } = buildTaskCountMaps(rows, 'g-web');
    expect(byDeal).toEqual({ d1: 2, d2: 1 });
    expect(byJob).toEqual({});
  });
  it('ignores deal tasks whose department is a different service', () => {
    const rows = [{ deal_id: 'd1', job_id: null, department_group_id: 'g-local' }];
    expect(buildTaskCountMaps(rows, 'g-web').byDeal).toEqual({});
  });
  it('counts job-scoped tasks into byJob regardless of department', () => {
    const rows = [
      { deal_id: null, job_id: 'j1', department_group_id: 'g-local' },
      { deal_id: null, job_id: 'j1', department_group_id: 'g-web' },
    ];
    expect(buildTaskCountMaps(rows, 'g-web').byJob).toEqual({ j1: 2 });
  });
  it('with a null serviceGroupId, only job-scoped tasks count', () => {
    const rows = [
      { deal_id: 'd1', job_id: null, department_group_id: 'g-web' },
      { deal_id: null, job_id: 'j1', department_group_id: 'g-web' },
    ];
    const { byDeal, byJob } = buildTaskCountMaps(rows, null);
    expect(byDeal).toEqual({});
    expect(byJob).toEqual({ j1: 1 });
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`Cannot find module './serviceTaskMatch'`)

Run: `npx vitest run src/features/jobs/serviceTaskMatch.test.ts`

- [ ] **Step 3: Implement** `src/features/jobs/serviceTaskMatch.ts`

```ts
/** The department group id for a service_type, or null when none exists
 *  (ai_seo / hosting / ads have no department group). */
export function groupIdForServiceType(
  groups: { id: string; code: string }[],
  serviceType: string,
): string | null {
  return groups.find((g) => g.code === serviceType)?.id ?? null;
}

type CountRow = { deal_id: string | null; job_id: string | null; department_group_id: string | null };

/** Build per-deal (department-matched, deal-scoped) and per-job (job-scoped) open-task
 *  count maps. A card's count = byDeal[deal_id] + byJob[job_id]. Mirrors the tab union:
 *  a job-scoped task counts via byJob; a deal-scoped task counts via byDeal only when
 *  its department is this service's group. */
export function buildTaskCountMaps(
  rows: CountRow[],
  serviceGroupId: string | null,
): { byDeal: Record<string, number>; byJob: Record<string, number> } {
  const byDeal: Record<string, number> = {};
  const byJob: Record<string, number> = {};
  for (const r of rows) {
    if (r.job_id) {
      byJob[r.job_id] = (byJob[r.job_id] ?? 0) + 1;
    } else if (r.deal_id && serviceGroupId && r.department_group_id === serviceGroupId) {
      byDeal[r.deal_id] = (byDeal[r.deal_id] ?? 0) + 1;
    }
  }
  return { byDeal, byJob };
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `npx vitest run src/features/jobs/serviceTaskMatch.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/features/jobs/serviceTaskMatch.ts src/features/jobs/serviceTaskMatch.test.ts
git commit -m "feat(tasks): pure service↔department task-match helpers + tests"
```

---

## Task 2: `useServiceTaskCounts` hook

**Files:**
- Create: `src/features/jobs/hooks/useServiceTaskCounts.ts`

- [ ] **Step 1: Implement** (one cached, RLS-limited query per board)

```ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { buildTaskCountMaps } from '../serviceTaskMatch';

type Maps = { byDeal: Record<string, number>; byJob: Record<string, number> };

/** Open-task counts for the current service board: byDeal (department-matched deal
 *  tasks) + byJob (job-scoped tasks). One cached query shared by all cards on a board.
 *  RLS-limited — counts only what the viewer can see (admins: all), consistent with
 *  the Tasks tab. */
export function useServiceTaskCounts(serviceGroupId: string | null): Maps {
  const { data } = useQuery<Maps>({
    queryKey: ['service-task-counts', serviceGroupId ?? 'none'],
    staleTime: 30_000,
    queryFn: async () => {
      let q = supabase
        .from('assigned_tasks')
        .select('deal_id, job_id, department_group_id')
        .eq('status', 'open');
      q = serviceGroupId
        ? q.or(`department_group_id.eq.${serviceGroupId},job_id.not.is.null`)
        : q.not('job_id', 'is', null);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return buildTaskCountMaps(
        (data ?? []) as { deal_id: string | null; job_id: string | null; department_group_id: string | null }[],
        serviceGroupId,
      );
    },
  });
  return data ?? { byDeal: {}, byJob: {} };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/jobs/hooks/useServiceTaskCounts.ts
git commit -m "feat(tasks): cached per-board service-task count hook"
```

---

## Task 3: `useAssignedTasksForSource` — optional `deptMatch`

**Files:**
- Modify: `src/features/assigned_tasks/hooks/useAssignedTasksForSource.ts`

- [ ] **Step 1: Add the `deptMatch` param + union query**

Replace the `useAssignedTasksForSource` function with:

```ts
export function useAssignedTasksForSource(
  source: { kind: 'deal' | 'job'; id: string },
  deptMatch?: { dealId: string; departmentGroupId: string },
) {
  const column = source.kind === 'deal' ? 'deal_id' : 'job_id';
  const baseKey =
    source.kind === 'deal'
      ? queryKeys.assignedTasksForDeal(source.id)
      : queryKeys.assignedTasksForJob(source.id);
  const useUnion = source.kind === 'job' && !!deptMatch;
  const key = useUnion ? [...baseKey, 'dept', deptMatch!.departmentGroupId] : baseKey;

  return useQuery<AssignedTaskRow[]>({
    queryKey: key,
    enabled: !!source.id,
    queryFn: async () => {
      let q = supabase.from('assigned_tasks').select(SELECT);
      if (useUnion) {
        q = q.or(
          `job_id.eq.${source.id},and(deal_id.eq.${deptMatch!.dealId},department_group_id.eq.${deptMatch!.departmentGroupId})`,
        );
      } else {
        q = q.eq(column, source.id);
      }
      const { data, error } = await q.order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as AssignedTaskRow[];
    },
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS (existing callers pass no `deptMatch`; behavior unchanged for them).

- [ ] **Step 3: Commit**

```bash
git add src/features/assigned_tasks/hooks/useAssignedTasksForSource.ts
git commit -m "feat(tasks): useAssignedTasksForSource can union deal+department tasks for a job"
```

---

## Task 4: Tasks tab shows dept-matched deal tasks (+ "deal" chip) and the job page passes the match

**Files:**
- Modify: `src/features/assigned_tasks/AssignedTasksTab.tsx`
- Modify: `src/features/jobs/JobDetailPage.tsx`
- Modify: `src/i18n/locales/en/jobs.json`, `src/i18n/locales/el/jobs.json`

- [ ] **Step 1: Add the "from deal" i18n key** — inside the existing `assigned_tasks` object in both files.

`en/jobs.json` add: `"from_deal": "deal",`
`el/jobs.json` add: `"from_deal": "συμφωνία",`
(Place next to other `assigned_tasks.*` keys; keep JSON valid.)

- [ ] **Step 2: `AssignedTasksTab` — accept `deptMatch`, thread it, render the chip**

In `AssignedTasksTab.tsx`:

(a) Extend `Props` and the component signature:
```tsx
type Props = {
  source: { kind: 'deal' | 'job'; id: string };
  deptMatch?: { dealId: string; departmentGroupId: string };
};
```
```tsx
export function AssignedTasksTab({ source, deptMatch }: Props) {
```
(b) Pass `deptMatch` to the hook:
```tsx
  const { data: tasks = [], isLoading, error } = useAssignedTasksForSource(source, deptMatch);
```
(c) Tell each row whether it's an inherited deal task (only meaningful in the job view):
```tsx
        {open.map((task) => (
          <TaskRow key={task.id} task={task} onOpen={setOpenTaskId} fromDeal={source.kind === 'job' && task.job_id == null} />
        ))}
```
and the same for the resolved list:
```tsx
        {resolved.map((task) => (
          <TaskRow key={task.id} task={task} onOpen={setOpenTaskId} fromDeal={source.kind === 'job' && task.job_id == null} />
        ))}
```
(d) Extend `TaskRow` to render the chip:
```tsx
function TaskRow({
  task,
  onOpen,
  fromDeal = false,
}: {
  task: AssignedTaskRow;
  onOpen: (id: string) => void;
  fromDeal?: boolean;
}) {
```
and inside the title `<div className="flex items-center gap-2">`, right after `<DepartmentChip department={task.department} />`, add:
```tsx
            {fromDeal && (
              <span className="rounded-full bg-sky-100 px-1.5 py-0.5 text-[9px] font-semibold text-sky-800 dark:bg-sky-950/50 dark:text-sky-200">
                {t('assigned_tasks.from_deal')}
              </span>
            )}
```

- [ ] **Step 3: `JobDetailPage` — resolve the group and pass `deptMatch`**

In `JobDetailPage.tsx`, add the import:
```tsx
import { useGroups } from '@/features/groups/hooks/useGroups';
import { groupIdForServiceType } from './serviceTaskMatch';
```
Inside the component (near the other hooks, after `job` is available), add:
```tsx
  const { data: groups = [] } = useGroups();
```
Replace the tasks tab mount (line ~502):
```tsx
            <AssignedTasksTab source={{ kind: 'job', id: job.id }} />
```
with:
```tsx
            <AssignedTasksTab
              source={{ kind: 'job', id: job.id }}
              {...(groupIdForServiceType(groups, job.service_type)
                ? { deptMatch: { dealId: job.deal_id, departmentGroupId: groupIdForServiceType(groups, job.service_type)! } }
                : {})}
            />
```
(`useGroups` must be called unconditionally — place it with the other top-level hooks, before any early `return`. `job.deal_id` is non-null on jobs.)

- [ ] **Step 4: Typecheck + JSON valid + tab tests**

Run: `node -e "JSON.parse(require('fs').readFileSync('src/i18n/locales/en/jobs.json','utf8'));JSON.parse(require('fs').readFileSync('src/i18n/locales/el/jobs.json','utf8'));console.log('JSON OK')" && npm run typecheck && npx vitest run src/features/assigned_tasks`
Expected: `JSON OK`, typecheck PASS, assigned_tasks tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/assigned_tasks/AssignedTasksTab.tsx src/features/jobs/JobDetailPage.tsx src/i18n/locales/en/jobs.json src/i18n/locales/el/jobs.json
git commit -m "feat(tasks): job Tasks tab shows department-matched deal tasks (with a deal chip)"
```

---

## Task 5: Kanban card task-count badge

**Files:**
- Modify: `src/features/jobs/JobsKanbanCard.tsx`

- [ ] **Step 1: Add imports + count lookup**

In `JobsKanbanCard.tsx`, add imports:
```tsx
import { ListChecks } from 'lucide-react';
import { useGroups } from '@/features/groups/hooks/useGroups';
import { groupIdForServiceType } from './serviceTaskMatch';
import { useServiceTaskCounts } from './hooks/useServiceTaskCounts';
```
Inside the component body (with the other hooks, before the `return`), add:
```tsx
  const { data: groups = [] } = useGroups();
  const serviceGroupId = groupIdForServiceType(groups, job.service_type);
  const taskCounts = useServiceTaskCounts(serviceGroupId);
  const openTaskCount = (taskCounts.byDeal[job.deal_id] ?? 0) + (taskCounts.byJob[job.id] ?? 0);
```
(`ListChecks` is added to the existing `lucide-react` import if you prefer one line — either is fine.)

- [ ] **Step 2: Render the badge** — in the right-side icon group (the `<div className="flex shrink-0 items-center gap-1">`), add before the `{job.is_blocked && (…)}` block:

```tsx
              {openTaskCount > 0 && (
                <span
                  className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-800 dark:bg-amber-950/50 dark:text-amber-200"
                  title={lang === 'el' ? `${openTaskCount} ανοιχτές εργασίες` : `${openTaskCount} open tasks`}
                >
                  <ListChecks className="size-3" />
                  {openTaskCount}
                </span>
              )}
```
(`lang` already exists in this component: `const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en'`.)

- [ ] **Step 3: Build (lint gate)**

Run: `npm run build`
Expected: tsc PASS, eslint 0 warnings, vite build OK.

- [ ] **Step 4: Commit**

```bash
git add src/features/jobs/JobsKanbanCard.tsx
git commit -m "feat(tasks): open-task count badge on service job kanban cards"
```

---

## Task 6: Full verification, live smoke, push

**Files:** none (verification only)

- [ ] **Step 1: Full suite + build**

Run: `npm run build && npm run test:run`
Expected: build green; all vitest pass (including `serviceTaskMatch.test.ts`).

- [ ] **Step 2: Push to main**

```bash
git push origin HEAD:main
```
(If a parallel session advanced origin: `git fetch origin && git pull --rebase origin main`, then push. Commit only the files in this plan.)

- [ ] **Step 3: Live smoke** (against a local `npm run dev` → prod DB, or the deployed site once the chunk hash changes)

1. Find a real deal that has BOTH a Web SEO job and a Local SEO job (`select d.code, j.service_type, j.id, j.deal_id from jobs j join deals d on d.id=j.deal_id where d.id in (select deal_id from jobs where service_type='web_seo' and not archived) and j.service_type in ('web_seo','local_seo') and not j.archived order by d.code limit 10;`).
2. On that **deal**, create a delegated task with **department = Web SEO** (use the deal page's Tasks tab "+ New task", pick the Web SEO department + any assignee).
3. Open that deal's **Web SEO job** → Tasks tab → the new task appears with a blue **"deal"** chip; the Web SEO **kanban card** shows an amber task-count badge incremented by 1.
4. Open the same deal's **Local SEO job** → the task does NOT appear there, and its card badge did not change.
5. Resolve or delete the smoke task. Confirm `browser_console_messages` level=error → 0.

---

## Self-Review (run before execution)

- **Spec coverage:** dept→service match (Task 1 `groupIdForServiceType`) ✅; tab union (Task 3 + 4) ✅; "deal" chip (Task 4) ✅; card badge, cached, no N+1 (Task 2 + 5) ✅; no schema/RLS change (read-side queries only) ✅; RLS-limited consistency (Task 2 uses normal query) ✅; services without a group fall back to job-scoped (Task 1/2 null-group branches) ✅; unit tests + build + live smoke (Task 1/6) ✅; i18n (Task 4) ✅.
- **Type consistency:** `groupIdForServiceType(groups, serviceType): string | null` and `buildTaskCountMaps(rows, serviceGroupId): {byDeal,byJob}` used identically in Task 1 (impl/test), Task 2, Task 4, Task 5. `useAssignedTasksForSource(source, deptMatch?)` matches Task 3 (impl) and Task 4 (call). `useServiceTaskCounts(serviceGroupId)` matches Task 2 (impl) and Task 5 (call). The `{ dealId, departmentGroupId }` shape is identical in Task 3/4.
- **No placeholders:** every code step has complete code.
