import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { AddCustomJobForm } from './AddCustomJobForm';
import {
  useJobsBilling,
  type JobBillingRow,
  type PaymentWithLines,
} from './hooks/useJobsBilling';
import { useEndJob, useUpdateJobBilling } from './hooks/useCustomJobMutations';
import { useUpdateDealPayment } from './hooks/useDealPayments';
import { formatDate } from '@/lib/datetime';
import { formatEur } from '@/lib/countries';

const SEPARATE = '__separate__';
/** Prefix for "pair with job X" options whose value encodes the target job id. */
const PAIR_PREFIX = 'pair:';

/** True when two jobs can share one recurring payment (same billing cadence). */
function canGroupTogether(a: JobBillingRow, b: JobBillingRow): boolean {
  if (a.id === b.id) return false;
  if (a.billing_type !== 'recurring_monthly' && a.billing_type !== 'recurring_yearly') return false;
  return a.billing_type === b.billing_type;
}

function reportError(err: unknown) {
  const errors = (err as Error & { errors?: string[] }).errors ?? [(err as Error).message];
  alert(errors.join('\n'));
}

function cadenceSuffix(t: (k: string) => string, billingType: string): string {
  switch (billingType) {
    case 'recurring_monthly':
      return ` / ${t('jobs_billing.cadence.recurring_monthly')}`;
    case 'recurring_yearly':
      return ` / ${t('jobs_billing.cadence.recurring_yearly')}`;
    default:
      return '';
  }
}

function JobRow({
  job,
  dealId,
  jobs,
  groupLabels,
  readOnly,
}: {
  job: JobBillingRow;
  dealId: string;
  /** All non-archived jobs of the deal (used to offer pairing targets). */
  jobs: JobBillingRow[];
  /** Map of billing_group_id -> human label ("Group 1", …). */
  groupLabels: Map<string, string>;
  /** Hide all mutation controls and render a plain read-only row. */
  readOnly: boolean;
}) {
  const { t } = useTranslation('deals');
  const update = useUpdateJobBilling(dealId);
  const end = useEndJob(dealId);

  // Same-cadence jobs that aren't already in a group — candidates to pair with
  // (joining an existing group is offered separately via the group labels).
  const pairTargets = jobs.filter((other) => canGroupTogether(job, other) && !other.billing_group_id);

  // Existing groups this job may join: those holding at least one same-cadence
  // job, excluding the job's own current group.
  const joinableGroups = [...groupLabels.entries()].filter(([gid]) => {
    if (gid === job.billing_group_id) return false;
    return jobs.some((other) => other.billing_group_id === gid && canGroupTogether(job, other));
  });

  // Whether any grouping action is available at all (drives the empty hint).
  const canGroup = pairTargets.length > 0 || joinableGroups.length > 0 || !!job.billing_group_id;

  const [price, setPrice] = useState(
    job.amount_net != null ? Number(job.amount_net).toFixed(2) : '',
  );
  const [confirmEnd, setConfirmEnd] = useState(false);

  const ended = job.status === 'ended' || job.billing_active === false;
  const department = job.billing_only
    ? t('jobs_billing.billing_only')
    : t(`services.types.${job.department}`, { defaultValue: job.department });

  function commitPrice() {
    const next = Number(price || 0);
    if (next === Number(job.amount_net ?? 0)) return;
    update.mutateAsync({ jobId: job.id, amountNet: next }).catch(reportError);
  }

  async function onGroupChange(value: string) {
    try {
      if (value === SEPARATE) {
        await update.mutateAsync({ jobId: job.id, clearGroup: true });
      } else if (value.startsWith(PAIR_PREFIX)) {
        // Pair with a currently-ungrouped job: mint a fresh group for BOTH.
        const otherId = value.slice(PAIR_PREFIX.length);
        const groupId = crypto.randomUUID();
        await update.mutateAsync({ jobId: otherId, billingGroupId: groupId });
        await update.mutateAsync({ jobId: job.id, billingGroupId: groupId });
      } else {
        // Join an existing group.
        await update.mutateAsync({ jobId: job.id, billingGroupId: value });
      }
    } catch (err) {
      reportError(err);
    }
  }

  return (
    <tr className="border-t">
      <td className="px-2 py-2 text-xs text-slate-700">
        {job.title || '—'}
        {job.is_custom && (
          <span className="ml-1 rounded bg-purple-100 px-1 text-[9px] font-medium uppercase text-purple-700">
            custom
          </span>
        )}
      </td>
      <td className="px-2 py-2 text-xs text-slate-600">{department}</td>
      <td className="px-2 py-2">
        {readOnly ? (
          <span className="text-xs text-slate-700">
            €{Number(job.amount_net ?? 0).toFixed(2)}
            <span className="text-[10px] text-slate-400">{cadenceSuffix(t, job.billing_type)}</span>
          </span>
        ) : (
          <div className="flex items-center gap-1">
            <span className="text-xs text-slate-400">€</span>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              onBlur={commitPrice}
              disabled={ended}
              className="h-8 w-20 text-xs"
            />
            <span className="text-[10px] text-slate-400">
              {cadenceSuffix(t, job.billing_type)}
            </span>
          </div>
        )}
      </td>
      <td className="px-2 py-2">
        <span
          className={`rounded px-2 py-0.5 text-[11px] font-medium ${
            ended ? 'bg-slate-100 text-slate-500' : 'bg-emerald-100 text-emerald-700'
          }`}
        >
          {ended ? t('jobs_billing.status.ended') : t('jobs_billing.status.active')}
        </span>
      </td>
      <td className="px-2 py-2">
        {readOnly ? (
          <span className="text-xs text-slate-600">
            {job.billing_group_id && groupLabels.has(job.billing_group_id)
              ? groupLabels.get(job.billing_group_id)
              : t('jobs_billing.group.separate')}
          </span>
        ) : (
          <>
            <Select
              value={job.billing_group_id ?? SEPARATE}
              onValueChange={onGroupChange}
              disabled={ended || !canGroup}
            >
              <SelectTrigger
                className="h-8 w-full text-xs"
                aria-label={t('jobs_billing.col_group')}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SEPARATE}>{t('jobs_billing.group.separate')}</SelectItem>
                {/* Keep the job's own group selectable so the current value resolves. */}
                {job.billing_group_id && groupLabels.has(job.billing_group_id) && (
                  <SelectItem value={job.billing_group_id}>
                    {groupLabels.get(job.billing_group_id)}
                  </SelectItem>
                )}
                {joinableGroups.map(([gid, label]) => (
                  <SelectItem key={gid} value={gid}>
                    {label}
                  </SelectItem>
                ))}
                {pairTargets.map((other) => (
                  <SelectItem key={other.id} value={`${PAIR_PREFIX}${other.id}`}>
                    {t('jobs_billing.group.pair_with', {
                      title: other.title || t('jobs_billing.untitled'),
                    })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-0.5 text-[10px] leading-tight text-slate-400">
              {t('jobs_billing.group.future_only')}
            </p>
          </>
        )}
      </td>
      <td className="px-2 py-2 text-right">
        {!readOnly && !ended && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setConfirmEnd(true)}
            disabled={end.isPending}
          >
            {t('jobs_billing.end')}
          </Button>
        )}
        {!readOnly && (
          <ConfirmDialog
            open={confirmEnd}
            onOpenChange={setConfirmEnd}
            title={t('jobs_billing.end_confirm_title')}
            description={t('jobs_billing.end_confirm_body')}
            confirmLabel={t('jobs_billing.end')}
            pending={end.isPending}
            onConfirm={async () => {
              try {
                await end.mutateAsync(job.id);
                setConfirmEnd(false);
              } catch (err) {
                reportError(err);
              }
            }}
          />
        )}
      </td>
    </tr>
  );
}

function PaymentCard({
  payment,
  dealId,
  readOnly,
}: {
  payment: PaymentWithLines;
  dealId: string;
  readOnly: boolean;
}) {
  const { t } = useTranslation('deals');
  const update = useUpdateDealPayment(dealId);
  const [invoice, setInvoice] = useState(payment.invoice_number ?? '');

  function toggleStatus() {
    const next = payment.status === 'paid' ? 'pending' : 'paid';
    update
      .mutateAsync({
        id: payment.id,
        patch: { status: next, paid_at: next === 'paid' ? new Date().toISOString() : null },
      })
      .catch(reportError);
  }

  function commitInvoice() {
    if (invoice === (payment.invoice_number ?? '')) return;
    update
      .mutateAsync({ id: payment.id, patch: { invoice_number: invoice || null } })
      .catch(reportError);
  }

  return (
    <div className="rounded-md border">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 px-3 py-2">
        <div className="text-xs text-slate-600">
          <span className="font-medium text-slate-700">
            {payment.due_date ? formatDate(payment.due_date) : t('jobs_billing.payment.no_due_date')}
          </span>
          {payment.label && <span className="ml-2 text-slate-500">· {payment.label}</span>}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs tabular-nums font-medium text-slate-700">
            €{payment.total_gross.toFixed(2)}
          </span>
          {(() => {
            const statusLabel =
              payment.status === 'paid'
                ? t('jobs_billing.payment.status_paid')
                : payment.status === 'overdue'
                  ? t('jobs_billing.payment.status_overdue')
                  : t('jobs_billing.payment.status_pending');
            const statusClass =
              payment.status === 'paid'
                ? 'bg-emerald-100 text-emerald-700'
                : payment.status === 'overdue'
                  ? 'bg-red-100 text-red-700'
                  : 'bg-slate-100 text-slate-700';
            return readOnly ? (
              <span className={`rounded px-2 py-1 text-xs font-medium ${statusClass}`}>
                {statusLabel}
              </span>
            ) : (
              <button
                type="button"
                onClick={toggleStatus}
                className={`rounded px-2 py-1 text-xs font-medium ${statusClass}`}
                title={
                  payment.status === 'paid'
                    ? t('jobs_billing.payment.mark_pending')
                    : t('jobs_billing.payment.mark_paid')
                }
              >
                {statusLabel}
              </button>
            );
          })()}
          {readOnly
            ? payment.invoice_number && (
                <span className="text-xs text-slate-600">#{payment.invoice_number}</span>
              )
            : (
                <Input
                  value={invoice}
                  onChange={(e) => setInvoice(e.target.value)}
                  onBlur={commitInvoice}
                  placeholder={t('jobs_billing.payment.invoice_number')}
                  className="h-7 w-28 text-xs"
                />
              )}
        </div>
      </div>
      {payment.lines.length > 0 && (
        <ul className="divide-y">
          {payment.lines.map((line) => (
            <li
              key={line.id}
              className="flex items-center justify-between px-3 py-1.5 text-xs text-slate-600"
            >
              <span>{line.label || '—'}</span>
              <span className="tabular-nums">€{line.amount_gross.toFixed(2)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A single bucket of the jobs-derived pricing summary. */
type SummaryBucket = { net: number; vat: number; gross: number };

/**
 * Pricing summary computed from the deal's JOBS (mirrors the
 * sync_deal_pricing_from_jobs DB trigger). Only active, non-archived,
 * billing-active jobs contribute. Setup fees are one-time charges so they
 * fold into the one-time bucket. VAT is computed per job (so mixed VAT rates
 * sum correctly) and then aggregated.
 */
function PricingSummary({ jobs }: { jobs: JobBillingRow[] }) {
  const { t } = useTranslation('deals');

  const { oneTime, monthly, yearly } = useMemo(() => {
    const empty = (): SummaryBucket => ({ net: 0, vat: 0, gross: 0 });
    const buckets = { oneTime: empty(), monthly: empty(), yearly: empty() };

    const add = (bucket: SummaryBucket, net: number, vatRate: number) => {
      const vat = net * (vatRate / 100);
      bucket.net += net;
      bucket.vat += vat;
      bucket.gross += net + vat;
    };

    for (const j of jobs) {
      // Mirror the trigger: only active, billing-active jobs count. (The hook
      // already filters out archived jobs.)
      const active = j.status !== 'ended' && j.billing_active !== false;
      if (!active) continue;

      const vatRate = j.vat_rate ?? 0;
      const net = Number(j.amount_net ?? 0);
      const setup = Number(j.setup_fee ?? 0);

      // Setup fees are one-time charges regardless of the job's cadence.
      if (setup) add(buckets.oneTime, setup, vatRate);

      if (j.billing_type === 'recurring_monthly') add(buckets.monthly, net, vatRate);
      else if (j.billing_type === 'recurring_yearly') add(buckets.yearly, net, vatRate);
      else add(buckets.oneTime, net, vatRate);
    }
    return buckets;
  }, [jobs]);

  const rows: Array<{ label: string; bucket: SummaryBucket }> = [
    { label: t('jobs_billing.summary.one_time_label'), bucket: oneTime },
    { label: t('jobs_billing.summary.monthly_label'), bucket: monthly },
    { label: t('jobs_billing.summary.yearly_label'), bucket: yearly },
  ];

  return (
    <div className="rounded-md border bg-slate-50 p-3 text-sm">
      <div className="mb-2 text-xs font-medium uppercase text-slate-500">
        {t('jobs_billing.summary.title')}
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-slate-500">
            <th className="text-left font-normal"></th>
            <th className="text-right font-normal">{t('jobs_billing.summary.subtotal')}</th>
            <th className="text-right font-normal">{t('jobs_billing.summary.vat')}</th>
            <th className="text-right font-normal">{t('jobs_billing.summary.total')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td className="py-1 text-slate-600">{r.label}</td>
              <td className="py-1 text-right">{formatEur(r.bucket.net)}</td>
              <td className="py-1 text-right">{formatEur(r.bucket.vat)}</td>
              <td className="py-1 text-right font-medium">{formatEur(r.bucket.gross)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type Props = {
  dealId: string;
  defaultVatRate?: number;
  /** Hide all mutation controls and render a clean read-only view. */
  readOnly?: boolean;
};

export function JobsBillingPanel({ dealId, defaultVatRate = 24, readOnly = false }: Props) {
  const { t } = useTranslation('deals');
  const { data, isLoading } = useJobsBilling(dealId);
  const [showAdd, setShowAdd] = useState(false);

  const jobs = useMemo(() => data?.jobs ?? [], [data]);
  const payments = data?.payments ?? [];

  // Stable "Group 1 / 2 / …" labels for every billing group currently in use.
  const groupLabels = useMemo(() => {
    const map = new Map<string, string>();
    let n = 1;
    for (const j of jobs) {
      if (j.billing_group_id && !map.has(j.billing_group_id)) {
        map.set(j.billing_group_id, t('jobs_billing.group.label', { n }));
        n += 1;
      }
    }
    return map;
  }, [jobs, t]);

  if (isLoading) return <p className="text-sm text-slate-500">…</p>;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wide text-slate-500">
            {t('jobs_billing.title')}
          </h2>
          {!readOnly && (
            <Button type="button" size="sm" variant="outline" onClick={() => setShowAdd((v) => !v)}>
              {t('jobs_billing.add_job')}
            </Button>
          )}
        </div>

        {!readOnly && showAdd && (
          <AddCustomJobForm
            dealId={dealId}
            defaultVatRate={defaultVatRate}
            onDone={() => setShowAdd(false)}
          />
        )}

        {jobs.length === 0 ? (
          <p className="text-sm text-slate-500">{t('jobs_billing.empty_jobs')}</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50">
                <tr className="text-xs text-slate-500">
                  <th className="px-2 py-2 font-normal">{t('jobs_billing.col_title')}</th>
                  <th className="px-2 py-2 font-normal">{t('jobs_billing.col_department')}</th>
                  <th className="px-2 py-2 font-normal">{t('jobs_billing.col_price')}</th>
                  <th className="px-2 py-2 font-normal">{t('jobs_billing.col_status')}</th>
                  <th className="px-2 py-2 font-normal">{t('jobs_billing.col_group')}</th>
                  <th className="px-2 py-2 font-normal text-right" />
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <JobRow
                    key={j.id}
                    job={j}
                    dealId={dealId}
                    jobs={jobs}
                    groupLabels={groupLabels}
                    readOnly={readOnly}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <PricingSummary jobs={jobs} />

      <div className="space-y-3">
        <h3 className="text-sm font-medium uppercase tracking-wide text-slate-500">
          {t('jobs_billing.payments_title')}
        </h3>
        {payments.length === 0 ? (
          <p className="text-sm text-slate-500">{t('jobs_billing.empty_payments')}</p>
        ) : (
          <div className="space-y-2">
            {payments.map((p) => (
              <PaymentCard key={p.id} payment={p} dealId={dealId} readOnly={readOnly} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
