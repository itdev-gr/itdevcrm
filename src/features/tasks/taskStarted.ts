/** Pure visibility rules for the "Started working" affordance. */
export function canStartTask(p: { isAssignee: boolean; resolved: boolean; startedAt: string | null }): boolean {
  return p.isAssignee && !p.resolved && p.startedAt == null;
}

export function startedBadgeVisible(p: { resolved: boolean; startedAt: string | null }): boolean {
  return !p.resolved && p.startedAt != null;
}
