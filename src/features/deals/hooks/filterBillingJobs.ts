/** Work-card children (parent_job_id set) are €0 and shouldn't appear in the
 *  deal Overview billing list — only their parent billing record does. */
export function filterBillingJobs<T extends { parent_job_id: string | null }>(rows: T[]): T[] {
  return rows.filter((r) => !r.parent_job_id);
}
