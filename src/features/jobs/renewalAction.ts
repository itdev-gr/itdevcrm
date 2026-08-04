// Which cards accounting may push to Renewal by hand (force_job_renewal).
//
// The automatic move is ledger-driven (jobs.renewed_for_period, migration
// 20260804090000). This is the escape hatch for the cases the ledger cannot
// reach on its own: a move that hit 'client_blocked', a payment recorded outside
// the CRM, or a card someone dragged off Renewal by mistake.

export const RENEWABLE_SERVICES = [
  'web_seo',
  'local_seo',
  'ads',
  'social_media',
  'maintenance',
] as const;

type RenewableJob = {
  service_type: string;
  archived?: boolean | null;
  billing_only?: boolean | null;
  stage?: { code: string } | null;
};

export function canForceRenewal(job: RenewableJob): boolean {
  if (job.archived) return false;
  // Billing-only records (the AI SEO parent) are deliberately off-board.
  if (job.billing_only) return false;
  if (!(RENEWABLE_SERVICES as readonly string[]).includes(job.service_type)) return false;
  // Already there — nothing to force.
  if (job.stage?.code === 'renewal') return false;
  // Closed is the end of the engagement; reopening is close_deal / end_job territory.
  if (job.stage?.code === 'closed') return false;
  return true;
}
