import { withSentry, captureApiError } from './_sentry.js';
// All runtime imports are deferred until inside the handler so a failed
// dependency surfaces as a 500 with a real stack instead of Vercel's
// opaque FUNCTION_INVOCATION_FAILED at module-load time.
import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = { maxDuration: 60 };

async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    await runHandler(req, res);
  } catch (err) {
    const e = err as Error;
    console.error('contract-pdf handler error:', e);
    captureApiError('contract-pdf', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'internal_error' });
    }
  }
}

async function runHandler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const contractId = typeof req.query.id === 'string' ? req.query.id : null;
  const auth = req.headers.authorization ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';

  if (!contractId || !token) {
    res.status(400).json({ error: 'missing contract id or token' });
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
  const { renderContractHtml } = await import('./_contract-pdf-template.js');

  // Service-role client used for storage + DB updates.
  const admin = createClient(supabaseUrl, serviceRoleKey);

  // User client for permission verification — RLS-safe read of the contract.
  // Uses the ANON key (not service_role): if the Authorization header is ever
  // dropped, RLS denies the read rather than silently granting full
  // service-role access. Privileged storage/DB writes go through `admin`.
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  const {
    data: { user },
  } = await userClient.auth.getUser(token);
  if (!user) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const { data: contract, error } = await userClient
    .from('contracts')
    .select('*')
    .eq('id', contractId)
    .single();
  if (error || !contract) {
    res.status(404).json({ error: error?.message ?? 'not found' });
    return;
  }

  // Party header: contracts carry either a client or a lead (RLS-safe reads —
  // a denied read renders the header with nulls, same as before).
  type PartyHeader = {
    name: string | null;
    contact_first_name: string | null;
    contact_last_name: string | null;
    email: string | null;
    phone: string | null;
    vat_number: string | null;
    address: string | null;
    city: string | null;
  };
  let party: PartyHeader | null = null;
  if (contract.client_id) {
    const { data: client } = await userClient
      .from('clients')
      .select('name, email, phone, vat_number, address, city, contact_first_name, contact_last_name')
      .eq('id', contract.client_id)
      .single();
    party = client;
  } else if (contract.lead_id) {
    const { data: lead } = await userClient
      .from('leads')
      .select('title, company_name, email, phone, vat_number, address, contact_first_name, contact_last_name')
      .eq('id', contract.lead_id)
      .single();
    party = lead
      ? { ...lead, name: lead.company_name ?? lead.title, city: null }
      : null;
  }
  const contactName = party
    ? [party.contact_first_name, party.contact_last_name].filter(Boolean).join(' ')
    : '';

  const html = renderContractHtml({
    contractNumber: contract.contract_number,
    title: contract.title,
    body: contract.body,
    clientName: party?.name ?? null,
    contactName: contactName || null,
    email: party?.email ?? null,
    phone: party?.phone ?? null,
    vatNumber: party?.vat_number ?? null,
    address: [party?.address, party?.city].filter(Boolean).join(', ') || null,
    createdAt: contract.created_at,
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
    // short contracts still come out at A4 size.
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

  const path = `contracts/${contract.id}.pdf`;
  const { error: uploadErr } = await admin.storage
    .from('contract-pdfs')
    .upload(path, pdf, { contentType: 'application/pdf', upsert: true });
  if (uploadErr) {
    res.status(500).json({ error: 'upload failed: ' + uploadErr.message });
    return;
  }

  await admin.from('contracts').update({ pdf_path: path }).eq('id', contract.id);

  const { data: signed } = await admin.storage.from('contract-pdfs').createSignedUrl(path, 60 * 5);
  res.status(200).json({ url: signed?.signedUrl ?? null });
}

export default withSentry('contract-pdf', handler);
