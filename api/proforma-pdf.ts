import { withSentry, captureApiError } from './_sentry.js';
// All runtime imports are deferred until inside the handler so a failed
// dependency surfaces as a 500 with a real stack instead of Vercel's
// opaque FUNCTION_INVOCATION_FAILED at module-load time.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { resolveOfferRecipient, type RecipientSource } from './_recipient.js';

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

async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    await runHandler(req, res);
  } catch (err) {
    const e = err as Error;
    console.error('proforma-pdf handler error:', e);
    captureApiError('proforma-pdf', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'internal_error' });
    }
  }
}

async function runHandler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const proFormaId = typeof req.query.id === 'string' ? req.query.id : null;
  const auth = req.headers.authorization ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';

  if (!proFormaId || !token) {
    res.status(400).json({ error: 'missing pro forma id or token' });
    return;
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    res.status(500).json({ error: 'server not configured' });
    return;
  }

  // Defer the supabase + template imports so a failed module load lands
  // inside the outer handler's try/catch rather than crashing cold start.
  const { createClient } = await import('@supabase/supabase-js');
  const { renderProFormaHtml } = await import('./_proforma-pdf-template.js');

  // Service-role client used for storage + DB updates.
  const admin = createClient(supabaseUrl, serviceRoleKey);

  // User client for permission verification — RLS-safe read of the pro forma.
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

  const { data: proForma, error } = await userClient
    .from('pro_formas').select('*').eq('id', proFormaId).single();
  if (error || !proForma) {
    res.status(404).json({ error: error?.message ?? 'not found' });
    return;
  }

  // Resolve the recipient printed at the top of the PDF. Prefer a linked
  // client; otherwise fall back to the originating lead.
  let client: RecipientSource = null;
  if (proForma.client_id) {
    const { data } = await userClient
      .from('clients').select('name, email, contact_first_name, contact_last_name')
      .eq('id', proForma.client_id).single();
    client = data;
  }
  let lead: RecipientSource = null;
  if (!client && proForma.lead_id) {
    const { data } = await userClient
      .from('leads').select('company_name, email, contact_first_name, contact_last_name')
      .eq('id', proForma.lead_id).single();
    lead = data;
  }
  const { clientName, companyName, email } = resolveOfferRecipient(client, lead);

  const html = renderProFormaHtml({
    proFormaId: proForma.id,
    proFormaNumber: proForma.pro_forma_number,
    clientName,
    companyName,
    email,
    currency: proForma.currency,
    vatPercent: Number(proForma.vat_percent),
    validityDays: proForma.validity_days,
    notes: proForma.notes,
    items: (proForma.items as unknown as OfferItem[]) ?? [],
    totals: (proForma.totals as unknown as OfferTotals) ?? {
      subtotal: 0, discountAmount: 0, taxable: 0, vatAmount: 0, total: 0,
    },
    createdAt: proForma.created_at,
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
    // tiny documents still come out at A4 size.
    // Wait for webfonts before measuring — Inter's metrics differ from the
    // fallback, and an undershot height spills the tail onto a nearly-blank
    // second page whose background paints as a huge dead area. Same fix as
    // contract-pdf (569c9dc): fonts.ready + an 8mm sub-pixel buffer.
    const bodyHeight = await page.evaluate(async () => {
      await document.fonts.ready;
      return document.body.scrollHeight;
    });
    const pageHeightMm = Math.max(bodyHeight / 3.779527559 + 8, 297);
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

  const path = `proformas/${proForma.id}.pdf`;
  const { error: uploadErr } = await admin.storage
    .from('proforma-pdfs')
    .upload(path, pdf, { contentType: 'application/pdf', upsert: true });
  if (uploadErr) {
    res.status(500).json({ error: 'upload failed: ' + uploadErr.message });
    return;
  }

  await admin.from('pro_formas').update({ pdf_path: path }).eq('id', proForma.id);

  const { data: signed } = await admin.storage
    .from('proforma-pdfs').createSignedUrl(path, 60 * 5);
  res.status(200).json({ url: signed?.signedUrl ?? null });
}

export default withSentry('proforma-pdf', handler);
