import { withSentry } from './_sentry.js';
// api/offer-view.ts
// Public, token-gated offer PDF viewer — the link clients receive in offer
// emails (https://www.itdevcrm.com/o/<token>, rewritten here by vercel.json).
// The anonymous client never touches the offers table or the offer-pdfs bucket:
// the token is looked up with the service-role client and the PDF bytes are
// streamed inline, so no forwardable signed storage URL ever leaves the server.
// Same security model as api/client-intake.ts (shape-guard → rate limit →
// service-role lookup); GET only, same-origin, no CORS.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { rateLimit } from './_rate-limit.js';
import { isSuspectedBotUa } from './_bot-ua.js';

const TOKEN_RE = /^[0-9a-f-]{36}$/i;
const RATE_LIMIT = { limit: 30, windowMs: 60_000 };

/** First value of `x-forwarded-for` (the real client on Vercel), else a fallback. */
function firstForwardedFor(xff: string | string[] | undefined): string {
  const raw = Array.isArray(xff) ? xff[0] : xff;
  const first = (raw ?? '').split(',')[0]?.trim();
  return first && first.length > 0 ? first : 'unknown';
}

// Friendly Greek fallback page (offer not found / PDF not generated yet).
// Inline HTML like api/unsubscribe.ts — this URL is opened by end clients.
function fallbackPage(res: VercelResponse, status: number, message: string): void {
  res.status(status).setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!doctype html><html lang="el"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>IT DEV — Προσφορά</title></head>
<body style="font-family:Arial,Helvetica,sans-serif;background:#f6f7f9;margin:0;padding:40px 16px">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;box-shadow:0 1px 4px rgba(0,0,0,.08)">
<h1 style="font-size:18px;margin:0 0 12px">IT DEV</h1>
<p style="font-size:15px;color:#333;margin:0">${message}</p>
</div></body></html>`);
}

async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  const limited = rateLimit(firstForwardedFor(req.headers['x-forwarded-for']), RATE_LIMIT);
  if (!limited.ok) {
    res.status(429).setHeader('Retry-After', String(Math.ceil(limited.retryAfterMs / 1000)));
    res.json({ error: 'rate_limited' });
    return;
  }

  const token = typeof req.query.t === 'string' ? req.query.t : '';
  if (!TOKEN_RE.test(token)) {
    fallbackPage(res, 404, 'Η προσφορά δεν βρέθηκε. Ελέγξτε τον σύνδεσμο ή επικοινωνήστε μαζί μας.');
    return;
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    res.status(500).json({ error: 'server not configured' });
    return;
  }
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const { data: offer, error } = await admin
    .from('offers')
    .select('id, pdf_path, pdf_generated_at, offer_number, items')
    .eq('public_token', token)
    .maybeSingle();
  if (error) throw new Error(`offer-view lookup: ${error.message}`);
  if (!offer) {
    fallbackPage(res, 404, 'Η προσφορά δεν βρέθηκε. Ελέγξτε τον σύνδεσμο ή επικοινωνήστε μαζί μας.');
    return;
  }

  // Record the open (fire-and-forget — never blocks or fails the PDF). The
  // offer_views AFTER INSERT trigger posts the «άνοιξε την προσφορά» comment
  // on the lead/deal card; scanner-bot UAs are recorded but never surfaced.
  const userAgent = Array.isArray(req.headers['user-agent'])
    ? req.headers['user-agent'][0]
    : req.headers['user-agent'];
  void admin
    .from('offer_views')
    .insert({
      offer_id: offer.id,
      ip: firstForwardedFor(req.headers['x-forwarded-for']),
      user_agent: (userAgent ?? '').slice(0, 500) || null,
      suspected_bot: isSuspectedBotUa(userAgent),
    })
    .then(({ error: viewErr }) => {
      if (viewErr) console.error('offer-view: view insert failed:', viewErr.message);
    });
  // Self-healing: regenerate when the stored PDF is missing or predates the
  // latest edit of a service-description template — so links sent before a
  // copy change (or before generation succeeded at all) serve a fresh PDF on
  // first open. Regeneration only runs when actually stale, so repeat opens
  // stream the stored object.
  const { generateOfferPdf, isPdfStale } = await import('./_offer-pdf-core.js');
  let bytes: Buffer | null = null;
  if (await isPdfStale(admin, offer)) {
    const result = await generateOfferPdf(admin, admin, offer.id);
    if (result.ok) bytes = Buffer.from(result.pdf);
    else console.error('offer-view: regeneration failed:', result.error);
  }
  if (!bytes && offer.pdf_path) {
    const { data: blob, error: dlErr } = await admin.storage.from('offer-pdfs').download(offer.pdf_path);
    if (!dlErr && blob) bytes = Buffer.from(await blob.arrayBuffer());
  }
  if (!bytes) {
    fallbackPage(res, 200, 'Η προσφορά δεν είναι διαθέσιμη αυτή τη στιγμή. Παρακαλούμε δοκιμάστε ξανά σε λίγο ή επικοινωνήστε μαζί μας.');
    return;
  }

  const filename = `${(offer.offer_number ?? 'offer').replace(/[^A-Za-z0-9._-]/g, '_')}.pdf`;
  res.status(200)
    .setHeader('Content-Type', 'application/pdf')
    .setHeader('Content-Disposition', `inline; filename="${filename}"`)
    .setHeader('Cache-Control', 'private, no-store')
    .send(bytes);
}

export default withSentry('offer-view', handler);
