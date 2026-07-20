export type TaskOpenLink = { href: string; labelKey: 'open_deal' | 'open_job'; code: string };

/**
 * Where the task detail's "open" links should point, and what to label them.
 *
 * A deal-scoped task surfaces on the matching service jobs, but the technical team
 * cannot open the deal page (deals aren't readable by their groups). So for a
 * deal-scoped task, when the viewer can't open the deal, link to EVERY matching
 * service job of the deal (a deal can hold several web_dev jobs — one per website).
 * Job-scoped tasks always open their job; users who can open deals keep the deal link.
 */
export function resolveTaskOpenLinks(params: {
  dealId: string | null;
  jobId: string | null;
  sourceCode: string | null;
  canOpenDeal: boolean;
  matchingJobs: { id: string; code: string | null }[];
}): TaskOpenLink[] {
  const { dealId, jobId, sourceCode, canOpenDeal, matchingJobs } = params;
  const code = sourceCode ?? '';
  if (jobId) return [{ href: `/jobs/${jobId}`, labelKey: 'open_job', code }];
  if (dealId) {
    if (canOpenDeal) return [{ href: `/deals/${dealId}`, labelKey: 'open_deal', code }];
    return matchingJobs.map((j) => ({
      href: `/jobs/${j.id}`,
      labelKey: 'open_job' as const,
      code: j.code ?? code,
    }));
  }
  return [];
}
