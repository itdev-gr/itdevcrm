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
import {
  ACCOUNTING_CLIENTS_TABLE_COLS,
  ACCOUNTING_CLIENTS_TABLE_MIN_WIDTH,
  tableCellClass,
  tableSectionBorder,
} from '@/features/clients/clientsTableLayout';

function isBlocked(c: AccountingClientRow): boolean {
  return (c.client_blocks ?? []).some((b) => b.unblocked_at == null);
}

function activeJobs(c: AccountingClientRow) {
  return (c.jobs ?? []).filter((j) => !j.archived && j.status === 'active');
}

function monthlyRevenue(c: AccountingClientRow): number {
  return activeJobs(c)
    .filter((j) => j.billing_type === 'recurring_monthly')
    .reduce((sum, j) => sum + (Number(j.amount_net) || 0), 0);
}

function yearlyRevenue(c: AccountingClientRow): number {
  return activeJobs(c)
    .filter((j) => j.billing_type === 'recurring_yearly')
    .reduce((sum, j) => sum + (Number(j.amount_net) || 0), 0);
}

type Tone = 'active' | 'pending' | 'blocked' | 'done';
const ALL_TONES: Tone[] = ['active', 'pending', 'blocked', 'done'];
const TONE_LABEL_KEY: Record<Tone, string> = {
  active: 'clients_page.status.active',
  pending: 'clients_page.status.no_jobs',
  blocked: 'clients_page.status.blocked',
  done: 'clients_page.status.done',
};

// Same derivation the Status column shows, so filtering matches what's on screen.
function clientTone(c: AccountingClientRow): Tone {
  if (isBlocked(c) || c.status === 'blocked') return 'blocked';
  if (c.status === 'done') return 'done';
  if (activeJobs(c).length === 0) return 'pending';
  return 'active';
}

const STATUS_STYLES = {
  active: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300',
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300',
  blocked: 'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300',
  done: 'bg-slate-200 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300',
} as const;

export function AccountingClientsPage() {
  const { t, i18n } = useTranslation('accounting');
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const { data: clients = [], isLoading } = useAccountingClients();
  const [search, setSearch] = useState('');
  const [enabled, setEnabled] = useState<Set<Tone>>(() => new Set(ALL_TONES));

  const q = search.trim().toLowerCase();
  const visible = clients.filter((c) => {
    if (!enabled.has(clientTone(c))) return false;
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
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('clients_page.table.status')}
          </span>
          {ALL_TONES.map((tone) => {
            const on = enabled.has(tone);
            return (
              <button
                key={tone}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  setEnabled((prev) => {
                    const next = new Set(prev);
                    if (next.has(tone)) next.delete(tone);
                    else next.add(tone);
                    return next;
                  })
                }
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-medium shadow-sm transition-colors',
                  on
                    ? cn(STATUS_STYLES[tone], 'border-transparent')
                    : 'border-border/70 bg-background text-muted-foreground/60 hover:bg-muted/40',
                )}
              >
                {t(TONE_LABEL_KEY[tone])}
              </button>
            );
          })}
        </div>
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
            <table
              className="w-full table-fixed border-collapse text-sm"
              style={{ minWidth: ACCOUNTING_CLIENTS_TABLE_MIN_WIDTH }}
            >
              <colgroup>
                {ACCOUNTING_CLIENTS_TABLE_COLS.map((w, i) => (
                  <col key={i} className={w} />
                ))}
              </colgroup>
              <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm">
                <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className={cn(tableCellClass, 'font-medium')}>{t('clients_page.table.code')}</th>
                  <th className={cn(tableCellClass, 'font-medium')}>{t('clients_page.table.start_date')}</th>
                  <th className={cn(tableCellClass, tableSectionBorder, 'font-medium text-foreground/80')}>
                    {t('clients_page.table.company')}
                  </th>
                  <th className={cn(tableCellClass, tableSectionBorder, 'font-medium')}>
                    {t('clients_page.table.contact')}
                  </th>
                  <th className={cn(tableCellClass, 'font-medium text-foreground/80')}>
                    {t('clients_page.table.email')}
                  </th>
                  <th className={cn(tableCellClass, 'font-medium')}>{t('clients_page.table.phone')}</th>
                  <th className={cn(tableCellClass, tableSectionBorder, 'font-medium')}>
                    {t('clients_page.table.vat')}
                  </th>
                  <th className={cn(tableCellClass, 'text-right font-medium')}>
                    {t('clients_page.table.active_jobs')}
                  </th>
                  <th className={cn(tableCellClass, 'text-right font-medium')}>
                    {t('clients_page.table.monthly_revenue')}
                  </th>
                  <th className={cn(tableCellClass, 'text-right font-medium')}>
                    {t('clients_page.table.yearly_revenue')}
                  </th>
                  <th className={cn(tableCellClass, tableSectionBorder, 'font-medium')}>
                    {t('clients_page.table.status')}
                  </th>
                  <th className={cn(tableCellClass, 'font-medium')}>{t('clients_page.table.industry')}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((c) => {
                  const jobs = activeJobs(c);
                  const monthly = monthlyRevenue(c);
                  const yearly = yearlyRevenue(c);
                  const tone = clientTone(c);
                  const status = t(TONE_LABEL_KEY[tone]);
                  const contactName = [c.contact_first_name, c.contact_last_name]
                    .filter(Boolean)
                    .join(' ');
                  return (
                    <tr
                      key={c.id}
                      className="group border-b border-border/40 transition-colors last:border-b-0 hover:bg-muted/35"
                    >
                      <td className={tableCellClass}>
                        {c.code ? (
                          <CopyableCode code={c.code} className="text-[10px]" />
                        ) : (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </td>
                      <td className={cn(tableCellClass, 'whitespace-nowrap text-xs text-muted-foreground')}>
                        {c.start_date ? formatDate(c.start_date) : formatDate(c.created_at)}
                      </td>
                      <td className={cn(tableCellClass, tableSectionBorder)}>
                        <Link
                          to={`/clients/${c.id}`}
                          className="block font-medium text-primary transition-colors hover:underline"
                          title={c.name}
                        >
                          {c.name}
                        </Link>
                      </td>
                      <td className={cn(tableCellClass, tableSectionBorder, 'text-muted-foreground')} title={contactName || undefined}>
                        {contactName || <span className="text-muted-foreground/50">—</span>}
                      </td>
                      <td className={tableCellClass}>
                        {c.email ? (
                          <a
                            href={`mailto:${c.email}`}
                            className="block font-mono text-xs tracking-tight text-muted-foreground transition-colors hover:text-primary"
                            title={c.email}
                          >
                            {c.email}
                          </a>
                        ) : (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </td>
                      <td className={cn(tableCellClass, 'text-muted-foreground')}>
                        <CallLink phone={c.phone} />
                      </td>
                      <td className={cn(tableCellClass, tableSectionBorder, 'font-mono text-xs text-muted-foreground')}>
                        {c.vat_number ?? <span className="font-sans text-muted-foreground/50">—</span>}
                      </td>
                      <td className={cn(tableCellClass, 'text-right tabular-nums')}>
                        {jobs.length > 0 ? (
                          <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                            {jobs.length}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/40">—</span>
                        )}
                      </td>
                      <td className={cn(tableCellClass, 'text-right tabular-nums')}>
                        {monthly > 0 ? (
                          <span className="font-medium text-emerald-700 dark:text-emerald-400">
                            €{monthly.toFixed(0)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/40">—</span>
                        )}
                      </td>
                      <td className={cn(tableCellClass, 'text-right tabular-nums')}>
                        {yearly > 0 ? (
                          <span className="font-medium text-emerald-700 dark:text-emerald-400">
                            €{yearly.toFixed(0)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/40">—</span>
                        )}
                      </td>
                      <td className={cn(tableCellClass, tableSectionBorder)}>
                        <span
                          className={cn(
                            'inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium',
                            STATUS_STYLES[tone],
                          )}
                        >
                          {status}
                        </span>
                      </td>
                      <td className={cn(tableCellClass, 'text-muted-foreground')} title={c.industry ? industryLabel(c.industry, lang) : undefined}>
                        {c.industry ? (
                          <span className="inline-flex rounded-full bg-muted/60 px-2 py-0.5 text-xs">
                            {industryLabel(c.industry, lang)}
                          </span>
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
