// Self-contained HTML template for the full-financials accounting report PDF.
// No @/ aliases, no src/lib imports — must run in Vercel serverless context.
// Same rendering path as contract/offer/proforma PDFs (headless Chromium with
// a Greek-capable webfont) — NOT jsPDF, which cannot render Greek glyphs
// (see docs/system-analysis/2026-08-27-expenses-reporting-audit.md, E28).

export type ReportLine = {
  date: string; // YYYY-MM-DD
  counterparty: string | null; // client or vendor
  detail: string | null; // deal code + service for income; category for expenses
  status: string;
  net: number;
  vat: number;
  gross: number;
};

export type ReportMonth = {
  period: string; // YYYY-MM
  incomeRows: ReportLine[];
  expenseRows: ReportLine[];
  incomeNet: number;
  incomeVat: number;
  incomeGross: number;
  expenseNet: number;
  expenseVat: number;
  expenseGross: number;
};

export type ReportPdfInput = {
  from: string;
  to: string;
  includePendingExpenses: boolean;
  generatedAt: string; // ISO
  months: ReportMonth[];
  totalIncomeNet: number;
  totalIncomeVat: number;
  totalIncomeGross: number;
  totalExpenseNet: number;
  totalExpenseVat: number;
  totalExpenseGross: number;
};

function escapeHtml(s: string | null | undefined): string {
  if (s === null || s === undefined) return '';
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return String(s).replace(/[&<>"']/g, (m) => map[m]);
}

function eur(n: number): string {
  return n.toLocaleString('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

function dmy(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function monthLabel(period: string): string {
  const names = [
    'Ιανουάριος', 'Φεβρουάριος', 'Μάρτιος', 'Απρίλιος', 'Μάιος', 'Ιούνιος',
    'Ιούλιος', 'Αύγουστος', 'Σεπτέμβριος', 'Οκτώβριος', 'Νοέμβριος', 'Δεκέμβριος',
  ];
  const [y, m] = period.split('-');
  return `${names[Number(m) - 1] ?? period} ${y}`;
}

function linesTable(title: string, rows: ReportLine[], totals: { net: number; vat: number; gross: number }): string {
  const body = rows
    .map(
      (r) => `<tr>
        <td>${dmy(r.date)}</td>
        <td>${escapeHtml(r.counterparty) || '—'}</td>
        <td>${escapeHtml(r.detail) || '—'}</td>
        <td class="st">${r.status === 'paid' ? 'Πληρωμένο' : 'Εκκρεμεί'}</td>
        <td class="num">${eur(r.net)}</td>
        <td class="num">${eur(r.vat)}</td>
        <td class="num">${eur(r.gross)}</td>
      </tr>`,
    )
    .join('');
  return `<table>
    <thead>
      <tr class="section"><th colspan="7">${escapeHtml(title)}</th></tr>
      <tr>
        <th>Ημ/νία</th><th>Συναλλασσόμενος</th><th>Στοιχεία</th><th>Κατάσταση</th>
        <th class="num">Καθαρό</th><th class="num">ΦΠΑ</th><th class="num">Μικτό</th>
      </tr>
    </thead>
    <tbody>${body || '<tr><td colspan="7" class="empty">Καμία εγγραφή</td></tr>'}</tbody>
    <tfoot>
      <tr class="subtotal">
        <td colspan="4">Σύνολο</td>
        <td class="num">${eur(totals.net)}</td>
        <td class="num">${eur(totals.vat)}</td>
        <td class="num">${eur(totals.gross)}</td>
      </tr>
    </tfoot>
  </table>`;
}

export function renderReportHtml(input: ReportPdfInput): string {
  const monthsHtml = input.months
    .map((m) => {
      const profitNet = m.incomeNet - m.expenseNet;
      const profitGross = m.incomeGross - m.expenseGross;
      return `<section class="month">
        <h2>${monthLabel(m.period)}</h2>
        ${linesTable('Έσοδα', m.incomeRows, { net: m.incomeNet, vat: m.incomeVat, gross: m.incomeGross })}
        ${linesTable('Έξοδα', m.expenseRows, { net: m.expenseNet, vat: m.expenseVat, gross: m.expenseGross })}
        <p class="month-profit">Καθαρό αποτέλεσμα μήνα: <strong>${eur(profitNet)}</strong>
          <span class="muted">(μικτή βάση: ${eur(profitGross)})</span></p>
      </section>`;
    })
    .join('');

  const totalProfitNet = input.totalIncomeNet - input.totalExpenseNet;
  const totalProfitGross = input.totalIncomeGross - input.totalExpenseGross;

  return `<!doctype html>
<html lang="el">
<head>
<meta charset="utf-8" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap&subset=greek" rel="stylesheet" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter', 'Helvetica Neue', Arial, sans-serif; font-size: 9.5px; color: #16232b; }
  .band { background: #0b2f41; color: #fff; padding: 18px 28px; }
  .band h1 { font-size: 17px; letter-spacing: 0.3px; }
  .band .sub { margin-top: 4px; font-size: 10px; color: #bcd4dd; }
  main { padding: 18px 28px 28px; }
  h2 { font-size: 12px; color: #0b2f41; border-bottom: 2px solid #118b8f; padding-bottom: 3px; margin: 18px 0 8px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  thead { display: table-header-group; }
  th { text-align: left; font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.4px; color: #5b707c; padding: 3px 6px; border-bottom: 1px solid #d7e1e6; }
  tr.section th { font-size: 10px; color: #0b2f41; text-transform: none; letter-spacing: 0; border-bottom: none; padding-top: 8px; }
  td { padding: 3px 6px; border-bottom: 1px solid #eef2f4; vertical-align: top; }
  td.num, th.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  td.st { white-space: nowrap; }
  td.empty { color: #8a9aa4; font-style: italic; }
  tr.subtotal td { font-weight: 700; border-top: 1.5px solid #0b2f41; border-bottom: none; }
  .month { page-break-inside: auto; }
  .month-profit { margin: 4px 0 14px; font-size: 10.5px; }
  .muted { color: #5b707c; }
  .grand { margin-top: 18px; border: 1.5px solid #0b2f41; border-radius: 6px; padding: 12px 16px; page-break-inside: avoid; }
  .grand h2 { border: none; margin: 0 0 8px; }
  .grand table td, .grand table th { border: none; padding: 2px 6px; }
  .footer { margin-top: 16px; font-size: 8px; color: #8a9aa4; }
</style>
</head>
<body>
  <div class="band">
    <h1>IT DEV — Οικονομική Αναφορά</h1>
    <div class="sub">Περίοδος: ${dmy(input.from)} – ${dmy(input.to)}
      ${input.includePendingExpenses ? '· περιλαμβάνονται εκκρεμή έξοδα' : '· μόνο πληρωμένες εγγραφές'}</div>
  </div>
  <main>
    ${monthsHtml || '<p class="muted">Καμία κίνηση στην επιλεγμένη περίοδο.</p>'}
    <div class="grand">
      <h2>Σύνολα περιόδου</h2>
      <table>
        <thead><tr><th></th><th class="num">Καθαρό</th><th class="num">ΦΠΑ</th><th class="num">Μικτό</th></tr></thead>
        <tbody>
          <tr><td>Έσοδα</td><td class="num">${eur(input.totalIncomeNet)}</td><td class="num">${eur(input.totalIncomeVat)}</td><td class="num">${eur(input.totalIncomeGross)}</td></tr>
          <tr><td>Έξοδα</td><td class="num">${eur(input.totalExpenseNet)}</td><td class="num">${eur(input.totalExpenseVat)}</td><td class="num">${eur(input.totalExpenseGross)}</td></tr>
          <tr class="subtotal"><td>Καθαρό κέρδος</td><td class="num">${eur(totalProfitNet)}</td>
            <td class="num">${eur(input.totalIncomeVat - input.totalExpenseVat)}</td>
            <td class="num">${eur(totalProfitGross)}</td></tr>
        </tbody>
      </table>
      <p class="muted" style="margin-top:6px">Το καθαρό κέρδος υπολογίζεται σε καθαρή βάση (ο ΦΠΑ αποδίδεται).</p>
    </div>
    <p class="footer">Δημιουργήθηκε ${new Date(input.generatedAt).toLocaleString('el-GR', { timeZone: 'Europe/Athens' })} · ITDEV CRM</p>
  </main>
</body>
</html>`;
}
