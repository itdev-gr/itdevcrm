import { withSentry } from './_sentry.js';
import { secretMatches } from './_secret.js';
import { leadTitle } from './_lead-title';
// api/meta-lead.ts
// Public Meta lead-ad ingestion. Zapier sends each lead here (GET with query
// params, or POST with a JSON body — both supported).
//   GET/POST /api/meta-lead?key=<secret>&email=...&id=...&<form fields>
// Meta form field names vary (often Greek custom labels), so each lead field is
// resolved by exact name first, then a fuzzy fallback. The full raw payload is
// always stored in source_data so nothing is ever lost.
// Helpers are inlined so the serverless function bundles standalone on Vercel.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

function splitFullName(full: string): { first: string | null; last: string | null } {
  const t = (full ?? '').trim();
  if (!t) return { first: null, last: null };
  const parts = t.split(/\s+/);
  return { first: parts[0] ?? null, last: parts.length > 1 ? parts.slice(1).join(' ') : null };
}

const str = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
};

// Store phones the way the CRM does: plain local Greek form (69…/2…, 10 digits).
// 0030/30/+30-prefixed Greek numbers are stripped to the local part; anything
// else (foreign numbers, malformed lengths) passes through untouched.
export function normalizeGreekPhone(v: string | null): string | null {
  const digits = (v ?? '').replace(/\D/g, '');
  if (/^0030(69|2)/.test(digits) && digits.length === 14) return digits.slice(4);
  if (/^30(69|2)/.test(digits) && digits.length === 12) return digits.slice(2);
  if (digits.length === 10 && /^(69|2)/.test(digits)) return digits;
  return str(v);
}

// Some Meta forms nest a COL$ answer as an object (e.g. {"": "μέσα_σε_1_μήνα"}),
// which String()s to "[object Object]" and loses the answer. Flatten any non-null
// object to the join of its non-empty leaf strings; plain values behave like str().
export function flattenColumnValue(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'object') {
    const leaves: string[] = [];
    const walk = (o: unknown): void => {
      if (o == null) return;
      if (typeof o === 'object') {
        for (const val of Object.values(o as Record<string, unknown>)) walk(val);
      } else {
        const s = String(o).trim();
        if (s.length > 0) leaves.push(s);
      }
    };
    walk(v);
    return leaves.length > 0 ? leaves.join(' ') : null;
  }
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

// Meta form answers slugify spaces to underscores (e.g. "όχι,_αλλά_θέλω"). Undo that.
function cleanUnderscore(v: string | null): string | null {
  if (v == null) return null;
  const s = v.replace(/_/g, ' ').trim();
  return s.length > 0 ? s : null;
}

// Zapier number-formats the franchise budget option: the Greek thousands-dot value
// "€5.000" arrives as "€5.00" (trailing zero dropped). Restore it; anything else
// (e.g. "Εξαρτάται") passes through with the same _→space cleanup as other answers.
export function demangleBudget(v: string | null): string | null {
  if (v == null) return null;
  const m = v.match(/^€(\d{1,3})\.00$/);
  if (m) return `€${m[1]}.000`;
  return cleanUnderscore(v);
}

// The submission timestamp (COL$B) as a plain YYYY-MM-DD (used in franchise notes).
function isoDate(v: string | null): string | null {
  if (!v) return null;
  const m = v.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1]! : null;
}

// ---- Columnar (Meta → Excel → Zapier) format --------------------------------
// Some Meta leads arrive as a positional spreadsheet row with keys COL$A..COL$S
// and prefixed values (l: lead id, p: phone, c:/as:/ag:/f: campaign/adset/ad/form
// ids). The webhook's named-field resolver can't read this, so those leads landed
// blank. This parser maps the columns explicitly; non-columnar payloads return null
// and fall back to the named-field path (so future header-based payloads still work).
type ColumnarLead = {
  leadgenId: string | null;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  formName: string | null;
  noteBlock: string | null;
  // Franchise lead-form extras (null for every other form).
  isFranchise: boolean;
  budget: string | null;
  when: string | null;
  experience: string | null;
  region: string | null;
};

function stripPrefix(v: string | null, prefix: string): string | null {
  if (!v) return null;
  return v.startsWith(prefix) ? str(v.slice(prefix.length)) : v;
}

function looksLikeUrl(v: string | null): boolean {
  if (!v) return false;
  return /^https?:\/\//i.test(v) || /\b[a-z0-9-]+\.[a-z]{2,}(\/|$)/i.test(v);
}

function metaDate(iso: string | null): string | null {
  if (!iso) return null;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

// Excel/Meta column order: A, B, … Z, AA, AB, … (length first, then lexicographic).
function compareColKeys(a: string, b: string): number {
  const x = a.slice(4); // drop the "COL$" prefix
  const y = b.slice(4);
  return x.length - y.length || (x < y ? -1 : x > y ? 1 : 0);
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;
// Meta lead-status tokens occupy the trailing column on some forms — never an answer.
const LEAD_STATUS = new Set(['created', 'in_progress', 'disqualified', 'complete', 'archived', 'deleted']);

export function parseColumnarMetaLead(data: Record<string, unknown>): ColumnarLead | null {
  if (!('COL$A' in data) && !('COL$N' in data)) return null;
  const c = (k: string): string | null => flattenColumnValue(data[k]);

  // The positional payload lists the standard contact fields (full name, phone, email)
  // consecutively, in that order, AFTER the form's custom-question answers. But the
  // number of question columns varies per form (0 for Social, 1 for AI/Local SEO, 2 for
  // the website form), which shifts every later column — so a hard-coded COL$N=name is
  // only right for single-question forms and mis-reads an answer as the name otherwise.
  // Anchor on the email column (the one field with an unambiguous shape) and read phone
  // and name by relative position; fall back to the legacy fixed columns if no email is
  // found, so we never do worse than before on an unrecognised payload.
  const colKeys = Object.keys(data)
    .filter((k) => /^COL\$[A-Z]+$/.test(k))
    .sort(compareColKeys);

  const emailIdx = colKeys.findIndex((k) => EMAIL_RE.test(c(k) ?? ''));
  // Contact order varies by form. Anchor on the email column, then disambiguate by the
  // column immediately after it: if that value is a phone (≥10 digits) the order is
  // name, email, phone (the franchise form); otherwise it's the standard name, phone,
  // email (phone precedes the email). Fall back to fixed columns when no email is found.
  const afterEmailDigits =
    emailIdx >= 0 ? (c(colKeys[emailIdx + 1] ?? '') ?? '').replace(/\D/g, '') : '';
  let nameIdx: number;
  let phoneIdx: number;
  let mailIdx: number;
  if (emailIdx >= 1 && afterEmailDigits.length >= 10) {
    mailIdx = emailIdx;
    nameIdx = emailIdx - 1;
    phoneIdx = emailIdx + 1;
  } else if (emailIdx >= 2) {
    mailIdx = emailIdx;
    phoneIdx = emailIdx - 1;
    nameIdx = emailIdx - 2;
  } else {
    nameIdx = colKeys.indexOf('COL$N');
    phoneIdx = colKeys.indexOf('COL$O');
    mailIdx = colKeys.indexOf('COL$P');
  }
  const at = (i: number): string | null => (i >= 0 && i < colKeys.length ? c(colKeys[i]!) : null);

  const leadgenId = stripPrefix(c('COL$A'), 'l:');
  const fullName = at(nameIdx);
  const email = at(mailIdx);
  const phone = stripPrefix(at(phoneIdx), 'p:');
  const formName = c('COL$J');

  // Website = the first URL-looking column after email (was hard-coded to COL$R).
  let website: string | null = null;
  for (let i = mailIdx + 1; i < colKeys.length; i++) {
    const v = c(colKeys[i]!);
    if (looksLikeUrl(v)) {
      website = v;
      break;
    }
  }

  const platformRaw = (c('COL$L') ?? '').toLowerCase();
  const platform =
    platformRaw === 'fb' ? 'Facebook' : platformRaw === 'ig' ? 'Instagram' : c('COL$L');

  // Custom form answers (question text is not in the positional payload): every column
  // after the platform that isn't the name/phone/email, the website URL, or the trailing
  // lead-status token.
  const platformIdx = colKeys.indexOf('COL$L');
  const answersStart = platformIdx >= 0 ? platformIdx + 1 : colKeys.indexOf('COL$M');
  const answers: string[] = [];
  for (let i = answersStart; i >= 0 && i < colKeys.length; i++) {
    if (i === nameIdx || i === phoneIdx || i === mailIdx) continue;
    const v = c(colKeys[i]!);
    if (!v || looksLikeUrl(v) || LEAD_STATUS.has(v.toLowerCase())) continue;
    answers.push(v);
  }

  const lines: string[] = [];
  if (formName) lines.push(`Form: ${formName}`);
  const campaign = c('COL$H');
  const adset = c('COL$F');
  const ad = c('COL$D');
  if (campaign) lines.push(`Campaign: ${campaign}`);
  if (adset) lines.push(`Ad set: ${adset}`);
  if (ad) lines.push(`Ad: ${ad}`);
  if (platform) lines.push(`Platform: ${platform}`);
  const submitted = metaDate(c('COL$B'));
  if (submitted) lines.push(`Submitted: ${submitted}`);
  if (answers.length > 0) {
    lines.push('Answers:');
    for (const a of answers) lines.push(`- ${a}`);
  }
  const noteBlock = lines.length > 0 ? lines.join('\n') : null;

  // Franchise lead form: the four answer columns after the platform carry structured
  // fields (budget, when-to-start, prior experience, region) that sales reads directly.
  const isFranchise = /franchi[sz]e/i.test(formName ?? '');
  let budget: string | null = null;
  let when: string | null = null;
  let experience: string | null = null;
  let region: string | null = null;
  if (isFranchise) {
    const ans = (offset: number): string | null =>
      platformIdx >= 0 ? c(colKeys[platformIdx + offset] ?? '') : null;
    budget = demangleBudget(ans(1)); // COL$M
    when = cleanUnderscore(ans(2)); // COL$N (flattened out of {"": "…"})
    experience = cleanUnderscore(ans(3)); // COL$O
    region = cleanUnderscore(ans(4)); // COL$P
  }

  return {
    leadgenId,
    fullName,
    email,
    phone,
    website,
    formName,
    noteBlock,
    isFranchise,
    budget,
    when,
    experience,
    region,
  };
}

async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  const bodyObj =
    typeof req.body === 'object' && req.body !== null ? (req.body as Record<string, unknown>) : {};
  const data: Record<string, unknown> = { ...(req.query as Record<string, unknown>), ...bodyObj };

  const secret = process.env.META_LEAD_SECRET;
  // Prefer the X-Meta-Secret header; ?key= stays for back-compat with the
  // existing Zapier config (move it to the header to stop leaking the key,
  // then query support can be dropped). Constant-time compare.
  const provided = String(req.headers['x-meta-secret'] ?? data.key ?? '');
  if (!secretMatches(provided, secret)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    res.status(500).json({ error: 'server misconfigured' });
    return;
  }
  const admin = createClient(supabaseUrl, serviceRoleKey);

  // Persist the raw lead, but never the secret.
  const payload: Record<string, unknown> = { ...data };
  delete payload.key;

  // Resolve fields: exact name first, then fuzzy (handles Greek Meta form labels).
  // raw_* duplicates and already-claimed keys are skipped so notes stay clean.
  const used = new Set<string>();
  const pick = (names: string[], regex?: RegExp): string | null => {
    for (const n of names) {
      const v = str(data[n]);
      if (v) {
        used.add(n);
        return v;
      }
    }
    if (regex) {
      for (const k of Object.keys(data)) {
        if (k.startsWith('raw_') || used.has(k)) continue;
        if (regex.test(k)) {
          const v = str(data[k]);
          if (v) {
            used.add(k);
            return v;
          }
        }
      }
    }
    return null;
  };

  // Meta → Excel → Zapier rows arrive as the positional COL$ format; everything
  // else (direct Meta/manual params) uses the named-field resolver.
  const columnar = parseColumnarMetaLead(data);

  const leadgenId = columnar ? columnar.leadgenId : pick(['leadgen_id', 'id']);
  const fullName = columnar ? columnar.fullName : pick(['full_name', 'name'], /ονοματεπ|full.?name/i);
  const email = columnar ? columnar.email : pick(['email'], /email/i);
  // Both paths (columnar + named-field) funnel through the same normalizer so stored
  // phones match the CRM's local Greek form; the parser stays a faithful raw reader.
  const phone = normalizeGreekPhone(
    columnar ? columnar.phone : pick(['phone', 'phone_number'], /phone|τηλεφ/i),
  );
  const company = columnar ? null : pick(['company', 'company_name'], /company|εταιρ/i);
  const website = columnar ? columnar.website : pick(['website'], /website/i);
  const formName = columnar ? columnar.formName : pick(['form_name', 'campaign']);

  // Normalize the dedup id so retries match regardless of Meta's field name.
  if (leadgenId) payload.leadgen_id = leadgenId;

  let notes: string | null;
  if (columnar) {
    // Campaign context + form answers, already assembled by the columnar parser.
    notes = columnar.noteBlock;
  } else {
    // Remaining custom answers (e.g. the Greek questionnaire) → notes for sales.
    const SYSTEM = new Set([
      'key', 'created_time', 'form_id', 'form_name', 'campaign', 'id', 'leadgen_id',
      'is_organic', 'page_id', 'platform', 'website', 'ad_id', 'adset_id', 'ad_name',
      'adset_name', 'campaign_id', 'campaign_name',
    ]);
    const noteLines: string[] = [];
    for (const k of Object.keys(data)) {
      if (k.startsWith('raw_') || used.has(k) || SYSTEM.has(k)) continue;
      const v = str(data[k]);
      if (v) noteLines.push(`${k}: ${v}`);
    }
    notes = pick(['notes']) ?? (noteLines.length > 0 ? noteLines.join('\n') : null);
  }

  // Franchise lead form: a distinct source, a name-based title, and a compact Greek
  // contact_info block. crm_budget/crm_region ride along in source_data so the DB
  // release paths can fill the lead's budget/region columns.
  const isFranchise = !!(columnar && columnar.isFranchise);
  if (isFranchise && columnar) {
    const platformRaw = flattenColumnValue(data['COL$L']);
    const submitted = isoDate(flattenColumnValue(data['COL$B']));
    const infoLines: string[] = [];
    if (columnar.when) infoLines.push(`Πότε θέλει να ξεκινήσει: ${columnar.when}`);
    if (columnar.experience) infoLines.push(`Εμπειρία: ${columnar.experience}`);
    infoLines.push(
      `Meta lead l:${columnar.leadgenId ?? ''} (${platformRaw ?? ''}, ${submitted ?? ''}), φόρμα: ${columnar.formName ?? ''}`,
    );
    notes = infoLines.join('\n');
    payload.crm_budget = columnar.budget;
    payload.crm_region = columnar.region;
  }

  // Dedup on the Meta lead id stored in source_data. Retries return the existing
  // record — whether it landed in `leads` (clean) or `lead_intake` (held duplicate).
  if (leadgenId) {
    const { data: existing } = await admin
      .from('leads')
      .select('id')
      .eq('source_data->>leadgen_id', leadgenId)
      .limit(1);
    if (existing && existing.length > 0) {
      res.status(200).json({ ok: true, deduped: true, lead_id: existing[0].id });
      return;
    }
    const { data: held } = await admin
      .from('lead_intake')
      .select('id')
      .eq('source_data->>leadgen_id', leadgenId)
      .limit(1);
    if (held && held.length > 0) {
      res.status(200).json({ ok: true, deduped: true, held: true, intake_id: held[0].id });
      return;
    }
  }

  const { first, last } = splitFullName(fullName ?? '');
  // Owner 2026-08-31: title = «Contact name (Form)» — see api/_lead-title.ts.
  const title = leadTitle(fullName, formName, isFranchise);
  const source = isFranchise ? 'franchise' : 'meta';

  // ---- Intake queue --------------------------------------------------------
  // Every incoming lead is held in `lead_intake` for review — nothing reaches the
  // sales board until a reviewer Releases it. We still run the duplicate check so
  // possible duplicates (email/phone already on another lead or a deal-customer)
  // are flagged in the queue; clean leads simply have empty `matches`.
  const phoneDigits = (phone ?? '').replace(/\D/g, '');
  const phoneNorm = phoneDigits.length >= 10 ? phoneDigits.slice(-10) : null;

  const { data: dupRows } = await admin.rpc('find_lead_duplicates', {
    p_email: email,
    p_phone: phone,
  });
  const matches = (dupRows ?? []) as Array<{
    match_type: string;
    record_id: string;
    display_name: string;
    context: string | null;
    matched_field: string;
  }>;
  const matchedOn = Array.from(new Set(matches.map((m) => m.matched_field)));

  const { data: intake, error: intakeErr } = await admin
    .from('lead_intake')
    .insert({
      source,
      source_data: payload,
      title,
      contact_first_name: first,
      contact_last_name: last,
      email,
      phone,
      phone_normalized: phoneNorm,
      website,
      company_name: company,
      contact_info: notes,
      matched_on: matchedOn,
      matches,
    })
    .select('id')
    .single();
  if (intakeErr || !intake) {
    res.status(500).json({ error: intakeErr?.message ?? 'intake_failed' });
    return;
  }
  res.status(200).json({ ok: true, held: true, duplicate: matches.length > 0, intake_id: intake.id });
}

export default withSentry('meta-lead', handler);
