import { createClient } from '@supabase/supabase-js';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { renderOfferHtml, type OfferItem, type OfferTotals } from './_pdf-template';

export const config = { maxDuration: 60 };

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const offerId = url.searchParams.get('id');
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!offerId || !token) {
    return new Response(JSON.stringify({ error: 'missing offer id or token' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(JSON.stringify({ error: 'server not configured' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }

  // Service-role client used for storage + DB updates.
  const admin = createClient(supabaseUrl, serviceRoleKey);

  // User client for permission verification — RLS-safe read of the offer.
  const userClient = createClient(supabaseUrl, serviceRoleKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  const { data: { user } } = await userClient.auth.getUser(token);
  if (!user) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }

  const { data: offer, error } = await userClient
    .from('offers').select('*').eq('id', offerId).single();
  if (error || !offer) {
    return new Response(JSON.stringify({ error: error?.message ?? 'not found' }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    });
  }

  let clientName = 'Client';
  let companyName: string | null = null;
  let email: string | null = null;
  if (offer.client_id) {
    const { data: client } = await userClient
      .from('clients').select('name, email, contact_first_name, contact_last_name')
      .eq('id', offer.client_id).single();
    if (client) {
      const contact = [client.contact_first_name, client.contact_last_name].filter(Boolean).join(' ');
      clientName = contact || client.name || 'Client';
      companyName = client.name ?? null;
      email = client.email ?? null;
    }
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
    items: (offer.items as unknown as OfferItem[]) ?? [],
    totals: (offer.totals as unknown as OfferTotals) ?? {
      subtotal: 0, discountAmount: 0, taxable: 0, vatAmount: 0, total: 0,
    },
    createdAt: offer.created_at,
  });

  // Headless Chromium via @sparticuz/chromium for the Vercel runtime.
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  });
  let pdf: Uint8Array;
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    pdf = await page.pdf({ format: 'A4', printBackground: true });
  } finally {
    await browser.close();
  }

  // Use the service-role client to write to storage (RLS bypass).
  const path = `offers/${offer.id}.pdf`;
  const { error: uploadErr } = await admin.storage
    .from('offer-pdfs')
    .upload(path, pdf, { contentType: 'application/pdf', upsert: true });
  if (uploadErr) {
    return new Response(JSON.stringify({ error: 'upload failed: ' + uploadErr.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }

  await admin.from('offers').update({ pdf_path: path }).eq('id', offer.id);

  const { data: signed } = await admin.storage
    .from('offer-pdfs').createSignedUrl(path, 60 * 5);
  return new Response(JSON.stringify({ url: signed?.signedUrl ?? null }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
