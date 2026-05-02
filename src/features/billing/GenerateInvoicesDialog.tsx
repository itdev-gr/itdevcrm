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
import { useGenerateMonthlyInvoices } from './hooks/useGenerateMonthlyInvoices';

type Props = { open: boolean; onOpenChange: (v: boolean) => void };

function defaultPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function GenerateInvoicesDialog({ open, onOpenChange }: Props) {
  const { t } = useTranslation('accounting');
  const generate = useGenerateMonthlyInvoices();
  const [period, setPeriod] = useState(defaultPeriod());

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
      alert(t('recurring.generate.errors.invalid_period_format'));
      return;
    }
    try {
      const result = await generate.mutateAsync(period);
      alert(t('recurring.generate.success', { count: result.count, period: result.period }));
      onOpenChange(false);
    } catch (err) {
      const msg = (err as Error).message;
      alert(t(`recurring.generate.errors.${msg}`, { defaultValue: msg }));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('recurring.generate.dialog_title')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <Label htmlFor="period">{t('recurring.generate.period_label')}</Label>
            <Input
              id="period"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              placeholder="2026-05"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={generate.isPending}>
              {generate.isPending
                ? t('recurring.generate.submitting')
                : t('recurring.generate.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
