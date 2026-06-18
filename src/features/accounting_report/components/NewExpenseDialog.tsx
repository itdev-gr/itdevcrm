import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useExpenseCategories } from '../hooks/useExpenseCategories';
import { useCreateExpense } from '../hooks/useCreateExpense';

export type NewExpenseDialogProps = {
  open: boolean;
  onClose: () => void;
};

type BillingType = 'one_time' | 'recurring_monthly' | 'recurring_yearly';

function autoEndDate(start: string, billingType: BillingType): string | null {
  if (!start) return null;
  const d = new Date(`${start}T00:00:00Z`);
  if (billingType === 'one_time') return start;
  if (billingType === 'recurring_monthly') {
    d.setUTCMonth(d.getUTCMonth() + 1);
  } else {
    d.setUTCFullYear(d.getUTCFullYear() + 1);
  }
  return d.toISOString().slice(0, 10);
}

export function NewExpenseDialog({ open, onClose }: NewExpenseDialogProps) {
  const { t, i18n } = useTranslation('accounting_report');
  const cats = useExpenseCategories();
  const create = useCreateExpense();
  const isEl = i18n.language.startsWith('el');

  const [categoryId, setCategoryId] = useState('');
  const [vendor, setVendor] = useState('');
  const [billingType, setBillingType] = useState<BillingType>('one_time');
  const [amountNet, setAmountNet] = useState('');
  const [vatRate, setVatRate] = useState('24');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const grossNum =
    Number(amountNet || 0) + (Number(amountNet || 0) * Number(vatRate || 0)) / 100;

  function onBillingChange(bt: BillingType) {
    setBillingType(bt);
    if (startDate) {
      const auto = autoEndDate(startDate, bt);
      if (auto) setEndDate(auto);
    }
  }
  function onStartChange(s: string) {
    setStartDate(s);
    const auto = autoEndDate(s, billingType);
    if (auto) setEndDate(auto);
  }

  async function submit(markPaid: boolean) {
    setError(null);
    if (!categoryId) return setError(t('expense_form.validation.category_required'));
    if (!amountNet) return setError(t('expense_form.validation.amount_required'));
    if (!startDate) return setError(t('expense_form.validation.start_date_required'));
    if (endDate && endDate < startDate)
      return setError(t('expense_form.validation.end_date_after_start'));
    if (markPaid && !paymentMethod.trim())
      return setError(t('expense_form.validation.payment_method_required'));
    try {
      await create.mutateAsync({
        categoryId,
        vendor: vendor || null,
        billingType,
        amountNet: Number(amountNet),
        vatRate: Number(vatRate),
        startDate,
        endDate: endDate || null,
        paymentMethod: paymentMethod || null,
        notes: notes || null,
        markPaid,
      });
      onClose();
    } catch {
      setError(t('errors.save_failed'));
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-lg rounded bg-card p-6 shadow">
        <h2 className="mb-4 text-lg font-semibold">{t('expense_form.create_title')}</h2>

        <label className="block text-sm">
          {t('expense_form.category')}
          <select
            aria-label={t('expense_form.category')}
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="mt-1 block w-full rounded border px-2 py-1"
          >
            <option value="">{t('expense_form.category_placeholder')}</option>
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
                onClick={() => onBillingChange(bt)}
                className={`rounded border px-2 py-1 ${billingType === bt ? 'bg-primary text-primary-foreground' : ''}`}
              >
                {t(`expense_form.${bt}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
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
          <div>
            {t('expense_form.amount_gross')}
            <div data-testid="amount-gross-display" className="mt-1 rounded border bg-muted px-2 py-1">
              €{grossNum.toFixed(2)}
            </div>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <label>
            {t('expense_form.start_date')}
            <input
              aria-label={t('expense_form.start_date')}
              type="date"
              value={startDate}
              onChange={(e) => onStartChange(e.target.value)}
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

        {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="rounded border px-3 py-1.5 text-sm" onClick={onClose}>
            {t('expense_form.cancel')}
          </button>
          <button
            type="button"
            className="rounded border px-3 py-1.5 text-sm"
            onClick={() => submit(true)}
            disabled={create.isPending}
          >
            {t('expense_form.submit_and_mark_paid')}
          </button>
          <button
            type="button"
            className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground"
            onClick={() => submit(false)}
            disabled={create.isPending}
          >
            {t('expense_form.submit')}
          </button>
        </div>
      </div>
    </div>
  );
}
