const ALLOWED_GROUPS = new Set([
  'accounting',
  'web_seo',
  'local_seo',
  'web_dev',
  'social_media',
  'ai_seo',
  'hosting',
  'ads',
  'maintenance',
  'franchise',
]);

export function canCreateAssignedTask(input: {
  isAdmin: boolean;
  groupCodes: readonly string[];
}): boolean {
  if (input.isAdmin) return true;
  return input.groupCodes.some((c) => ALLOWED_GROUPS.has(c));
}
