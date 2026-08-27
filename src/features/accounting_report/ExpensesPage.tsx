import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { FilterBar, FilterSelect, PageHeader, SegmentedControl } from '@/components/layout/page-shell';
import { todayLocalISO, maxPaidDateISO } from '@/features/deals/paymentsPaidDate';
import { useExpenses } from './hooks/useExpenses';
import { useExpenseCategories } from './hooks/useExpenseCategories';
import { useExpensesRealtime } from './hooks/useExpensesRealtime';
import { useMarkExpensePaid } from './hooks/useMarkExpensePaid';
import { ExpenseDetailDialog } from './components/ExpenseDetailDialog';
import { NewExpenseDialog } from './components/NewExpenseDialog';
import { ExpenseRow } from './components/ExpenseRow';
import { ExpensesSummaryBar } from './components/ExpensesSummaryBar';
import { monthOptions, monthRange } from './utils/monthFilter';

type StatusFilter = 'all' | 'pending' | 'paid';

export function ExpensesPage() {
  const { t, i18n } = useTranslation('accounting_report');
  useExpensesRealtime();

  const [status, setStatus] = useState<StatusFilter>('all');
  const [categoryId, setCategoryId] = useState<string>('');
  const [vendor, setVendor] = useState('');
  const [month, setMonth] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkMethod, setBulkMethod] = useState('');
  const [bulkDate, setBulkDate] = useState(() => todayLocalISO());
  const [bulkPending, setBulkPending] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const markPaid = useMarkExpensePaid();

  const cats = useExpenseCategories();
  const isEl = i18n.language.startsWith('el');
  const months = monthOptions(new Date());
  const range = month ? monthRange(month) : null;

  const expenses = useExpenses({
    ...(status !== 'all' ? { status } : {}),
    ...(categoryId ? { categoryId } : {}),
    ...(vendor ? { vendor } : {}),
    ...(range ? { from: range.from, to: range.to } : {}),
  });

  const rows = expenses.data ?? [];
  const statusOptions: { value: StatusFilter; label: string }[] = [
    { value: 'all', label: t('expenses_list.status_all') },
    { value: 'pending', label: t('expenses_list.status_pending') },
    { value: 'paid', label: t('expenses_list.status_paid') },
  ];

  // M7: a bulk selection made under one filter view shouldn't silently
  // survive into a different one (e.g. selecting rows under "pending", then
  // switching to "paid" and clicking "Mark selected paid" on cards that were
  // never re-checked against the new list).
  const filterKey = `${status}|${categoryId}|${vendor}|${month}`;
  useEffect(() => {
    setSelected(new Set());
  }, [filterKey]);

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function onBulkMarkPaid() {
    if (!bulkMethod || selected.size === 0) return;
    setBulkPending(true);
    setBulkError(null);
    try {
      for (const id of selected) {
        await markPaid.mutateAsync({ id, paymentMethod: bulkMethod, paidDate: bulkDate });
      }
      setSelected(new Set());
      setBulkOpen(false);
      setBulkMethod('');
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : String(err));
    } finally {
      setBulkPending(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader title={t('expenses_page_title')}>
        <Button onClick={() => setShowNew(true)}>
          <Plus className="size-4" />
          {t('expense_breakdown.new_expense')}
        </Button>
      </PageHeader>

      <FilterBar className="flex-col items-stretch gap-3 sm:flex-row sm:items-center">
        <SegmentedControl value={status} onChange={(v) => setStatus(v as StatusFilter)} options={statusOptions} />
        <FilterSelect
          aria-label={t('expense_form.category')}
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="min-w-[180px]"
        >
          <option value="">{t('expenses_list.category_all')}</option>
          {(cats.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {isEl ? c.name_el : c.name_en}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect
          aria-label={t('expenses_list.month_all')}
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="min-w-[140px]"
        >
          <option value="">{t('expenses_list.month_all')}</option>
          {months.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </FilterSelect>
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label={t('expenses_list.search_placeholder')}
            placeholder={t('expenses_list.search_placeholder')}
            value={vendor}
            onChange={(e) => setVendor(e.target.value)}
            className="h-9 rounded-full border-border/70 bg-background pl-9 shadow-sm"
          />
        </div>
        <span className="text-xs tabular-nums text-muted-foreground sm:ml-auto">
          {rows.length}
        </span>
      </FilterBar>

      {selected.size > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/50 px-3 py-2">
          <span className="text-xs text-muted-foreground">
            {t('expenses_list.selected_count', { count: selected.size, defaultValue: '{{count}} selected' })}
          </span>
          <Popover
            open={bulkOpen}
            onOpenChange={(open) => {
              setBulkOpen(open);
              setBulkError(null);
              if (open) setBulkDate(todayLocalISO());
            }}
          >
            <PopoverTrigger asChild>
              <Button type="button" size="sm" variant="outline">
                {t('expenses_list.bulk_mark_paid')}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 space-y-2 p-3">
              <Label className="text-xs">{t('expense_form.payment_method')}</Label>
              <Input
                aria-label={t('expense_form.payment_method')}
                value={bulkMethod}
                onChange={(e) => setBulkMethod(e.target.value)}
                className="h-8 text-xs"
              />
              <Label className="text-xs">
                {t('expense_detail.paid_date', { defaultValue: 'Payment date' })}
              </Label>
              <Input
                type="date"
                aria-label={t('expense_detail.paid_date', { defaultValue: 'Payment date' })}
                value={bulkDate}
                max={maxPaidDateISO()}
                onChange={(e) => setBulkDate(e.target.value)}
                className="h-8 text-xs"
              />
              {bulkError && <p className="text-xs text-red-600 dark:text-red-400">{bulkError}</p>}
              <Button
                type="button"
                size="sm"
                className="w-full"
                disabled={!bulkMethod || !bulkDate || bulkPending}
                onClick={onBulkMarkPaid}
              >
                {t('expenses_list.bulk_mark_paid')}
              </Button>
            </PopoverContent>
          </Popover>
          <Button type="button" size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            {t('expenses_list.clear_selection', { defaultValue: 'Clear' })}
          </Button>
        </div>
      )}

      <ExpensesSummaryBar rows={rows} />

      <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm">
        {expenses.isLoading ? (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">…</div>
        ) : rows.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="text-sm text-muted-foreground">{t('expenses_list.empty')}</p>
            <Button variant="outline" size="sm" onClick={() => setShowNew(true)}>
              <Plus className="size-3.5" />
              {t('expense_breakdown.new_expense')}
            </Button>
          </div>
        ) : (
          <div className="h-full overflow-auto">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm">
                <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-medium"></th>
                  <th className="px-4 py-3 font-medium">{t('expense_form.start_date')}</th>
                  <th className="px-4 py-3 font-medium">{t('expense_form.category')}</th>
                  <th className="px-4 py-3 font-medium">{t('expense_form.vendor')}</th>
                  <th className="px-4 py-3 text-right font-medium">{t('expense_breakdown.net')}</th>
                  <th className="px-4 py-3 text-right font-medium">{t('expense_breakdown.vat')}</th>
                  <th className="px-4 py-3 text-right font-medium">{t('expense_breakdown.gross')}</th>
                  <th className="px-4 py-3 font-medium">{t('transaction_drawer.status')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <ExpenseRow
                    key={r.id}
                    row={r}
                    onClick={setDetailId}
                    selected={selected.has(r.id)}
                    onToggleSelect={toggleSelected}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <NewExpenseDialog open={showNew} onClose={() => setShowNew(false)} />
      <ExpenseDetailDialog open={!!detailId} id={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}
