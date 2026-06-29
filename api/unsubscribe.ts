import { withSentry } from './_sentry.js';
// Public opt-out endpoint linked from every automated lead email:
//   GET  /api/unsubscribe?lead=<uuid>&token=<unsubscribe_token>  → confirm page
//   POST (same URL, from the confirm form)                       → performs opt-out
// The token is a per-lead random uuid, so the link only works for the
// recipient it was sent to. The GET is read-only on purpose: link prefetchers
// / mail-security scanners auto-fetch the URL and must NOT unsubscribe anyone;
// the mutation only happens on the explicit POST. Always renders HTML (no JSON).
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
<p style="font-size:12px;color:#94a3b8;margin-top:32px">ITDEV · itdev.gr</p>
</div></body></html>`);
}

// Confirmation page: a single button that POSTs back to this same endpoint.
// lead/token are validated UUIDs, so they are safe to interpolate verbatim.
function confirmPage(res: VercelResponse, lead: string, token: string): void {
  const action = `/api/unsubscribe?lead=${lead}&token=${token}`;
  res
    .status(200)
    .setHeader('Content-Type', 'text/html; charset=utf-8')
    .send(`<!doctype html><html lang="el"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Απεγγραφή</title></head>
<body style="font-family:Arial,sans-serif;display:flex;justify-content:center;padding:64px 16px;background:#f8fafc;color:#0f172a">
<div style="max-width:420px;text-align:center">
<h1 style="font-size:20px">Απεγγραφή από ενημερώσεις</h1>
<p style="color:#475569">Πατήστε το κουμπί για να επιβεβαιώσετε ότι δεν θέλετε να λαμβάνετε πλέον αυτοματοποιημένα email από εμάς.</p>
<form method="POST" action="${action}">
<button type="submit" style="margin-top:16px;padding:10px 20px;font-size:15px;border:0;border-radius:8px;background:#0f172a;color:#fff;cursor:pointer">Επιβεβαίωση απεγγραφής</button>
</form>
<p style="font-size:12px;color:#94a3b8;margin-top:32px">ITDEV · itdev.gr</p>
</div></body></html>`);
}

async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const lead = String(req.query.lead ?? '');
  const token = String(req.query.token ?? '');
  if (!UUID_RE.test(lead) || !UUID_RE.test(token)) {
    page(res, 400, 'Μη έγκυρος σύνδεσμος', 'Ο σύνδεσμος απεγγραφής δεν είναι έγκυρος.');
    return;
  }

  // Read-only GET: show the confirm button, do not mutate (prefetcher-safe).
  if (req.method !== 'POST') {
    confirmPage(res, lead, token);
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

export default withSentry('unsubscribe', handler);
