import { useState } from 'react';
import { PauseCircle, PlayCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { formatDate } from '@/lib/datetime';
import { useJobPauseBilling, useJobResumeBilling } from './hooks/useJobBillingPause';

type Props = {
  jobId: string;
  dealId: string;
  billingType: string;
  billingActive: boolean;
  blockedReason: string | null;
  blockedAt: string | null;
  canToggle: boolean;
};

function reportError(err: unknown) {
  const errors = (err as Error & { errors?: string[] }).errors ?? [(err as Error).message];
  alert(errors.join('\n'));
}

export function JobBillingPauseCard({
  jobId,
  dealId,
  billingType,
  billingActive,
  blockedReason,
  blockedAt,
  canToggle,
}: Props) {
  const [confirmPause, setConfirmPause] = useState(false);
  const [confirmResume, setConfirmResume] = useState(false);
  const pause = useJobPauseBilling(jobId, dealId);
  const resume = useJobResumeBilling(jobId, dealId);

  const isRecurring = billingType === 'recurring_monthly' || billingType === 'recurring_yearly';
  if (!isRecurring) return null;

  const isPaused = blockedReason === 'billing_paused';
  // If billing is inactive for another reason (not paused), don't clutter the UI.
  if (!isPaused && !billingActive) return null;
  // Active + viewer can't toggle → nothing to show.
  if (!isPaused && !canToggle) return null;

  async function onPause() {
    try {
      await pause.mutateAsync();
      setConfirmPause(false);
    } catch (err) {
      reportError(err);
    }
  }

  async function onResume() {
    try {
      await resume.mutateAsync();
      setConfirmResume(false);
    } catch (err) {
      reportError(err);
    }
  }

  return (
    <section className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Billing
      </h2>
      {isPaused ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200">
          <div className="flex items-start gap-2">
            <PauseCircle className="mt-0.5 size-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                Billing paused{blockedAt ? ` since ${formatDate(blockedAt)}` : ''}.
              </p>
              <p className="mt-1 text-xs text-amber-900/80 dark:text-amber-200/80">
                No new payments are generated for this service; the deal ignores its unpaid history.
              </p>
              {canToggle && (
                <div className="mt-3">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setConfirmResume(true)}
                    disabled={resume.isPending}
                  >
                    <PlayCircle className="size-3.5" />
                    Resume billing
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">Billing is active for this service.</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setConfirmPause(true)}
            disabled={pause.isPending}
          >
            <PauseCircle className="size-3.5" />
            Pause billing
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={confirmPause}
        onOpenChange={setConfirmPause}
        title="Pause billing for this service?"
        description="Unpaid payments for this service will be cancelled (kept in history) and no new periods will be generated. The deal can move to Paid In Full on its other services. Paused months are never back-billed."
        confirmLabel="Pause billing"
        pending={pause.isPending}
        onConfirm={onPause}
      />

      <ConfirmDialog
        open={confirmResume}
        onOpenChange={setConfirmResume}
        title="Resume billing for this service?"
        description="The job is unblocked and a fresh billing period starts today. The deal will move to Awaiting Payment."
        confirmLabel="Resume billing"
        pending={resume.isPending}
        onConfirm={onResume}
      />
    </section>
  );
}
