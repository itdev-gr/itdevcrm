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
