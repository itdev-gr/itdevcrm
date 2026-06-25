import { withSentry, captureApiError } from './_sentry.js';
// All runtime imports are deferred until inside the handler so a failed
// dependency surfaces as a 500 with a real stack instead of Vercel's
// opaque FUNCTION_INVOCATION_FAILED at module-load time.
import type { VercelRequest, VercelResponse } from '@vercel/node';

type OfferItem = {
  category: string;
  itemId: string;
  label: string;
  description: string;
  unitPrice: number;
  qty: number;
  lineTotal: number;
};

type OfferTotals = {
  subtotal: number;
  discountAmount: number;
  taxable: number;
  vatAmount: number;
  total: number;
};

export const config = { maxDuration: 60 };

type RecipientSource = {
  // clients use `name`; leads use `company_name` — accept either.
  name?: string | null;
  company_name?: string | null;
  email: string | null;
  contact_first_name: string | null;
  contact_last_name: string | null;
} | null;

type OfferRecipient = {
  clientName: string;
  companyName: string | null;
  email: string | null;
};

/**
 * Resolve the name/company/email printed at the top of the offer PDF.
 * Prefer a linked client; otherwise fall back to the originating lead — most
 * offers are drafted from a lead that has not been converted to a client yet,
 * so without this fallback the PDF header printed the literal word "Client".
 */
export function resolveOfferRecipient(
  client: RecipientSource,
  lead: RecipientSource,
): OfferRecipient {
  const source = client ?? lead;
  if (!source) return { clientName: 'Client', companyName: null, email: null };
  const contact = [source.contact_first_name, source.contact_last_name]
    .filter(Boolean)
    .join(' ');
  const company = source.name ?? source.company_name ?? null;
  return {
    clientName: contact || company || 'Client',
    companyName: company,
    email: source.email ?? null,
  };
}

async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    await runHandler(req, res);
  } catch (err) {
    const e = err as Error;
    console.error('offer-pdf handler error:', e);
    captureApiError('offer-pdf', err);
    if (!res.headersSent) {
      res.status(500).json({
        error: e?.message ?? 'unknown error',
        stack: e?.stack?.split('\n').slice(0, 8).join('\n') ?? null,
      });
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
  if (!supabaseUrl || !serviceRoleKey) {
    res.status(500).json({ error: 'server not configured' });
    return;
  }

  // Defer the supabase + template imports so a failed module load lands
  // inside the outer handler's try/catch rather than crashing cold start.
  const { createClient } = await import('@supabase/supabase-js');
  const { renderOfferHtml } = await import('./_pdf-template.js');

  // Service-role client used for storage + DB updates.
  const admin = createClient(supabaseUrl, serviceRoleKey);

  // User client for permission verification — RLS-safe read of the offer.
  const userClient = createClient(supabaseUrl, serviceRoleKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  const { data: { user } } = await userClient.auth.getUser(token);
  if (!user) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const { data: offer, error } = await userClient
    .from('offers').select('*').eq('id', offerId).single();
  if (error || !offer) {
    res.status(404).json({ error: error?.message ?? 'not found' });
    return;
  }

  // Resolve the recipient printed at the top of the PDF. Prefer a linked
  // client; otherwise fall back to the originating lead — most offers are
  // drafted from an un-converted lead (no client_id), and without this the
  // header printed the literal word "Client".
  let client: RecipientSource = null;
  if (offer.client_id) {
    const { data } = await userClient
      .from('clients').select('name, email, contact_first_name, contact_last_name')
      .eq('id', offer.client_id).single();
    client = data;
  }
  let lead: RecipientSource = null;
  if (!client && offer.lead_id) {
    const { data } = await userClient
      .from('leads').select('company_name, email, contact_first_name, contact_last_name')
      .eq('id', offer.lead_id).single();
    lead = data;
  }
  const { clientName, companyName, email } = resolveOfferRecipient(client, lead);

  const html = renderOfferHtml({
    offerId: offer.id,
    offerNumber: offer.offer_number,
    clientName,
    companyName,
    email,
    currency: offer.currency,
    vatPercent: Number(offer.vat_percent),
    validityDays: offer.validity_days,
    notes: offer.notes,
    items: (offer.items as unknown as OfferItem[]) ?? [],
    totals: (offer.totals as unknown as OfferTotals) ?? {
      subtotal: 0, discountAmount: 0, taxable: 0, vatAmount: 0, total: 0,
    },
    createdAt: offer.created_at,
  });

  const puppeteer = await import('puppeteer-core');
  const chromium = await import('@sparticuz/chromium');
  const executablePath = await chromium.default.executablePath();
  const browser = await puppeteer.default.launch({
    args: chromium.default.args,
    defaultViewport: chromium.default.defaultViewport,
    executablePath,
    headless: chromium.default.headless as boolean | 'new',
  });
  let pdf: Uint8Array;
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    // Render as a single tall page (no page breaks). Measure the rendered
    // body height in px and convert to mm via the 96 DPI ratio
    // (1 mm = 3.779527559 px). 297 mm = A4 height — use as a floor so
    // tiny offers still come out at A4 size.
    const bodyHeight = await page.evaluate(() => document.body.scrollHeight);
    const pageHeightMm = Math.max(bodyHeight / 3.779527559, 297);
    pdf = await page.pdf({
      width: '210mm',
      height: `${pageHeightMm}mm`,
      margin: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' },
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
    });
  } finally {
    await browser.close();
  }

  const path = `offers/${offer.id}.pdf`;
  const { error: uploadErr } = await admin.storage
    .from('offer-pdfs')
    .upload(path, pdf, { contentType: 'application/pdf', upsert: true });
  if (uploadErr) {
    res.status(500).json({ error: 'upload failed: ' + uploadErr.message });
    return;
  }

  await admin.from('offers').update({ pdf_path: path }).eq('id', offer.id);

  const { data: signed } = await admin.storage
    .from('offer-pdfs').createSignedUrl(path, 60 * 5);
  res.status(200).json({ url: signed?.signedUrl ?? null });
}

export default withSentry('offer-pdf', handler);
