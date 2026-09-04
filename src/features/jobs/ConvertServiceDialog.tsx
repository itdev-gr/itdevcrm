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
import { useOfferCatalog } from '@/features/offers/hooks/useOfferCatalog';

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
  const { t, i18n } = useTranslation('jobs');
  const targets = convertibleTargets(job);
  const [target, setTarget] = useState(targets[0] ?? '');
  const [newPrice, setNewPrice] = useState('');
  // Converting INTO ads has to say which ads. Without this the job lands with
  // the generic 'Ads' title, which is how six of the existing ads jobs ended up
  // recording nothing about what they are.
  const [adsPackageId, setAdsPackageId] = useState('');
  const { data: catalog = [] } = useOfferCatalog();
  const adsPackages = catalog.filter((p) => p.service_type === 'ads');
  const adsName = (p: (typeof adsPackages)[number]) =>
    p.display_names[i18n.language.startsWith('el') ? 'el' : 'en'] ?? p.code;
  const needsAdsType = target === 'ads';
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
    if (needsAdsType && !adsPackageId) return;
    try {
      const result = await convert.mutateAsync({ jobId: job.id, target });
      const price = newPrice.trim();
      const wantsPrice = price !== '' && Number.isFinite(Number(price));
      // Name the job after the chosen package. Deliberately NOT the catalogue
      // price: this dialog promises "amounts/payments stay the same", and the
      // price field above is there for anyone who wants to change it.
      const pkg = needsAdsType ? adsPackages.find((p) => p.id === adsPackageId) : undefined;
      if (result?.id && (wantsPrice || pkg)) {
        await updateBilling.mutateAsync({
          jobId: result.id,
          ...(wantsPrice ? { amountNet: Number(price) } : {}),
          ...(pkg ? { title: adsName(pkg) } : {}),
        });
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
            {needsAdsType && (
              <div>
                <Label htmlFor="convert-ads-type" className="text-[11px] text-muted-foreground">
                  {t('convert.ads_type')}
                </Label>
                <select
                  id="convert-ads-type"
                  value={adsPackageId}
                  onChange={(e) => setAdsPackageId(e.target.value)}
                  disabled={busy}
                  aria-label={t('convert.ads_type')}
                  className="mt-0.5 h-8 w-full rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                >
                  <option value="">{t('convert.ads_type_placeholder')}</option>
                  {adsPackages.map((p) => (
                    <option key={p.id} value={p.id}>
                      {adsName(p)}
                    </option>
                  ))}
                </select>
              </div>
            )}
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
            <Button
              type="button"
              onClick={onConfirm}
              disabled={busy || !target || (needsAdsType && !adsPackageId)}
            >
              {t('convert.confirm')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
