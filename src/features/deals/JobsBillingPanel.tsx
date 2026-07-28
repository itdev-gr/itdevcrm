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
import { AddWebsiteForm } from './AddWebsiteForm';
import {
  useJobsBilling,
  type JobBillingRow,
  type PaymentWithLines,
} from './hooks/useJobsBilling';
import { useEndJob, useUpdateJobBilling } from './hooks/useCustomJobMutations';
import { useUpdateDealPayment } from './hooks/useDealPayments';
import { formatDate } from '@/lib/datetime';
import { formatEur } from '@/lib/countries';
import { splitInstallments, type InstallmentPlan } from './installmentSplit';
import { CustomScheduleEditor } from './CustomScheduleEditor';
import { validateCustomSchedule, type ScheduleRow } from './customSchedule';
import { billingErrorMessage, reportBillingError as reportError } from './billingErrors';
import type { BillingType } from '@/lib/rpc';
import { PauseCircle, PlayCircle } from 'lucide-react';
import { useJobPauseBilling, useJobResumeBilling } from '@/features/jobs/hooks/useJobBillingPause';

/** Billing-term options offered per job, in display order. */
const TERMS: BillingType[] = ['one_time', 'recurring_monthly', 'recurring_yearly'];
/** Installment plans offered for one-time web_dev jobs. */
const PLANS: InstallmentPlan[] = ['none', '50_50', '50_25_25', 'custom'];

const SEPARATE = '__separate__';
/** Prefix for "pair with job X" options whose value encodes the target job id. */
const PAIR_PREFIX = 'pair:';

/** True when two jobs can share one recurring payment (same billing cadence). */
function canGroupTogether(a: JobBillingRow, b: JobBillingRow): boolean {
  if (a.id === b.id) return false;
  if (a.billing_type !== 'recurring_monthly' && a.billing_type !== 'recurring_yearly') return false;
  return a.billing_type === b.billing_type;
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
  const pause = useJobPauseBilling(job.id, dealId);
  const resume = useJobResumeBilling(job.id, dealId);

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
  const [confirmPause, setConfirmPause] = useState(false);
  const [confirmResume, setConfirmResume] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<ScheduleRow[] | null>(null);

  const ended = job.status === 'ended' || job.billing_active === false;
  const isRecurring = job.billing_type === 'recurring_monthly' || job.billing_type === 'recurring_yearly';
  const isPaused = job.blocked_reason === 'billing_paused';
  const showPause = !readOnly && isRecurring && job.parent_job_id == null && !isPaused && !ended;
  const showResume = !readOnly && isRecurring && job.parent_job_id == null && isPaused;
  const department = job.billing_only
    ? t('jobs_billing.billing_only')
    : t(`services.types.${job.department}`, { defaultValue: job.department });

  function commitPrice() {
    const next = Number(price || 0);
    if (next === Number(job.amount_net ?? 0)) return;
    update.mutateAsync({ jobId: job.id, amountNet: next }).catch((err: unknown) => reportError(t, err));
  }

  async function onTermChange(value: string) {
    if (value === job.billing_type) return;
    try {
      // A one-time job can't be bundled into a (recurring) billing group, so
      // clear any grouping when switching to one-time.
      await update.mutateAsync({
        jobId: job.id,
        billingType: value as BillingType,
        ...(value === 'one_time' && job.billing_group_id ? { clearGroup: true } : {}),
      });
    } catch (err) {
      reportError(t, err);
    }
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
      reportError(t, err);
    }
  }

  // Installment plans apply only to one-time web_dev and franchise jobs.
  const planEligible =
    (job.department === 'web_dev' || job.department === 'franchise') && job.billing_type === 'one_time';
  const currentPlan = (job.installment_plan as InstallmentPlan) ?? 'none';

  /** Open the custom-schedule editor, seeded from the job's saved schedule when it has one. */
  function openScheduleEditor() {
    const saved = job.installment_schedule;
    setEditingSchedule(
      saved && saved.length > 0
        ? saved.map((r) => ({ amount_net: Number(r.amount_net ?? 0), due_date: r.due_date ?? null }))
        : [{ amount_net: Number(job.amount_net ?? 0), due_date: null }],
    );
  }

  async function onPlanChange(value: string) {
    // 'custom' is handled before the unchanged-value guard so re-selecting it
    // on an already-custom job opens the schedule editor instead of no-oping.
    if (value === 'custom') {
      openScheduleEditor();
      return;
    }
    if (value === currentPlan) return;
    try {
      await update.mutateAsync({ jobId: job.id, installmentPlan: value as InstallmentPlan });
    } catch (err) {
      // Translate known billing error codes (e.g. cannot_replan_paid_installment).
      reportError(t, err);
    }
  }
  async function saveSchedule() {
    if (!editingSchedule) return;
    const err = validateCustomSchedule(editingSchedule, Number(job.amount_net ?? 0));
    if (err) { alert(billingErrorMessage(t, err)); return; }
    try {
      await update.mutateAsync({ jobId: job.id, installmentPlan: 'custom', installmentSchedule: editingSchedule });
      setEditingSchedule(null);
    } catch (e) {
      reportError(t, e);
    }
  }

  const noteText = (job.description ?? '').trim();
  const notePreview = noteText.length > 120 ? `${noteText.slice(0, 120)}…` : noteText;

  return (
    <>
    <tr className="border-t">
      <td className="px-1.5 py-1.5 text-[11px] text-foreground">
        {job.title || '—'}
        {job.is_custom && (
          <span className="ml-1 rounded bg-purple-100 px-1 text-[9px] font-medium uppercase text-purple-700 dark:bg-purple-950/50 dark:text-purple-300">
            custom
          </span>
        )}
      </td>
      <td className="px-1.5 py-1.5 text-[11px] text-muted-foreground">{department}</td>
      <td className="px-1.5 py-1.5">
        {readOnly ? (
          <span className="text-[11px] text-foreground">
            €{Number(job.amount_net ?? 0).toFixed(2)}
            <span className="text-[10px] text-muted-foreground">{cadenceSuffix(t, job.billing_type)}</span>
          </span>
        ) : (
          <div className="flex items-center gap-1">
            <span className="text-[11px] text-muted-foreground">€</span>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              onBlur={commitPrice}
              disabled={ended}
              className="h-7 w-16 text-[11px]"
            />
            <span className="text-[10px] text-muted-foreground">
              {cadenceSuffix(t, job.billing_type)}
            </span>
          </div>
        )}
      </td>
      <td className="px-1.5 py-1.5">
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
            isPaused
              ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300'
              : ended
                ? 'bg-muted text-muted-foreground'
                : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
          }`}
        >
          {isPaused
            ? t('jobs_billing.pause.paused')
            : ended
              ? t('jobs_billing.status.ended')
              : t('jobs_billing.status.active')}
        </span>
      </td>
      <td className="px-1.5 py-1.5">
        {readOnly ? (
          <span className="text-[11px] text-muted-foreground">
            {job.billing_group_id && groupLabels.has(job.billing_group_id)
              ? groupLabels.get(job.billing_group_id)
              : t('jobs_billing.group.separate')}
          </span>
        ) : (
          <div className="space-y-1">
            <div className="flex min-w-[12.5rem] flex-wrap gap-1">
              <Select value={job.billing_type} onValueChange={onTermChange} disabled={ended}>
                <SelectTrigger
                  className="h-7 w-[6.25rem] text-[11px]"
                  aria-label={t('jobs_billing.col_term')}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(job.department === 'hosting' || job.department === 'domains' ? (['recurring_yearly'] as BillingType[]) : TERMS).map(
                    (term) => (
                      <SelectItem key={term} value={term}>
                        {t(`jobs_billing.cadence_options.${term}`)}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
              <Select
                value={job.billing_group_id ?? SEPARATE}
                onValueChange={onGroupChange}
                disabled={ended || !canGroup}
              >
                <SelectTrigger
                  className="h-7 w-[6.75rem] text-[11px]"
                  aria-label={t('jobs_billing.col_group')}
                  title={t('jobs_billing.group.future_only')}
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
              {planEligible && (
                <Select value={currentPlan} onValueChange={onPlanChange} disabled={ended}>
                  <SelectTrigger className="h-7 w-[7.5rem] text-[11px]" aria-label={t('jobs_billing.plan_label')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PLANS.map((p) => (
                      <SelectItem key={p} value={p}>
                        {t(`jobs_billing.plan_options.${p}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {/* A controlled Select never re-fires onValueChange for its current
                  value, so an already-custom job needs an explicit way in. */}
              {planEligible && currentPlan === 'custom' && !editingSchedule && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-[11px]"
                  onClick={openScheduleEditor}
                  disabled={ended}
                >
                  {t('jobs_billing.edit_payments')}
                </Button>
              )}
            </div>
            {planEligible && currentPlan !== 'none' && currentPlan !== 'custom' && job.amount_net != null && (
              <p className="text-[10px] text-muted-foreground">
                {t('jobs_billing.plan_preview', {
                  parts: splitInstallments(Number(job.amount_net || 0), currentPlan)
                    .map((n) => formatEur(n))
                    .join(' + '),
                })}
              </p>
            )}
            {editingSchedule && (
              <div className="space-y-1">
                <CustomScheduleEditor rows={editingSchedule} onChange={setEditingSchedule} total={Number(job.amount_net ?? 0)} />
                <div className="flex gap-1">
                  <Button type="button" size="sm" className="h-7 px-2 text-[11px]" onClick={saveSchedule} disabled={update.isPending}>
                    {t('jobs_billing.schedule.save')}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => setEditingSchedule(null)}>
                    {t('jobs_billing.schedule.cancel')}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </td>
      <td className="px-1.5 py-1.5 text-right">
        <div className="flex items-center justify-end gap-1">
          {showPause && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 px-2 text-[11px]"
              onClick={() => setConfirmPause(true)}
              disabled={pause.isPending}
            >
              <PauseCircle className="size-3.5" />
              {t('jobs_billing.pause.pause')}
            </Button>
          )}
          {showResume && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 px-2 text-[11px]"
              onClick={() => setConfirmResume(true)}
              disabled={resume.isPending}
            >
              <PlayCircle className="size-3.5" />
              {t('jobs_billing.pause.resume')}
            </Button>
          )}
          {!readOnly && !ended && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 px-2 text-[11px]"
              onClick={() => setConfirmEnd(true)}
              disabled={end.isPending}
            >
              {t('jobs_billing.end')}
            </Button>
          )}
        </div>
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
                reportError(t, err);
              }
            }}
          />
        )}
        {showPause && (
          <ConfirmDialog
            open={confirmPause}
            onOpenChange={setConfirmPause}
            title={t('jobs_billing.pause.pause_confirm_title')}
            description={t('jobs_billing.pause.pause_confirm_body')}
            confirmLabel={t('jobs_billing.pause.pause')}
            pending={pause.isPending}
            onConfirm={async () => {
              try {
                await pause.mutateAsync();
                setConfirmPause(false);
              } catch (err) {
                reportError(t, err);
              }
            }}
          />
        )}
        {showResume && (
          <ConfirmDialog
            open={confirmResume}
            onOpenChange={setConfirmResume}
            title={t('jobs_billing.pause.resume_confirm_title')}
            description={t('jobs_billing.pause.resume_confirm_body')}
            confirmLabel={t('jobs_billing.pause.resume')}
            pending={resume.isPending}
            onConfirm={async () => {
              try {
                await resume.mutateAsync();
                setConfirmResume(false);
              } catch (err) {
                reportError(t, err);
              }
            }}
          />
        )}
      </td>
    </tr>
    {noteText && (
      <tr data-testid={`note-preview-${job.id}`} className="border-t-0">
        <td
          colSpan={6}
          title={noteText}
          className="px-1.5 pb-1.5 pt-0 text-[10px] italic text-muted-foreground truncate"
        >
          {notePreview}
        </td>
      </tr>
    )}
    </>
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
      .catch((err: unknown) => reportError(t, err));
  }

  function commitInvoice() {
    if (invoice === (payment.invoice_number ?? '')) return;
    update
      .mutateAsync({ id: payment.id, patch: { invoice_number: invoice || null } })
      .catch((err: unknown) => reportError(t, err));
  }

  return (
    <div className="rounded-md border overflow-hidden">
      <div className="flex flex-col gap-2 bg-muted px-2.5 py-1.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">
            {payment.due_date ? formatDate(payment.due_date) : t('jobs_billing.payment.no_due_date')}
          </span>
          {payment.label && <span className="ml-1.5 text-muted-foreground">· {payment.label}</span>}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <span className="text-[11px] tabular-nums font-medium text-foreground">
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
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                : payment.status === 'overdue'
                  ? 'bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300'
                  : 'bg-muted text-muted-foreground';
            return readOnly ? (
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${statusClass}`}>
                {statusLabel}
              </span>
            ) : (
              <button
                type="button"
                onClick={toggleStatus}
                className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${statusClass}`}
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
                <span className="text-[11px] text-muted-foreground">#{payment.invoice_number}</span>
              )
            : (
                <Input
                  value={invoice}
                  onChange={(e) => setInvoice(e.target.value)}
                  onBlur={commitInvoice}
                  placeholder={t('jobs_billing.payment.invoice_number')}
                  className="h-7 w-24 text-[11px]"
                />
              )}
        </div>
      </div>
      {payment.lines.length > 0 && (
        <ul className="divide-y">
          {payment.lines.map((line) => (
            <li
              key={line.id}
              className="flex items-center justify-between px-3 py-1.5 text-xs text-muted-foreground"
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
    <div className="rounded-md border bg-muted p-2 text-xs">
      <div className="mb-1.5 text-[10px] font-medium uppercase text-muted-foreground">
        {t('jobs_billing.summary.title')}
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-xs text-muted-foreground">
            <th className="text-left font-normal"></th>
            <th className="text-right font-normal">{t('jobs_billing.summary.subtotal')}</th>
            <th className="text-right font-normal">{t('jobs_billing.summary.vat')}</th>
            <th className="text-right font-normal">{t('jobs_billing.summary.total')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td className="py-1 text-muted-foreground">{r.label}</td>
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
  /** Legacy ClickUp "Invoiced Date" — the real start date, shown read-only. */
  invoicedDate?: string | null;
};

export function JobsBillingPanel({
  dealId,
  defaultVatRate = 24,
  readOnly = false,
  invoicedDate = null,
}: Props) {
  const { t, i18n } = useTranslation('deals');
  const { data, isLoading } = useJobsBilling(dealId);
  const [showAdd, setShowAdd] = useState(false);
  const [showAddWebsite, setShowAddWebsite] = useState(false);

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

  if (isLoading) return <p className="text-sm text-muted-foreground">…</p>;

  return (
    <div className="min-w-0 space-y-4">
      <div className="min-w-0 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t('jobs_billing.title')}
          </h2>
          {!readOnly && (
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 px-2 text-[11px]"
                onClick={() => setShowAddWebsite((v) => !v)}
              >
                {t('jobs_billing.add_website')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 px-2 text-[11px]"
                onClick={() => setShowAdd((v) => !v)}
              >
                {t('jobs_billing.add_job')}
              </Button>
            </div>
          )}
        </div>

        <p className="text-[11px] text-muted-foreground" data-testid="jobs-billing-invoiced-date">
          {t('jobs_billing.invoiced_date')}:{' '}
          <span className="font-medium text-foreground">
            {invoicedDate ? formatDate(invoicedDate, i18n.language) : '—'}
          </span>
        </p>

        {!readOnly && showAdd && (
          <AddCustomJobForm
            dealId={dealId}
            defaultVatRate={defaultVatRate}
            onDone={() => setShowAdd(false)}
          />
        )}

        {!readOnly && showAddWebsite && (
          <AddWebsiteForm dealId={dealId} onDone={() => setShowAddWebsite(false)} />
        )}

        {jobs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('jobs_billing.empty_jobs')}</p>
        ) : (
          <div className="min-w-0 overflow-x-auto rounded-md border">
            <table className="w-full min-w-[36rem] text-left text-xs">
              <thead className="bg-muted">
                <tr className="text-[10px] text-muted-foreground">
                  <th className="px-1.5 py-1.5 font-normal">{t('jobs_billing.col_title')}</th>
                  <th className="px-1.5 py-1.5 font-normal">{t('jobs_billing.col_department')}</th>
                  <th className="px-1.5 py-1.5 font-normal">{t('jobs_billing.col_price')}</th>
                  <th className="px-1.5 py-1.5 font-normal">{t('jobs_billing.col_status')}</th>
                  <th className="px-1.5 py-1.5 font-normal">{t('jobs_billing.col_group')}</th>
                  <th className="px-1.5 py-1.5 font-normal text-right" />
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

      <div className="min-w-0 space-y-2">
        <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {t('jobs_billing.payments_title')}
        </h3>
        {payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('jobs_billing.empty_payments')}</p>
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
