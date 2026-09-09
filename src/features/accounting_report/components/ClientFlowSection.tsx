import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { RefreshCw, UserPlus, UserX } from 'lucide-react';
import { FilterSelect } from '@/components/layout/page-shell';
import { cn } from '@/lib/utils';
import { monthOptions, monthRange } from '../utils/monthFilter';
import { useClientFlow } from '../hooks/useClientFlow';
import type { ClientFlowRow } from '../utils/clientFlow';

type Panel = 'new_deals' | 'stopped' | 'renewals';

function FlowTile({
  label,
  count,
  icon: Icon,
  accent,
  expanded,
  onToggle,
  loading,
}: {
  label: string;
  count: number;
  icon: typeof UserPlus;
  accent: string;
  expanded: boolean;
  onToggle: () => void;
  loading: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      className={cn(
        'rounded-xl border bg-card p-4 text-left shadow-sm transition-colors',
        expanded ? 'border-primary/50' : 'border-border/60 hover:border-border',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="mt-1.5 text-2xl font-bold tracking-tight tabular-nums">
            {loading ? '—' : count}
          </p>
        </div>
        <div className={cn('rounded-lg p-2.5', accent)}>
          <Icon className="size-4" />
        </div>
      </div>
    </button>
  );
}

/**
 * Monthly client flow (admin-only): new deals / fully-stopped clients /
 * renewal clients for one selected month, with expandable name lists.
 * Owner definitions 2026-09-09 — see migration 20260909120000.
 */
export function ClientFlowSection() {
  const { t } = useTranslation(['accounting_report', 'deals']);
  const serviceLabel = (key: string) =>
    t(`deals:services.types.${key}`, { defaultValue: key });
  const months = monthOptions(new Date());
  const [month, setMonth] = useState(() => months[0]!.value);
  const [panel, setPanel] = useState<Panel | null>(null);
  const flow = useClientFlow(monthRange(month));

  const groups = flow.data;
  const panelRows: ClientFlowRow[] =
    panel === 'new_deals'
      ? (groups?.newDeals ?? [])
      : panel === 'stopped'
        ? (groups?.stopped ?? [])
        : panel === 'renewals'
          ? (groups?.renewals ?? [])
          : [];

  const toggle = (p: Panel) => setPanel((cur) => (cur === p ? null : p));

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">{t('client_flow.title')}</h2>
        <FilterSelect
          aria-label={t('client_flow.month')}
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="min-w-[140px]"
        >
          {months.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </FilterSelect>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <FlowTile
          label={t('client_flow.new_deals')}
          count={groups?.newDeals.length ?? 0}
          icon={UserPlus}
          accent="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
          expanded={panel === 'new_deals'}
          onToggle={() => toggle('new_deals')}
          loading={flow.isLoading}
        />
        <FlowTile
          label={t('client_flow.stopped')}
          count={groups?.stopped.length ?? 0}
          icon={UserX}
          accent="bg-red-500/10 text-red-700 dark:text-red-400"
          expanded={panel === 'stopped'}
          onToggle={() => toggle('stopped')}
          loading={flow.isLoading}
        />
        <FlowTile
          label={t('client_flow.renewals')}
          count={groups?.renewals.length ?? 0}
          icon={RefreshCw}
          accent="bg-violet-500/10 text-violet-700 dark:text-violet-400"
          expanded={panel === 'renewals'}
          onToggle={() => toggle('renewals')}
          loading={flow.isLoading}
        />
      </div>

      {panel && (
        <div className="rounded-xl border border-border/60 bg-card p-3 shadow-sm">
          {panelRows.length === 0 ? (
            <p className="px-1 py-2 text-sm text-muted-foreground">{t('client_flow.empty')}</p>
          ) : (
            <ul className="divide-y divide-border/50">
              {panelRows.map((r) => (
                <li
                  key={`${r.kind}:${r.deal_id ?? r.client_id}`}
                  className="flex items-center justify-between gap-3 px-1 py-2 text-sm"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    {r.deal_id ? (
                      <Link
                        to={`/deals/${r.deal_id}`}
                        className="shrink-0 font-mono text-xs text-primary hover:underline"
                      >
                        {r.client_code ?? r.deal_code ?? '—'}
                      </Link>
                    ) : (
                      r.client_code && (
                        <span className="shrink-0 font-mono text-xs text-muted-foreground">
                          {r.client_code}
                        </span>
                      )
                    )}
                    <span className="truncate">{r.client_name}</span>
                    {r.services && r.services.length > 0 && (
                      <span className="hidden truncate text-xs text-muted-foreground sm:inline">
                        {r.services.map((s) => serviceLabel(s)).join(', ')}
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-3 text-xs tabular-nums">
                    <span
                      className={cn(
                        'font-medium',
                        Number(r.amount_paid ?? 0) > 0
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-muted-foreground',
                      )}
                    >
                      €{Number(r.amount_paid ?? 0).toFixed(2)}
                    </span>
                    <span className="text-muted-foreground">{r.event_date}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
