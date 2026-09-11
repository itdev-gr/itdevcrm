import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { TriangleAlert } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/lib/stores/authStore';
import { useNotifications } from './hooks/useNotifications';
import { useMarkNotificationRead } from './hooks/useMarkNotificationRead';

/**
 * The centre-of-screen alert the owner asked for (2026-09-11): when an action
 * leaves a service in a state that silently loses or wrongly charges money, the
 * accountant who did it finds out **now**, not when someone happens to open the
 * Alerts page months later.
 *
 * Delivery reuses what already exists — the `notifications` table plus the
 * Supabase Realtime subscription the bell already runs — so no new
 * infrastructure. `trg_jobs_notify_billing_fault` (20260911190000) is what
 * inserts the row, and only on the TRANSITION into a fault state, so a service
 * that is already wrong does not re-nag on every unrelated edit.
 *
 * Dismissing marks the notification read, which is what stops it reappearing:
 * the list is re-filtered to unread on every render, so an unread row would pop
 * straight back up.
 */
type FaultPayload = {
  fault?: string;
  detail?: string;
  job_code?: string;
  client_name?: string;
  service_type?: string;
  amount?: number | string;
  parent_id?: string;
};

function eur(amount: number): string {
  return `${amount.toFixed(2).replace('.', ',')} €`;
}

export function BillingFaultPopup() {
  const { t } = useTranslation('deals');
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const groupCodes = useAuthStore((s) => s.groupCodes);
  const maySee = isAdmin || groupCodes.includes('accounting');

  const { data: all = [] } = useNotifications();
  const markRead = useMarkNotificationRead();
  // Dismissed in this session: the mark-read round-trip is not instant, and
  // without this the dialog flickers back while the mutation is in flight.
  const [dismissed, setDismissed] = useState<string[]>([]);

  const queue = maySee
    ? all.filter((n) => n.type === 'billing_fault' && !n.read_at && !dismissed.includes(n.id))
    : [];
  const current = queue[0] ?? null;

  // Nothing to render and nothing to do — but hooks must still run in order.
  useEffect(() => {
    if (!maySee && dismissed.length > 0) setDismissed([]);
  }, [maySee, dismissed.length]);

  if (!current) return null;

  const payload = (current.payload ?? {}) as FaultPayload;
  const amount = Number(payload.amount ?? 0);
  const faultKey = payload.fault ?? 'unknown';

  function dismiss() {
    if (!current) return;
    setDismissed((prev) => [...prev, current.id]);
    markRead.mutate(current.id);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && dismiss()}>
      <DialogContent className="max-w-md border-red-300 dark:border-red-800/60">
        <div className="flex items-start gap-3">
          <TriangleAlert className="mt-0.5 size-6 shrink-0 text-red-600 dark:text-red-400" aria-hidden />
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-red-700 dark:text-red-300">
              {t(`billing_fault.title.${faultKey}`, {
                defaultValue: t('billing_fault.title.unknown'),
              })}
            </DialogTitle>
            <DialogDescription className="mt-1">
              {payload.detail ?? t('billing_fault.title.unknown')}
            </DialogDescription>

            <dl className="mt-3 space-y-1 text-sm">
              {payload.client_name ? (
                <div className="flex gap-2">
                  <dt className="text-muted-foreground">{t('billing_fault.client')}</dt>
                  <dd className="font-medium">{payload.client_name}</dd>
                </div>
              ) : null}
              {payload.job_code ? (
                <div className="flex gap-2">
                  <dt className="text-muted-foreground">{t('billing_fault.service')}</dt>
                  <dd className="font-mono text-xs">{payload.job_code}</dd>
                </div>
              ) : null}
              {amount > 0 ? (
                <div className="flex gap-2">
                  <dt className="text-muted-foreground">{t('billing_fault.impact')}</dt>
                  <dd className="font-semibold text-red-700 dark:text-red-300">{eur(amount)}</dd>
                </div>
              ) : null}
            </dl>

            {queue.length > 1 ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {t('billing_fault.more', { count: queue.length - 1 })}
              </p>
            ) : null}

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={dismiss}>
                {t('billing_fault.dismiss')}
              </Button>
              {payload.parent_id ? (
                <Button asChild size="sm" onClick={dismiss}>
                  <Link to={`/jobs/${payload.parent_id}`}>{t('billing_fault.open')}</Link>
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
