import { withSentry } from './_sentry.js';
import { secretMatches } from './_secret.js';
// api/pbx-lookup.ts
// Public caller-ID lookup for the Yeastar PBX.
//   GET /api/pbx-lookup?phone=<callerID>&key=<secret>
//   GET /api/pbx-lookup?phone=<callerID>           (with header X-PBX-Secret)
// Returns Yeastar's { "contact": {…} } envelope on a hit, 404 on a miss.
//
// NOTE: helpers are inlined (not imported from ../src/lib) so this serverless
// function bundles standalone on Vercel — importing across the api/→src/
// boundary made the function fail to invoke (500 FUNCTION_INVOCATION_FAILED).
// The frontend keeps its own copies in src/lib/phone/*.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

type ContactRow = {
  id: string;
  name: string | null;
  contact_first_name: string | null;
  contact_last_name: string | null;
  email: string | null;
  phone: string | null;
  source: 'client' | 'lead';
};

// Greek "national key": last 10 digits after stripping non-digits (drops +30/0030/30).
function normalizePhone(raw: string | null | undefined): string {
  const digits = (raw ?? '').replace(/[^0-9]/g, '');
  if (digits.length < 10) return '';
  return digits.slice(-10);
}

function toYeastarContact(row: ContactRow, appBase: string) {
  const base = appBase.replace(/\/+$/, '');
  const path = row.source === 'client' ? 'clients' : 'leads';
  return {
    contact: {
      id: row.id,
      firstname: row.contact_first_name ?? '',
      lastname: row.contact_last_name ?? '',
      company: row.name ?? '',
      email: row.email ?? '',
      businessphone: row.phone ?? '',
      mobilephone: '',
      url: `${base}/${path}/${row.id}`,
    },
  };
}

async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const secret = process.env.PBX_LOOKUP_SECRET;
  // Prefer the X-PBX-Secret header; ?key= stays for back-compat with existing
  // PBX config (reconfigure it to the header to stop leaking the key into
  // logs/Referer, then query support can be dropped). Constant-time compare.
  const provided = String(req.headers['x-pbx-secret'] ?? req.query.key ?? '');
  if (!secretMatches(provided, secret)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const raw = String(req.query.phone ?? req.query.callerID ?? '');
  const key = normalizePhone(raw);
  if (!key) {
    res.status(400).json({ error: 'missing or invalid phone' });
    return;
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    res.status(500).json({ error: 'server misconfigured' });
    return;
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data, error } = await admin.rpc('find_contact_by_phone', { p_key: key });
  if (error) {
    res.status(500).json({ error: 'lookup failed' });
    return;
  }

  const row = (Array.isArray(data) ? data[0] : data) as ContactRow | undefined;
  if (!row) {
    res.status(404).json({ error: 'not found' });
    return;
  }

  const appBase =
    process.env.PBX_DEEPLINK_BASE ?? process.env.VITE_PUBLIC_APP_URL ?? 'https://www.itdevcrm.com';
  res.status(200).json(toYeastarContact(row, appBase));
}

export default withSentry('pbx-lookup', handler);
