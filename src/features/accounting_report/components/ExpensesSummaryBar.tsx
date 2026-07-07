import { useTranslation } from 'react-i18next';
import type { ExpenseListRow } from '../hooks/useExpenses';

function eur(n: number): string {
  return `€${n.toFixed(2)}`;
}

export function ExpensesSummaryBar({ rows }: { rows: ExpenseListRow[] }) {
  const { t } = useTranslation('accounting_report');
  let net = 0, vat = 0, gross = 0, pending = 0, paid = 0;
  for (const r of rows) {
    net += r.amount_net;
    vat += r.vat_amount;
    gross += r.amount_gross;
    if (r.status === 'paid') paid += r.amount_gross;
    else pending += r.amount_gross;
  }

  const cell = 'flex items-baseline gap-1.5';
  const label = 'text-[11px] uppercase tracking-wide text-muted-foreground';
  const value = 'text-sm font-semibold tabular-nums';

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-border/60 bg-card px-4 py-2.5 text-sm shadow-sm">
      <div className={cell}>
        <span className={label}>{t('expense_breakdown.count')}</span>
        <span className={value} data-testid="summary-count">{rows.length}</span>
      </div>
      <div className={cell}>
        <span className={label}>{t('expense_breakdown.net')}</span>
        <span className={value} data-testid="summary-net">{eur(net)}</span>
      </div>
      <div className={cell}>
        <span className={label}>{t('expense_breakdown.vat')}</span>
        <span className={value} data-testid="summary-vat">{eur(vat)}</span>
      </div>
      <div className={cell}>
        <span className={label}>{t('expense_breakdown.gross')}</span>
        <span className={value} data-testid="summary-gross">{eur(gross)}</span>
      </div>
      <div className="ml-auto flex items-center gap-4">
        <div className={cell}>
          <span className="text-[11px] font-medium text-amber-700 dark:text-amber-400">{t('status.pending')}</span>
          <span className={value} data-testid="summary-pending">{eur(pending)}</span>
        </div>
        <div className={cell}>
          <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400">{t('status.paid')}</span>
          <span className={value} data-testid="summary-paid">{eur(paid)}</span>
        </div>
      </div>
    </div>
  );
}
