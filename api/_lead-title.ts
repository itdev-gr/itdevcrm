/** Lead title = «Primary contact name (Form)» — owner request 2026-08-31.
 *  Franchise forms get the literal `Franchise` label (raw names are noisy);
 *  other forms keep their raw form name. Falls back to the pre-2026-08-31
 *  behavior when a piece is missing. Backfill of older leads: migration
 *  20260831250000_lead_title_contact_name.sql (same format). */
export function leadTitle(
  fullName: string | null,
  formName: string | null,
  isFranchise: boolean,
): string {
  const name = fullName?.trim() || null;
  const form = isFranchise ? 'Franchise' : formName?.trim() || null;
  if (name && form) return `${name} (${form})`.slice(0, 200);
  return (name ?? form ?? 'Meta lead').slice(0, 200);
}
