export const CONVERT_GROUP_A = ['web_seo', 'local_seo', 'social_media', 'ads'] as const;
export const CONVERT_GROUP_B = ['hosting', 'domains'] as const;

function group(s: string): readonly string[] | null {
  if ((CONVERT_GROUP_A as readonly string[]).includes(s)) return CONVERT_GROUP_A;
  if ((CONVERT_GROUP_B as readonly string[]).includes(s)) return CONVERT_GROUP_B;
  return null;
}

export function convertibleTargets(job: {
  service_type: string;
  parent_job_id: string | null;
  hasChildren?: boolean;
}): string[] {
  if (job.parent_job_id || job.hasChildren) return [];
  const g = group(job.service_type);
  if (!g) return [];
  return g.filter((s) => s !== job.service_type);
}

export function canConvert(job: {
  service_type: string;
  parent_job_id: string | null;
  hasChildren?: boolean;
}): boolean {
  return convertibleTargets(job).length > 0;
}
