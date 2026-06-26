import type { JobRow } from './hooks/useJobs';

/** Coerce an unknown value to a string ('' for null/undefined/non-string). */
function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** All searchable fields of a Local SEO job, lowercased and joined with a
 *  separator so a query can't match across two adjacent fields. */
export function jobSearchHaystack(job: JobRow): string {
  const d: Record<string, unknown> = job.details ?? {};
  return [
    job.title,
    job.code,
    job.deal?.code,
    job.client?.name,
    job.client?.email,
    job.client?.phone,
    d.profile_url,
    d.business_profile,
  ]
    .map(str)
    .join('\n')
    .toLowerCase();
}

/** Case-insensitive substring match across all searchable fields.
 *  An empty/whitespace query matches every job (no filtering). */
export function matchesJobSearch(job: JobRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return jobSearchHaystack(job).includes(q);
}
