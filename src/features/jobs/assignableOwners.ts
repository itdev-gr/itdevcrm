import type { MentionableUser } from '@/features/comments/hooks/useMentionableUsers';

// ai_seo work is done by the SEO owners; the ai_seo group itself is empty.
const SERVICE_GROUP_CODES: Record<string, string[]> = {
  ai_seo: ['ai_seo', 'local_seo', 'web_seo'],
};

/**
 * Options for the job Owner dropdown: department members for the job's
 * service_type, always including admins and the current owner. Falls back to
 * the full list when the department group has no members (spec 2026-07-29).
 */
export function filterAssignableOwners(
  owners: MentionableUser[],
  serviceType: string,
  currentOwnerId: string | null,
): MentionableUser[] {
  const accepted = SERVICE_GROUP_CODES[serviceType] ?? [serviceType];
  const dept = owners.filter((o) => (o.group_codes ?? []).some((c) => accepted.includes(c)));
  if (dept.length === 0) return owners;
  const deptIds = new Set(dept.map((o) => o.user_id));
  return owners.filter(
    (o) => deptIds.has(o.user_id) || o.is_admin || o.user_id === currentOwnerId,
  );
}
