import { useState } from 'react';
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
import { formatEur } from '@/lib/countries';
import { useUpdateJobBilling } from '@/features/deals/hooks/useCustomJobMutations';
import { splitInstallments, type InstallmentPlan } from '@/features/deals/installmentSplit';
import { CustomScheduleEditor } from '@/features/deals/CustomScheduleEditor';
import { validateCustomSchedule, type ScheduleRow } from '@/features/deals/customSchedule';
import { billingErrorMessage, reportBillingError as reportError } from '@/features/deals/billingErrors';
import type { BillingType } from '@/lib/rpc';

/** Billing-term options offered per job, in display order. */
const TERMS: { value: BillingType; label: string }[] = [
  { value: 'one_time', label: 'One-time' },
  { value: 'recurring_monthly', label: 'Monthly' },
  { value: 'recurring_yearly', label: 'Yearly' },
];

/** Installment plans offered for one-time web_dev jobs. */
const PLANS: { value: InstallmentPlan; label: string }[] = [
  { value: 'none', label: 'No plan' },
  { value: '50_50', label: '50 / 50' },
  { value: '50_25_25', label: '50 / 25 / 25' },
  { value: 'custom', label: 'Custom' },
];

/** The subset of a job this card needs to edit its billing. */
export type BillingEditJob = {
  id: string;
  deal_id: string;
  amount_net: number | null;
  vat_rate: number | null;
  billing_type: string;
  installment_plan: string;
  installment_schedule?: ScheduleRow[] | null;
  service_type: string;
};

/**
 * Edits ONE job's billing (price, VAT, billing term, and — for one-time
 * web_dev jobs — its installment plan / custom schedule). Mirrors the inner
 * `JobRow` of JobsBillingPanel but as a standalone card for the Job page,
 * available to admins + the accounting group.
 */
export function JobBillingEditCard({ job }: { job: BillingEditJob }) {
  const { t } = useTranslation('deals');
  const update = useUpdateJobBilling(job.deal_id);

  const [price, setPrice] = useState(
    job.amount_net != null ? Number(job.amount_net).toFixed(2) : '',
  );
  const [vat, setVat] = useState(
    job.vat_rate != null ? String(job.vat_rate) : '',
  );
  const [editingSchedule, setEditingSchedule] = useState<ScheduleRow[] | null>(null);

  function commitPrice() {
    const next = Number(price || 0);
    if (next === Number(job.amount_net ?? 0)) return;
    update.mutateAsync({ jobId: job.id, amountNet: next }).catch((err: unknown) => reportError(t, err));
  }

  function commitVat() {
    const next = Number(vat || 0);
    if (next === Number(job.vat_rate ?? 0)) return;
    update.mutateAsync({ jobId: job.id, vatRate: next }).catch((err: unknown) => reportError(t, err));
  }

  async function onTermChange(value: string) {
    if (value === job.billing_type) return;
    try {
      await update.mutateAsync({ jobId: job.id, billingType: value as BillingType });
    } catch (err) {
      reportError(t, err);
    }
  }

  // Installment plans apply only to one-time web_dev and franchise jobs.
  const planEligible =
    (job.service_type === 'web_dev' || job.service_type === 'franchise') &&
    job.billing_type === 'one_time';
  const currentPlan = (job.installment_plan as InstallmentPlan) ?? 'none';

  /** Open the custom-schedule editor, seeded from the job's saved schedule when it has one (matches JobRow). */
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
      reportError(t, err);
    }
  }

  async function saveSchedule() {
    if (!editingSchedule) return;
    const err = validateCustomSchedule(editingSchedule, Number(job.amount_net ?? 0));
    if (err) {
      alert(billingErrorMessage(t, err));
      return;
    }
    try {
      await update.mutateAsync({
        jobId: job.id,
        installmentPlan: 'custom',
        installmentSchedule: editingSchedule,
      });
      setEditingSchedule(null);
    } catch (e) {
      reportError(t, e);
    }
  }

  return (
    <section className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Billing
      </h2>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[11px] text-muted-foreground" htmlFor="job-billing-price">
            Price (net €)
          </label>
          <Input
            id="job-billing-price"
            type="number"
            step="0.01"
            min="0"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            onBlur={commitPrice}
            disabled={update.isPending}
            className="mt-0.5 h-8 w-28 text-sm"
          />
        </div>
        <div>
          <label className="block text-[11px] text-muted-foreground" htmlFor="job-billing-vat">
            VAT %
          </label>
          <Input
            id="job-billing-vat"
            type="number"
            step="0.01"
            min="0"
            value={vat}
            onChange={(e) => setVat(e.target.value)}
            onBlur={commitVat}
            disabled={update.isPending}
            className="mt-0.5 h-8 w-20 text-sm"
          />
        </div>
        <div>
          <span className="block text-[11px] text-muted-foreground">Billing type</span>
          <Select value={job.billing_type} onValueChange={onTermChange} disabled={update.isPending}>
            <SelectTrigger className="mt-0.5 h-8 w-[8rem] text-sm" aria-label="Billing type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TERMS.map((term) => (
                <SelectItem key={term.value} value={term.value}>
                  {term.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {planEligible && (
          <div>
            <span className="block text-[11px] text-muted-foreground">Payment plan</span>
            <Select value={currentPlan} onValueChange={onPlanChange} disabled={update.isPending}>
              <SelectTrigger className="mt-0.5 h-8 w-[9rem] text-sm" aria-label="Payment plan">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PLANS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {/* A controlled Select never re-fires onValueChange for its current
            value, so an already-custom job needs an explicit way in. */}
        {planEligible && currentPlan === 'custom' && !editingSchedule && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 px-3 text-xs"
            onClick={openScheduleEditor}
            disabled={update.isPending}
          >
            {t('jobs_billing.edit_payments')}
          </Button>
        )}
      </div>

      {planEligible &&
        currentPlan !== 'none' &&
        currentPlan !== 'custom' &&
        job.amount_net != null && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            Schedule:{' '}
            {splitInstallments(Number(job.amount_net || 0), currentPlan)
              .map((n) => formatEur(n))
              .join(' + ')}
          </p>
        )}

      {editingSchedule && (
        <div className="mt-3 space-y-1.5">
          <CustomScheduleEditor
            rows={editingSchedule}
            onChange={setEditingSchedule}
            total={Number(job.amount_net ?? 0)}
          />
          <div className="flex gap-1.5">
            <Button
              type="button"
              size="sm"
              className="h-8 px-3 text-xs"
              onClick={saveSchedule}
              disabled={update.isPending}
            >
              Save schedule
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 px-3 text-xs"
              onClick={() => setEditingSchedule(null)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
