import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useExpenseDetail } from '../hooks/useExpenseDetail';
import { useMarkExpensePaid } from '../hooks/useMarkExpensePaid';
import { useDeleteExpense } from '../hooks/useDeleteExpense';
import { useUploadReceipt } from '../hooks/useUploadReceipt';

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

  const [showPaidForm, setShowPaidForm] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('');

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

  async function onDelete() {
    if (!id) return;
    if (!confirm(t('expense_detail.delete_confirm'))) return;
    await del.mutateAsync(id);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-lg rounded bg-white p-6 shadow">
        <h2 className="mb-2 text-lg font-semibold">{t('expense_detail.title')}</h2>
        {detail.isLoading || !e ? (
          <p>…</p>
        ) : (
          <>
            <p className="text-sm text-neutral-600">
              {(isEl ? e.category?.name_el : e.category?.name_en) ?? e.category_id} · {e.vendor ?? '—'}
            </p>
            <p className="mt-3 text-sm">
              {t('expense_form.amount_net')}: €{e.amount_net.toFixed(2)} ·{' '}
              {t('expense_form.vat_rate')}: {e.vat_rate}% ·{' '}
              {t('expense_form.amount_gross')}: €{e.amount_gross.toFixed(2)}
            </p>
            <p className="mt-1 text-sm">
              {t('expense_form.start_date')}: {e.start_date}
              {e.end_date && ` → ${e.end_date}`}
            </p>
            <p className="mt-1 text-sm">
              {t('transaction_drawer.status')}: {t(`status.${e.status}`)}
              {e.status === 'paid' && e.paid_at && ` (${e.paid_at})`}
            </p>
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
                      className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white"
                    >
                      {t('expense_form.submit')}
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="mt-6 flex justify-between">
              <button type="button" onClick={onDelete} className="rounded border px-3 py-1.5 text-sm text-red-600">
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
