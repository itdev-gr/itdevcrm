import { useTranslation } from 'react-i18next';
import { RefreshCw, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { SegmentedControl } from '@/components/layout/page-shell';
import { cn } from '@/lib/utils';
import type { RangePreset, DateRange } from '../utils/formatRange';
import type { PLSummary } from '../hooks/usePLSummary';

export type ReportHeaderProps = {
  preset: RangePreset;
  range: DateRange;
  onPreset: (preset: RangePreset) => void;
  onCustomFrom: (iso: string) => void;
  onCustomTo: (iso: string) => void;
  summary: PLSummary | undefined;
  mrr: number;
  collectedMrr: number;
  ytdSummary: PLSummary | undefined;
  includePendingExpenses: boolean;
  onIncludePendingExpensesChange: (value: boolean) => void;
};

function KpiTile({
  label,
  gross,
  net,
  suffix,
  icon: Icon,
  accent = 'default',
  hint,
}: {
  label: string;
  gross: number;
  net?: number | undefined;
  suffix: string;
  icon: typeof TrendingUp;
  accent?: 'income' | 'expense' | 'profit' | 'mrr' | 'default';
  hint?: string | undefined;
}) {
  const accentStyles = {
    default: 'bg-muted/50 text-muted-foreground',
    income: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    expense: 'bg-red-500/10 text-red-700 dark:text-red-400',
    profit: 'bg-primary/10 text-primary',
    mrr: 'bg-violet-500/10 text-violet-700 dark:text-violet-400',
  } as const;

  return (
    <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="mt-1.5 text-2xl font-bold tracking-tight tabular-nums">€{gross.toFixed(2)}</p>
          {net !== undefined && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              €{net.toFixed(2)} {suffix}
            </p>
          )}
          {hint && (
            <span className="mt-1.5 inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              {hint}
            </span>
          )}
        </div>
        <div className={cn('rounded-lg p-2.5', accentStyles[accent])}>
          <Icon className="size-4" />
        </div>
      </div>
    </div>
  );
}

export function ReportHeader({
  preset,
  range,
  onPreset,
  onCustomFrom,
  onCustomTo,
  summary,
  mrr,
  collectedMrr,
  ytdSummary,
  includePendingExpenses,
  onIncludePendingExpensesChange,
}: ReportHeaderProps) {
  const { t } = useTranslation('accounting_report');
  const presets: RangePreset[] = ['this_month', 'last_month', 'this_year', 'last_year', 'custom'];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <SegmentedControl
          value={preset}
          onChange={(v) => onPreset(v as RangePreset)}
          options={presets.map((p) => ({
            value: p,
            label: t(`range.${p}`),
          }))}
        />
        {preset === 'custom' && (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2 text-muted-foreground">
              {t('range.from')}
              <Input
                type="date"
                value={range.from}
                onChange={(e) => onCustomFrom(e.target.value)}
                className="h-9 w-auto"
              />
            </label>
            <label className="flex items-center gap-2 text-muted-foreground">
              {t('range.to')}
              <Input
                type="date"
                value={range.to}
                onChange={(e) => onCustomTo(e.target.value)}
                className="h-9 w-auto"
              />
            </label>
          </div>
        )}

        <label className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            aria-label={t('include_pending_expenses')}
            checked={includePendingExpenses}
            onChange={(e) => onIncludePendingExpensesChange(e.target.checked)}
          />
          <span>{t('include_pending_expenses')}</span>
        </label>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile
          label={t('kpi.income')}
          gross={summary?.totalIncomeGross ?? 0}
          net={summary?.totalIncomeNet}
          suffix={t('kpi.net_suffix')}
          icon={TrendingUp}
          accent="income"
        />
        <KpiTile
          label={t('kpi.expense')}
          gross={summary?.totalExpenseGross ?? 0}
          net={summary?.totalExpenseNet}
          suffix={t('kpi.net_suffix')}
          icon={TrendingDown}
          accent="expense"
          hint={includePendingExpenses ? t('includes_pending_hint') : undefined}
        />
        <KpiTile
          label={t('kpi.net_profit')}
          gross={summary?.netProfitGross ?? 0}
          net={summary?.netProfitNet}
          suffix={t('kpi.net_suffix')}
          icon={Wallet}
          accent="profit"
        />
        <KpiTile
          label={t('kpi.mrr')}
          gross={mrr}
          net={collectedMrr}
          suffix={t('kpi.mrr_collected_suffix')}
          icon={RefreshCw}
          accent="mrr"
        />
      </div>

      {ytdSummary && (
        <div className="rounded-xl border border-border/60 bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{t('kpi.ytd')}:</span>{' '}
          {t('kpi.income')}{' '}
          <span className="font-medium tabular-nums text-emerald-700 dark:text-emerald-400">
            €{ytdSummary.totalIncomeGross.toFixed(2)}
          </span>
          {' · '}
          {t('kpi.expense')}{' '}
          <span className="font-medium tabular-nums text-red-700 dark:text-red-400">
            €{ytdSummary.totalExpenseGross.toFixed(2)}
          </span>
          {' · '}
          {t('kpi.net_profit')}{' '}
          <span className="font-medium tabular-nums text-primary">
            €{ytdSummary.netProfitGross.toFixed(2)}
          </span>
        </div>
      )}
    </div>
  );
}
