import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Ban, RefreshCw, Search, Users } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { FilterBar, PageHeader } from '@/components/layout/page-shell';
import { CallLink } from '@/components/CallLink';
import { formatDate } from '@/lib/datetime';
import { industryLabel } from '@/lib/industries';
import { cn } from '@/lib/utils';
import { useRecurringClients, type RecurringClientRow } from './hooks/useRecurringClients';

function StatusBadge({ row }: { row: RecurringClientRow }) {
  const { t } = useTranslation('accounting');

  if (row.is_blocked) {
    return (
      <span className="inline-flex rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-800 dark:bg-red-950/50 dark:text-red-300">
        {t('recurring_clients.status.blocked')}
      </span>
    );
  }
  if (row.has_overdue_payment) {
    return (
      <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
        {t('recurring_clients.status.overdue')}
      </span>
    );
  }
  if (row.status === 'done') {
    return (
      <span className="inline-flex rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
        {t('recurring_clients.status.done')}
      </span>
    );
  }
  return (
    <span className="inline-flex rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
      {t('recurring_clients.status.active')}
    </span>
  );
}

function StatTile({
  label,
  value,
  icon: Icon,
  accent = 'default',
}: {
  label: string;
  value: string;
  icon: typeof Users;
  accent?: 'default' | 'primary' | 'warning' | 'danger';
}) {
  const accentStyles = {
    default: 'bg-muted/50 text-muted-foreground',
    primary: 'bg-primary/10 text-primary',
    warning: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
    danger: 'bg-red-500/10 text-red-700 dark:text-red-400',
  } as const;

  const valueStyles = {
    default: 'text-foreground',
    primary: 'text-primary',
    warning: 'text-amber-700 dark:text-amber-400',
    danger: 'text-red-700 dark:text-red-400',
  } as const;

  return (
    <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className={cn('mt-1.5 text-2xl font-bold tracking-tight tabular-nums', valueStyles[accent])}>
            {value}
          </p>
        </div>
        <div className={cn('rounded-lg p-2.5', accentStyles[accent])}>
          <Icon className="size-4" />
        </div>
      </div>
    </div>
  );
}

export function AccountingRecurringPage() {
  const { t, i18n } = useTranslation('accounting');
  const { t: tDeals } = useTranslation('deals');
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const { data: rows = [], isLoading } = useRecurringClients();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const contact = [r.contact_first_name, r.contact_last_name].filter(Boolean).join(' ');
      return (
        r.client_name.toLowerCase().includes(q) ||
        contact.toLowerCase().includes(q) ||
        (r.email ?? '').toLowerCase().includes(q) ||
        (r.phone ?? '').toLowerCase().includes(q) ||
        (r.industry ?? '').toLowerCase().includes(q) ||
        industryLabel(r.industry, lang).toLowerCase().includes(q)
      );
    });
  }, [rows, query, lang]);

  const totals = useMemo(
    () => ({
      count: rows.length,
      monthly: rows.reduce((sum, r) => sum + r.monthly_total + r.yearly_total / 12, 0),
      overdue: rows.filter((r) => r.has_overdue_payment).length,
      blocked: rows.filter((r) => r.is_blocked).length,
    }),
    [rows],
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader title={t('recurring_clients.title')} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label={t('recurring_clients.stats.active_clients')}
          value={String(totals.count)}
          icon={Users}
        />
        <StatTile
          label={t('recurring_clients.stats.monthly')}
          value={`€${totals.monthly.toFixed(0)}`}
          icon={RefreshCw}
          accent="primary"
        />
        <StatTile
          label={t('recurring_clients.stats.overdue')}
          value={String(totals.overdue)}
          icon={AlertTriangle}
          accent="warning"
        />
        <StatTile
          label={t('recurring_clients.stats.blocked')}
          value={String(totals.blocked)}
          icon={Ban}
          accent="danger"
        />
      </div>

      <FilterBar>
        <div className="relative min-w-[220px] flex-1 sm:max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t('recurring_clients.filter_placeholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-9 rounded-full border-border/70 bg-background pl-9 shadow-sm"
          />
        </div>
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          {filtered.length} / {rows.length}
        </span>
      </FilterBar>

      <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm">
        {isLoading ? (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">…</div>
        ) : filtered.length === 0 ? (
          <div className="flex h-40 items-center justify-center px-6 text-center text-sm text-muted-foreground">
            {t('recurring_clients.empty')}
          </div>
        ) : (
          <div className="h-full overflow-auto">
            <table className="w-full min-w-[900px] border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm">
                <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-medium">{t('recurring_clients.table.client')}</th>
                  <th className="px-4 py-3 font-medium">{t('recurring_clients.table.services')}</th>
                  <th className="px-4 py-3 text-right font-medium">
                    {t('recurring_clients.table.monthly')}
                  </th>
                  <th className="px-4 py-3 font-medium">{t('recurring_clients.table.next_due')}</th>
                  <th className="px-4 py-3 font-medium">{t('recurring_clients.table.status')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const contactName = [r.contact_first_name, r.contact_last_name]
                    .filter(Boolean)
                    .join(' ');
                  const isOverdue = r.has_overdue_payment && !r.is_blocked;
                  return (
                    <tr
                      key={r.client_id}
                      className={cn(
                        'group border-b border-border/40 transition-colors last:border-b-0 hover:bg-muted/35',
                        isOverdue && 'bg-amber-500/[0.04]',
                      )}
                    >
                      <td className="max-w-[240px] px-4 py-3">
                        <Link
                          to={r.deal_id ? `/deals/${r.deal_id}` : `/clients/${r.client_id}`}
                          className="block truncate font-medium text-primary hover:underline"
                        >
                          {r.client_name}
                        </Link>
                        {(contactName || r.email || r.phone) && (
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                            {contactName && <span className="truncate">{contactName}</span>}
                            {r.email && (
                              <a
                                href={`mailto:${r.email}`}
                                className="truncate transition-colors hover:text-primary"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {r.email}
                              </a>
                            )}
                            {r.phone && (
                              <span onClick={(e) => e.stopPropagation()}>
                                <CallLink phone={r.phone} />
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="max-w-[260px] px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {r.active_services.map((s) => (
                            <span
                              key={s}
                              className="inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"
                            >
                              {tDeals(`services.types.${s}`)}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {r.monthly_total > 0 && (
                          <span className="font-medium text-emerald-700 dark:text-emerald-400">
                            €{r.monthly_total.toFixed(0)}
                          </span>
                        )}
                        {r.yearly_total > 0 && (
                          <span className="block text-xs text-muted-foreground">
                            €{r.yearly_total.toFixed(0)}/yr
                          </span>
                        )}
                        {r.monthly_total === 0 && r.yearly_total === 0 && (
                          <span className="text-muted-foreground/50">€0</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs">
                        {r.earliest_due ? (
                          <span
                            className={cn(
                              isOverdue
                                ? 'font-medium text-amber-700 dark:text-amber-400'
                                : 'text-muted-foreground',
                            )}
                          >
                            {formatDate(r.earliest_due, i18n.language)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge row={r} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
