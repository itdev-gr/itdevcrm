import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { useAccountingClients, type AccountingClientRow } from './hooks/useAccountingClients';
import { CopyableCode } from '@/components/CopyableCode';
import { CallLink } from '@/components/CallLink';
import { FilterBar, PageHeader } from '@/components/layout/page-shell';
import { Input } from '@/components/ui/input';
import { formatDate } from '@/lib/datetime';
import { industryLabel } from '@/lib/industries';
import { cn } from '@/lib/utils';

function isBlocked(c: AccountingClientRow): boolean {
  return (c.client_blocks ?? []).some((b) => b.unblocked_at == null);
}

function activeJobs(c: AccountingClientRow) {
  return (c.jobs ?? []).filter((j) => !j.archived && j.status === 'active');
}

function monthlyRevenue(c: AccountingClientRow): number {
  return activeJobs(c)
    .filter((j) => j.billing_type === 'recurring_monthly')
    .reduce((sum, j) => sum + (Number(j.monthly_amount) || 0), 0);
}

function yearlyRevenue(c: AccountingClientRow): number {
  return activeJobs(c)
    .filter((j) => j.billing_type === 'recurring_yearly')
    .reduce((sum, j) => sum + (Number(j.monthly_amount) || 0), 0);
}

function clientStatus(c: AccountingClientRow, t: (key: string) => string) {
  if (isBlocked(c)) return { label: t('clients_page.status.blocked'), tone: 'blocked' as const };
  if (activeJobs(c).length === 0) return { label: t('clients_page.status.no_jobs'), tone: 'pending' as const };
  return { label: t('clients_page.status.active'), tone: 'active' as const };
}

const STATUS_STYLES = {
  active: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300',
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300',
  blocked: 'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300',
} as const;

export function AccountingClientsPage() {
  const { t, i18n } = useTranslation('accounting');
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const { data: clients = [], isLoading } = useAccountingClients();
  const [search, setSearch] = useState('');
  const [blockedOnly, setBlockedOnly] = useState(false);

  const q = search.trim().toLowerCase();
  const visible = clients.filter((c) => {
    if (blockedOnly && !isBlocked(c)) return false;
    if (!q) return true;
    const haystack = [
      c.code,
      c.name,
      c.contact_first_name,
      c.contact_last_name,
      c.email,
      c.phone,
      c.industry,
      industryLabel(c.industry, lang),
      c.country,
      c.vat_number,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(q);
  });

  return (
    <div className="flex h-full min-h-0 flex-col gap-5 p-6">
      <PageHeader title={t('clients_page.title')} />

      <FilterBar>
        <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('clients_page.search')}
            className="h-9 rounded-full border-border/70 bg-background pl-9 shadow-sm"
          />
        </div>
        <label className="flex cursor-pointer items-center gap-2 rounded-full border border-border/70 bg-background px-3 py-1.5 text-sm shadow-sm transition-colors hover:bg-muted/40">
          <input
            type="checkbox"
            checked={blockedOnly}
            onChange={(e) => setBlockedOnly(e.target.checked)}
            className="size-3.5 rounded border-input accent-primary"
          />
          <span className="text-muted-foreground">{t('clients_page.show_blocked_only')}</span>
        </label>
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          {visible.length} / {clients.length}
        </span>
      </FilterBar>

      <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm">
        {isLoading ? (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">…</div>
        ) : visible.length === 0 ? (
          <div className="flex h-40 items-center justify-center px-6 text-center text-sm text-muted-foreground">
            {t('clients_page.empty')}
          </div>
        ) : (
          <div className="h-full overflow-auto">
            <table className="w-full min-w-[1100px] border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm">
                <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-medium">{t('clients_page.table.code')}</th>
                  <th className="px-4 py-3 font-medium">{t('clients_page.table.start_date')}</th>
                  <th className="px-4 py-3 font-medium">{t('clients_page.table.company')}</th>
                  <th className="px-4 py-3 font-medium">{t('clients_page.table.contact')}</th>
                  <th className="px-4 py-3 font-medium">{t('clients_page.table.email')}</th>
                  <th className="px-4 py-3 font-medium">{t('clients_page.table.phone')}</th>
                  <th className="px-4 py-3 font-medium">{t('clients_page.table.vat')}</th>
                  <th className="px-4 py-3 text-right font-medium">
                    {t('clients_page.table.active_jobs')}
                  </th>
                  <th className="px-4 py-3 text-right font-medium">
                    {t('clients_page.table.monthly_revenue')}
                  </th>
                  <th className="px-4 py-3 text-right font-medium">
                    {t('clients_page.table.yearly_revenue')}
                  </th>
                  <th className="px-4 py-3 font-medium">{t('clients_page.table.status')}</th>
                  <th className="px-4 py-3 font-medium">{t('clients_page.table.industry')}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((c) => {
                  const jobs = activeJobs(c);
                  const monthly = monthlyRevenue(c);
                  const yearly = yearlyRevenue(c);
                  const { label: status, tone } = clientStatus(c, t);
                  const contactName = [c.contact_first_name, c.contact_last_name]
                    .filter(Boolean)
                    .join(' ');
                  return (
                    <tr
                      key={c.id}
                      className="group border-b border-border/40 transition-colors last:border-b-0 hover:bg-muted/35"
                    >
                      <td className="px-4 py-3">
                        {c.code ? (
                          <CopyableCode code={c.code} className="text-[10px]" />
                        ) : (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                        {c.start_date ? formatDate(c.start_date) : formatDate(c.created_at)}
                      </td>
                      <td className="max-w-[220px] px-4 py-3">
                        <Link
                          to={`/clients/${c.id}`}
                          className="block truncate font-medium text-primary hover:underline"
                        >
                          {c.name}
                        </Link>
                      </td>
                      <td className="max-w-[140px] truncate px-4 py-3 text-muted-foreground">
                        {contactName || <span className="text-muted-foreground/50">—</span>}
                      </td>
                      <td className="max-w-[180px] truncate px-4 py-3 text-muted-foreground">
                        {c.email ?? <span className="text-muted-foreground/50">—</span>}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        <CallLink phone={c.phone} />
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        {c.vat_number ?? <span className="font-sans text-muted-foreground/50">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {jobs.length > 0 ? (
                          <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                            {jobs.length}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/50">0</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {monthly > 0 ? (
                          <span className="font-medium text-emerald-700 dark:text-emerald-400">
                            €{monthly.toFixed(0)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/50">€0</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {yearly > 0 ? (
                          <span className="font-medium text-emerald-700 dark:text-emerald-400">
                            €{yearly.toFixed(0)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/50">€0</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            'inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium',
                            STATUS_STYLES[tone],
                          )}
                        >
                          {status}
                        </span>
                      </td>
                      <td className="max-w-[140px] truncate px-4 py-3 text-muted-foreground">
                        {c.industry ? (
                          industryLabel(c.industry, lang)
                        ) : (
                          <span className="text-muted-foreground/50">—</span>
                        )}
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
