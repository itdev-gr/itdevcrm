import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { accountingPrepayMonths, type PrepayResult } from '@/lib/rpc';
import { invalidateFinancialReports } from '@/lib/financialInvalidations';
import { dealPaymentsKey } from './hooks/useDealPayments';
import { jobsBillingKey } from './hooks/useJobsBilling';

const MONTH_CHOICES = [1, 2, 3, 4, 5, 6, 9, 12];

/** Records N prepaid months for every active monthly chain of the deal.
 *  The preview is SERVER-computed (RPC dry-run) so what you see is exactly
 *  what gets created; confirm re-runs the same RPC without dry-run. */
export function PrepayDialog({
  dealId,
  open,
  onClose,
}: {
  dealId: string;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation('deals');
  const qc = useQueryClient();
  const [months, setMonths] = useState(3);
  const [preview, setPreview] = useState<PrepayResult | null>(null);
  const [done, setDone] = useState<PrepayResult | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || done) return;
    let cancelled = false;
    setPreview(null);
    accountingPrepayMonths(dealId, months, true)
      .then((r) => {
        if (!cancelled) setPreview(r);
      })
      .catch((e: Error) => {
        if (!cancelled) setPreview({ ok: false, errors: [e.message] });
      });
    return () => {
      cancelled = true;
    };
  }, [dealId, months, open, done]);

  async function confirm() {
    setBusy(true);
    try {
      const r = await accountingPrepayMonths(dealId, months, false);
      setDone(r);
      void qc.invalidateQueries({ queryKey: dealPaymentsKey(dealId) });
      void qc.invalidateQueries({ queryKey: jobsBillingKey(dealId) });
      void qc.invalidateQueries({ queryKey: ['accounting-deals'] });
      void qc.invalidateQueries({ queryKey: ['accounting-ledger'] });
      void qc.invalidateQueries({ queryKey: ['accounting-pl-summary'] });
      // Prepay pushes each chain's renewal horizon out and records paid periods,
      // which the Recurring page and MRR figures read — refresh them too so they
      // don't show stale "next due" / collected amounts until a manual reload.
      void qc.invalidateQueries({ queryKey: ['recurring-clients'] });
      void qc.invalidateQueries({ queryKey: ['accounting-mrr'] });
      // Also refresh the P&L / dashboard trend keys the block above doesn't cover.
      invalidateFinancialReports(qc);
    } catch (e) {
      setDone({ ok: false, errors: [(e as Error).message] });
    } finally {
      setBusy(false);
    }
  }

  const groups = (preview?.groups ?? []).filter((g) => !g.error);
  const total = groups.reduce((s, g) => s + Number(g.monthly_net) * months, 0);
  const noChain = preview !== null && !preview.ok;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('payments.prepay_title', { defaultValue: 'Prepay months' })}</DialogTitle>
          <DialogDescription>
            {t('payments.prepay_desc', {
              defaultValue: 'Creates the future monthly periods and marks them as paid.',
            })}
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="space-y-2 text-sm">
            {done.ok ? (
              <p>
                {t('payments.prepay_done', {
                  n: done.periods_created ?? 0,
                  defaultValue: 'Recorded {{n}} period(s) as paid.',
                })}
                {(done.skipped_duplicates ?? 0) > 0 && (
                  <span className="block text-muted-foreground">
                    {t('payments.prepay_skipped', {
                      n: done.skipped_duplicates,
                      defaultValue: 'Skipped {{n}} duplicate period(s).',
                    })}
                  </span>
                )}
              </p>
            ) : (
              <p className="text-red-600">{(done.errors ?? []).join(', ')}</p>
            )}
          </div>
        ) : noChain ? (
          <p className="text-sm text-muted-foreground">
            {t('payments.prepay_no_chain', {
              defaultValue: 'This deal has no active monthly services.',
            })}
          </p>
        ) : (
          <div className="space-y-3 text-sm">
            <div>
              <Label className="text-xs">{t('payments.prepay_months', { defaultValue: 'Months' })}</Label>
              <select
                value={months}
                onChange={(e) => setMonths(Number(e.target.value))}
                className="mt-1 block w-24 rounded-md border border-input bg-background px-2 py-1 text-xs"
              >
                {MONTH_CHOICES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            {preview === null ? (
              <p className="text-muted-foreground">…</p>
            ) : (
              <>
                <ul className="space-y-1">
                  {groups.map((g) => (
                    <li key={g.group_key} className="flex justify-between gap-2">
                      <span className="min-w-0 truncate">{g.services.join(' + ')}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        €{Number(g.monthly_net).toFixed(2)}/{t('payments.prepay_mo', { defaultValue: 'mo' })} · {g.from} → {g.to}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="border-t pt-2 font-medium tabular-nums">
                  {t('payments.prepay_total', { defaultValue: 'Total to record' })}: €{total.toFixed(2)}
                </p>
              </>
            )}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            {done ? t('payments.prepay_close', { defaultValue: 'Close' }) : t('payments.prepay_cancel', { defaultValue: 'Cancel' })}
          </Button>
          {!done && !noChain && (
            <Button type="button" size="sm" onClick={() => void confirm()} disabled={busy || preview === null}>
              {t('payments.prepay_confirm', { defaultValue: 'Record prepayment' })}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
