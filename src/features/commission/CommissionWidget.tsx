import { useTranslation } from 'react-i18next';
import { Wallet } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useMyCommission } from './hooks/useMyCommission';

const eur = new Intl.NumberFormat('el-GR', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 2,
});

export function CommissionWidget() {
  const { t } = useTranslation('common');
  const { data } = useMyCommission();
  // Hidden for people without a sales-app profile; admins only see it once
  // there is something to show.
  if (!data?.found) return null;
  if (data.role === 'admin' && data.total_earnings === 0 && data.bonuses === 0) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="hidden items-center gap-1.5 rounded-lg border border-border/70 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted lg:flex"
          title={t('commission.title', { defaultValue: 'Earnings this month' })}
        >
          <Wallet className="size-3.5 text-[#157777] dark:text-[#7ad4d4]" />
          <span className="font-medium tabular-nums text-foreground">
            {eur.format(data.total_earnings)}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <div className="mb-2 text-sm font-semibold">
          {t('commission.title', { defaultValue: 'Earnings this month' })}
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <Row label={t('commission.commission', { defaultValue: 'Commission' })} value={eur.format(data.commission)} />
          <Row label={t('commission.setup_fees', { defaultValue: 'Setup fees' })} value={eur.format(data.setup_fees)} />
          <Row label={t('commission.bonuses', { defaultValue: 'Bonuses' })} value={eur.format(data.bonuses)} />
          <Row label={t('commission.sales', { defaultValue: 'Sales value' })} value={eur.format(data.sales_amount)} />
          <Row label={t('commission.packages', { defaultValue: 'Packages' })} value={String(data.packages)} />
        </div>
        <div className="mt-3 border-t border-border pt-2 text-xs">
          <div className="flex items-center justify-between font-semibold">
            <span>{t('commission.total', { defaultValue: 'Total with bonuses' })}</span>
            <span className="tabular-nums">{eur.format(data.total_earnings + data.bonuses)}</span>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium tabular-nums">{value}</span>
    </>
  );
}
