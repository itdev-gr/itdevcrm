// Shared offer-PDF generation core, used by:
//   - api/offer-pdf.ts   (staff, Bearer-JWT auth, RLS-scoped reads)
//   - api/offer-view.ts  (public link, token-gated, service-role reads —
//     regenerates on demand when the stored PDF is missing or stale)
// Runtime imports are deferred inside generateOfferPdf so a failed dependency
// surfaces as a handled error instead of crashing cold start (same rationale
// as offer-pdf.ts).
import { resolveOfferRecipient, type RecipientSource } from './_recipient.js';
import { createClient } from '@supabase/supabase-js';

// Factory so `Db` is the client shape a no-generic createClient() call
// produces (bare ReturnType<typeof createClient> resolves to generic defaults
// and won't accept the real value — see api/client-intake.ts).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function makeClient(url: string, key: string) {
  return createClient(url, key);
}
export type Db = ReturnType<typeof makeClient>;

export type OfferItem = {
  category: string;
  itemId: string;
  label: string;
  description: string;
  unitPrice: number;
  qty: number;
  lineTotal: number;
  subpackages?: { label: string; price: number }[];
};

type OfferTotals = {
  subtotal: number;
  discountAmount: number;
  taxable: number;
  vatAmount: number;
  total: number;
};

/** Template bodies are meant as plain prose. `{{vars}}` are NOT interpolated
 *  in the PDF, so strip any an admin pastes in rather than printing them. */
export function sanitizeServiceBlock(body: string): string {
  return body.replace(/\{\{\s*\w+\s*\}\}/g, '').trim();
}

/** category → sanitized description text, dropping empty/whitespace bodies. */
export function buildServiceBlocks(tpls: { key: string; body: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const tpl of tpls) {
    const text = sanitizeServiceBlock(tpl.body);
    if (text) out[tpl.key.replace(/^offer_svc_/, '')] = text;
  }
  return out;
}

export type OfferPdfResult =
  | { ok: true; path: string; bytes: number; pdf: Uint8Array }
  | { ok: false; status: number; error: string };

/**
 * Render + store the offer PDF: reads the offer through `readClient` (the
 * RLS-scoped user client for staff calls, `admin` for the public token path),
 * writes storage + pdf_path/pdf_generated_at through `admin`.
 */
export async function generateOfferPdf(readClient: Db, admin: Db, offerId: string): Promise<OfferPdfResult> {
  const { renderOfferHtml } = await import('./_pdf-template.js');

  const { data: offer, error } = await readClient
    .from('offers').select('*').eq('id', offerId).single();
  if (error || !offer) {
    return { ok: false, status: 404, error: error?.message ?? 'not found' };
  }

  // Resolve the recipient printed at the top of the PDF. Prefer a linked
  // client; otherwise fall back to the originating lead.
  let client: RecipientSource = null;
  if (offer.client_id) {
    const { data } = await readClient
      .from('clients').select('name, email, contact_first_name, contact_last_name')
      .eq('id', offer.client_id).single();
    client = data;
  }
  let lead: RecipientSource = null;
  if (!client && offer.lead_id) {
    const { data } = await readClient
      .from('leads').select('company_name, email, contact_first_name, contact_last_name')
      .eq('id', offer.lead_id).single();
    lead = data;
  }
  const { clientName, companyName, email } = resolveOfferRecipient(client, lead);

  // Service descriptions (admin-edited offer_svc_* template bodies) render
  // inside the PDF's «Δυνατότητες - Υπηρεσίες» section.
  const items = (offer.items as unknown as OfferItem[]) ?? [];
  const categories = [...new Set(items.map((it) => it.category).filter(Boolean))];
  let serviceBlocks: Record<string, string> = {};
  if (categories.length > 0) {
    const { data: tpls } = await admin
      .from('email_templates')
      .select('key, body')
      .in('key', categories.map((c) => `offer_svc_${c}`));
    serviceBlocks = buildServiceBlocks((tpls ?? []) as { key: string; body: string }[]);
  }

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
    items,
    totals: (offer.totals as unknown as OfferTotals) ?? {
      subtotal: 0, discountAmount: 0, taxable: 0, vatAmount: 0, total: 0,
    },
    createdAt: offer.created_at,
    serviceBlocks,
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

  const path = `offers/${offer.id}.pdf`;
  const { error: uploadErr } = await admin.storage
    .from('offer-pdfs')
    .upload(path, pdf, { contentType: 'application/pdf', upsert: true });
  if (uploadErr) {
    return { ok: false, status: 500, error: 'upload failed: ' + uploadErr.message };
  }

  await admin.from('offers')
    .update({ pdf_path: path, pdf_generated_at: new Date().toISOString() })
    .eq('id', offer.id);

  return { ok: true, path, bytes: pdf.length, pdf };
}

/**
 * Is the stored PDF stale? True when it was never generated, predates the
 * pdf_generated_at column, or predates the latest edit of any offer_svc_*
 * template used by this offer's categories.
 */
export async function isPdfStale(
  admin: Db,
  offer: { pdf_path: string | null; pdf_generated_at: string | null; items: unknown },
): Promise<boolean> {
  if (!offer.pdf_path || !offer.pdf_generated_at) return true;
  const items = (offer.items as OfferItem[] | null) ?? [];
  const categories = [...new Set(items.map((it) => it.category).filter(Boolean))];
  if (categories.length === 0) return false;
  const { data } = await admin
    .from('email_templates')
    .select('updated_at')
    .in('key', categories.map((c) => `offer_svc_${c}`))
    .order('updated_at', { ascending: false })
    .limit(1);
  const latest = (data as { updated_at: string }[] | null)?.[0]?.updated_at;
  return !!latest && new Date(latest) > new Date(offer.pdf_generated_at);
}
