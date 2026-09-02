/** Lead title = «Primary contact name (Form)» — owner request 2026-08-31.
 *  Franchise forms get the literal `Franchise` label (raw names are noisy);
 *  other forms keep their raw form name. Falls back to the pre-2026-08-31
 *  behavior when a piece is missing. Backfill of older leads: migration
 *  20260831250000_lead_title_contact_name.sql (same format). */
/** Known service keywords → clean labels (owner 2026-09-02): a raw Meta form
 *  name like «📍 LOCAL SEO LEAD FORM — ITDEV» shows as just «Local SEO».
 *  Order matters: the SEO variants are checked before the bare «website»
 *  keyword. Unknown form names pass through unchanged. Keep in sync with the
 *  SQL backfill in migration 20260902090000_lead_title_form_labels.sql. */
const FORM_LABELS: readonly [RegExp, string][] = [
  [/local[\s_-]*seo/i, 'Local SEO'],
  [/web[\s_-]*seo/i, 'Web SEO'],
  [/ai[\s_-]*seo/i, 'AI SEO'],
  [/website/i, 'Website'],
];

export function normalizeFormLabel(formName: string): string {
  for (const [re, label] of FORM_LABELS) if (re.test(formName)) return label;
  return formName;
}

export function leadTitle(
  fullName: string | null,
  formName: string | null,
  isFranchise: boolean,
): string {
  const name = fullName?.trim() || null;
  const rawForm = formName?.trim() || null;
  const form = isFranchise ? 'Franchise' : rawForm ? normalizeFormLabel(rawForm) : null;
  if (name && form) return `${name} (${form})`.slice(0, 200);
  return (name ?? form ?? 'Meta lead').slice(0, 200);
}
