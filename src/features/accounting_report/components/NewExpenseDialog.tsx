import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/lib/stores/authStore';
import { maxPaidDateISO } from '@/features/deals/paymentsPaidDate';
import { useExpenseCategories } from '../hooks/useExpenseCategories';
import { useCreateExpense } from '../hooks/useCreateExpense';
import { useSetExpenseAutopay } from '../hooks/useSetExpenseAutopay';

export type NewExpenseDialogProps = {
  open: boolean;
  onClose: () => void;
};

type BillingType = 'one_time' | 'recurring_monthly' | 'recurring_yearly';
type VatChoice = '0' | '24' | 'custom';

function autoEndDate(start: string, billingType: BillingType): string | null {
  if (!start) return null;
  const d = new Date(`${start}T00:00:00Z`);
  if (billingType === 'one_time') return start;
  if (billingType === 'recurring_monthly') {
    const day = d.getUTCDate();
    d.setUTCMonth(d.getUTCMonth() + 1);
    // Month-end overflow guard: Jan 31 + 1 month rolls into early March. If the
    // day-of-month changed, the target month is shorter than the start day —
    // snap back to its last day (day 0 = last day of the previous month).
    if (d.getUTCDate() !== day) {
      d.setUTCDate(0);
    }
  } else {
    d.setUTCFullYear(d.getUTCFullYear() + 1);
  }
  return d.toISOString().slice(0, 10);
}

export function NewExpenseDialog({ open, onClose }: NewExpenseDialogProps) {
  const { t, i18n } = useTranslation('accounting_report');
  const cats = useExpenseCategories();
  const create = useCreateExpense();
  const autopayMut = useSetExpenseAutopay();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const isEl = i18n.language.startsWith('el');

  const [categoryId, setCategoryId] = useState('');
  const [vendor, setVendor] = useState('');
  const [billingType, setBillingType] = useState<BillingType>('one_time');
  const [amountNet, setAmountNet] = useState('');
  const [vatChoice, setVatChoice] = useState<VatChoice | null>(null);
  const [vatCustom, setVatCustom] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [notes, setNotes] = useState('');
  const [autopayOn, setAutopayOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // I1 (entry half): the paid-date field only appears once "Save & mark
  // paid" is actually engaged — a plain "Save" (pending) never needs it.
  // Default = the expense's own start_date (the period being recorded),
  // matching the autopay convention (settle_autopay_expenses writes
  // paid_at = start_date), not "today".
  const [showPaidDate, setShowPaidDate] = useState(false);
  const [paidDate, setPaidDate] = useState('');

  // No preselection: the previous silent '24' default meant staff always
  // overrode it (135/135 live rows landed at 0%). Forcing a conscious pick
  // means "no choice yet" (null) is a distinct state from "0% chosen".
  const vatRateValue: number | null =
    vatChoice === null
      ? null
      : vatChoice === 'custom'
        ? (vatCustom === '' || Number.isNaN(Number(vatCustom)) ? null : Number(vatCustom))
        : Number(vatChoice);

  const grossNum = Number(amountNet || 0) + (Number(amountNet || 0) * (vatRateValue ?? 0)) / 100;

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
    if (vatRateValue === null) return setError(t('expense_form.validation.vat_required'));
    if (!startDate) return setError(t('expense_form.validation.start_date_required'));
    if (endDate && endDate < startDate)
      return setError(t('expense_form.validation.end_date_after_start'));
    if (markPaid && !paymentMethod.trim())
      return setError(t('expense_form.validation.payment_method_required'));
    const wantsAutopay = billingType !== 'one_time' && autopayOn;
    if (wantsAutopay && !paymentMethod.trim())
      return setError(t('expense_form.validation.autopay_requires_method'));
    try {
      const created = await create.mutateAsync({
        categoryId,
        vendor: vendor || null,
        billingType,
        amountNet: Number(amountNet),
        vatRate: vatRateValue,
        startDate,
        endDate: endDate || null,
        paymentMethod: paymentMethod || null,
        paidByUserId: userId,
        notes: notes || null,
        markPaid,
        ...(markPaid ? { paidDate: paidDate || startDate } : {}),
        autopay: wantsAutopay,
      });
      if (wantsAutopay && created?.id) {
        // Settles an already-due first period now; if it fails, the nightly
        // sweep settles it — the flag is already on the row.
        await autopayMut.mutateAsync({
          id: created.id as string,
          enabled: true,
          paymentMethod: paymentMethod.trim() || null,
        }).catch(() => undefined);
      }
      onClose();
    } catch {
      setError(t('errors.save_failed'));
    }
  }

  // "Save & mark paid" is a two-click affordance: the first click reveals
  // the paid-date field (defaulted to the expense's own start_date) instead
  // of submitting blind; the second click (paidDate now populated) submits.
  function onMarkPaidClick() {
    if (!showPaidDate) {
      setPaidDate(startDate);
      setShowPaidDate(true);
      return;
    }
    void submit(true);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded bg-card p-6 shadow">
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

        {billingType !== 'one_time' && (
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              aria-label={t('autopay.label')}
              checked={autopayOn}
              onChange={(ev) => setAutopayOn(ev.target.checked)}
            />
            <span>⚡ {t('autopay.label')}</span>
            <span className="text-xs text-muted-foreground">{t('autopay.hint')}</span>
          </label>
        )}

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
          <div>
            <p>{t('expense_form.vat_rate')}</p>
            <div className="mt-1 flex gap-1">
              {(['0', '24', 'custom'] as VatChoice[]).map((choice) => (
                <button
                  key={choice}
                  type="button"
                  aria-label={t(`expense_form.vat_${choice}`)}
                  onClick={() => setVatChoice(choice)}
                  className={`rounded border px-2 py-1 text-xs ${vatChoice === choice ? 'bg-primary text-primary-foreground' : ''}`}
                >
                  {t(`expense_form.vat_${choice}`)}
                </button>
              ))}
            </div>
            {vatChoice === 'custom' && (
              <input
                aria-label={t('expense_form.vat_custom_input')}
                type="number" step="0.01" min="0" max="100"
                value={vatCustom}
                onChange={(e) => setVatCustom(e.target.value)}
                className="mt-1 block w-full rounded border px-2 py-1"
              />
            )}
          </div>
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

        {showPaidDate && (
          <label className="mt-3 block text-sm">
            {t('expense_detail.paid_date', { defaultValue: 'Payment date' })}
            <input
              type="date"
              aria-label={t('expense_detail.paid_date', { defaultValue: 'Payment date' })}
              value={paidDate}
              max={maxPaidDateISO()}
              onChange={(e) => setPaidDate(e.target.value)}
              className="mt-1 block w-full rounded border px-2 py-1"
            />
          </label>
        )}

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

        <p className="mt-3 text-xs text-muted-foreground">{t('expense_form.no_receipt_note')}</p>

        {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="rounded border px-3 py-1.5 text-sm" onClick={onClose}>
            {t('expense_form.cancel')}
          </button>
          <button
            type="button"
            className="rounded border px-3 py-1.5 text-sm"
            onClick={onMarkPaidClick}
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
