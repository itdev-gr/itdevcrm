import { jsPDF } from 'jspdf';
import type { PLSummary } from '../hooks/usePLSummary';
import type { LedgerRow } from '../hooks/useLedger';

export type PDFInput = {
  rangeLabel: string;
  summary: PLSummary;
  incomeRows: LedgerRow[];
  expenseRows: LedgerRow[];
};

function fmt(n: number) {
  return n.toFixed(2);
}

export function downloadPDF(filename: string, input: PDFInput): void {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  let y = 15;
  doc.setFontSize(16);
  doc.text('Accounting Report', 14, y);
  y += 8;
  doc.setFontSize(11);
  doc.text(input.rangeLabel, 14, y);
  y += 10;

  doc.setFontSize(12);
  doc.text(`Income (gross):  EUR ${fmt(input.summary.totalIncomeGross)}`, 14, y); y += 6;
  doc.text(`Expense (gross): EUR ${fmt(input.summary.totalExpenseGross)}`, 14, y); y += 6;
  doc.text(`Net profit:       EUR ${fmt(input.summary.netProfitGross)}`, 14, y); y += 10;

  doc.setFontSize(11);
  doc.text('Income rows', 14, y); y += 6;
  for (const r of input.incomeRows.slice(0, 40)) {
    doc.text(
      `${r.event_date}  ${r.category_key ?? '-'}  ${r.counterparty ?? '-'}  EUR ${fmt(r.amount_gross)}`,
      14, y,
    );
    y += 5;
    if (y > 280) { doc.addPage(); y = 15; }
  }

  y += 4;
  doc.text('Expense rows', 14, y); y += 6;
  for (const r of input.expenseRows.slice(0, 40)) {
    doc.text(
      `${r.event_date}  ${r.category_key ?? '-'}  ${r.counterparty ?? '-'}  EUR ${fmt(r.amount_gross)}`,
      14, y,
    );
    y += 5;
    if (y > 280) { doc.addPage(); y = 15; }
  }

  doc.save(filename);
}
