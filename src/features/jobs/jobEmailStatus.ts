import { seoAccessConfig } from './seoAccessButton';

export type JobEmailState = 'sent' | 'not_sent' | 'coming_soon';

export interface JobEmailStatusInput {
  service_type: string;
  client_email?: string | null;
}

/** The service → onboarding-email template map lives in `seoAccessConfig`
 *  (single source of truth, shared with the SEO access-request confirm
 *  dialog copy); this just reads the `templateKey` back out of it. */
export function jobEmailStatus(
  job: JobEmailStatusInput,
  sentMap: Record<string, string>,
): { state: JobEmailState; templateKey: string | null; lastSent: string | null } {
  const templateKey = seoAccessConfig(job.service_type)?.templateKey ?? null;
  if (!templateKey) return { state: 'coming_soon', templateKey: null, lastSent: null };
  const email = (job.client_email ?? '').trim().toLowerCase();
  const lastSent = email ? (sentMap[`${templateKey}|${email}`] ?? null) : null;
  return { state: lastSent ? 'sent' : 'not_sent', templateKey, lastSent };
}
