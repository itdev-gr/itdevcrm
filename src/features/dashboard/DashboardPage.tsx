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
import { RefreshCw, Target, TrendingUp, Wallet } from 'lucide-react';
import { PageHeader, SegmentedControl } from '@/components/layout/page-shell';
import { Input } from '@/components/ui/input';
import { useAssignableOwners } from '@/features/leads/hooks/useAssignableOwners';
import { useContractedMRR } from '@/features/accounting_report/hooks/useContractedMRR';
import { cn } from '@/lib/utils';
import {
  monthKeys,
  cohortStats,
  dealsByPerson,
  type LeadLite,
  type CohortRow,
  type DealLite,
  type DealPersonRow,
} from './aggregate';
import {
  useDashboardLeads,
  useDashboardDeals,
  useMonthlyPL,
  useRecurringCollected,
  type DashboardDeal,
} from './hooks/useDashboardData';

type Preset =
  | 'this_month'
  | 'last_month'
  | 'last_6_months'
  | 'this_year'
  | 'last_12_months'
  | 'custom';

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

function rangeFor(preset: Exclude<Preset, 'custom'>): { from: string; to: string } {
  const now = new Date();
  const to = isoDay(now);
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  if (preset === 'this_month') return { from: isoDay(new Date(Date.UTC(y, m, 1))), to };
  if (preset === 'last_month')
    return {
      from: isoDay(new Date(Date.UTC(y, m - 1, 1))),
      to: isoDay(new Date(Date.UTC(y, m, 0))),
    };
  if (preset === 'this_year') return { from: `${y}-01-01`, to };
  const months = preset === 'last_6_months' ? 5 : 11;
  const from = new Date(Date.UTC(y, m - months, 1));
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

function WonByPersonTable({ rows }: { rows: DealPersonRow[] }) {
  const { t } = useTranslation();
  return (
    <div className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm">
      <div className="border-b border-border/60 px-4 py-3">
        <h3 className="text-sm font-semibold">{t('dashboard.deals_won_by_person')}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] border-collapse text-sm">
          <thead className="bg-muted/40">
            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3 font-medium">{t('dashboard.by_person')}</th>
              <th className="px-4 py-3 text-right font-medium">{t('dashboard.deals_won')}</th>
              <th className="px-4 py-3 text-right font-medium">{t('dashboard.value_won')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-10 text-center text-sm text-muted-foreground">
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
                <td className="px-4 py-3 text-right font-medium text-emerald-700 dark:text-emerald-400">
                  {r.deals}
                </td>
                <td className="px-4 py-3 text-right">
                  <span className="font-medium">€{r.oneTime.toFixed(0)}</span>
                  {r.monthly > 0 && (
                    <span className="ml-1 text-xs text-emerald-700 dark:text-emerald-400">
                      +€{r.monthly.toFixed(0)}/mo
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

function LeadsBySourceTable({ rows }: { rows: CohortRow[] }) {
  const { t } = useTranslation();
  return (
    <div className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm">
      <div className="border-b border-border/60 px-4 py-3">
        <h3 className="text-sm font-semibold">{t('dashboard.leads_by_source')}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[320px] border-collapse text-sm">
          <thead className="bg-muted/40">
            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3 font-medium">{t('dashboard.by_source')}</th>
              <th className="px-4 py-3 text-right font-medium">{t('dashboard.leads_received')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={2} className="px-4 py-10 text-center text-sm text-muted-foreground">
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
  const [customFrom, setCustomFrom] = useState<string>(() => rangeFor('this_month').from);
  const [customTo, setCustomTo] = useState<string>(() => rangeFor('this_month').to);
  const range = useMemo(
    () => (preset === 'custom' ? { from: customFrom, to: customTo } : rangeFor(preset)),
    [preset, customFrom, customTo],
  );
  const rangeLabel = useMemo(() => formatRangeLabel(range.from, range.to, locale), [range, locale]);

  const leads = useDashboardLeads(range);
  const deals = useDashboardDeals();
  const pl = useMonthlyPL(range);
  const recurring = useRecurringCollected(range);
  const contractedMrr = useContractedMRR();
  const { data: owners = [] } = useAssignableOwners();

  const ownerName = useMemo(() => {
    const m = new Map(owners.map((o) => [o.user_id, o.full_name || o.email]));
    return (id: string | null) =>
      id ? (m.get(id) ?? t('dashboard.unknown')) : t('dashboard.unassigned');
  }, [owners, t]);

  // Leads — received count + by-source, plus the per-person conversion diagram
  // (won/lost/open from lead stages) which the dashboard keeps as before.
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
  const bySource = useMemo(() => cohortStats(leadLites, (l) => l.source), [leadLites]);
  const byOwner = useMemo(() => cohortStats(leadLites, (l) => l.owner), [leadLites]);
  const leadsReceived = leadLites.length;

  // Deals = the wins. Active only: exclude closed (churned) + done (finished); won-date in range.
  const dealLites: DealLite[] = useMemo(() => {
    const isActiveWonInRange = (d: DashboardDeal) => {
      const code = d.accounting_stage?.code;
      if (code === 'closed' || code === 'done') return false;
      const won = d.invoiced_date ?? d.actual_close_date;
      return !!won && won >= range.from && won <= range.to;
    };
    return (deals.data ?? []).filter(isActiveWonInRange).map((d) => ({
      person: ownerName(d.won_by_user_id),
      oneTime: Number(d.one_time_value) || 0,
      monthly: Number(d.recurring_monthly_value) || 0,
    }));
  }, [deals.data, range, ownerName]);

  const wonByPerson = useMemo(() => dealsByPerson(dealLites), [dealLites]);
  const wonTotals = useMemo(
    () => ({
      count: dealLites.length,
      oneTime: dealLites.reduce((s, d) => s + d.oneTime, 0),
      monthly: dealLites.reduce((s, d) => s + d.monthly, 0),
    }),
    [dealLites],
  );

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

  const presets: Preset[] = [
    'this_month',
    'last_month',
    'last_6_months',
    'this_year',
    'last_12_months',
    'custom',
  ];

  return (
    <div className="space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader title={t('dashboard.title')} description={rangeLabel}>
        <div className="flex flex-wrap items-end gap-3">
          <SegmentedControl
            value={preset}
            onChange={(v) => setPreset(v as Preset)}
            options={presets.map((p) => ({
              value: p,
              label: t(`dashboard.range.${p}`),
            }))}
          />
          {preset === 'custom' && (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <label className="flex items-center gap-2 text-muted-foreground">
                {t('dashboard.range.from')}
                <Input
                  type="date"
                  value={range.from}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="h-9 w-auto"
                />
              </label>
              <label className="flex items-center gap-2 text-muted-foreground">
                {t('dashboard.range.to')}
                <Input
                  type="date"
                  value={range.to}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="h-9 w-auto"
                />
              </label>
            </div>
          )}
        </div>
      </PageHeader>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Tile label={t('dashboard.leads_received')} value={String(leadsReceived)} icon={TrendingUp} />
        <Tile
          label={t('dashboard.deals_won')}
          value={String(wonTotals.count)}
          icon={Target}
          accent="success"
        />
        <Tile
          label={t('dashboard.won_value')}
          value={`€${wonTotals.oneTime.toFixed(0)}`}
          hint={wonTotals.monthly > 0 ? `+€${wonTotals.monthly.toFixed(0)}/mo` : ''}
          icon={Wallet}
          accent="success"
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
            <Line type="monotone" dataKey="income" name={t('dashboard.income')} stroke={CHART.income} strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
            <Line type="monotone" dataKey="expenses" name={t('dashboard.expenses')} stroke={CHART.expenses} strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="profit" name={t('dashboard.profit')} stroke={CHART.profit} strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="recurring" name={t('dashboard.recurring_collected')} stroke={CHART.recurring} strokeDasharray="5 5" strokeWidth={2} dot={false} />
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
        <WonByPersonTable rows={wonByPerson} />
        <LeadsBySourceTable rows={bySource} />
      </div>
    </div>
  );
}
