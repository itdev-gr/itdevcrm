/**
 * What KIND of lead is this — «ΟΝΟΜΑ ΕΠΩΝΥΜΟ (SERVICE)» (owner request 2026-09-11).
 *
 * The label already exists for Meta leads: api/_lead-title.ts writes
 * `leads.title` as «Name (Local SEO)», which is why the Sales Tasks page shows
 * it. The kanban card threw it away, and leads that arrived as ClickUp imports
 * (128 of them from the Social Media form alone) never had it at all — their
 * form only survives inside `notes`. This module derives the label from every
 * source we have, so both populations read the same.
 *
 * Derived at render time on purpose: no title is rewritten, a hand-edited title
 * cannot poison it, and the label can never be appended twice.
 */

/**
 * Raw form names are noisy («🧲 SOCIAL MEDIA LEAD FORM (ITDEV)») and lead titles
 * carry hand-typed junk from years of editing («(Syros)», «(possible)»), so only
 * recognised services survive — anything else becomes null and shows nothing.
 *
 * Order matters: the SEO variants are tested before the bare «website».
 * Keep in sync with FORM_LABELS in api/_lead-title.ts (separate tsconfig — the
 * serverless bundle cannot import from src/) and with the SQL in migration
 * 20260902090000_lead_title_form_labels.sql.
 */
const SERVICE_LABEL_PATTERNS: readonly [RegExp, string][] = [
  [/local[\s_-]*seo/i, 'Local SEO'],
  [/web[\s_-]*seo/i, 'Web SEO'],
  [/ai[\s_-]*seo/i, 'AI SEO'],
  [/social[\s_-]*media/i, 'Social Media'],
  [/website/i, 'Website'],
  [/franchise/i, 'Franchise'],
];

/** service_type codes → the same short labels, so a priced service and a form
 *  name never render as two different words for one thing. */
const SERVICE_TYPE_LABELS: Record<string, string> = {
  local_seo: 'Local SEO',
  web_seo: 'Web SEO',
  ai_seo: 'AI SEO',
  social_media: 'Social Media',
  web_dev: 'Website',
  franchise: 'Franchise',
  ads: 'Ads',
  hosting: 'Hosting',
  maintenance: 'Support',
  domains: 'Domains',
};

export function normalizeServiceLabel(raw: string | null | undefined): string | null {
  const text = (raw ?? '').trim();
  if (!text) return null;
  for (const [re, label] of SERVICE_LABEL_PATTERNS) if (re.test(text)) return label;
  return null;
}

/** The trailing «(…)» of a title, if it has one. */
const TRAILING_PARENS = /\s*\(([^()]+)\)\s*$/;

/** The form line both ingestion paths write: «Form: …» (Zapier) or «Φόρμα: …» (DB). */
const NOTES_FORM_LINE = /^\s*(?:Form|Φόρμα)\s*:\s*(.+)$/im;

export type LeadServiceInput = {
  title?: string | null;
  notes?: string | null;
  source?: string | null;
  services_planned?: unknown;
  contact_first_name?: string | null;
  contact_last_name?: string | null;
  company_name?: string | null;
};

/**
 * The lead's service, or null when we genuinely do not know (≈5.000 plain
 * ClickUp imports) — better a bare name than an invented category.
 */
export function leadServiceLabel(lead: LeadServiceInput): string | null {
  // 1. What sales actually priced wins: it is a deliberate human entry.
  const planned = Array.isArray(lead.services_planned) ? lead.services_planned : [];
  for (const row of planned) {
    const code = (row as { service_type?: string } | null)?.service_type;
    if (code && SERVICE_TYPE_LABELS[code]) return SERVICE_TYPE_LABELS[code];
  }
  // 2. The label the Meta ingestion already wrote into the title.
  const fromTitle = normalizeServiceLabel(TRAILING_PARENS.exec(lead.title ?? '')?.[1]);
  if (fromTitle) return fromTitle;
  // 3. The originating form, still recorded in the notes block — this is what
  //    rescues the imported Social Media / Web SEO leads.
  const fromNotes = normalizeServiceLabel(NOTES_FORM_LINE.exec(lead.notes ?? '')?.[1]);
  if (fromNotes) return fromNotes;
  // 4. Franchise leads are a service of their own and skip the forms entirely.
  if (lead.source === 'franchise') return 'Franchise';
  return null;
}

/** The name without whatever label a previous pass appended, so adding one back
 *  is idempotent. */
export function leadBaseName(lead: LeadServiceInput): string {
  const contact = [lead.contact_first_name, lead.contact_last_name]
    .filter(Boolean)
    .join(' ')
    .trim();
  if (contact) return contact;
  const company = (lead.company_name ?? '').trim();
  if (company) return company;
  const title = (lead.title ?? '').trim();
  // Only strip the parenthetical when it IS a service label — «Καφέ (Σύρος)»
  // keeps its parenthesis.
  if (normalizeServiceLabel(TRAILING_PARENS.exec(title)?.[1])) {
    return title.replace(TRAILING_PARENS, '').trim() || title;
  }
  return title;
}

/** «ΟΝΟΜΑ ΕΠΩΝΥΜΟ (SERVICE)» — the string the owner asked for. */
export function leadNameWithService(lead: LeadServiceInput): string {
  const name = leadBaseName(lead);
  const service = leadServiceLabel(lead);
  if (!service) return name;
  return name ? `${name} (${service})` : `(${service})`;
}
