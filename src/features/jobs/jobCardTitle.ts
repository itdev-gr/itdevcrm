// Card heading for the jobs kanban. Local SEO / AI SEO cards are titled by the
// job's Business profile (details.business_profile — seeded from the deal's
// business_profile_name or typed by technical) when present; the client
// identity then moves into the subtitle so it stays visible.
export type JobCardHeadingInput = {
  service_type: string;
  details?: Record<string, unknown> | null;
  client?: {
    name?: string | null;
    contact_first_name?: string | null;
    contact_last_name?: string | null;
  } | null;
  deal?: { title?: string | null } | null;
};

const BUSINESS_PROFILE_SERVICES = new Set(['local_seo', 'ai_seo']);

export function jobCardHeading(job: JobCardHeadingInput): {
  headline: string;
  subtitleParts: string[];
} {
  const contactName = [job.client?.contact_first_name, job.client?.contact_last_name]
    .filter(Boolean)
    .join(' ');
  const businessProfile = BUSINESS_PROFILE_SERVICES.has(job.service_type)
    ? String(job.details?.['business_profile'] ?? '').trim()
    : '';
  if (businessProfile) {
    return {
      headline: businessProfile,
      subtitleParts: [contactName, job.client?.name].filter((s): s is string => Boolean(s)),
    };
  }
  return {
    headline: contactName || job.client?.name || job.deal?.title || '—',
    subtitleParts: contactName && job.client?.name ? [job.client.name] : [],
  };
}
