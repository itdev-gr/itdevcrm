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
