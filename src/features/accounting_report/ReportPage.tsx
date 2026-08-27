import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/layout/page-shell';
import { useAuthStore } from '@/lib/stores/authStore';
import { rangeForPreset, type RangePreset, type DateRange } from './utils/formatRange';
import { useLedger, type LedgerRow } from './hooks/useLedger';
import { usePLSummary } from './hooks/usePLSummary';
import { useMRR } from './hooks/useMRR';
import { useContractedMRR } from './hooks/useContractedMRR';
import { useExpensesRealtime } from './hooks/useExpensesRealtime';
import { useDealPaymentsRealtime } from './hooks/useDealPaymentsRealtime';
import { ReportHeader } from './components/ReportHeader';
import { IncomeBreakdown } from './components/IncomeBreakdown';
import { ExpenseBreakdown } from './components/ExpenseBreakdown';
import { TransactionDrawer } from './components/TransactionDrawer';
import { ExportMenu } from './components/ExportMenu';
import { NewExpenseDialog } from './components/NewExpenseDialog';
import { ExpenseDetailDialog } from './components/ExpenseDetailDialog';
import { PeriodLockControl } from './components/PeriodLockControl';

export function ReportPage() {
  const { t } = useTranslation('accounting_report');
  const isAdmin = useAuthStore((s) => s.isAdmin);
  useExpensesRealtime();
  useDealPaymentsRealtime();

  const [preset, setPreset] = useState<RangePreset>('this_month');
  const [range, setRange] = useState<DateRange>(() => rangeForPreset('this_month'));
  const [includePendingExpenses, setIncludePendingExpenses] = useState(false);

  function onPreset(p: RangePreset) {
    setPreset(p);
    if (p !== 'custom') setRange(rangeForPreset(p));
  }

  const summary = usePLSummary(range, { includePendingExpenses });
  const ytdRange = useMemo(() => rangeForPreset('this_year'), []);
  const ytdSummary = usePLSummary(ytdRange, { includePendingExpenses });
  const collectedMrr = useMRR(range);
  const contractedMrr = useContractedMRR();
  const ledger = useLedger(range);

  const incomeRows = useMemo(
    () => (ledger.data ?? []).filter((r) => r.direction === 'in' && r.status === 'paid'),
    [ledger.data],
  );
  const expenseRows = useMemo(
    () =>
      (ledger.data ?? []).filter(
        (r) =>
          r.direction === 'out' &&
          (r.status === 'paid' || (includePendingExpenses && r.status === 'pending')),
      ),
    [ledger.data, includePendingExpenses],
  );

  const [drawer, setDrawer] = useState<{ title: string; rows: LedgerRow[] } | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  function openIncomeGroup(_key: string | null, rows: LedgerRow[], title: string) {
    setDrawer({ title, rows });
  }
  function openExpenseGroup(_key: string | null, rows: LedgerRow[], title: string) {
    setDrawer({ title, rows });
  }

  return (
    <div className="space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader title={t('page_title')} description={t('page_subtitle')}>
        {summary.data && (
          <ExportMenu
            rangeLabel={`${range.from} → ${range.to}`}
            from={range.from}
            to={range.to}
            summary={summary.data}
            incomeRows={incomeRows}
            expenseRows={expenseRows}
            includePendingExpenses={includePendingExpenses}
          />
        )}
      </PageHeader>

      <ReportHeader
        preset={preset}
        range={range}
        onPreset={onPreset}
        onCustomFrom={(iso) => setRange((r) => ({ ...r, from: iso }))}
        onCustomTo={(iso) => setRange((r) => ({ ...r, to: iso }))}
        summary={summary.data}
        mrr={contractedMrr.data ?? 0}
        collectedMrr={collectedMrr.data ?? 0}
        ytdSummary={ytdSummary.data}
        includePendingExpenses={includePendingExpenses}
        onIncludePendingExpensesChange={setIncludePendingExpenses}
      />

      {isAdmin && <PeriodLockControl />}

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
