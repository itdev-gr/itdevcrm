export const CONVERT_GROUP_A = ['web_seo', 'local_seo', 'social_media', 'ads'] as const;
export const CONVERT_GROUP_B = ['hosting', 'domains'] as const;

type ConvertibleJob = {
  service_type: string;
  parent_job_id: string | null;
  hasChildren?: boolean;
  billing_only?: boolean | null;
};

function group(s: string): readonly string[] | null {
  if ((CONVERT_GROUP_A as readonly string[]).includes(s)) return CONVERT_GROUP_A;
  if ((CONVERT_GROUP_B as readonly string[]).includes(s)) return CONVERT_GROUP_B;
  return null;
}

export function convertibleTargets(job: ConvertibleJob): string[] {
  // A child of a trio is never converted directly — act on the parent.
  if (job.parent_job_id) return [];
  // AI SEO: only the billing-only parent can be torn down into a single service.
  if (job.service_type === 'ai_seo') {
    return job.billing_only ? ['web_seo', 'local_seo'] : [];
  }
  if (job.hasChildren) return [];
  const g = group(job.service_type);
  if (!g) return [];
  const base = g.filter((s) => s !== job.service_type);
  // A standalone web_seo/local_seo can additionally be upgraded to an AI SEO trio.
  return job.service_type === 'web_seo' || job.service_type === 'local_seo'
    ? [...base, 'ai_seo']
    : base;
}

export function canConvert(job: ConvertibleJob): boolean {
  return convertibleTargets(job).length > 0;
}
