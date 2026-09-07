import { withSentry, captureApiError } from './_sentry.js';
// Public opt-out endpoint linked from marketing campaign emails only:
//   GET  /api/campaign-unsubscribe?r=<recipient uuid>&t=<unsubscribe_token>  → confirm page
//   POST (same URL, from the confirm form)                                   → performs opt-out
//
// This is a DELIBERATELY SEPARATE file from api/unsubscribe.ts, which serves the
// automated lead emails and sets `leads.email_opt_out`. The marketing module must
// have zero relation to the automated email system: if a campaign unsubscribe set
// `leads.email_opt_out`, it would silently switch off that lead's automated sales
// sequences too. So this file NEVER writes to `leads` or `clients` — it only ever
// touches `email_campaign_recipients` and calls the `suppress_email` RPC, which
// suppresses future sends by address, independently of any lead/client record.
//
// The token is a per-recipient random uuid, so the link only works for the
// recipient it was sent to. The GET is read-only on purpose: link prefetchers /
// mail-security scanners auto-fetch the URL and must NOT unsubscribe anyone; the
// mutation only happens on the explicit POST. Always renders HTML (no JSON).
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Pure parse/validate of the query string. Both `r` (recipient row id) and `t`
 * (unsubscribe token) must be present as single string values and be UUIDs —
 * `?r=a&r=b` arrives as an array from Vercel's query parser and must be
 * rejected outright rather than silently resolved to either value.
 */
export function parseCampaignUnsubscribe(
  query: Record<string, unknown>,
): { recipient: string; token: string } | null {
  const r = query.r;
  const t = query.t;
  if (typeof r !== 'string' || typeof t !== 'string') return null;
  if (!UUID_RE.test(r) || !UUID_RE.test(t)) return null;
  return { recipient: r, token: t };
}

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
// recipient/token are validated UUIDs, so they are safe to interpolate verbatim.
function confirmPage(res: VercelResponse, recipient: string, token: string): void {
  const action = `/api/campaign-unsubscribe?r=${recipient}&t=${token}`;
  res
    .status(200)
    .setHeader('Content-Type', 'text/html; charset=utf-8')
    .send(`<!doctype html><html lang="el"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Απεγγραφή</title></head>
<body style="font-family:Arial,sans-serif;display:flex;justify-content:center;padding:64px 16px;background:#f8fafc;color:#0f172a">
<div style="max-width:420px;text-align:center">
<h1 style="font-size:20px">Απεγγραφή από ενημερωτικά email</h1>
<p style="color:#475569">Πατήστε το κουμπί για να επιβεβαιώσετε ότι δεν θέλετε να λαμβάνετε πλέον ενημερωτικά (marketing) email από εμάς.</p>
<form method="POST" action="${action}">
<button type="submit" style="margin-top:16px;padding:10px 20px;font-size:15px;border:0;border-radius:8px;background:#0f172a;color:#fff;cursor:pointer">Επιβεβαίωση απεγγραφής</button>
</form>
<p style="font-size:12px;color:#94a3b8;margin-top:32px">ITDEV · itdev.gr</p>
</div></body></html>`);
}

async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const parsed = parseCampaignUnsubscribe(req.query);
  if (!parsed) {
    page(res, 400, 'Μη έγκυρος σύνδεσμος', 'Ο σύνδεσμος απεγγραφής δεν είναι έγκυρος.');
    return;
  }
  const { recipient, token } = parsed;

  // Read-only GET: show the confirm button, do not mutate (prefetcher-safe).
  if (req.method !== 'POST') {
    confirmPage(res, recipient, token);
    return;
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    page(res, 500, 'Κάτι πήγε στραβά', 'Παρακαλούμε δοκιμάστε ξανά αργότερα.');
    return;
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);

  // Only ever touches email_campaign_recipients — never leads/clients.
  const { data, error } = await admin
    .from('email_campaign_recipients')
    .update({ unsubscribed_at: new Date().toISOString() })
    .eq('id', recipient)
    .eq('unsubscribe_token', token)
    .select('email_lower, campaign_id');

  const row = data?.[0];
  if (error || !row) {
    page(res, 400, 'Μη έγκυρος σύνδεσμος', 'Ο σύνδεσμος απεγγραφής δεν είναι έγκυρος ή έχει λήξει.');
    return;
  }

  // The recipient row is already marked unsubscribed at this point, so the
  // success page below is truthful regardless of what happens next. Suppress
  // the address globally too (so future campaigns skip it), but if that RPC
  // fails, don't surface an error to the user — log and move on.
  try {
    const { error: suppressError } = await admin.rpc('suppress_email', {
      p_email: row.email_lower,
      p_reason: 'unsubscribed',
      p_source: `campaign:${row.campaign_id}`,
    });
    if (suppressError) {
      captureApiError('campaign-unsubscribe', suppressError);
    }
  } catch (err) {
    captureApiError('campaign-unsubscribe', err);
  }

  page(
    res,
    200,
    'Απεγγραφήκατε με επιτυχία',
    'Δεν θα λαμβάνετε πλέον ενημερωτικά (marketing) email από εμάς.',
  );
}

export default withSentry('campaign-unsubscribe', handler);
