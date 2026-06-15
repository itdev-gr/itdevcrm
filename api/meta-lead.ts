// api/meta-lead.ts
// Public Meta lead-ad ingestion. Zapier sends each lead here (GET with query
// params, or POST with a JSON body — both supported).
//   GET/POST /api/meta-lead?key=<secret>&full_name=...&email=...&leadgen_id=...
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

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
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
    // TEMP diagnostic — shows WHERE Zapier put the data; never the secret value.
    res.status(401).json({
      error: 'unauthorized',
      debug: {
        method: req.method,
        query_keys: Object.keys((req.query as Record<string, unknown>) ?? {}),
        body_keys:
          typeof req.body === 'object' && req.body !== null
            ? Object.keys(req.body as Record<string, unknown>)
            : [],
        key_as_header: req.headers['key'] != null,
        x_meta_secret_header: req.headers['x-meta-secret'] != null,
        received_len: provided.length,
        expected_len: secret ? secret.length : null,
      },
    });
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

  // Dedup on the Meta lead id stored in source_data (no dedicated column needed,
  // so this works before any migration). Retries return the existing lead.
  const leadgenId = str(payload.leadgen_id);
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

  const { first, last } = splitFullName(String(payload.full_name ?? ''));
  const title = (str(payload.form_name) ?? str(payload.campaign) ?? 'Meta lead').slice(0, 200);

  const { data: inserted, error } = await admin
    .from('leads')
    .insert({
      source: 'meta',
      source_data: payload,
      title,
      contact_first_name: first,
      contact_last_name: last,
      email: str(payload.email),
      phone: str(payload.phone),
      website: str(payload.website),
      company_name: str(payload.company),
      contact_info: str(payload.notes),
    })
    .select('id')
    .single();

  if (error || !inserted) {
    res.status(500).json({ error: error?.message ?? 'insert_failed' });
    return;
  }
  res.status(200).json({ ok: true, lead_id: inserted.id });
}
