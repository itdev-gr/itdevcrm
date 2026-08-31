// Job pricing (the amount + the billing frequency / terms) is accounting-sensitive.
// It is hidden from the technical/service teams who work the job boards — only
// admins and the accounting group may see it. Mirrors the canBlockJob gate.
export function canViewJobPricing(isAdmin: boolean, groupCodes: string[]): boolean {
  return isAdmin || groupCodes.includes('accounting');
}

/** Hard delete of a job. Admins always; accounting only while the job's deal has
 *  never once reached Paid In Full (deals.first_paid_in_full_at is null — the
 *  delete_jobs RPC enforces the same rule server-side, migration 20260831130000).
 *  Mistake-fixing on fresh deals only; a deal that was ever paid stays admin-only. */
export function canDeleteJob(
  isAdmin: boolean,
  groupCodes: string[],
  dealFirstPaidInFullAt: string | null | undefined,
): boolean {
  if (isAdmin) return true;
  return groupCodes.includes('accounting') && dealFirstPaidInFullAt == null;
}
