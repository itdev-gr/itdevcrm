export type TaskLinkMode = 'lead' | 'client';

/** Which record picker the task dialog shows. An existing link wins (so any
 *  role can edit any task faithfully); then a default lead or default client
 *  the dialog was opened with (e.g. a lead's or client's Tasks tab); otherwise
 *  sales work leads. */
export function taskLinkMode(params: {
  isSales: boolean;
  editLeadId: string | null;
  editClientId: string | null;
  hasDefaultLead: boolean;
  hasDefaultClient: boolean;
}): TaskLinkMode {
  if (params.editLeadId) return 'lead';
  if (params.editClientId) return 'client';
  if (params.hasDefaultLead) return 'lead';
  if (params.hasDefaultClient) return 'client';
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
