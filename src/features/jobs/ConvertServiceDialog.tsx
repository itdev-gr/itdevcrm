import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { convertibleTargets } from './serviceConversion';
import { useConvertJobService } from './hooks/useConvertJobService';
import { useUpdateJobBilling } from '@/features/deals/hooks/useCustomJobMutations';

type ConvertJob = {
  id: string;
  deal_id: string;
  service_type: string;
  parent_job_id: string | null;
  hasChildren?: boolean;
  billing_only?: boolean | null;
};

/**
 * Admin/accounting dialog that converts a job between service types via the
 * `convert_job_service_type` RPC (amounts preserved; board/owner/tasks/code
 * realigned). Optionally also changes the price: after a successful convert it
 * calls the existing `update_job_billing` on the resulting billing job so we
 * reuse the tested billing logic instead of duplicating it.
 *
 * The target picker is a NATIVE <select>: a Radix Select nested inside this
 * Radix Dialog fails to open reliably (focus-scope / portal), so we avoid it.
 */
export function ConvertServiceDialog({
  job,
  open,
  onOpenChange,
}: {
  job: ConvertJob;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation('jobs');
  const targets = convertibleTargets(job);
  const [target, setTarget] = useState(targets[0] ?? '');
  const [newPrice, setNewPrice] = useState('');
  const convert = useConvertJobService();
  const updateBilling = useUpdateJobBilling(job.deal_id);
  const busy = convert.isPending || updateBilling.isPending;

  const label = (s: string) => t(`deals:services.types.${s}`, { defaultValue: s });
  const warningKey =
    job.service_type === 'ai_seo'
      ? 'convert.warning_ai_down'
      : target === 'ai_seo'
        ? 'convert.warning_ai_up'
        : 'convert.warning';

  async function onConfirm() {
    if (!target) return;
    try {
      const result = await convert.mutateAsync({ jobId: job.id, target });
      const price = newPrice.trim();
      if (price !== '' && Number.isFinite(Number(price)) && result?.id) {
        await updateBilling.mutateAsync({ jobId: result.id, amountNet: Number(price) });
      }
      onOpenChange(false);
      window.alert(t('convert.success'));
    } catch (e) {
      window.alert(t('convert.error', { msg: e instanceof Error ? e.message : String(e) }));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('convert.title')}</DialogTitle>
        </DialogHeader>
        {targets.length === 0 ? (
          <DialogDescription>{t('convert.none')}</DialogDescription>
        ) : (
          <div className="space-y-3">
            <div>
              <Label htmlFor="convert-target" className="text-[11px] text-muted-foreground">
                {t('convert.target')}
              </Label>
              <select
                id="convert-target"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                disabled={busy}
                aria-label={t('convert.target')}
                className="mt-0.5 h-8 w-full rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
              >
                {targets.map((s) => (
                  <option key={s} value={s}>
                    {label(s)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="convert-price" className="text-[11px] text-muted-foreground">
                {t('convert.new_price')}
              </Label>
              <Input
                id="convert-price"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={newPrice}
                onChange={(e) => setNewPrice(e.target.value)}
                placeholder={t('convert.new_price_hint')}
                disabled={busy}
                className="mt-0.5 h-8 text-sm"
              />
            </div>
            <DialogDescription>{t(warningKey)}</DialogDescription>
          </div>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {t('common:cancel', { defaultValue: 'Cancel' })}
            </Button>
          </DialogClose>
          {targets.length > 0 && (
            <Button type="button" onClick={onConfirm} disabled={busy || !target}>
              {t('convert.confirm')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
