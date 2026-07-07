import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useExpenseCategories } from '../hooks/useExpenseCategories';
import { useUpdateExpense } from '../hooks/useUpdateExpense';
import type { ExpenseListRow } from '../hooks/useExpenses';

type BillingType = 'one_time' | 'recurring_monthly' | 'recurring_yearly';

export type ExpenseEditFormProps = {
  expense: ExpenseListRow;
  onDone: () => void;
};

export function ExpenseEditForm({ expense, onDone }: ExpenseEditFormProps) {
  const { t, i18n } = useTranslation('accounting_report');
  const cats = useExpenseCategories();
  const update = useUpdateExpense();
  const isEl = i18n.language.startsWith('el');

  const [categoryId, setCategoryId] = useState(expense.category_id);
  const [vendor, setVendor] = useState(expense.vendor ?? '');
  const [billingType, setBillingType] = useState<BillingType>(expense.billing_type);
  const [amountNet, setAmountNet] = useState(String(expense.amount_net));
  const [vatRate, setVatRate] = useState(String(expense.vat_rate));
  const [startDate, setStartDate] = useState(expense.start_date);
  const [endDate, setEndDate] = useState(expense.end_date ?? '');
  const [paymentMethod, setPaymentMethod] = useState(expense.payment_method ?? '');
  const [notes, setNotes] = useState(expense.notes ?? '');
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    if (!categoryId) return setError(t('expense_form.validation.category_required'));
    if (!amountNet) return setError(t('expense_form.validation.amount_required'));
    if (!startDate) return setError(t('expense_form.validation.start_date_required'));
    if (endDate && endDate < startDate)
      return setError(t('expense_form.validation.end_date_after_start'));
    try {
      await update.mutateAsync({
        id: expense.id,
        patch: {
          vendor: vendor || null,
          categoryId,
          billingType,
          amountNet: Number(amountNet),
          vatRate: Number(vatRate),
          startDate,
          endDate: endDate || null,
          notes: notes || null,
          paymentMethod: paymentMethod || null,
        },
      });
      onDone();
    } catch {
      setError(t('errors.save_failed'));
    }
  }

  return (
    <div>
      <h3 className="mb-3 text-sm font-semibold">{t('expense_form.edit_title')}</h3>

      <label className="block text-sm">
        {t('expense_form.category')}
        <select
          aria-label={t('expense_form.category')}
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="mt-1 block w-full rounded border px-2 py-1"
        >
          {(cats.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>{isEl ? c.name_el : c.name_en}</option>
          ))}
        </select>
      </label>

      <label className="mt-3 block text-sm">
        {t('expense_form.vendor')}
        <input
          aria-label={t('expense_form.vendor')}
          value={vendor}
          onChange={(e) => setVendor(e.target.value)}
          className="mt-1 block w-full rounded border px-2 py-1"
        />
      </label>

      <div className="mt-3 text-sm">
        <p className="mb-1 text-muted-foreground">{t('expense_form.billing_type')}</p>
        <div className="flex gap-2">
          {(['one_time','recurring_monthly','recurring_yearly'] as BillingType[]).map((bt) => (
            <button
              key={bt}
              type="button"
              onClick={() => setBillingType(bt)}
              className={`rounded border px-2 py-1 ${billingType === bt ? 'bg-primary text-primary-foreground' : ''}`}
            >
              {t(`expense_form.${bt}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <label>
          {t('expense_form.amount_net')}
          <input
            aria-label={t('expense_form.amount_net')}
            type="number" step="0.01" min="0"
            value={amountNet}
            onChange={(e) => setAmountNet(e.target.value)}
            className="mt-1 block w-full rounded border px-2 py-1"
          />
        </label>
        <label>
          {t('expense_form.vat_rate')}
          <input
            aria-label={t('expense_form.vat_rate')}
            type="number" step="0.01" min="0" max="100"
            value={vatRate}
            onChange={(e) => setVatRate(e.target.value)}
            className="mt-1 block w-full rounded border px-2 py-1"
          />
        </label>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <label>
          {t('expense_form.start_date')}
          <input
            aria-label={t('expense_form.start_date')}
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="mt-1 block w-full rounded border px-2 py-1"
          />
        </label>
        <label>
          {t('expense_form.end_date')}
          <input
            aria-label={t('expense_form.end_date')}
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="mt-1 block w-full rounded border px-2 py-1"
          />
        </label>
      </div>

      <label className="mt-3 block text-sm">
        {t('expense_form.payment_method')}
        <input
          aria-label={t('expense_form.payment_method')}
          value={paymentMethod}
          onChange={(e) => setPaymentMethod(e.target.value)}
          className="mt-1 block w-full rounded border px-2 py-1"
        />
      </label>

      <label className="mt-3 block text-sm">
        {t('expense_form.notes')}
        <textarea
          aria-label={t('expense_form.notes')}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="mt-1 block w-full rounded border px-2 py-1"
          rows={2}
        />
      </label>

      {billingType !== 'one_time' && (
        <p className="mt-2 text-xs text-muted-foreground">{t('expense_form.edit_chain_hint')}</p>
      )}

      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className="rounded border px-3 py-1.5 text-sm" onClick={onDone}>
          {t('expense_form.cancel')}
        </button>
        <button
          type="button"
          className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground"
          onClick={save}
          disabled={update.isPending}
        >
          {t('expense_form.submit')}
        </button>
      </div>
    </div>
  );
}
