// Job pricing (the amount + the billing frequency / terms) is accounting-sensitive.
// It is hidden from the technical/service teams who work the job boards — only
// admins and the accounting group may see it. Mirrors the canBlockJob gate.
export function canViewJobPricing(isAdmin: boolean, groupCodes: string[]): boolean {
  return isAdmin || groupCodes.includes('accounting');
}
