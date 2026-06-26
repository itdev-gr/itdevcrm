export type TaskOpenLink = { href: string; labelKey: 'open_deal' | 'open_job'; code: string } | null;

/**
 * Where the task detail's "open" button should point, and what to label it.
 *
 * A deal-scoped task surfaces on the matching service job, but the technical team
 * cannot open the deal page (deals aren't readable by their groups). So for a
 * deal-scoped task, when the viewer can't open the deal, link to the deal's matching
 * service job instead (its code is shown). Job-scoped tasks always open their job;
 * users who can open deals keep the deal link.
 */
export function resolveTaskOpenLink(params: {
  dealId: string | null;
  jobId: string | null;
  sourceCode: string | null;
  canOpenDeal: boolean;
  matchingJob: { id: string; code: string | null } | null;
}): TaskOpenLink {
  const { dealId, jobId, sourceCode, canOpenDeal, matchingJob } = params;
  const code = sourceCode ?? '';
  if (jobId) return { href: `/jobs/${jobId}`, labelKey: 'open_job', code };
  if (dealId) {
    if (canOpenDeal) return { href: `/deals/${dealId}`, labelKey: 'open_deal', code };
    if (matchingJob) {
      return { href: `/jobs/${matchingJob.id}`, labelKey: 'open_job', code: matchingJob.code ?? code };
    }
    return null;
  }
  return null;
}
