/** The department group id for a service_type, or null when none exists
 *  (ai_seo / hosting / ads have no department group). */
export function groupIdForServiceType(
  groups: { id: string; code: string }[],
  serviceType: string,
): string | null {
  return groups.find((g) => g.code === serviceType)?.id ?? null;
}

type CountRow = { deal_id: string | null; job_id: string | null; department_group_id: string | null };

/** Build per-deal (department-matched, deal-scoped) and per-job (job-scoped) open-task
 *  count maps. A card's count = byDeal[deal_id] + byJob[job_id]. Mirrors the tab union:
 *  a job-scoped task counts via byJob; a deal-scoped task counts via byDeal only when
 *  its department is this service's group. */
export function buildTaskCountMaps(
  rows: CountRow[],
  serviceGroupId: string | null,
): { byDeal: Record<string, number>; byJob: Record<string, number> } {
  const byDeal: Record<string, number> = {};
  const byJob: Record<string, number> = {};
  for (const r of rows) {
    if (r.job_id) {
      byJob[r.job_id] = (byJob[r.job_id] ?? 0) + 1;
    } else if (r.deal_id && serviceGroupId && r.department_group_id === serviceGroupId) {
      byDeal[r.deal_id] = (byDeal[r.deal_id] ?? 0) + 1;
    }
  }
  return { byDeal, byJob };
}
