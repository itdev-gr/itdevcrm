import { useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useUpsertServicePackage } from './hooks/useUpsertServicePackage';
import type { ServicePackageRow } from './hooks/useServicePackages';
import type { Json } from '@/types/supabase';

const SERVICE_TYPES = [
  'web_seo',
  'local_seo',
  'web_dev',
  'social_media',
  'ai_seo',
  'hosting',
] as const;

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial?: ServicePackageRow | null;
};

type FormProps = {
  initial: ServicePackageRow | null | undefined;
  onOpenChange: (v: boolean) => void;
};

function ServicePackageForm({ initial, onOpenChange }: FormProps) {
  const { t } = useTranslation('admin');
  const upsert = useUpsertServicePackage();

  const dn = initial?.display_names as { en?: string; el?: string } | null | undefined;

  const [serviceType, setServiceType] = useState<(typeof SERVICE_TYPES)[number]>(
    (initial?.service_type as (typeof SERVICE_TYPES)[number]) ?? 'web_seo',
  );
  const [code, setCode] = useState(initial?.code ?? '');
  const [nameEn, setNameEn] = useState(dn?.en ?? '');
  const [nameEl, setNameEl] = useState(dn?.el ?? '');
  const [oneTime, setOneTime] = useState(String(initial?.default_one_time_amount ?? 0));
  const [monthly, setMonthly] = useState(String(initial?.default_monthly_amount ?? 0));
  const [setupFee, setSetupFee] = useState(String(initial?.setup_fee ?? 0));
  const [sortOrder, setSortOrder] = useState(String(initial?.sort_order ?? 0));
  const [description, setDescription] = useState(initial?.description ?? '');

  function toNum(v: string) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!code.trim() || !nameEn.trim()) return;
    try {
      const displayNames: Json = {
        en: nameEn.trim(),
        el: nameEl.trim() || nameEn.trim(),
      };
      const payload = {
        service_type: serviceType,
        code: code.trim(),
        display_names: displayNames,
        default_one_time_amount: toNum(oneTime),
        default_monthly_amount: toNum(monthly),
        setup_fee: toNum(setupFee),
        sort_order: Math.trunc(toNum(sortOrder)),
        description: description.trim() !== '' ? description.trim() : null,
      };
      if (initial?.id) {
        await upsert.mutateAsync({ id: initial.id, ...payload });
      } else {
        await upsert.mutateAsync(payload);
      }
      onOpenChange(false);
    } catch (err) {
      alert((err as Error).message);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div>
        <Label htmlFor="st">{t('service_packages.fields.service_type')}</Label>
        <select
          id="st"
          value={serviceType}
          onChange={(e) => setServiceType(e.target.value as (typeof SERVICE_TYPES)[number])}
          className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          disabled={!!initial}
        >
          {SERVICE_TYPES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor="cd">{t('service_packages.fields.code')}</Label>
          <Input
            id="cd"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            disabled={!!initial}
          />
        </div>
        <div>
          <Label htmlFor="so">{t('service_packages.fields.sort_order')}</Label>
          <Input
            id="so"
            type="number"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="ne">{t('service_packages.fields.name_en')}</Label>
          <Input id="ne" value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="nl">{t('service_packages.fields.name_el')}</Label>
          <Input id="nl" value={nameEl} onChange={(e) => setNameEl(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="ot">{t('service_packages.fields.default_one_time')}</Label>
          <Input
            id="ot"
            inputMode="decimal"
            value={oneTime}
            onChange={(e) => setOneTime(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="mo">{t('service_packages.fields.default_monthly')}</Label>
          <Input
            id="mo"
            inputMode="decimal"
            value={monthly}
            onChange={(e) => setMonthly(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="sf">{t('service_packages.fields.setup_fee')}</Label>
          <Input
            id="sf"
            inputMode="decimal"
            value={setupFee}
            onChange={(e) => setSetupFee(e.target.value)}
          />
        </div>
      </div>
      <div>
        <Label htmlFor="ds">{t('service_packages.fields.description')}</Label>
        <textarea
          id="ds"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="mt-1 block min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          {t('service_packages.cancel')}
        </Button>
        <Button type="submit" disabled={upsert.isPending}>
          {t('service_packages.save')}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function ServicePackageDialog({ open, onOpenChange, initial }: Props) {
  const { t } = useTranslation('admin');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {initial ? t('service_packages.edit_title') : t('service_packages.add_title')}
          </DialogTitle>
        </DialogHeader>
        <ServicePackageForm
          key={open ? (initial?.id ?? 'new') : 'closed'}
          initial={initial}
          onOpenChange={onOpenChange}
        />
      </DialogContent>
    </Dialog>
  );
}
