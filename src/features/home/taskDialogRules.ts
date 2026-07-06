export type TaskLinkMode = 'lead' | 'client';

/** Which record picker the task dialog shows. An existing link wins (so any
 *  role can edit any task faithfully); otherwise sales work leads. */
export function taskLinkMode(params: {
  isSales: boolean;
  editLeadId: string | null;
  editClientId: string | null;
  hasDefaultLead: boolean;
}): TaskLinkMode {
  if (params.editLeadId) return 'lead';
  if (params.editClientId) return 'client';
  if (params.hasDefaultLead) return 'lead';
  return params.isSales ? 'lead' : 'client';
}

/** Sales allocate tasks within their circle: sales, admins, accounting. */
export function filterTaskAssignees<T extends { is_admin: boolean; group_codes: string[] }>(
  owners: T[],
  restrictToSalesCircle: boolean,
): T[] {
  if (!restrictToSalesCircle) return owners;
  return owners.filter(
    (o) => o.is_admin || o.group_codes.includes('sales') || o.group_codes.includes('accounting'),
  );
}
