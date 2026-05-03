import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  useAddDealPayment,
  useDealPayments,
  useDeleteDealPayment,
  useUpdateDealPayment,
  type DealPaymentRow,
} from './hooks/useDealPayments';
import type { PlannedService } from './ServicesPlannedField';

type Props = {
  dealId: string;
  services: PlannedService[];
};

const BILLING_OPTIONS: PlannedService['billing_type'][] = [
  'one_time',
  'recurring_monthly',
  'recurring_yearly',
];

const SERVICE_OPTIONS: PlannedService['service_type'][] = [
  'web_seo',
  'local_seo',
  'web_dev',
  'social_media',
  'ai_seo',
  'hosting',
];

function PaymentRow({ row, dealId }: { row: DealPaymentRow; dealId: string }) {
  const { t } = useTranslation('deals');
  const update = useUpdateDealPayment(dealId);
  const remove = useDeleteDealPayment(dealId);

  const isTest = row.billing_type === 'recurring_test_2min';

  const [label, setLabel] = useState(row.label ?? '');
  const [start, setStart] = useState(row.start_date ?? '');
  const [end, setEnd] = useState(row.end_date ?? '');
  const [amount, setAmount] = useState(String(row.amount ?? ''));
  const [invoice, setInvoice] = useState(row.invoice_number ?? '');

  function commit(patch: Record<string, unknown>) {
    void update.mutateAsync({ id: row.id, patch });
  }

  function toggleStatus() {
    const next = row.status === 'paid' ? 'pending' : 'paid';
    void update.mutateAsync({
      id: row.id,
      patch: {
        status: next,
        paid_at: next === 'paid' ? new Date().toISOString() : null,
      },
    });
  }

  if (isTest) {
    const nextDue = row.next_due_at ? new Date(row.next_due_at) : null;
    return (
      <tr className="border-t bg-amber-50/40">
        <td className="px-2 py-2 text-xs text-slate-700">
          {t('services.types.test', { defaultValue: 'Test' })}
          <div className="text-[10px] text-amber-700">
            {t('services.billing.recurring_test_2min', {
              defaultValue: 'Every 2 minutes (test)',
            })}
          </div>
        </td>
        <td className="px-2 py-2 text-xs text-slate-600">{row.label ?? '—'}</td>
        <td className="px-2 py-2 text-xs text-slate-500" colSpan={2}>
          {t('payments.next_due', { defaultValue: 'Next due' })}:{' '}
          {nextDue ? nextDue.toLocaleString() : '—'}
        </td>
        <td className="px-2 py-2 text-xs">{Number(row.amount ?? 0).toFixed(2)}</td>
        <td className="px-2 py-2">
          <span className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-600">
            {row.status === 'paid' ? t('payments.status_paid') : t('payments.status_pending')}
          </span>
        </td>
        <td className="px-2 py-2 text-xs text-slate-500">{row.invoice_number ?? '—'}</td>
        <td className="px-2 py-2 text-right text-[10px] text-slate-400">auto</td>
      </tr>
    );
  }

  return (
    <tr className="border-t">
      <td className="px-2 py-2 text-xs text-slate-700">
        {row.service_type ? t(`services.types.${row.service_type}`) : '—'}
        <div className="text-[10px] text-slate-400">
          {t(`services.billing.${row.billing_type}`)}
        </div>
      </td>
      <td className="px-2 py-2">
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={() => label !== (row.label ?? '') && commit({ label: label || null })}
          className="h-8 text-xs"
        />
      </td>
      <td className="px-2 py-2">
        <Input
          type="date"
          value={start}
          onChange={(e) => {
            setStart(e.target.value);
            commit({ start_date: e.target.value || null });
          }}
          className="h-8 text-xs"
        />
      </td>
      <td className="px-2 py-2">
        <Input
          type="date"
          value={end}
          onChange={(e) => {
            setEnd(e.target.value);
            commit({ end_date: e.target.value || null });
          }}
          className="h-8 text-xs"
        />
      </td>
      <td className="px-2 py-2">
        <Input
          type="number"
          step="0.01"
          min="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onBlur={() => commit({ amount: Number(amount || 0) })}
          className="h-8 text-xs"
        />
      </td>
      <td className="px-2 py-2">
        <button
          type="button"
          onClick={toggleStatus}
          className={`rounded px-2 py-1 text-xs font-medium ${
            row.status === 'paid'
              ? 'bg-emerald-100 text-emerald-700'
              : 'bg-slate-100 text-slate-700'
          }`}
        >
          {row.status === 'paid' ? t('payments.status_paid') : t('payments.status_pending')}
        </button>
      </td>
      <td className="px-2 py-2">
        <Input
          value={invoice}
          onChange={(e) => setInvoice(e.target.value)}
          onBlur={() => invoice !== (row.invoice_number ?? '') && commit({ invoice_number: invoice || null })}
          placeholder="—"
          className="h-8 text-xs"
        />
      </td>
      <td className="px-2 py-2 text-right">
        <Button
          type="button"
          size="sm"
          variant="destructive"
          onClick={() => {
            if (confirm(t('payments.remove'))) {
              void remove.mutateAsync(row.id);
            }
          }}
        >
          ×
        </Button>
      </td>
    </tr>
  );
}

export function PaymentsPanel({ dealId, services }: Props) {
  const { t } = useTranslation('deals');
  const { data: payments = [], isLoading } = useDealPayments(dealId);
  const add = useAddDealPayment(dealId);

  const [showAdd, setShowAdd] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newServiceType, setNewServiceType] = useState<PlannedService['service_type'] | ''>(
    services[0]?.service_type ?? '',
  );
  const [newBilling, setNewBilling] = useState<PlannedService['billing_type']>('one_time');
  const [newAmount, setNewAmount] = useState('');
  const [newStart, setNewStart] = useState('');
  const [newEnd, setNewEnd] = useState('');

  function submitNew() {
    if (!newAmount) return;
    void add.mutateAsync({
      service_type: newServiceType || null,
      billing_type: newBilling,
      label: newLabel || null,
      amount: Number(newAmount),
      start_date: newStart || null,
      end_date: newEnd || null,
    });
    setShowAdd(false);
    setNewLabel('');
    setNewAmount('');
    setNewStart('');
    setNewEnd('');
  }

  if (isLoading) return <p className="text-sm text-slate-500">…</p>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-500">
          {t('payments.title')}
        </h2>
        <Button type="button" size="sm" variant="outline" onClick={() => setShowAdd((v) => !v)}>
          {t('payments.add')}
        </Button>
      </div>

      {payments.length === 0 ? (
        <p className="text-sm text-slate-500">{t('payments.empty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50">
              <tr className="text-xs text-slate-500">
                <th className="px-2 py-2 font-normal">{t('payments.service')}</th>
                <th className="px-2 py-2 font-normal">{t('payments.label')}</th>
                <th className="px-2 py-2 font-normal">{t('payments.start')}</th>
                <th className="px-2 py-2 font-normal">{t('payments.end')}</th>
                <th className="px-2 py-2 font-normal">{t('payments.amount')}</th>
                <th className="px-2 py-2 font-normal">{t('payments.status')}</th>
                <th className="px-2 py-2 font-normal">{t('payments.invoice_number')}</th>
                <th className="px-2 py-2 font-normal text-right"></th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <PaymentRow key={p.id} row={p} dealId={dealId} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && (
        <div className="grid grid-cols-2 gap-3 rounded-md border bg-slate-50 p-3 sm:grid-cols-6">
          <div>
            <Label className="text-xs">{t('payments.service')}</Label>
            <select
              value={newServiceType}
              onChange={(e) =>
                setNewServiceType(e.target.value as PlannedService['service_type'] | '')
              }
              className="mt-1 block w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
            >
              <option value="">—</option>
              {SERVICE_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {t(`services.types.${s}`)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-xs">{t('services.billing_type')}</Label>
            <select
              value={newBilling}
              onChange={(e) => setNewBilling(e.target.value as PlannedService['billing_type'])}
              className="mt-1 block w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
            >
              {BILLING_OPTIONS.map((b) => (
                <option key={b} value={b}>
                  {t(`services.billing.${b}`)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-xs">{t('payments.label')}</Label>
            <Input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <div>
            <Label className="text-xs">{t('payments.start')}</Label>
            <Input
              type="date"
              value={newStart}
              onChange={(e) => setNewStart(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <div>
            <Label className="text-xs">{t('payments.end')}</Label>
            <Input
              type="date"
              value={newEnd}
              onChange={(e) => setNewEnd(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <div>
            <Label className="text-xs">{t('payments.amount')}</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={newAmount}
              onChange={(e) => setNewAmount(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <div className="col-span-2 sm:col-span-6">
            <Button type="button" size="sm" onClick={submitNew} disabled={!newAmount}>
              {t('payments.add')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
