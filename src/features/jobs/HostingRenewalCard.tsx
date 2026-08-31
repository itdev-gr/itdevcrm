import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/lib/stores/authStore';
import { useUpdateDealPayment } from '@/features/deals/hooks/useDealPayments';
import { queryKeys } from '@/lib/queryKeys';
import { useHostingRenewalPayment } from './hooks/useHostingRenewal';

/**
 * Editable hosting renewal anniversary. Hosting period dates derive from the
 * payment chain, which is seeded from the day the deal closed — usually NOT
 * the real hosting anniversary. Accounting corrects it here: the edit writes
 * the chain-head payment's end_date, so the next yearly charge (and, when the
 * head is paid, the job's «Renewal due») anchor to the true date.
 */
export function HostingRenewalCard({ jobId, dealId }: { jobId: string; dealId: string | null }) {
  const qc = useQueryClient();
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const groupCodes = useAuthStore((s) => s.groupCodes);
  const canEdit = isAdmin || groupCodes.includes('accounting');
  const { data: payment, isLoading } = useHostingRenewalPayment(dealId);
  const update = useUpdateDealPayment(dealId ?? '');
  const [draft, setDraft] = useState('');

  useEffect(() => {
    setDraft(payment?.end_date ?? '');
  }, [payment?.end_date]);

  if (!dealId || isLoading) return null;

  const dirty = !!payment && draft !== (payment.end_date ?? '');

  function save() {
    if (!payment || !dirty || !draft) return;
    update
      .mutateAsync({ id: payment.id, patch: { end_date: draft } })
      .then(() => {
        // A paid head recomputes the job's period via the DB trigger.
        void qc.invalidateQueries({ queryKey: ['hosting-renewal-payment', dealId] });
        void qc.invalidateQueries({ queryKey: queryKeys.job(jobId) });
        void qc.invalidateQueries({ queryKey: ['jobs'] });
      })
      .catch((e: Error) => alert(e.message));
  }

  return (
    <section className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Hosting renewal
      </h2>
      {!payment ? (
        <p className="text-sm text-muted-foreground">
          No hosting payment exists yet for this deal — the renewal date will appear once the
          first yearly charge is created.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="hosting-renewal-date" className="text-sm text-muted-foreground">
              Renewal date
            </label>
            <input
              id="hosting-renewal-date"
              type="date"
              value={draft}
              disabled={!canEdit || update.isPending}
              onChange={(e) => setDraft(e.target.value)}
              className="rounded border border-input bg-background px-2 py-1 text-sm"
            />
            {canEdit && dirty && (
              <button
                type="button"
                onClick={save}
                disabled={update.isPending}
                className="rounded bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground"
              >
                Save
              </button>
            )}
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              {payment.status}
            </span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Set this to the REAL hosting anniversary (not the day the client paid). Future yearly
            charges are computed from this date.
            {payment.status !== 'paid' &&
              ' The list’s “Renewal due” updates when this charge is marked paid.'}
          </p>
        </>
      )}
    </section>
  );
}
