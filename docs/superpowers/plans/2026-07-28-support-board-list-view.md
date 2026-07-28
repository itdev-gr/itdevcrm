# Support Board List View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Support (`maintenance`) kanban at `/tech/maintenance` with a hosting-identical list view, powered by one shared generic list component used by both Hosting and Support.

**Architecture:** Generalise the pure helpers in `src/features/hosting/hostingList.ts` into `src/features/jobs/jobsList.ts` (adds blocked-status awareness and a done-stage-code set), extract the Hosting page markup into a generic `src/features/jobs/JobsListPage.tsx`, then make `HostingListPage` and a new `SupportListPage` thin wrappers. Swap the `/tech/maintenance` route. Frontend only — zero DB changes (the 8 maintenance pipeline_stages stay; revert = git revert).

**Tech Stack:** React + TypeScript, TanStack Query, react-router, Tailwind, vitest. Existing hooks reused: `useJobs`, `usePipelineStages`, `useMoveJobStage`, `useUnblockJob` (RPC `unblock_job` already gates admin OR accounting-edit — no new RPC).

**Spec:** `docs/superpowers/specs/2026-07-28-support-board-list-view-design.md`

## Global Constraints

- `npm run build` (tsc -b + eslint `--max-warnings=0`) must pass — it is stricter than `tsc --noEmit`.
- vitest runs against PROD env — run ONLY the new test file (`npx vitest run src/features/jobs/jobsList.test.ts`), never the whole suite.
- No DB changes of any kind (stages, RLS, RPCs untouched).
- Commit per task, push directly to `main` (no PRs). Commit trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Page copy is English-only (exactly like the current Hosting page); only `formatDate` uses the resolved language.
- Blocked-chip colors must match the kanban card badge: `bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-200`.

---

### Task 1: Pure list helpers `jobsList.ts` (TDD)

**Files:**
- Create: `src/features/jobs/jobsList.ts`
- Test: `src/features/jobs/jobsList.test.ts`

**Interfaces:**
- Consumes: `JobRow` from `src/features/jobs/hooks/useJobs.ts` (fields used: `id`, `code`, `stage_id`, `stage.code`, `is_blocked`, `details`, `client.name`, `client.website`, `period_due_date`).
- Produces (Task 2 relies on these exact signatures):
  - `type JobListStatus = 'active' | 'done' | 'blocked'`
  - `type JobListStatusOpts = { doneStageIds?: ReadonlySet<string>; doneStageCodes: ReadonlySet<string>; blockedAware: boolean }`
  - `jobListStatus(job: JobRow, opts: JobListStatusOpts): JobListStatus`
  - `jobListDomain(job: JobRow): string`
  - `filterAndSortJobsList(jobs: JobRow[], filter: { status: 'active' | 'done' | 'all'; search: string }, opts: JobListStatusOpts): JobRow[]`

- [ ] **Step 1: Write the failing test**

Create `src/features/jobs/jobsList.test.ts` with exactly:

```ts
// src/features/jobs/jobsList.test.ts
import { describe, it, expect } from 'vitest';
import { filterAndSortJobsList, jobListDomain, jobListStatus } from './jobsList';
import type { JobRow } from '@/features/jobs/hooks/useJobs';

const mk = (o: Partial<JobRow>): JobRow =>
  ({
    id: 'j', code: '000001-SUPPORT', service_type: 'maintenance', period_due_date: null,
    is_blocked: false,
    stage: { id: 's', code: 'active', board: 'maintenance', display_names: {} },
    client: { id: 'c', name: 'Acme', contact_first_name: null, contact_last_name: null, industry: null },
    details: {}, parent_job_id: null,
    ...o,
  }) as unknown as JobRow;

const stage = (code: string) => ({ id: 's', code, board: 'maintenance', display_names: {} });
const OPTS = { doneStageCodes: new Set(['done', 'closed']), blockedAware: true };

describe('jobListStatus', () => {
  it('derives status from the stage code (done + closed both read as Done)', () => {
    expect(jobListStatus(mk({ stage: stage('active') }), OPTS)).toBe('active');
    expect(jobListStatus(mk({ stage: stage('onboarding') }), OPTS)).toBe('active');
    expect(jobListStatus(mk({ stage: stage('done') }), OPTS)).toBe('done');
    expect(jobListStatus(mk({ stage: stage('closed') }), OPTS)).toBe('done');
  });

  it('hosting parity: single done code, blocked flag ignored when not blockedAware', () => {
    const hostingOpts = { doneStageCodes: new Set(['closed']), blockedAware: false };
    expect(jobListStatus(mk({ stage: stage('closed'), is_blocked: true }), hostingOpts)).toBe('done');
    expect(jobListStatus(mk({ stage: stage('active'), is_blocked: true }), hostingOpts)).toBe('active');
  });

  it('blocked wins over any stage when blockedAware', () => {
    expect(jobListStatus(mk({ is_blocked: true, stage: stage('active') }), OPTS)).toBe('blocked');
    expect(jobListStatus(mk({ is_blocked: true, stage: stage('closed') }), OPTS)).toBe('blocked');
  });

  it('derives status from stage_id when doneStageIds is given (optimistic move)', () => {
    // stage.code is stale ('active') but stage_id says done — stage_id must win.
    const j = mk({ stage_id: 'done-id', stage: stage('active') });
    expect(jobListStatus(j, { ...OPTS, doneStageIds: new Set(['done-id']) })).toBe('done');
    expect(jobListStatus(j, { ...OPTS, doneStageIds: new Set(['other-id']) })).toBe('active');
  });
});

describe('jobListDomain', () => {
  it('picks the domain from details then client website', () => {
    expect(jobListDomain(mk({ details: { live_url: 'a.gr' } }))).toBe('a.gr');
    expect(jobListDomain(mk({ details: { hosting: 'b.gr' } }))).toBe('b.gr');
    expect(jobListDomain(mk({ details: {}, client: { id: 'c', name: 'X', website: 'c.gr' } as NonNullable<JobRow['client']> }))).toBe('c.gr');
    expect(jobListDomain(mk({ details: {} }))).toBe('');
  });
});

describe('filterAndSortJobsList', () => {
  const jobs = [
    mk({ id: 'a', client: { id: '1', name: 'Beta' } as NonNullable<JobRow['client']>, period_due_date: '2026-09-01' }),
    mk({ id: 'b', client: { id: '2', name: 'Alpha' } as NonNullable<JobRow['client']>, period_due_date: '2026-08-01' }),
    mk({ id: 'c', client: { id: '3', name: 'Gamma' } as NonNullable<JobRow['client']>, period_due_date: null }),
    mk({ id: 'd', client: { id: '4', name: 'Done Co' } as NonNullable<JobRow['client']>,
        stage: stage('closed'), period_due_date: '2026-01-01' }),
    mk({ id: 'e', client: { id: '5', name: 'Frozen' } as NonNullable<JobRow['client']>,
        is_blocked: true, period_due_date: '2026-07-01' }),
  ];

  it('Active pill keeps blocked rows, excludes done; sorts by due asc nulls last', () => {
    const active = filterAndSortJobsList(jobs, { status: 'active', search: '' }, OPTS);
    expect(active.map((j) => j.id)).toEqual(['e', 'b', 'a', 'c']);
  });

  it('Done pill shows only done; All shows everything', () => {
    expect(filterAndSortJobsList(jobs, { status: 'done', search: '' }, OPTS).map((j) => j.id)).toEqual(['d']);
    expect(filterAndSortJobsList(jobs, { status: 'all', search: '' }, OPTS).map((j) => j.id)).toEqual(['d', 'e', 'b', 'a', 'c']);
  });

  it('searches client name, code and domain', () => {
    expect(filterAndSortJobsList(jobs, { status: 'all', search: 'alpha' }, OPTS).map((j) => j.id)).toEqual(['b']);
    expect(filterAndSortJobsList(jobs, { status: 'all', search: 'no-match-xyz' }, OPTS)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/jobs/jobsList.test.ts`
Expected: FAIL — cannot resolve `./jobsList` (module does not exist).

- [ ] **Step 3: Write the implementation**

Create `src/features/jobs/jobsList.ts` with exactly:

```ts
// src/features/jobs/jobsList.ts
// Generalised from src/features/hosting/hostingList.ts so the Hosting and
// Support lists share one status model (Support adds the blocked state).
import type { JobRow } from '@/features/jobs/hooks/useJobs';

export type JobListStatus = 'active' | 'done' | 'blocked';

export type JobListStatusOpts = {
  /**
   * Ids of the board's Done-mapped stages. When non-empty they win over
   * `stage.code` — the optimistic stage-move only patches `stage_id`, so
   * keying off it makes a status flip reflect instantly.
   */
  doneStageIds?: ReadonlySet<string>;
  /** Stage codes that read as Done while stage ids aren't known yet. */
  doneStageCodes: ReadonlySet<string>;
  /** true on boards whose jobs can be payment-blocked (Support). Hosting is exempt. */
  blockedAware: boolean;
};

export function jobListStatus(job: JobRow, opts: JobListStatusOpts): JobListStatus {
  if (opts.blockedAware && job.is_blocked) return 'blocked';
  if (opts.doneStageIds && opts.doneStageIds.size > 0) {
    return job.stage_id && opts.doneStageIds.has(job.stage_id) ? 'done' : 'active';
  }
  return job.stage?.code && opts.doneStageCodes.has(job.stage.code) ? 'done' : 'active';
}

/** The job's site: details.live_url → details.hosting → client.website → ''. */
export function jobListDomain(job: JobRow): string {
  const d = (job.details ?? {}) as Record<string, unknown>;
  const candidates = [d.live_url, d.hosting, job.client?.website];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return '';
}

/**
 * Filter by status pill + free-text search, sorted by due date asc (nulls
 * last). Blocked rows live under the Active pill — they're unfinished work.
 */
export function filterAndSortJobsList(
  jobs: JobRow[],
  filter: { status: 'active' | 'done' | 'all'; search: string },
  opts: JobListStatusOpts,
): JobRow[] {
  const q = filter.search.trim().toLowerCase();
  const filtered = jobs.filter((j) => {
    const st = jobListStatus(j, opts);
    if (filter.status === 'active' && st === 'done') return false;
    if (filter.status === 'done' && st !== 'done') return false;
    if (!q) return true;
    const hay = [j.client?.name ?? '', j.code ?? '', jobListDomain(j)].join(' ').toLowerCase();
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

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/jobs/jobsList.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/jobs/jobsList.ts src/features/jobs/jobsList.test.ts
git commit -m "feat(jobs): shared list-status helpers for hosting-style lists

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Generic `JobsListPage` + Hosting becomes a thin wrapper

**Files:**
- Create: `src/features/jobs/JobsListPage.tsx`
- Modify: `src/features/hosting/HostingListPage.tsx` (full rewrite as wrapper)
- Delete: `src/features/hosting/hostingList.ts`, `src/features/hosting/hostingList.test.ts` (superseded by Task 1)

**Interfaces:**
- Consumes (from Task 1): `jobListStatus`, `jobListDomain`, `filterAndSortJobsList`, `JobListStatus`, `JobListStatusOpts` from `@/features/jobs/jobsList`. Existing hooks: `useJobs(serviceType)`, `usePipelineStages()`, `useMoveJobStage(serviceType)`, `useUnblockJob(jobId)` (from `@/features/jobs/hooks/useBlockJob`), `useAuthStore((s) => s.isAdmin)`.
- Produces (Task 3 relies on this): `JobsListPage` component (named export + default) with props
  `{ serviceType: ServiceType; title: string; description: string; dueColumnLabel: string; doneStageCodes: readonly string[]; showBlocked: boolean }`.
  Board code === `serviceType` for both consumers (`'hosting'`, `'maintenance'`) — one prop covers both (small simplification vs the spec's separate `board` prop).

- [ ] **Step 1: Create the generic page**

Create `src/features/jobs/JobsListPage.tsx` with exactly:

```tsx
// src/features/jobs/JobsListPage.tsx
// Hosting-style flat list of a board's jobs. Extracted verbatim from
// HostingListPage so Hosting and Support render identically; Support adds
// the blocked chip / admin override via showBlocked.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { FilterBar, PageHeader } from '@/components/layout/page-shell';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/datetime';
import { useAuthStore } from '@/lib/stores/authStore';
import { useJobs, type JobRow, type ServiceType } from '@/features/jobs/hooks/useJobs';
import { useMoveJobStage } from '@/features/jobs/hooks/useMoveJobStage';
import { useUnblockJob } from '@/features/jobs/hooks/useBlockJob';
import { usePipelineStages } from '@/features/stages/hooks/usePipelineStages';
import {
  filterAndSortJobsList,
  jobListDomain,
  jobListStatus,
  type JobListStatus,
  type JobListStatusOpts,
} from './jobsList';

type StatusFilter = 'active' | 'done' | 'all';
const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'done', label: 'Done' },
  { key: 'all', label: 'All' },
];

const REBLOCK_HINT = 'Billing re-blocks automatically if the payment is still overdue.';

export type JobsListPageProps = {
  /** Board code === service type for the boards using this page. */
  serviceType: ServiceType;
  title: string;
  description: string;
  dueColumnLabel: string;
  /** Stage codes that read as Done. Flipping to Done always writes 'closed'. */
  doneStageCodes: readonly string[];
  /** true = blocked jobs show the red chip (admins get an override dropdown). */
  showBlocked: boolean;
};

function StatusCell({
  job,
  status,
  canOverrideBlocked,
  onSetStatus,
}: {
  job: JobRow;
  status: JobListStatus;
  canOverrideBlocked: boolean;
  onSetStatus: (jobId: string, next: 'active' | 'done') => void;
}) {
  const unblock = useUnblockJob(job.id);

  if (status === 'blocked' && !canOverrideBlocked) {
    return (
      <span
        title={REBLOCK_HINT}
        className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-800 dark:bg-red-950/50 dark:text-red-200"
      >
        Blocked
      </span>
    );
  }

  if (status === 'blocked') {
    return (
      <select
        value="blocked"
        disabled={unblock.isPending}
        title={REBLOCK_HINT}
        onChange={async (e) => {
          const next = e.target.value as 'blocked' | 'active' | 'done';
          if (next === 'blocked') return;
          try {
            await unblock.mutateAsync();
            if (next === 'done') onSetStatus(job.id, 'done');
          } catch (err) {
            alert((err as Error).message);
          }
        }}
        className="rounded-full border border-red-300/80 bg-red-50 px-2 py-1 text-xs font-semibold text-red-800 shadow-sm dark:border-red-900 dark:bg-red-950/50 dark:text-red-200"
      >
        <option value="blocked">Blocked</option>
        <option value="active">Active</option>
        <option value="done">Done</option>
      </select>
    );
  }

  return (
    <select
      value={status}
      onChange={(e) => onSetStatus(job.id, e.target.value as 'active' | 'done')}
      className={cn(
        'rounded-full border border-border/70 bg-background px-2 py-1 text-xs font-medium shadow-sm',
        status === 'active' ? 'text-emerald-700 dark:text-emerald-300' : 'text-muted-foreground',
      )}
    >
      <option value="active">Active</option>
      <option value="done">Done</option>
    </select>
  );
}

export function JobsListPage({
  serviceType,
  title,
  description,
  dueColumnLabel,
  doneStageCodes,
  showBlocked,
}: JobsListPageProps) {
  const { i18n } = useTranslation();
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('active');
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const { data: jobs = [], isLoading } = useJobs(serviceType);
  const { data: stages = [] } = usePipelineStages();
  const move = useMoveJobStage(serviceType);

  const boardStages = stages.filter((s) => s.board === serviceType && !s.archived);
  const activeStageId = boardStages.find((s) => s.code === 'active')?.id;
  const closedStageId = boardStages.find((s) => s.code === 'closed')?.id;

  const statusOpts: JobListStatusOpts = {
    doneStageIds: new Set(boardStages.filter((s) => doneStageCodes.includes(s.code)).map((s) => s.id)),
    doneStageCodes: new Set(doneStageCodes),
    blockedAware: showBlocked,
  };

  const rows = filterAndSortJobsList(jobs, { status, search: query }, statusOpts);

  function setJobStatus(jobId: string, next: 'active' | 'done') {
    const stageId = next === 'done' ? closedStageId : activeStageId;
    if (!stageId) return;
    move.mutate({ jobId, stageId, completed: next === 'done' });
  }

  if (isLoading) {
    return <div className="px-4 py-6 sm:px-6 lg:px-8 text-sm text-muted-foreground">…</div>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader title={title} description={description} />

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
            No {title.toLowerCase()} jobs match.
          </div>
        ) : (
          <div className="h-full overflow-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm">
                <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Client</th>
                  <th className="px-4 py-3 font-medium">Domain</th>
                  <th className="px-4 py-3 font-medium">{dueColumnLabel}</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((j) => {
                  const domain = jobListDomain(j);
                  const st = jobListStatus(j, statusOpts);
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
                        <StatusCell
                          job={j}
                          status={st}
                          canOverrideBlocked={isAdmin}
                          onSetStatus={setJobStatus}
                        />
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

export default JobsListPage;
```

- [ ] **Step 2: Rewrite `HostingListPage` as a thin wrapper**

Replace the ENTIRE contents of `src/features/hosting/HostingListPage.tsx` with:

```tsx
// src/features/hosting/HostingListPage.tsx
import { JobsListPage } from '@/features/jobs/JobsListPage';

export function HostingListPage() {
  return (
    <JobsListPage
      serviceType="hosting"
      title="Hosting"
      description="Yearly hosting — Active & Done."
      dueColumnLabel="Renewal due"
      doneStageCodes={['closed']}
      showBlocked={false}
    />
  );
}

export default HostingListPage;
```

- [ ] **Step 3: Delete the superseded hosting helpers**

```bash
git rm src/features/hosting/hostingList.ts src/features/hosting/hostingList.test.ts
```

(Their behaviour and tests were migrated into `jobsList.ts` / `jobsList.test.ts` in Task 1 — the hosting-parity test covers the single-code, non-blocked configuration.)

- [ ] **Step 4: Verify tests and strict build pass**

Run: `npx vitest run src/features/jobs/jobsList.test.ts`
Expected: PASS.

Run: `npm run build`
Expected: exit 0, no eslint warnings. (Catches any leftover import of the deleted `hostingList` module.)

- [ ] **Step 5: Commit**

```bash
git add -A src/features/jobs/JobsListPage.tsx src/features/hosting
git commit -m "refactor(hosting): extract generic JobsListPage; HostingListPage becomes wrapper

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: `SupportListPage` + route swap

**Files:**
- Create: `src/features/support/SupportListPage.tsx`
- Modify: `src/app/router.tsx` (lazy import block ~line 33; route line 309)

**Interfaces:**
- Consumes (from Task 2): `JobsListPage` from `@/features/jobs/JobsListPage`.
- Produces: `SupportListPage` (named + default export) rendered at `/tech/maintenance`.

- [ ] **Step 1: Create the wrapper**

Create `src/features/support/SupportListPage.tsx` with exactly:

```tsx
// src/features/support/SupportListPage.tsx
// The Support board (service_type 'maintenance') as a hosting-style list.
// The 8 maintenance pipeline_stages stay in the DB; the list collapses them:
// done/closed → Done, everything else → Active, is_blocked → Blocked chip.
import { JobsListPage } from '@/features/jobs/JobsListPage';

export function SupportListPage() {
  return (
    <JobsListPage
      serviceType="maintenance"
      title="Support"
      description="Monthly support — Active & Done."
      dueColumnLabel="Next due"
      doneStageCodes={['done', 'closed']}
      showBlocked
    />
  );
}

export default SupportListPage;
```

- [ ] **Step 2: Swap the route**

In `src/app/router.tsx`:

(a) Directly below the existing `HostingListPage` lazy declaration (~line 33), add:

```tsx
const SupportListPage = lazyPage(
  () => import('@/features/support/SupportListPage'),
  'SupportListPage',
);
```

(b) Replace the maintenance route line (line 309):

```tsx
{ path: 'maintenance', element: <JobsKanbanPage serviceType="maintenance" /> },
```

with:

```tsx
{ path: 'maintenance', element: <SupportListPage /> },
```

Do NOT touch `:serviceType/clients`, `:serviceType/docs`, the Sidebar, or any other route.

- [ ] **Step 3: Verify strict build passes**

Run: `npm run build`
Expected: exit 0. (If `JobsKanbanPage` is now flagged as unused, it is still used by web-seo/local-seo/web-dev/social-media/ads/franchise routes — an unused-import error would mean a botched edit; re-check step 2.)

- [ ] **Step 4: Commit**

```bash
git add src/features/support/SupportListPage.tsx src/app/router.tsx
git commit -m "feat(support): /tech/maintenance becomes hosting-style list (kanban replaced)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: End-to-end verification + push

**Files:** none (verification only).

- [ ] **Step 1: Full check**

```bash
npx vitest run src/features/jobs/jobsList.test.ts && npm run build
```

Expected: tests PASS, build exit 0.

- [ ] **Step 2: Manual smoke in the running app**

Start `npm run dev`, log in as admin `info@itdev.gr` (pw in project memory), then verify:

1. `/tech/hosting` — pixel-identical to before: search, pills, table, status flip still works.
2. `/tech/maintenance` — renders the list (no kanban): columns Client · Domain · Next due · Status; jobs in onboarding/renewal/audit/active/on_hold show **Active**; jobs in done/closed show **Done** under the Done pill.
3. A blocked Support job (if none exists in prod, temporarily block one from its Job detail page): red **Blocked** dropdown for admin with options Blocked/Active/Done and the re-block tooltip; picking Active unblocks (row flips to Active status).
4. Flip a Support job Active → Done: it moves to the Closed stage (check the ✓ on the job detail page), and back.
5. Non-admin check (any sales/tech account, pw shared): blocked row shows the read-only red chip, no dropdown.

- [ ] **Step 3: Push to main**

```bash
git push origin main
```

Vercel auto-deploys. Post-deploy: hard-refresh if chunk 404s appear (known stale-chunk behaviour).
