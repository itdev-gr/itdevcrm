import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { renderOfferHtml, type OfferItem, type OfferTotals } from './_pdf-template';

export const config = { maxDuration: 60 };

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
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

  const browser = await puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: true,
  });
  let pdf: Uint8Array;
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    pdf = await page.pdf({ format: 'A4', printBackground: true });
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
