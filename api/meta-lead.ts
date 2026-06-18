import { withSentry } from './_sentry.js';
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

async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  const bodyObj =
    typeof req.body === 'object' && req.body !== null ? (req.body as Record<string, unknown>) : {};
  const data: Record<string, unknown> = { ...(req.query as Record<string, unknown>), ...bodyObj };

  const secret = process.env.META_LEAD_SECRET;
  const provided = String(req.headers['x-meta-secret'] ?? data.key ?? '');
  if (!secret || provided.length !== secret.length || provided !== secret) {
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

  const leadgenId = pick(['leadgen_id', 'id']);
  const fullName = pick(['full_name', 'name'], /ονοματεπ|full.?name/i);
  const email = pick(['email'], /email/i);
  const phone = pick(['phone', 'phone_number'], /phone|τηλεφ/i);
  const company = pick(['company', 'company_name'], /company|εταιρ/i);
  const website = pick(['website'], /website/i);
  const formName = pick(['form_name', 'campaign']);

  // Normalize the dedup id so retries match regardless of Meta's field name.
  if (leadgenId) payload.leadgen_id = leadgenId;

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
  const notes = pick(['notes']) ?? (noteLines.length > 0 ? noteLines.join('\n') : null);

  // Dedup on the Meta lead id stored in source_data (no dedicated column needed,
  // so this works before any migration). Retries return the existing lead.
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
  }

  const { first, last } = splitFullName(fullName ?? '');
  const title = (formName ?? 'Meta lead').slice(0, 200);

  const { data: inserted, error } = await admin
    .from('leads')
    .insert({
      source: 'meta',
      source_data: payload,
      title,
      contact_first_name: first,
      contact_last_name: last,
      email,
      phone,
      website,
      company_name: company,
      contact_info: notes,
    })
    .select('id')
    .single();

  if (error || !inserted) {
    res.status(500).json({ error: error?.message ?? 'insert_failed' });
    return;
  }
  res.status(200).json({ ok: true, lead_id: inserted.id });
}

export default withSentry('meta-lead', handler);
