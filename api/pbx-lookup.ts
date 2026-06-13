// api/pbx-lookup.ts
// Public caller-ID lookup for the Yeastar PBX.
//   GET /api/pbx-lookup?phone=<callerID>&key=<secret>
//   GET /api/pbx-lookup?phone=<callerID>           (with header X-PBX-Secret)
// Returns Yeastar's { "contact": {…} } envelope on a hit, 404 on a miss.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { normalizePhone } from '../src/lib/phone/normalize';
import { toYeastarContact, type ContactRow } from '../src/lib/phone/mapContact';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const secret = process.env.PBX_LOOKUP_SECRET;
  const provided = String(req.headers['x-pbx-secret'] ?? req.query.key ?? '');
  if (!secret || provided.length !== secret.length || provided !== secret) {
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
    process.env.PBX_DEEPLINK_BASE ?? process.env.VITE_PUBLIC_APP_URL ?? 'https://crm.itdev.gr';
  res.status(200).json(toYeastarContact(row, appBase));
}
