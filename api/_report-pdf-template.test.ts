import { describe, it, expect } from 'vitest';
import { renderReportHtml, type ReportPdfInput } from './_report-pdf-template';

function input(overrides: Partial<ReportPdfInput> = {}): ReportPdfInput {
  return {
    from: '2026-08-01',
    to: '2026-08-31',
    includePendingExpenses: false,
    generatedAt: '2026-08-27T12:00:00Z',
    months: [
      {
        period: '2026-08',
        incomeRows: [
          {
            date: '2026-08-05',
            counterparty: 'ΖΗΝΑ BEAUTY SALON <script>',
            detail: '000123 · local_seo',
            status: 'paid',
            net: 200,
            vat: 48,
            gross: 248,
          },
        ],
        expenseRows: [
          {
            date: '2026-08-10',
            counterparty: 'Supabase',
            detail: 'software',
            status: 'paid',
            net: 216,
            vat: 0,
            gross: 216,
          },
        ],
        incomeNet: 200,
        incomeVat: 48,
        incomeGross: 248,
        expenseNet: 216,
        expenseVat: 0,
        expenseGross: 216,
      },
    ],
    totalIncomeNet: 200,
    totalIncomeVat: 48,
    totalIncomeGross: 248,
    totalExpenseNet: 216,
    totalExpenseVat: 0,
    totalExpenseGross: 216,
    ...overrides,
  };
}

describe('renderReportHtml', () => {
  it('renders Greek headings, month label and both tables', () => {
    const html = renderReportHtml(input());
    expect(html).toContain('lang="el"');
    expect(html).toContain('Οικονομική Αναφορά');
    expect(html).toContain('Αύγουστος 2026');
    expect(html).toContain('Έσοδα');
    expect(html).toContain('Έξοδα');
    expect(html).toContain('Σύνολα περιόδου');
    expect(html).toContain('Καθαρό κέρδος');
    // Greek-capable webfont, the reason this is NOT jsPDF (audit E28).
    expect(html).toContain('fonts.googleapis.com');
  });

  it('escapes user-controlled text (client names cannot inject HTML)', () => {
    const html = renderReportHtml(input());
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('shows deal code + service on income lines and dd/mm/yyyy dates', () => {
    const html = renderReportHtml(input());
    expect(html).toContain('000123 · local_seo');
    expect(html).toContain('05/08/2026');
  });

  it('labels the pending-expenses mode and statuses in Greek', () => {
    const html = renderReportHtml(input({ includePendingExpenses: true }));
    expect(html).toContain('περιλαμβάνονται εκκρεμή έξοδα');
    expect(renderReportHtml(input())).toContain('μόνο πληρωμένες εγγραφές');
    expect(html).toContain('Πληρωμένο');
  });

  it('renders an empty-period notice when there are no months', () => {
    const html = renderReportHtml(input({ months: [] }));
    expect(html).toContain('Καμία κίνηση στην επιλεγμένη περίοδο.');
  });
});
