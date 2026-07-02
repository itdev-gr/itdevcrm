export type JobEmailState = 'sent' | 'not_sent' | 'coming_soon';

const SERVICE_TEMPLATE: Record<string, string> = {
  web_seo: 'webseo_gsc_access',
  local_seo: 'localseo_gbp_access',
};

export interface JobEmailStatusInput {
  service_type: string;
  client_email?: string | null;
}

export function jobEmailStatus(
  job: JobEmailStatusInput,
  sentMap: Record<string, string>,
): { state: JobEmailState; templateKey: string | null; lastSent: string | null } {
  const templateKey = SERVICE_TEMPLATE[job.service_type] ?? null;
  if (!templateKey) return { state: 'coming_soon', templateKey: null, lastSent: null };
  const email = (job.client_email ?? '').trim().toLowerCase();
  const lastSent = email ? (sentMap[`${templateKey}|${email}`] ?? null) : null;
  return { state: lastSent ? 'sent' : 'not_sent', templateKey, lastSent };
}
