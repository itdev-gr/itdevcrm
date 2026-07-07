import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useExpenseDetail } from '../hooks/useExpenseDetail';

function formatPaidAt(iso: string | null, locale: string): string {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat(locale === 'el' ? 'el-GR' : 'en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

import { useMarkExpensePaid } from '../hooks/useMarkExpensePaid';
import { useDeleteExpense } from '../hooks/useDeleteExpense';
import { useUploadReceipt } from '../hooks/useUploadReceipt';
import { useSetExpenseAutopay } from '../hooks/useSetExpenseAutopay';

export type ExpenseDetailDialogProps = {
  open: boolean;
  id: string | null;
  onClose: () => void;
};

export function ExpenseDetailDialog({ open, id, onClose }: ExpenseDetailDialogProps) {
  const { t, i18n } = useTranslation('accounting_report');
  const detail = useExpenseDetail(open ? id : null);
  const markPaid = useMarkExpensePaid();
  const del = useDeleteExpense();
  const upload = useUploadReceipt();
  const autopayMut = useSetExpenseAutopay();

  const [showPaidForm, setShowPaidForm] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('');
  const [autopayMethod, setAutopayMethod] = useState('');
  const [showAutopayMethod, setShowAutopayMethod] = useState(false);
  const [autopayError, setAutopayError] = useState<string | null>(null);

  if (!open || !id) return null;
  const e = detail.data;
  const isEl = i18n.language.startsWith('el');

  async function onUpload(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0];
    if (!file || !id) return;
    await upload.mutateAsync({ expenseId: id, file });
  }

  async function onMarkPaid() {
    if (!id || !paymentMethod) return;
    await markPaid.mutateAsync({ id, paymentMethod });
    setShowPaidForm(false);
    setPaymentMethod('');
  }

  async function onEnableAutopay() {
    if (!id || !e) return;
    setAutopayError(null);
    // A method must exist somewhere: on the row or typed just now.
    if (!e.payment_method && !autopayMethod.trim()) {
      setShowAutopayMethod(true);
      return;
    }
    try {
      await autopayMut.mutateAsync({
        id,
        enabled: true,
        paymentMethod: autopayMethod.trim() || e.payment_method || null,
      });
      setShowAutopayMethod(false);
      setAutopayMethod('');
    } catch (err) {
      setAutopayError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onDisableAutopay() {
    if (!id) return;
    setAutopayError(null);
    try {
      await autopayMut.mutateAsync({ id, enabled: false });
    } catch (err) {
      setAutopayError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onDelete() {
    if (!id) return;
    if (!confirm(t('expense_detail.delete_confirm'))) return;
    await del.mutateAsync(id);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-lg rounded bg-card p-6 shadow">
        <h2 className="mb-2 text-lg font-semibold">{t('expense_detail.title')}</h2>
        {detail.isLoading || !e ? (
          <p>…</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {(isEl ? e.category?.name_el : e.category?.name_en) ?? e.category_id} · {e.vendor ?? '—'}
            </p>
            <p className="mt-3 text-sm">
              {t('expense_form.amount_net')}: €{e.amount_net.toFixed(2)} ·{' '}
              {t('expense_form.vat_rate')}: {e.vat_rate}% ·{' '}
              {t('expense_form.amount_gross')}: €{e.amount_gross.toFixed(2)}
            </p>
            <p className="mt-1 text-sm">
              {t('expense_form.billing_type')}: {t(`expense_form.${e.billing_type}`)}
            </p>
            <p className="mt-1 text-sm">
              {t('expense_form.start_date')}: {e.start_date}
              {e.billing_type !== 'one_time' && e.end_date && e.end_date !== e.start_date && (
                <> → {e.end_date}</>
              )}
            </p>
            <p className="mt-1 text-sm">
              {t('transaction_drawer.status')}: {t(`status.${e.status}`)}
              {e.status === 'paid' && e.paid_at && ` (${formatPaidAt(e.paid_at, i18n.language)})`}
            </p>

            {e.billing_type !== 'one_time' && (
              <div className="mt-3 rounded border p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">⚡ {t('autopay.label')}</span>
                  <span className={e.autopay ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}>
                    {e.autopay ? t('autopay.on') : t('autopay.off')}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{t('autopay.hint')}</p>
                <div className="mt-2 flex items-end gap-2">
                  {showAutopayMethod && !e.payment_method && (
                    <label className="text-sm">
                      {t('expense_form.payment_method')}
                      <input
                        aria-label="Autopay payment method"
                        value={autopayMethod}
                        onChange={(ev) => setAutopayMethod(ev.target.value)}
                        className="mt-1 block rounded border px-2 py-1"
                      />
                    </label>
                  )}
                  {e.autopay ? (
                    <button
                      type="button"
                      onClick={onDisableAutopay}
                      disabled={autopayMut.isPending}
                      className="rounded border px-3 py-1.5 text-sm"
                    >
                      {t('autopay.disable')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={onEnableAutopay}
                      disabled={autopayMut.isPending}
                      className="rounded border px-3 py-1.5 text-sm"
                    >
                      {t('autopay.enable')}
                    </button>
                  )}
                </div>
                {autopayError && (
                  <p className="mt-2 text-sm text-red-600 dark:text-red-400">{autopayError}</p>
                )}
              </div>
            )}

            {e.notes && <p className="mt-2 text-sm">{e.notes}</p>}

            <div className="mt-4 flex items-center gap-3">
              <label className="text-sm">
                {t('expense_form.upload_receipt')}
                <input
                  type="file"
                  aria-label={t('expense_form.upload_receipt')}
                  accept="application/pdf,image/png,image/jpeg,image/webp"
                  onChange={onUpload}
                  className="mt-1 block text-xs"
                />
              </label>
            </div>

            {e.status !== 'paid' && (
              <div className="mt-4">
                {!showPaidForm ? (
                  <button
                    type="button"
                    onClick={() => setShowPaidForm(true)}
                    className="rounded border px-3 py-1.5 text-sm"
                  >
                    {t('expense_detail.mark_paid')}
                  </button>
                ) : (
                  <div className="flex items-end gap-2">
                    <label className="text-sm">
                      {t('expense_form.payment_method')}
                      <input
                        aria-label={t('expense_form.payment_method')}
                        value={paymentMethod}
                        onChange={(ev) => setPaymentMethod(ev.target.value)}
                        className="mt-1 block rounded border px-2 py-1"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={onMarkPaid}
                      className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground"
                    >
                      {t('expense_form.submit')}
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="mt-6 flex justify-between">
              <button type="button" onClick={onDelete} className="rounded border px-3 py-1.5 text-sm text-red-600 dark:text-red-400">
                {t('expense_detail.delete')}
              </button>
              <button type="button" onClick={onClose} className="rounded border px-3 py-1.5 text-sm">
                {t('expense_form.cancel')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
