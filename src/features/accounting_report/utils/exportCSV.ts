import type { LedgerRow } from '../hooks/useLedger';

const COLUMNS = [
  'event_date',
  'period',
  'direction',
  'status',
  'category_key',
  'counterparty',
  'billing_type',
  'amount_net',
  'vat_amount',
  'amount_gross',
] as const;

function escape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function ledgerRowsToCSV(rows: LedgerRow[]): string {
  const head = COLUMNS.join(',');
  const body = rows
    .map((r) => COLUMNS.map((c) => escape((r as Record<string, unknown>)[c])).join(','))
    .join('\n');
  return `${head}\n${body}\n`;
}

export function downloadCSV(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
