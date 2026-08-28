import { withSentry, captureApiError } from './_sentry.js';
// Staff offer-PDF endpoint: Bearer-JWT auth, RLS-scoped offer read, then the
// shared generation core (api/_offer-pdf-core.ts) renders + stores the PDF and
// we hand back a short-lived signed URL. The public no-login variant lives in
// api/offer-view.ts.
// Runtime imports are deferred until inside the handler so a failed dependency
// surfaces as a 500 with a real stack instead of Vercel's opaque
// FUNCTION_INVOCATION_FAILED at module-load time.
import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = { maxDuration: 60 };

async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    await runHandler(req, res);
  } catch (err) {
    const e = err as Error;
    console.error('offer-pdf handler error:', e);
    captureApiError('offer-pdf', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'internal_error' });
    }
  }
}

async function runHandler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const offerId = typeof req.query.id === 'string' ? req.query.id : null;
  const auth = req.headers.authorization ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';

  if (!offerId || !token) {
    res.status(400).json({ error: 'missing offer id or token' });
    return;
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    res.status(500).json({ error: 'server not configured' });
    return;
  }

  const { createClient } = await import('@supabase/supabase-js');
  const { generateOfferPdf } = await import('./_offer-pdf-core.js');

  // Service-role client used for storage + DB updates.
  const admin = createClient(supabaseUrl, serviceRoleKey);

  // User client for permission verification — RLS-safe read of the offer.
  // Uses the ANON key (not service_role): if the Authorization header is ever
  // dropped, RLS denies the read rather than silently granting full
  // service-role access. Privileged storage/DB writes go through `admin`.
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  const { data: { user } } = await userClient.auth.getUser(token);
  if (!user) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const result = await generateOfferPdf(userClient, admin, offerId);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }

  const { data: signed } = await admin.storage
    .from('offer-pdfs').createSignedUrl(result.path, 60 * 5);
  res.status(200).json({ url: signed?.signedUrl ?? null, path: result.path, bytes: result.bytes });
}

export default withSentry('offer-pdf', handler);
