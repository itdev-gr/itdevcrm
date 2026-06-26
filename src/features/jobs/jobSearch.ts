import type { JobRow } from './hooks/useJobs';

/** Coerce an unknown value to a string ('' for null/undefined/non-string). */
function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** All searchable fields of an SEO-board job (Local SEO + Web SEO), lowercased
 *  and joined with a separator so a query can't match across two adjacent
 *  fields. */
export function jobSearchHaystack(job: JobRow): string {
  const d: Record<string, unknown> = job.details ?? {};
  return [
    job.title,
    job.code,
    job.deal?.code,
    job.client?.code,
    job.client?.name,
    job.client?.contact_first_name,
    job.client?.contact_last_name,
    job.client?.email,
    job.client?.phone,
    job.client?.phone_normalized,
    job.client?.website,
    d.profile_url,
    d.business_profile,
  ]
    .map(str)
    .join('\n')
    .toLowerCase();
}

/** Case-insensitive substring match across all searchable fields.
 *  An empty/whitespace query matches every job (no filtering).
 *  Space-separated tokens are ANDed: each token must appear somewhere in the
 *  haystack, but they don't need to be in the same field. */
export function matchesJobSearch(job: JobRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = jobSearchHaystack(job);
  return q.split(/\s+/).every(token => haystack.includes(token));
}

/** When an active search narrows the board to a single job, the id to scroll
 *  into view. Null when the search is empty or there isn't exactly one match. */
export function boardFocusJobId(jobs: JobRow[], search: string): string | null {
  if (search.trim() === '') return null;
  if (jobs.length !== 1) return null;
  return jobs[0]?.id ?? null;
}
