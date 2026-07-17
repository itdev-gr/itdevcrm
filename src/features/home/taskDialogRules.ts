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

/** Mirrors the user_tasks_delete RLS policy: the creator may delete; the
 *  assignee may delete only personal/self tasks (never ones delegated to them). */
export function canDeleteUserTask(
  task: { user_id: string; created_by: string | null },
  meId: string,
): boolean {
  if (!meId) return false;
  if (task.created_by === meId) return true;
  return task.user_id === meId && (task.created_by == null || task.created_by === task.user_id);
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
