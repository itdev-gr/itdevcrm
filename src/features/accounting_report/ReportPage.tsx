import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { rangeForPreset, type RangePreset, type DateRange } from './utils/formatRange';
import { useLedger, type LedgerRow } from './hooks/useLedger';
import { usePLSummary } from './hooks/usePLSummary';
import { useMRR } from './hooks/useMRR';
import { useExpensesRealtime } from './hooks/useExpensesRealtime';
import { ReportHeader } from './components/ReportHeader';
import { IncomeBreakdown } from './components/IncomeBreakdown';
import { ExpenseBreakdown } from './components/ExpenseBreakdown';
import { TransactionDrawer } from './components/TransactionDrawer';
import { ExportMenu } from './components/ExportMenu';
import { NewExpenseDialog } from './components/NewExpenseDialog';
import { ExpenseDetailDialog } from './components/ExpenseDetailDialog';

export function ReportPage() {
  const { t } = useTranslation('accounting_report');
  useExpensesRealtime();

  const [preset, setPreset] = useState<RangePreset>('this_month');
  const [range, setRange] = useState<DateRange>(() => rangeForPreset('this_month'));

  function onPreset(p: RangePreset) {
    setPreset(p);
    if (p !== 'custom') setRange(rangeForPreset(p));
  }

  const summary = usePLSummary(range);
  const ytdRange = useMemo(() => rangeForPreset('this_year'), []);
  const ytdSummary = usePLSummary(ytdRange);
  const mrr = useMRR(range);
  const ledger = useLedger(range);

  const incomeRows = useMemo(
    () => (ledger.data ?? []).filter((r) => r.direction === 'in' && r.status === 'paid'),
    [ledger.data],
  );
  const expenseRows = useMemo(
    () => (ledger.data ?? []).filter((r) => r.direction === 'out' && r.status === 'paid'),
    [ledger.data],
  );

  const [drawer, setDrawer] = useState<{ title: string; rows: LedgerRow[] } | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  function openIncomeGroup(key: string | null, rows: LedgerRow[]) {
    setDrawer({ title: key ?? t('income_breakdown.unknown'), rows });
  }
  function openExpenseGroup(key: string | null, rows: LedgerRow[]) {
    setDrawer({ title: key ?? t('expense_breakdown.category'), rows });
  }

  return (
    <div className="space-y-6 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t('page_title')}</h1>
          <p className="text-sm text-neutral-600">{t('page_subtitle')}</p>
        </div>
        {summary.data && (
          <ExportMenu
            rangeLabel={`${range.from} → ${range.to}`}
            from={range.from}
            to={range.to}
            summary={summary.data}
            incomeRows={incomeRows}
            expenseRows={expenseRows}
          />
        )}
      </header>

      <ReportHeader
        preset={preset}
        range={range}
        onPreset={onPreset}
        onCustomFrom={(iso) => setRange((r) => ({ ...r, from: iso }))}
        onCustomTo={(iso) => setRange((r) => ({ ...r, to: iso }))}
        summary={summary.data}
        mrr={mrr.data ?? 0}
        ytdSummary={ytdSummary.data}
      />

      <IncomeBreakdown rows={incomeRows} onSelectGroup={openIncomeGroup} />
      <ExpenseBreakdown
        rows={expenseRows}
        onSelectGroup={openExpenseGroup}
        onNewExpense={() => setShowNew(true)}
      />

      <TransactionDrawer
        open={!!drawer}
        title={drawer?.title ?? ''}
        rows={drawer?.rows ?? []}
        onClose={() => setDrawer(null)}
        onSelectExpense={(id) => {
          setDetailId(id);
          setDrawer(null);
        }}
      />

      <NewExpenseDialog open={showNew} onClose={() => setShowNew(false)} />
      <ExpenseDetailDialog open={!!detailId} id={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}
