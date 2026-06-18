import { useMemo, useState } from 'react';
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
import { useAssignableOwners } from '@/features/leads/hooks/useAssignableOwners';
import { useContractedMRR } from '@/features/accounting_report/hooks/useContractedMRR';
import { monthKeys, cohortStats, type LeadLite, type CohortRow } from './aggregate';
import {
  useDashboardLeads,
  useMonthlyPL,
  useRecurringCollected,
} from './hooks/useDashboardData';

type Preset = 'last_6_months' | 'this_year' | 'last_12_months';

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

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded border p-3">
      <p className="text-xs uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function CohortTable({ title, rows }: { title: string; rows: CohortRow[] }) {
  const { t } = useTranslation();
  return (
    <div className="rounded border">
      <h3 className="border-b bg-muted px-3 py-2 text-sm font-semibold">{title}</h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="px-3 py-2 font-medium">{title}</th>
            <th className="px-3 py-2 text-right font-medium">{t('dashboard.leads')}</th>
            <th className="px-3 py-2 text-right font-medium">{t('dashboard.won')}</th>
            <th className="px-3 py-2 text-right font-medium">{t('dashboard.lost')}</th>
            <th className="px-3 py-2 text-right font-medium">{t('dashboard.open')}</th>
            <th className="px-3 py-2 text-right font-medium">{t('dashboard.win_rate')}</th>
            <th className="px-3 py-2 text-right font-medium">{t('dashboard.value_won')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} className="px-3 py-4 text-center text-xs text-muted-foreground">
                {t('dashboard.no_leads')}
              </td>
            </tr>
          )}
          {rows.map((r) => (
            <tr key={r.key} className="border-t tabular-nums">
              <td className="px-3 py-2">{r.key}</td>
              <td className="px-3 py-2 text-right">{r.total}</td>
              <td className="px-3 py-2 text-right text-emerald-700 dark:text-emerald-400">{r.won}</td>
              <td className="px-3 py-2 text-right text-red-700 dark:text-red-400">{r.lost}</td>
              <td className="px-3 py-2 text-right text-muted-foreground">{r.open}</td>
              <td className="px-3 py-2 text-right">
                {r.winRate === null ? '—' : `${Math.round(r.winRate * 100)}%`}
              </td>
              <td className="px-3 py-2 text-right">
                €{r.wonOneTime.toFixed(0)}
                {r.wonMonthly > 0 && (
                  <span className="text-xs text-muted-foreground"> +€{r.wonMonthly.toFixed(0)}/mo</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const SOURCE_LABELS: Record<string, string> = {
  manual: 'Manual',
  meta: 'Meta',
  import: 'Import',
};

export function DashboardPage() {
  const { t } = useTranslation();
  const [preset, setPreset] = useState<Preset>('last_6_months');
  const range = useMemo(() => rangeFor(preset), [preset]);

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
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t('dashboard.title')}</h1>
          <p className="text-sm text-muted-foreground">
            {range.from} → {range.to}
          </p>
        </div>
        <div className="flex gap-2">
          {presets.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPreset(p)}
              className={`rounded border px-3 py-1.5 text-sm ${preset === p ? 'bg-primary text-primary-foreground' : ''}`}
            >
              {t(`dashboard.range.${p}`)}
            </button>
          ))}
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Tile label={t('dashboard.leads_created')} value={String(totals.created)} />
        <Tile label={t('dashboard.won')} value={String(totals.won)} />
        <Tile
          label={t('dashboard.win_rate')}
          value={totals.winRate === null ? '—' : `${Math.round(totals.winRate * 100)}%`}
          hint={t('dashboard.win_rate_hint')}
        />
        <Tile
          label={t('dashboard.contracted_mrr')}
          value={`€${(contractedMrr.data ?? 0).toFixed(0)}`}
        />
        <Tile
          label={t('dashboard.collected')}
          value={`€${collectedInRange.toFixed(0)}`}
          hint={t('dashboard.collected_hint')}
        />
      </div>

      <section className="rounded border p-3">
        <h3 className="mb-2 text-sm font-semibold">{t('dashboard.revenue_trend')}</h3>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={trendData} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="month" fontSize={11} />
            <YAxis fontSize={11} tickFormatter={(v: number) => `€${v}`} />
            <Tooltip formatter={(v) => `€${Number(v ?? 0).toFixed(2)}`} />
            <Legend />
            <Line type="monotone" dataKey="income" name={t('dashboard.income')} stroke="#0f766e" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="expenses" name={t('dashboard.expenses')} stroke="#b91c1c" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="profit" name={t('dashboard.profit')} stroke="#1d4ed8" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="recurring" name={t('dashboard.recurring_collected')} stroke="#7c3aed" strokeDasharray="4 4" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </section>

      <section className="rounded border p-3">
        <h3 className="mb-2 text-sm font-semibold">{t('dashboard.conversion_by_person')}</h3>
        <ResponsiveContainer width="100%" height={Math.max(160, ownerChartData.length * 44)}>
          <BarChart data={ownerChartData} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 24 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis type="number" allowDecimals={false} fontSize={11} />
            <YAxis type="category" dataKey="name" width={110} fontSize={11} />
            <Tooltip />
            <Legend />
            <Bar dataKey={t('dashboard.won')} stackId="a" fill="#059669" />
            <Bar dataKey={t('dashboard.lost')} stackId="a" fill="#dc2626" />
            <Bar dataKey={t('dashboard.open')} stackId="a" fill="var(--muted-foreground)" />
          </BarChart>
        </ResponsiveContainer>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <CohortTable title={t('dashboard.by_person')} rows={byOwner} />
        <CohortTable title={t('dashboard.by_source')} rows={bySource} />
      </div>
    </div>
  );
}
