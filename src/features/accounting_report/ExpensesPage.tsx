import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useExpenses } from './hooks/useExpenses';
import { useExpenseCategories } from './hooks/useExpenseCategories';
import { useExpensesRealtime } from './hooks/useExpensesRealtime';
import { ExpenseDetailDialog } from './components/ExpenseDetailDialog';
import { NewExpenseDialog } from './components/NewExpenseDialog';

export function ExpensesPage() {
  const { t, i18n } = useTranslation('accounting_report');
  useExpensesRealtime();

  const [status, setStatus] = useState<'all' | 'pending' | 'paid'>('all');
  const [categoryId, setCategoryId] = useState<string>('');
  const [vendor, setVendor] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  const cats = useExpenseCategories();
  const isEl = i18n.language.startsWith('el');

  const expenses = useExpenses({
    ...(status !== 'all' ? { status } : {}),
    ...(categoryId ? { categoryId } : {}),
    ...(vendor ? { vendor } : {}),
  });

  return (
    <div className="space-y-4 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t('expenses_page_title')}</h1>
        <button
          type="button"
          onClick={() => setShowNew(true)}
          className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white"
        >
          {t('expense_breakdown.new_expense')}
        </button>
      </header>

      <div className="flex flex-wrap gap-2 text-sm">
        {(['all', 'pending', 'paid'] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            className={`rounded border px-3 py-1.5 ${status === s ? 'bg-neutral-900 text-white' : ''}`}
          >
            {t(`expenses_list.status_${s}`)}
          </button>
        ))}
        <select
          aria-label={t('expense_form.category')}
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="rounded border px-2 py-1"
        >
          <option value="">{t('expenses_list.category_all')}</option>
          {(cats.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>{isEl ? c.name_el : c.name_en}</option>
          ))}
        </select>
        <input
          aria-label={t('expenses_list.search_placeholder')}
          placeholder={t('expenses_list.search_placeholder')}
          value={vendor}
          onChange={(e) => setVendor(e.target.value)}
          className="rounded border px-2 py-1"
        />
      </div>

      {expenses.data && expenses.data.length === 0 && (
        <p className="text-sm text-neutral-600">{t('expenses_list.empty')}</p>
      )}

      {expenses.data && expenses.data.length > 0 && (
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left">
            <tr>
              <th className="px-3 py-2">{t('expense_form.start_date')}</th>
              <th className="px-3 py-2">{t('expense_form.category')}</th>
              <th className="px-3 py-2">{t('expense_form.vendor')}</th>
              <th className="px-3 py-2 text-right">{t('expense_breakdown.net')}</th>
              <th className="px-3 py-2 text-right">{t('expense_breakdown.vat')}</th>
              <th className="px-3 py-2 text-right">{t('expense_breakdown.gross')}</th>
              <th className="px-3 py-2">{t('transaction_drawer.status')}</th>
            </tr>
          </thead>
          <tbody>
            {expenses.data.map((r) => {
              const categoryName = isEl ? r.category?.name_el : r.category?.name_en;
              return (
                <tr
                  key={r.id}
                  className="cursor-pointer hover:bg-neutral-50"
                  onClick={() => setDetailId(r.id)}
                >
                  <td className="px-3 py-2">{r.start_date}</td>
                  <td className="px-3 py-2">{categoryName ?? r.category_id}</td>
                  <td className="px-3 py-2">{r.vendor ?? '—'}</td>
                  <td className="px-3 py-2 text-right">€{r.amount_net.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right">€{r.vat_amount.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right">€{r.amount_gross.toFixed(2)}</td>
                  <td className="px-3 py-2">{t(`status.${r.status}`)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <NewExpenseDialog open={showNew} onClose={() => setShowNew(false)} />
      <ExpenseDetailDialog open={!!detailId} id={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}
