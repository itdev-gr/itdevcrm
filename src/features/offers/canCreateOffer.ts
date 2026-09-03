// Owner rule 2026-09-03: offers are built by admins, the whole Accounting
// department and Sales — the technical boards are deliberately excluded.
// Mirrors the offers_insert RLS check, which stays the authority.
const ALLOWED_GROUPS = new Set(['accounting', 'sales']);

export function canCreateOffer(input: {
  isAdmin: boolean;
  groupCodes: readonly string[];
}): boolean {
  if (input.isAdmin) return true;
  return input.groupCodes.some((c) => ALLOWED_GROUPS.has(c));
}
