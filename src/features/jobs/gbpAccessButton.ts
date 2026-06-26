import type { JobRow } from './hooks/useJobs';

export type GbpButtonState = 'hidden' | 'no-email' | 'idle' | 'sent';

/** What the GBP-access button should show for a job + its last-sent timestamp. */
export function gbpButtonState(job: JobRow, lastSent: string | null): GbpButtonState {
  if (job.service_type !== 'local_seo') return 'hidden';
  const email = job.client?.email?.trim();
  if (!email) return 'no-email';
  return lastSent ? 'sent' : 'idle';
}
