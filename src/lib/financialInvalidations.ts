import type { QueryClient } from '@tanstack/react-query';

// Every surface that renders money aggregated from deal_payments/expenses.
// Mutating either table without invalidating these leaves the Report,
// P&L cards and Dashboard trend stale until a manual reload.
export const FINANCIAL_REPORT_KEYS = [
  ['accounting-ledger'],
  ['accounting-pl-summary'],
  ['accounting-mrr'],
  ['dashboard-monthly-pl'],
  ['dashboard-recurring-collected'],
] as const;

export function invalidateFinancialReports(qc: QueryClient): void {
  for (const queryKey of FINANCIAL_REPORT_KEYS) {
    void qc.invalidateQueries({ queryKey: [...queryKey] });
  }
}
