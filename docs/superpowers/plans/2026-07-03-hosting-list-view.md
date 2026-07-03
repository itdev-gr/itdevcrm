# Hosting 2-status List — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Hosting kanban with a searchable/filterable list of two statuses (Active / Done).

**Architecture:** A DB migration reduces the hosting `pipeline_stages` to `active` + `closed` (relabeled "Done") and migrates existing jobs; the `/tech/hosting` route swaps from the generic `JobsKanbanPage` to a new `HostingListPage` table that reuses `useJobs('hosting')`, `usePipelineStages`, and `useMoveJobStage`, backed by a pure `hostingList.ts` helper.

**Tech Stack:** React + TypeScript, @tanstack/react-query, Supabase, Vitest, TailwindCSS.

## Global Constraints

- **Keep the terminal stage's `code='closed'`** — only its `display_names` change to "Done". `src/features/accounting/closeTargets.ts` and the `close_deal` RPC target `code='closed'`; changing the code silently breaks deal-close for hosting.
- Build must pass `npm run build` (tsc -b + eslint `--max-warnings=0`); assert array indices with `!` (noUncheckedIndexedAccess).
- Follow the `.bind(supabase)` rule only where a bare `from`/`rpc` is captured into a const (these tasks call hooks, so N/A unless you add one).
- Status is derived from the stage code: a hosting job in `closed` = **Done**, anything else = **Active**.
- Marking a job Done is a stage move only (via `useMoveJobStage`); it must not stop billing.

---

### Task 1: Hosting stage migration (DB)

**Files:**
- Create: `supabase/migrations/20260703060000_hosting_two_stages.sql`

**Interfaces:**
- Produces: hosting board with exactly two non-archived stages — `active` (display "Active", pos 10) and `closed` (display "Done", pos 20). All non-archived hosting jobs sit in one of the two.

- [ ] **Step 1: Write the migration**

```sql
-- 2026-07-03: Reduce the Hosting board to two stages — Active + Done — so it can
-- be managed as a simple list. KEEP the terminal stage's code='closed' (deal-close
-- / end-job target it) and only relabel its display to "Done".
begin;

-- Active stays first.
update public.pipeline_stages set position = 10, updated_at = now()
 where board = 'hosting' and code = 'active';

-- Relabel the terminal 'closed' lane to "Done" (code unchanged), make it second.
update public.pipeline_stages
   set display_names = '{"en":"Done","el":"Ολοκληρωμένο"}'::jsonb, position = 20, updated_at = now()
 where board = 'hosting' and code = 'closed';

-- Move every non-archived hosting job off the lanes we are about to retire:
--   setup + on_hold  -> active ;   cancelled -> closed (Done).
update public.jobs set stage_id = (select id from public.pipeline_stages where board='hosting' and code='active'),
       updated_at = now()
 where service_type = 'hosting' and not archived
   and stage_id in (select id from public.pipeline_stages where board='hosting' and code in ('setup','on_hold'));

update public.jobs set stage_id = (select id from public.pipeline_stages where board='hosting' and code='closed'),
       updated_at = now()
 where service_type = 'hosting' and not archived
   and stage_id in (select id from public.pipeline_stages where board='hosting' and code='cancelled');

-- Retire the extra lanes (archive, not delete — preserves history + FKs).
update public.pipeline_stages set archived = true, updated_at = now()
 where board = 'hosting' and code in ('setup','on_hold','cancelled');

commit;

-- ROLLBACK:
--   update public.pipeline_stages set archived=false where board='hosting' and code in ('setup','on_hold','cancelled');
--   update public.pipeline_stages set display_names='{"en":"Closed","el":"Κλειστό"}'::jsonb, position=50 where board='hosting' and code='closed';
--   (job stage moves are left in place; harmless.)
```

- [ ] **Step 2: Controller applies to prod + verifies** (needs the Management API token — the controller runs this, not a subagent). Expected after apply:
  - `select code, display_names->>'en', position, archived from pipeline_stages where board='hosting' order by position` → `active|Active|10|f`, `closed|Done|20|f`, and `setup/on_hold/cancelled` all `archived=t`.
  - `select count(*) from jobs j join pipeline_stages s on s.id=j.stage_id where j.service_type='hosting' and not j.archived and s.archived` → **0**.
  - `select s.code, count(*) from jobs j join pipeline_stages s on s.id=j.stage_id where j.service_type='hosting' and not j.archived group by 1` → `active ≈ 22`, `closed = 1`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260703060000_hosting_two_stages.sql
git commit -m "feat(hosting): reduce board to Active + Done stages (migration)"
```

---

### Task 2: `hostingList.ts` pure helper (+ tests)

**Files:**
- Create: `src/features/hosting/hostingList.ts`
- Test: `src/features/hosting/hostingList.test.ts`

**Interfaces:**
- Consumes: `JobRow` from `@/features/jobs/hooks/useJobs` (has `stage?: { code: string }`, `details?: Record<string,unknown>|null`, `client?: { name: string; website?: string|null }|null`, `code: string|null`, `period_due_date: string|null`).
- Produces:
  - `hostingStatus(job: JobRow): 'active' | 'done'` — `'done'` iff `job.stage?.code === 'closed'`.
  - `hostingDomain(job: JobRow): string` — first non-empty of `details.live_url`, `details.hosting`, `client.website`; else `''`.
  - `filterAndSortHosting(jobs: JobRow[], opts: { status: 'active'|'done'|'all'; search: string }): JobRow[]` — filter by status + search (client name / job code / domain), sorted by `period_due_date` ascending with nulls last.

- [ ] **Step 1: Write the failing test**

```ts
// src/features/hosting/hostingList.test.ts
import { describe, it, expect } from 'vitest';
import { filterAndSortHosting, hostingDomain, hostingStatus } from './hostingList';
import type { JobRow } from '@/features/jobs/hooks/useJobs';

const mk = (o: Partial<JobRow>): JobRow =>
  ({
    id: 'j', code: '000001-HOSTING', service_type: 'hosting', period_due_date: null,
    stage: { id: 's', code: 'active', board: 'hosting', display_names: {} },
    client: { id: 'c', name: 'Acme', contact_first_name: null, contact_last_name: null, industry: null },
    details: {}, parent_job_id: null,
    ...o,
  }) as unknown as JobRow;

describe('hostingList', () => {
  it('derives status from the stage code', () => {
    expect(hostingStatus(mk({ stage: { id: 's', code: 'active', board: 'hosting', display_names: {} } }))).toBe('active');
    expect(hostingStatus(mk({ stage: { id: 's', code: 'closed', board: 'hosting', display_names: {} } }))).toBe('done');
  });

  it('picks the domain from details then client website', () => {
    expect(hostingDomain(mk({ details: { live_url: 'a.gr' } }))).toBe('a.gr');
    expect(hostingDomain(mk({ details: { hosting: 'b.gr' } }))).toBe('b.gr');
    expect(hostingDomain(mk({ details: {}, client: { id: 'c', name: 'X', website: 'c.gr' } as JobRow['client'] }))).toBe('c.gr');
    expect(hostingDomain(mk({ details: {} }))).toBe('');
  });

  it('filters by status and search, sorts by renewal due (nulls last)', () => {
    const jobs = [
      mk({ id: 'a', client: { id: '1', name: 'Beta' } as JobRow['client'], period_due_date: '2026-09-01' }),
      mk({ id: 'b', client: { id: '2', name: 'Alpha' } as JobRow['client'], period_due_date: '2026-08-01' }),
      mk({ id: 'c', client: { id: '3', name: 'Gamma' } as JobRow['client'], period_due_date: null }),
      mk({ id: 'd', client: { id: '4', name: 'Done Co' } as JobRow['client'],
          stage: { id: 's', code: 'closed', board: 'hosting', display_names: {} }, period_due_date: '2026-01-01' }),
    ];
    const active = filterAndSortHosting(jobs, { status: 'active', search: '' });
    expect(active.map((j) => j.id)).toEqual(['b', 'a', 'c']); // due asc, null last; the 'done' job excluded
    expect(filterAndSortHosting(jobs, { status: 'done', search: '' }).map((j) => j.id)).toEqual(['d']);
    expect(filterAndSortHosting(jobs, { status: 'all', search: 'alpha' }).map((j) => j.id)).toEqual(['b']);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (module not found)

Run: `npx vitest run src/features/hosting/hostingList.test.ts`
Expected: FAIL — cannot find `./hostingList`.

- [ ] **Step 3: Implement**

```ts
// src/features/hosting/hostingList.ts
import type { JobRow } from '@/features/jobs/hooks/useJobs';

export type HostingStatus = 'active' | 'done';

/** A hosting job is Done iff it sits in the terminal 'closed' stage. */
export function hostingStatus(job: JobRow): HostingStatus {
  return job.stage?.code === 'closed' ? 'done' : 'active';
}

/** The hosted site: details.live_url → details.hosting → client.website → ''. */
export function hostingDomain(job: JobRow): string {
  const d = (job.details ?? {}) as Record<string, unknown>;
  const candidates = [d.live_url, d.hosting, job.client?.website];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return '';
}

/** Filter by status + free-text search, sorted by renewal due asc (nulls last). */
export function filterAndSortHosting(
  jobs: JobRow[],
  opts: { status: 'active' | 'done' | 'all'; search: string },
): JobRow[] {
  const q = opts.search.trim().toLowerCase();
  const filtered = jobs.filter((j) => {
    if (opts.status !== 'all' && hostingStatus(j) !== opts.status) return false;
    if (!q) return true;
    const hay = [j.client?.name ?? '', j.code ?? '', hostingDomain(j)].join(' ').toLowerCase();
    return hay.includes(q);
  });
  return [...filtered].sort((a, b) => {
    const da = a.period_due_date;
    const db = b.period_due_date;
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return da < db ? -1 : da > db ? 1 : 0;
  });
}
```

- [ ] **Step 4: Run — expect PASS.** Run: `npx vitest run src/features/hosting/hostingList.test.ts`. Then `npm run build`.

- [ ] **Step 5: Commit**

```bash
git add src/features/hosting/hostingList.ts src/features/hosting/hostingList.test.ts
git commit -m "feat(hosting): hostingList helper (status/domain/filter-sort) + tests"
```

---

### Task 3: `HostingListPage` component

**Files:**
- Create: `src/features/hosting/HostingListPage.tsx`

**Interfaces:**
- Consumes: `useJobs('hosting')` → `JobRow[]`; `usePipelineStages()` → `StageRow[]` (filter `board==='hosting' && !archived`); `useMoveJobStage('hosting')` → `.mutate({ jobId, stageId, completed })` (completed=true stamps completed_at); `filterAndSortHosting/hostingDomain/hostingStatus` from `./hostingList`; `formatDate` from `@/lib/datetime`; `PageHeader`, `FilterBar` from `@/components/layout/page-shell`; `Input` from `@/components/ui/input`; `cn` from `@/lib/utils`.
- Produces: named export `HostingListPage`.

- [ ] **Step 1: Write the component**

```tsx
// src/features/hosting/HostingListPage.tsx
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { FilterBar, PageHeader } from '@/components/layout/page-shell';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/datetime';
import { useJobs } from '@/features/jobs/hooks/useJobs';
import { useMoveJobStage } from '@/features/jobs/hooks/useMoveJobStage';
import { usePipelineStages } from '@/features/stages/hooks/usePipelineStages';
import { filterAndSortHosting, hostingDomain, hostingStatus } from './hostingList';

type StatusFilter = 'active' | 'done' | 'all';
const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'done', label: 'Done' },
  { key: 'all', label: 'All' },
];

export function HostingListPage() {
  const { i18n } = useTranslation();
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('active');
  const { data: jobs = [], isLoading } = useJobs('hosting');
  const { data: stages = [] } = usePipelineStages();
  const move = useMoveJobStage('hosting');

  const hostingStages = stages.filter((s) => s.board === 'hosting' && !s.archived);
  const activeStage = hostingStages.find((s) => s.code === 'active');
  const doneStage = hostingStages.find((s) => s.code === 'closed');

  const rows = useMemo(
    () => filterAndSortHosting(jobs, { status, search: query }),
    [jobs, status, query],
  );

  function setJobStatus(jobId: string, next: 'active' | 'done') {
    const stage = next === 'done' ? doneStage : activeStage;
    if (!stage) return;
    move.mutate({ jobId, stageId: stage.id, completed: next === 'done' });
  }

  if (isLoading) {
    return <div className="px-4 py-6 sm:px-6 lg:px-8 text-sm text-muted-foreground">…</div>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader title="Hosting" description="Yearly hosting — Active & Done." />

      <FilterBar>
        <div className="relative min-w-[220px] flex-1 sm:max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by client, domain, code…"
            className="h-9 rounded-full border-border/70 bg-background pl-9 shadow-sm"
          />
        </div>
        <div className="flex items-center gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={status === f.key}
              onClick={() => setStatus(f.key)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium shadow-sm transition-colors',
                status === f.key
                  ? 'border-transparent bg-primary text-primary-foreground'
                  : 'border-border/70 bg-background text-muted-foreground hover:bg-muted/40',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          {rows.length} / {jobs.length}
        </span>
      </FilterBar>

      <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm">
        {rows.length === 0 ? (
          <div className="flex h-40 items-center justify-center px-6 text-sm text-muted-foreground">
            No hosting jobs match.
          </div>
        ) : (
          <div className="h-full overflow-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm">
                <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Client</th>
                  <th className="px-4 py-3 font-medium">Domain</th>
                  <th className="px-4 py-3 font-medium">Renewal due</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((j) => {
                  const domain = hostingDomain(j);
                  const st = hostingStatus(j);
                  return (
                    <tr
                      key={j.id}
                      className="group border-b border-border/40 transition-colors last:border-b-0 hover:bg-muted/35"
                    >
                      <td className="max-w-[320px] px-4 py-3">
                        <Link
                          to={`/jobs/${j.id}`}
                          className="block truncate text-sm font-medium text-foreground transition-colors hover:text-primary"
                        >
                          {j.client?.name ?? j.code ?? '—'}
                        </Link>
                        {j.code && <p className="truncate text-xs text-muted-foreground">{j.code}</p>}
                      </td>
                      <td className="max-w-[240px] px-4 py-3">
                        {domain ? (
                          <a
                            href={domain.startsWith('http') ? domain : `https://${domain}`}
                            target="_blank"
                            rel="noreferrer"
                            className="block truncate text-xs text-primary hover:underline"
                          >
                            {domain}
                          </a>
                        ) : (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 tabular-nums">
                        {j.period_due_date ? (
                          formatDate(j.period_due_date, lang)
                        ) : (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={st}
                          onChange={(e) => setJobStatus(j.id, e.target.value as 'active' | 'done')}
                          className={cn(
                            'rounded-full border border-border/70 bg-background px-2 py-1 text-xs font-medium shadow-sm',
                            st === 'active'
                              ? 'text-emerald-700 dark:text-emerald-300'
                              : 'text-muted-foreground',
                          )}
                        >
                          <option value="active">Active</option>
                          <option value="done">Done</option>
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default HostingListPage;
```

- [ ] **Step 2: Verify build.** Run: `npm run build` → PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/hosting/HostingListPage.tsx
git commit -m "feat(hosting): HostingListPage table (search + status filter + inline toggle)"
```

---

### Task 4: Swap the `/tech/hosting` route

**Files:**
- Modify: `src/app/router.tsx` (add a `lazyPage` import; change the `hosting` route element ~line 285)

**Interfaces:**
- Consumes: `HostingListPage` named export from Task 3.

- [ ] **Step 1: Add the lazy import** near the other `lazyPage(...)` declarations (after the `MyTasksPage`/`UsersListPage` block, matching their style):

```tsx
const HostingListPage = lazyPage(
  () => import('@/features/hosting/HostingListPage'),
  'HostingListPage',
);
```

- [ ] **Step 2: Change the hosting route element.** Find:

```tsx
              { path: 'hosting', element: <JobsKanbanPage serviceType="hosting" /> },
```

Replace with:

```tsx
              { path: 'hosting', element: <HostingListPage /> },
```

(Leave the other five `JobsKanbanPage` board routes unchanged.)

- [ ] **Step 3: Verify build + full suite.** Run: `npm run build` → PASS; `npx vitest run src/features/hosting` → PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/router.tsx
git commit -m "feat(hosting): route /tech/hosting to the list view"
```

---

## Notes for the controller

- **Task 1 is applied to prod by the controller** (Management API token), not a subagent; the subagent for Task 1 only writes the migration file. Verify with the Step-2 queries before marking complete.
- After Task 4, do a live check at `/tech/hosting`: table renders 23 rows (22 Active / 1 Done under the "All" filter), the status `<select>` flips a job and it moves between filters, and the search + renewal-due sort behave.
