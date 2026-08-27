import { withSentry, captureApiError } from './_sentry.js';
// Runtime imports are deferred (same pattern as contract-pdf.ts) so a failed
// dependency surfaces as a 500 with a real stack instead of Vercel's opaque
// FUNCTION_INVOCATION_FAILED at module-load time.
import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = { maxDuration: 60 };

async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    await runHandler(req, res);
  } catch (err) {
    const e = err as Error;
    console.error('report-pdf handler error:', e);
    captureApiError('report-pdf', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'internal_error' });
    }
  }
}

type LedgerRow = {
  direction: 'in' | 'out';
  event_date: string;
  period: string;
  status: string;
  amount_net: number | string | null;
  vat_amount: number | string | null;
  amount_gross: number | string | null;
  category_key: string | null;
  counterparty: string | null;
  source_id: string;
  deal_code: string | null;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

async function runHandler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const from = typeof req.query.from === 'string' ? req.query.from : null;
  const to = typeof req.query.to === 'string' ? req.query.to : null;
  const includePending = req.query.includePending === 'true';
  const auth = req.headers.authorization ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';

  if (!from || !to || !ISO_DATE.test(from) || !ISO_DATE.test(to) || !token) {
    res.status(400).json({ error: 'missing or invalid from/to/token' });
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
  const { renderReportHtml } = await import('./_report-pdf-template.js');

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

  // EXPLICIT admin gate — deliberately NOT inherited from RLS. deal_payments
  // is readable by several non-admin roles (audit E26), and a non-admin
  // inheriting RLS would get a silently half-empty document (income arm
  // populated, expenses denied) instead of a denial. Full financials are
  // admin-only, so the check is made here, against the service-role client.
  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: profile } = await admin
    .from('profiles')
    .select('is_admin')
    .eq('user_id', user.id)
    .single();
  if (!profile?.is_admin) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }

  // Complete, paged fetch — the ledger is past PostgREST's 1000-row page and
  // an unranged select silently truncates (audit E22). Deterministic order
  // (event_date, source_id) so pages never skip or duplicate rows.
  const PAGE = 1000;
  const rows: LedgerRow[] = [];
  for (let page = 0; ; page++) {
    const { data, error } = await admin
      .from('accounting_ledger_v')
      .select(
        'direction, event_date, period, status, amount_net, vat_amount, amount_gross, category_key, counterparty, source_id, deal_code',
      )
      .gte('event_date', from)
      .lte('event_date', to)
      .order('event_date', { ascending: true })
      .order('source_id', { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    rows.push(...((data ?? []) as LedgerRow[]));
    if ((data ?? []).length < PAGE) break;
  }

  // Same counting rule as the Report page and pl_summary_for_range:
  // income = paid only, always; expenses = paid + (opt-in) pending.
  const counted = rows.filter((r) =>
    r.direction === 'in'
      ? r.status === 'paid'
      : r.status === 'paid' || (includePending && r.status === 'pending'),
  );

  // Cent-safe accumulation: sum integers, divide once at the end.
  const cents = (v: number | string | null) => Math.round(Number(v ?? 0) * 100);
  type Acc = { net: number; vat: number; gross: number };
  const add = (a: Acc, r: LedgerRow) => {
    a.net += cents(r.amount_net);
    a.vat += cents(r.vat_amount);
    a.gross += cents(r.amount_gross);
  };

  const byPeriod = new Map<
    string,
    { income: LedgerRow[]; expense: LedgerRow[]; inAcc: Acc; outAcc: Acc }
  >();
  const totalIn: Acc = { net: 0, vat: 0, gross: 0 };
  const totalOut: Acc = { net: 0, vat: 0, gross: 0 };
  for (const r of counted) {
    let m = byPeriod.get(r.period);
    if (!m) {
      m = { income: [], expense: [], inAcc: { net: 0, vat: 0, gross: 0 }, outAcc: { net: 0, vat: 0, gross: 0 } };
      byPeriod.set(r.period, m);
    }
    if (r.direction === 'in') {
      m.income.push(r);
      add(m.inAcc, r);
      add(totalIn, r);
    } else {
      m.expense.push(r);
      add(m.outAcc, r);
      add(totalOut, r);
    }
  }

  const toLine = (r: LedgerRow) => ({
    date: r.event_date,
    counterparty: r.counterparty,
    detail:
      r.direction === 'in'
        ? [r.deal_code, r.category_key].filter(Boolean).join(' · ') || null
        : r.category_key,
    status: r.status,
    net: cents(r.amount_net) / 100,
    vat: cents(r.vat_amount) / 100,
    gross: cents(r.amount_gross) / 100,
  });

  const months = [...byPeriod.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, m]) => ({
      period,
      incomeRows: m.income.map(toLine),
      expenseRows: m.expense.map(toLine),
      incomeNet: m.inAcc.net / 100,
      incomeVat: m.inAcc.vat / 100,
      incomeGross: m.inAcc.gross / 100,
      expenseNet: m.outAcc.net / 100,
      expenseVat: m.outAcc.vat / 100,
      expenseGross: m.outAcc.gross / 100,
    }));

  const html = renderReportHtml({
    from,
    to,
    includePendingExpenses: includePending,
    generatedAt: new Date().toISOString(),
    months,
    totalIncomeNet: totalIn.net / 100,
    totalIncomeVat: totalIn.vat / 100,
    totalIncomeGross: totalIn.gross / 100,
    totalExpenseNet: totalOut.net / 100,
    totalExpenseVat: totalOut.vat / 100,
    totalExpenseGross: totalOut.gross / 100,
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
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    pdf = await page.pdf({
      format: 'a4',
      margin: { top: '10mm', right: '0mm', bottom: '12mm', left: '0mm' },
      printBackground: true,
    });
  } finally {
    await browser.close();
  }

  // Streamed straight back — financials are never written to storage.
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="accounting-report-${from}-to-${to}.pdf"`);
  res.status(200).send(Buffer.from(pdf));
}

export default withSentry('report-pdf', handler);
