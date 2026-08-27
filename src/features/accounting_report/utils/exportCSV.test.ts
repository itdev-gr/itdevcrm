import { describe, it, expect } from 'vitest';
import { ledgerRowsToCSV } from './exportCSV';
import type { LedgerRow } from '../hooks/useLedger';

const rows: LedgerRow[] = [
  {
    direction: 'in', event_date: '2026-06-10', period: '2026-06',
    status: 'paid', amount_net: 100, vat_amount: 24, amount_gross: 124,
    category_key: 'web_seo', counterparty: 'ACME Ltd, "Athens"',
    billing_type: 'recurring_monthly', source_table: 'deal_payments', source_id: 'x',
    deal_id: 'd1', deal_code: '000001',
  },
  {
    direction: 'out', event_date: '2026-06-12', period: '2026-06',
    status: 'paid', amount_net: 40, vat_amount: 9.6, amount_gross: 49.6,
    category_key: 'software', counterparty: 'Adobe',
    billing_type: 'recurring_monthly', source_table: 'expenses', source_id: 'y',
    deal_id: null, deal_code: null,
  },
];

describe('ledgerRowsToCSV', () => {
  it('emits a header row and one data row per ledger entry', () => {
    const csv = ledgerRowsToCSV(rows);
    const lines = csv.trim().split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^event_date,period,direction,status,category_key/);
  });

  it('escapes embedded commas and double-quotes', () => {
    const csv = ledgerRowsToCSV([rows[0]!]);
    expect(csv).toContain('"ACME Ltd, ""Athens"""');
  });
});
