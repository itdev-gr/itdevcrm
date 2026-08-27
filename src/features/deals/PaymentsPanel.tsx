import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ServiceTypeBadge } from '@/components/ServiceTypeBadge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  useAddDealPayment,
  useDealPayments,
  useDeleteDealPayment,
  useUpdateDealPayment,
  type DealPaymentRow,
} from './hooks/useDealPayments';
import { useJobsBilling } from './hooks/useJobsBilling';
import { PrepayDialog } from './PrepayDialog';
import { maxPaidDateString, paidAtFromDate, todayDateString } from './paymentsPaidDate';
import type { PlannedService } from './ServicesPlannedField';

const RECURRING: string[] = ['recurring_monthly', 'recurring_yearly'];

/** Key identifying one billing chain: the generator matches on both fields. */
function chainKey(serviceType: string | null, billingType: string | null): string {
  return `${serviceType ?? ''}|${billingType ?? ''}`;
}

type Props = {
  dealId: string;
  services: PlannedService[];
  defaultVatRate: number;
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
  'ads',
  'maintenance',
  'franchise',
  'domains',
];

function reportError(err: unknown) {
  const errors = (err as Error & { errors?: string[] }).errors ?? [(err as Error).message];
  alert(errors.join('\n'));
}

function PaymentRow({
  row,
  dealId,
  countryVatRate,
  willRegenerate,
}: {
  row: DealPaymentRow;
  dealId: string;
  /** The VAT rate that matches the client's country (e.g. 0 for Cyprus). */
  countryVatRate: number;
  /**
   * True when this period belongs to a recurring chain whose job is still
   * billing_active — deleting it does NOT stop the billing, because
   * ensure_recurring_payments() keys off the job, not the payment rows, and
   * will generate the period again. The dialog says so and points at the
   * control that does stop it (Pause billing, on the service card).
   */
  willRegenerate: boolean;
}) {
  const { t } = useTranslation('deals');
  const update = useUpdateDealPayment(dealId);
  const remove = useDeleteDealPayment(dealId);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const [label, setLabel] = useState(row.label ?? '');
  const [start, setStart] = useState(row.start_date ?? '');
  const [end, setEnd] = useState(row.end_date ?? '');
  const [amountNet, setAmountNet] = useState(
    row.amount_net != null ? Number(row.amount_net).toFixed(2) : '',
  );
  const [vatRate, setVatRate] = useState(String(row.vat_rate ?? 24));
  const [invoice, setInvoice] = useState(row.invoice_number ?? '');
  const [paidPopoverOpen, setPaidPopoverOpen] = useState(false);
  const [paidDate, setPaidDate] = useState(() => todayDateString());

  // Round to cents the same way the DB generated column does, so the preview
  // always matches what gets stored.
  const grossPreview =
    Math.round(
      (Number(amountNet || 0) + (Number(amountNet || 0) * Number(vatRate || 0)) / 100) * 100,
    ) / 100;
  const vatMismatch = Number(vatRate || 0) !== countryVatRate;

  function commit(patch: Record<string, unknown>) {
    update.mutateAsync({ id: row.id, patch }).catch(reportError);
  }

  function markPending() {
    // Un-marking clears paid_at immediately — no date to ask for.
    update
      .mutateAsync({ id: row.id, patch: { status: 'pending', paid_at: null } })
      .catch(reportError);
  }

  function confirmMarkPaid() {
    if (!paidDate) return;
    update
      .mutateAsync({
        id: row.id,
        patch: { status: 'paid', paid_at: paidAtFromDate(paidDate) },
      })
      .then(() => setPaidPopoverOpen(false))
      .catch(reportError);
  }

  return (
    <tr className="border-t">
      <td className="px-2 py-2 text-xs text-foreground">
        {row.service_type ? <ServiceTypeBadge serviceType={row.service_type} /> : '—'}
        <div className="text-[10px] text-muted-foreground">
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
          onChange={(e) => setStart(e.target.value)}
          onBlur={() => start !== (row.start_date ?? '') && commit({ start_date: start || null })}
          className="h-8 text-xs"
        />
      </td>
      <td className="px-2 py-2">
        <Input
          type="date"
          value={end}
          onChange={(e) => setEnd(e.target.value)}
          onBlur={() => end !== (row.end_date ?? '') && commit({ end_date: end || null })}
          className="h-8 text-xs"
        />
      </td>
      <td className="px-2 py-2">
        <Input
          type="number"
          step="0.01"
          min="0"
          value={amountNet}
          onChange={(e) => setAmountNet(e.target.value)}
          onBlur={() => commit({ amount_net: Number(amountNet || 0) })}
          className="h-8 text-xs"
        />
      </td>
      <td className="px-2 py-2">
        <Input
          type="number"
          step="0.01"
          min="0"
          max="100"
          value={vatRate}
          onChange={(e) => setVatRate(e.target.value)}
          onBlur={() => commit({ vat_rate: Number(vatRate || 0) })}
          className={`h-8 w-16 text-xs ${vatMismatch ? 'border-amber-400 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/50' : ''}`}
          title={
            vatMismatch
              ? t('payments.vat_mismatch', {
                  rate: countryVatRate,
                  defaultValue: "Client's country VAT is {{rate}}%",
                })
              : undefined
          }
        />
      </td>
      <td className="px-2 py-2 text-xs tabular-nums text-foreground">
        €{grossPreview.toFixed(2)}
      </td>
      <td className="px-2 py-2">
        {row.status === 'paid' ? (
          <button
            type="button"
            onClick={markPending}
            className="rounded bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
          >
            {t('payments.status_paid')}
          </button>
        ) : (
          <Popover
            open={paidPopoverOpen}
            onOpenChange={(open) => {
              setPaidPopoverOpen(open);
              if (open) setPaidDate(todayDateString());
            }}
          >
            <PopoverTrigger asChild>
              <button
                type="button"
                className={`rounded px-2 py-1 text-xs font-medium ${
                  row.status === 'overdue'
                    ? 'bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300'
                    : row.status === 'cancelled'
                      ? 'bg-muted text-muted-foreground line-through'
                      : 'bg-muted text-muted-foreground'
                }`}
              >
                {row.status === 'overdue'
                  ? t('payments.status_overdue', { defaultValue: 'Overdue' })
                  : row.status === 'cancelled'
                    ? t('payments.status_cancelled', { defaultValue: 'Cancelled' })
                    : t('payments.status_pending')}
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-56 space-y-2 p-2">
              <Label className="text-xs">
                {t('payments.paid_date_label', { defaultValue: 'Payment date' })}
              </Label>
              <Input
                type="date"
                aria-label={t('payments.paid_date_label', { defaultValue: 'Payment date' })}
                value={paidDate}
                max={maxPaidDateString()}
                onChange={(e) => setPaidDate(e.target.value)}
                className="h-8 text-xs"
              />
              <Button
                type="button"
                size="sm"
                disabled={!paidDate || update.isPending}
                onClick={confirmMarkPaid}
                className="w-full"
              >
                {t('payments.confirm_mark_paid', { defaultValue: 'Mark paid' })}
              </Button>
            </PopoverContent>
          </Popover>
        )}
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
          aria-label={t('payments.remove_row', { defaultValue: 'Delete billing period' })}
          onClick={() => setConfirmRemove(true)}
        >
          ×
        </Button>
        <ConfirmDialog
          open={confirmRemove}
          onOpenChange={setConfirmRemove}
          title={t('payments.remove_confirm_title', { defaultValue: 'Delete this billing period?' })}
          description={
            willRegenerate
              ? t('payments.remove_confirm_regenerates', {
                  defaultValue:
                    'Billing for this service is still switched on, so the nightly job will create this period again. To stop charging the client, use Pause billing on the service card instead.',
                })
              : t('payments.remove_confirm_plain', {
                  defaultValue: 'The row is removed permanently.',
                })
          }
          confirmLabel={t('payments.remove')}
          pending={remove.isPending}
          onConfirm={() => {
            remove
              .mutateAsync(row.id)
              .then(() => setConfirmRemove(false))
              .catch(reportError);
          }}
        />
      </td>
    </tr>
  );
}

export function PaymentsPanel({ dealId, services, defaultVatRate }: Props) {
  const { t } = useTranslation('deals');
  const { data: payments = [], isLoading } = useDealPayments(dealId);
  const add = useAddDealPayment(dealId);

  // Which (service, cadence) chains would regenerate a deleted period. Same
  // hook JobsBillingPanel uses on this page, so it is a cache hit rather than a
  // second request.
  const { data: billing } = useJobsBilling(dealId);
  const regeneratingChains = useMemo(() => {
    const keys = new Set<string>();
    for (const job of billing?.jobs ?? []) {
      if (!job.billing_active) continue;
      if (!RECURRING.includes(job.billing_type)) continue;
      keys.add(chainKey(job.department, job.billing_type));
    }
    return keys;
  }, [billing]);

  const [showAdd, setShowAdd] = useState(false);
  const [showPrepay, setShowPrepay] = useState(false);
  const hasMonthly = payments.some((p) => p.billing_type === 'recurring_monthly');
  const [newLabel, setNewLabel] = useState('');
  const [newServiceType, setNewServiceType] = useState<PlannedService['service_type'] | ''>(
    services[0]?.service_type ?? '',
  );
  const [newBilling, setNewBilling] = useState<PlannedService['billing_type']>('one_time');
  const [newAmountNet, setNewAmountNet] = useState('');
  const [newVatRate, setNewVatRate] = useState(String(defaultVatRate));
  const [newStart, setNewStart] = useState('');
  const [newEnd, setNewEnd] = useState('');

  const newGross =
    Number(newAmountNet || 0) + (Number(newAmountNet || 0) * Number(newVatRate || 0)) / 100;

  function submitNew() {
    if (!newAmountNet) return;
    add
      .mutateAsync({
        service_type: newServiceType || null,
        billing_type: newBilling,
        label: newLabel || null,
        amount_net: Number(newAmountNet),
        vat_rate: Number(newVatRate),
        start_date: newStart || null,
        end_date: newEnd || null,
      })
      .then(() => {
        // Only close + clear the add-form once the insert actually succeeds, so
        // a failed insert doesn't look like it worked.
        setShowAdd(false);
        setNewLabel('');
        setNewAmountNet('');
        setNewVatRate(String(defaultVatRate));
        setNewStart('');
        setNewEnd('');
      })
      .catch(reportError);
  }

  if (isLoading) return <p className="text-sm text-muted-foreground">…</p>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          {t('payments.title')}
        </h2>
        <div className="flex items-center gap-2">
          {hasMonthly && (
            <Button type="button" size="sm" variant="outline" onClick={() => setShowPrepay(true)}>
              {t('payments.prepay_button', { defaultValue: 'Prepay' })}
            </Button>
          )}
          <Button type="button" size="sm" variant="outline" onClick={() => setShowAdd((v) => !v)}>
            {t('payments.add')}
          </Button>
        </div>
      </div>

      {payments.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('payments.empty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted">
              <tr className="text-xs text-muted-foreground">
                <th className="px-2 py-2 font-normal">{t('payments.service')}</th>
                <th className="px-2 py-2 font-normal">{t('payments.label')}</th>
                <th className="px-2 py-2 font-normal">{t('payments.start')}</th>
                <th className="px-2 py-2 font-normal">{t('payments.end')}</th>
                <th className="px-2 py-2 font-normal">{t('payments.amount_net')}</th>
                <th className="px-2 py-2 font-normal">{t('payments.vat_rate')}</th>
                <th className="px-2 py-2 font-normal">{t('payments.amount_gross')}</th>
                <th className="px-2 py-2 font-normal">{t('payments.status')}</th>
                <th className="px-2 py-2 font-normal">{t('payments.invoice_number')}</th>
                <th className="px-2 py-2 font-normal text-right"></th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <PaymentRow
                  key={p.id}
                  row={p}
                  dealId={dealId}
                  countryVatRate={defaultVatRate}
                  willRegenerate={regeneratingChains.has(chainKey(p.service_type, p.billing_type))}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && (
        <div className="grid grid-cols-2 gap-3 rounded-md border bg-muted p-3 sm:grid-cols-6">
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
            <Label className="text-xs">{t('payments.amount_net')}</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={newAmountNet}
              onChange={(e) => setNewAmountNet(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <div>
            <Label className="text-xs">{t('payments.vat_rate')}</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              max="100"
              value={newVatRate}
              onChange={(e) => setNewVatRate(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <div>
            <Label className="text-xs">{t('payments.amount_gross')}</Label>
            <div className="mt-1 rounded-md border bg-card px-2 py-1 text-xs tabular-nums">
              €{newGross.toFixed(2)}
            </div>
          </div>
          <div className="col-span-2 sm:col-span-6">
            <Button type="button" size="sm" onClick={submitNew} disabled={!newAmountNet}>
              {t('payments.add')}
            </Button>
          </div>
        </div>
      )}

      {showPrepay && (
        <PrepayDialog dealId={dealId} open={showPrepay} onClose={() => setShowPrepay(false)} />
      )}
    </div>
  );
}
