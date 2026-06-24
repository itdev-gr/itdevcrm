// Pure counts for the sidebar Tasks badges.
// total   = all open tasks the user has (personal + delegated-to-them)
// newCount = those created since the user last opened the Tasks page
//           (seenIso = null → never opened → everything counts as new)
type WithCreatedAt = { created_at: string };

export function computeTaskBadges(
  userTasks: WithCreatedAt[],
  assignedTasks: WithCreatedAt[],
  seenIso: string | null,
): { total: number; newCount: number } {
  const total = userTasks.length + assignedTasks.length;
  const since = seenIso ? Date.parse(seenIso) : 0;
  const isNew = (createdAt: string) => Date.parse(createdAt) > since;
  const newCount =
    userTasks.filter((tk) => isNew(tk.created_at)).length +
    assignedTasks.filter((tk) => isNew(tk.created_at)).length;
  return { total, newCount };
}
