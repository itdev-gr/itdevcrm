import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from 'recharts';
import {
  Percent,
  RefreshCw,
  Target,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { PageHeader, SegmentedControl } from '@/components/layout/page-shell';
import { useAssignableOwners } from '@/features/leads/hooks/useAssignableOwners';
import { useContractedMRR } from '@/features/accounting_report/hooks/useContractedMRR';
import { cn } from '@/lib/utils';
import { monthKeys, cohortStats, type LeadLite, type CohortRow } from './aggregate';
import {
  useDashboardLeads,
  useMonthlyPL,
  useRecurringCollected,
} from './hooks/useDashboardData';

type Preset = 'last_6_months' | 'this_year' | 'last_12_months';

const CHART = {
  income: '#1a9696',
  expenses: '#e11d48',
  profit: '#2563eb',
  recurring: '#7c3aed',
  won: '#059669',
  lost: '#dc2626',
  open: '#94a3b8',
} as const;

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function rangeFor(preset: Preset): { from: string; to: string } {
  const now = new Date();
  const to = isoDay(now);
  if (preset === 'this_year') return { from: `${now.getUTCFullYear()}-01-01`, to };
  const months = preset === 'last_6_months' ? 5 : 11;
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 1));
  return { from: isoDay(from), to };
}

function formatRangeLabel(from: string, to: string, locale: string): string {
  const fmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' });
  return `${fmt.format(new Date(from))} – ${fmt.format(new Date(to))}`;
}

function Tile({
  label,
  value,
  hint,
  icon: Icon,
  accent = 'default',
}: {
  label: string;
  value: string;
  hint?: string;
  icon: typeof TrendingUp;
  accent?: 'default' | 'success' | 'primary' | 'warning';
}) {
  const accentStyles = {
    default: 'bg-muted/50 text-muted-foreground',
    success: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    primary: 'bg-primary/10 text-primary',
    warning: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  } as const;

  return (
    <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="mt-1.5 text-2xl font-bold tracking-tight tabular-nums">{value}</p>
          {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
        </div>
        <div className={cn('rounded-lg p-2.5', accentStyles[accent])}>
          <Icon className="size-4" />
        </div>
      </div>
    </div>
  );
}

function CohortTable({ title, rows }: { title: string; rows: CohortRow[] }) {
  const { t } = useTranslation();
  return (
    <div className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm">
      <div className="border-b border-border/60 px-4 py-3">
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead className="bg-muted/40">
            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3 font-medium">{title}</th>
              <th className="px-4 py-3 text-right font-medium">{t('dashboard.leads')}</th>
              <th className="px-4 py-3 text-right font-medium">{t('dashboard.won')}</th>
              <th className="px-4 py-3 text-right font-medium">{t('dashboard.lost')}</th>
              <th className="px-4 py-3 text-right font-medium">{t('dashboard.open')}</th>
              <th className="px-4 py-3 text-right font-medium">{t('dashboard.win_rate')}</th>
              <th className="px-4 py-3 text-right font-medium">{t('dashboard.value_won')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  {t('dashboard.no_leads')}
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr
                key={r.key}
                className="border-t border-border/40 tabular-nums transition-colors hover:bg-muted/30"
              >
                <td className="px-4 py-3 font-medium">{r.key}</td>
                <td className="px-4 py-3 text-right">{r.total}</td>
                <td className="px-4 py-3 text-right font-medium text-emerald-700 dark:text-emerald-400">
                  {r.won}
                </td>
                <td className="px-4 py-3 text-right text-red-700 dark:text-red-400">{r.lost}</td>
                <td className="px-4 py-3 text-right text-muted-foreground">{r.open}</td>
                <td className="px-4 py-3 text-right">
                  {r.winRate === null ? (
                    <span className="text-muted-foreground/50">—</span>
                  ) : (
                    <span className="inline-flex min-w-10 justify-end rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                      {Math.round(r.winRate * 100)}%
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <span className="font-medium">€{r.wonOneTime.toFixed(0)}</span>
                  {r.wonMonthly > 0 && (
                    <span className="ml-1 text-xs text-emerald-700 dark:text-emerald-400">
                      +€{r.wonMonthly.toFixed(0)}/mo
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border/60 bg-card p-4 shadow-sm sm:p-5">
      <h3 className="mb-4 text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

const SOURCE_LABELS: Record<string, string> = {
  manual: 'Manual',
  meta: 'Meta',
  import: 'Import',
};

export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage === 'el' ? 'el-GR' : 'en-US';
  const [preset, setPreset] = useState<Preset>('last_6_months');
  const range = useMemo(() => rangeFor(preset), [preset]);
  const rangeLabel = useMemo(() => formatRangeLabel(range.from, range.to, locale), [range, locale]);

  const leads = useDashboardLeads(range);
  const pl = useMonthlyPL(range);
  const recurring = useRecurringCollected(range);
  const contractedMrr = useContractedMRR();
  const { data: owners = [] } = useAssignableOwners();

  const ownerName = useMemo(() => {
    const m = new Map(owners.map((o) => [o.user_id, o.full_name || o.email]));
    return (id: string | null) =>
      id ? (m.get(id) ?? t('dashboard.unknown')) : t('dashboard.unassigned');
  }, [owners, t]);

  const leadLites: LeadLite[] = useMemo(
    () =>
      (leads.data ?? []).map((l) => ({
        owner: ownerName(l.owner_user_id),
        source: SOURCE_LABELS[l.source] ?? l.source,
        outcome:
          l.stage?.terminal_outcome === 'won'
            ? 'won'
            : l.stage?.terminal_outcome === 'lost'
              ? 'lost'
              : 'open',
        oneTimeValue: Number(l.estimated_one_time_value) || 0,
        monthlyValue: Number(l.estimated_monthly_value) || 0,
      })),
    [leads.data, ownerName],
  );

  const byOwner = useMemo(() => cohortStats(leadLites, (l) => l.owner), [leadLites]);
  const bySource = useMemo(() => cohortStats(leadLites, (l) => l.source), [leadLites]);

  const totals = useMemo(() => {
    const won = leadLites.filter((l) => l.outcome === 'won').length;
    const lost = leadLites.filter((l) => l.outcome === 'lost').length;
    return {
      created: leadLites.length,
      won,
      winRate: won + lost > 0 ? won / (won + lost) : null,
    };
  }, [leadLites]);

  const trendData = useMemo(() => {
    const plByMonth = new Map((pl.data ?? []).map((r) => [r.period, r]));
    const recByMonth = new Map((recurring.data ?? []).map((r) => [r.month, r.gross]));
    return monthKeys(range.from, range.to).map((month) => ({
      month,
      income: Number(plByMonth.get(month)?.total_income_gross ?? 0),
      expenses: Number(plByMonth.get(month)?.total_expense_gross ?? 0),
      profit: Number(plByMonth.get(month)?.net_profit_gross ?? 0),
      recurring: recByMonth.get(month) ?? 0,
    }));
  }, [pl.data, recurring.data, range]);

  const collectedInRange = trendData.reduce((s, r) => s + r.income, 0);

  const ownerChartData = byOwner.map((r) => ({
    name: r.key,
    [t('dashboard.won')]: r.won,
    [t('dashboard.lost')]: r.lost,
    [t('dashboard.open')]: r.open,
  }));

  const presets: Preset[] = ['last_6_months', 'this_year', 'last_12_months'];

  return (
    <div className="space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader title={t('dashboard.title')} description={rangeLabel}>
        <SegmentedControl
          value={preset}
          onChange={(v) => setPreset(v as Preset)}
          options={presets.map((p) => ({
            value: p,
            label: t(`dashboard.range.${p}`),
          }))}
        />
      </PageHeader>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Tile
          label={t('dashboard.leads_created')}
          value={String(totals.created)}
          icon={TrendingUp}
        />
        <Tile label={t('dashboard.won')} value={String(totals.won)} icon={Target} accent="success" />
        <Tile
          label={t('dashboard.win_rate')}
          value={totals.winRate === null ? '—' : `${Math.round(totals.winRate * 100)}%`}
          hint={t('dashboard.win_rate_hint')}
          icon={Percent}
          accent="primary"
        />
        <Tile
          label={t('dashboard.contracted_mrr')}
          value={`€${(contractedMrr.data ?? 0).toFixed(0)}`}
          icon={RefreshCw}
          accent="primary"
        />
        <Tile
          label={t('dashboard.collected')}
          value={`€${collectedInRange.toFixed(0)}`}
          hint={t('dashboard.collected_hint')}
          icon={Wallet}
          accent="warning"
        />
      </div>

      <ChartCard title={t('dashboard.revenue_trend')}>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={trendData} margin={{ top: 8, right: 16, bottom: 0, left: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="month" fontSize={11} tickLine={false} axisLine={false} />
            <YAxis fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v: number) => `€${v}`} />
            <Tooltip
              formatter={(v) => `€${Number(v ?? 0).toFixed(2)}`}
              contentStyle={{
                borderRadius: '0.75rem',
                border: '1px solid var(--border)',
                background: 'var(--card)',
              }}
            />
            <Legend wrapperStyle={{ fontSize: '12px' }} />
            <Line
              type="monotone"
              dataKey="income"
              name={t('dashboard.income')}
              stroke={CHART.income}
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 4 }}
            />
            <Line
              type="monotone"
              dataKey="expenses"
              name={t('dashboard.expenses')}
              stroke={CHART.expenses}
              strokeWidth={2}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="profit"
              name={t('dashboard.profit')}
              stroke={CHART.profit}
              strokeWidth={2}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="recurring"
              name={t('dashboard.recurring_collected')}
              stroke={CHART.recurring}
              strokeDasharray="5 5"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title={t('dashboard.conversion_by_person')}>
        <ResponsiveContainer width="100%" height={Math.max(180, ownerChartData.length * 48)}>
          <BarChart data={ownerChartData} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
            <XAxis type="number" allowDecimals={false} fontSize={11} tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey="name" width={120} fontSize={11} tickLine={false} axisLine={false} />
            <Tooltip
              contentStyle={{
                borderRadius: '0.75rem',
                border: '1px solid var(--border)',
                background: 'var(--card)',
              }}
            />
            <Legend wrapperStyle={{ fontSize: '12px' }} />
            <Bar dataKey={t('dashboard.won')} stackId="a" fill={CHART.won} radius={[0, 0, 0, 0]} />
            <Bar dataKey={t('dashboard.lost')} stackId="a" fill={CHART.lost} />
            <Bar dataKey={t('dashboard.open')} stackId="a" fill={CHART.open} radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <div className="grid gap-4 xl:grid-cols-2">
        <CohortTable title={t('dashboard.by_person')} rows={byOwner} />
        <CohortTable title={t('dashboard.by_source')} rows={bySource} />
      </div>
    </div>
  );
}
