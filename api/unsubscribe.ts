// Public opt-out endpoint linked from every automated lead email:
// GET /api/unsubscribe?lead=<uuid>&token=<unsubscribe_token>
// The token is a per-lead random uuid, so the link only works for the
// recipient it was sent to. Always renders a friendly page (no JSON).
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function page(res: VercelResponse, status: number, title: string, body: string): void {
  res
    .status(status)
    .setHeader('Content-Type', 'text/html; charset=utf-8')
    .send(`<!doctype html><html lang="el"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="font-family:Arial,sans-serif;display:flex;justify-content:center;padding:64px 16px;background:#f8fafc;color:#0f172a">
<div style="max-width:420px;text-align:center">
<h1 style="font-size:20px">${title}</h1>
<p style="color:#475569">${body}</p>
<p style="font-size:12px;color:#94a3b8;margin-top:32px">ITDev · itdev.gr</p>
</div></body></html>`);
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const lead = String(req.query.lead ?? '');
  const token = String(req.query.token ?? '');
  if (!UUID_RE.test(lead) || !UUID_RE.test(token)) {
    page(res, 400, 'Μη έγκυρος σύνδεσμος', 'Ο σύνδεσμος απεγγραφής δεν είναι έγκυρος.');
    return;
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    page(res, 500, 'Κάτι πήγε στραβά', 'Παρακαλούμε δοκιμάστε ξανά αργότερα.');
    return;
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data, error } = await admin
    .from('leads')
    .update({ email_opt_out: true })
    .eq('id', lead)
    .eq('unsubscribe_token', token)
    .select('id');

  if (error || !data || data.length === 0) {
    page(res, 400, 'Μη έγκυρος σύνδεσμος', 'Ο σύνδεσμος απεγγραφής δεν είναι έγκυρος ή έχει λήξει.');
    return;
  }

  page(
    res,
    200,
    'Απεγγραφήκατε με επιτυχία',
    'Δεν θα λαμβάνετε πλέον αυτοματοποιημένες ενημερώσεις από εμάς. Αν το μετανιώσετε, απλώς απαντήστε σε οποιοδήποτε email μας.',
  );
}
