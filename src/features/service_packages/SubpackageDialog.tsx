import { useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useUpsertSubpackage } from './hooks/useUpsertSubpackage';
import type { ServiceSubpackageRow } from './hooks/useServiceSubpackages';
import type { Json } from '@/types/supabase';

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  parentId: string;
  initial?: ServiceSubpackageRow | null;
};

type FormProps = {
  parentId: string;
  initial: ServiceSubpackageRow | null | undefined;
  onOpenChange: (v: boolean) => void;
};

function SubpackageForm({ parentId, initial, onOpenChange }: FormProps) {
  const { t } = useTranslation('admin');
  const upsert = useUpsertSubpackage(parentId);

  const dn = initial?.display_names as { en?: string; el?: string } | null | undefined;

  const [code, setCode] = useState(initial?.code ?? '');
  const [nameEn, setNameEn] = useState(dn?.en ?? '');
  const [nameEl, setNameEl] = useState(dn?.el ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [price, setPrice] = useState(String(initial?.price ?? 0));
  const [sortOrder, setSortOrder] = useState(String(initial?.sort_order ?? 0));
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);

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
        parent_package_id: parentId,
        code: code.trim(),
        display_names: displayNames,
        description: description.trim() !== '' ? description.trim() : null,
        price: toNum(price),
        sort_order: Math.trunc(toNum(sortOrder)),
        is_active: isActive,
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
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor="sub-cd">{t('service_packages.fields.code')}</Label>
          <Input
            id="sub-cd"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            disabled={!!initial}
          />
        </div>
        <div>
          <Label htmlFor="sub-so">{t('service_packages.fields.sort_order')}</Label>
          <Input
            id="sub-so"
            type="number"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="sub-ne">{t('service_packages.fields.name_en')}</Label>
          <Input id="sub-ne" value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="sub-nl">{t('service_packages.fields.name_el')}</Label>
          <Input id="sub-nl" value={nameEl} onChange={(e) => setNameEl(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="sub-pr">{t('service_packages.fields.price')}</Label>
          <Input
            id="sub-pr"
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </div>
      </div>
      <div>
        <Label htmlFor="sub-ds">{t('service_packages.fields.description')}</Label>
        <textarea
          id="sub-ds"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="mt-1 block min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </div>
      <div className="flex items-center gap-2">
        <input
          id="sub-ia"
          type="checkbox"
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
          className="h-4 w-4"
        />
        <Label htmlFor="sub-ia">{t('service_packages.fields.is_active')}</Label>
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

export function SubpackageDialog({ open, onOpenChange, parentId, initial }: Props) {
  const { t } = useTranslation('admin');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {initial
              ? t('service_packages.subpackages.edit_title')
              : t('service_packages.subpackages.add_title')}
          </DialogTitle>
          <DialogDescription className="sr-only">{t('service_packages.subpackages.dialog_description')}</DialogDescription>
        </DialogHeader>
        <SubpackageForm
          key={open ? (initial?.id ?? 'new') : 'closed'}
          parentId={parentId}
          initial={initial}
          onOpenChange={onOpenChange}
        />
      </DialogContent>
    </Dialog>
  );
}
