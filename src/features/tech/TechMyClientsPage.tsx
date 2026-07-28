import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Clock, Lock, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { FilterBar, PageHeader } from '@/components/layout/page-shell';
import { cn } from '@/lib/utils';
import { useTechMyClients, type TechMyClientRow } from './hooks/useTechMyClients';
import { relativeFromNow } from '@/lib/datetime';
import { industryLabel } from '@/lib/industries';

const SERVICE_LABELS: Record<string, { en: string; el: string }> = {
  'web-seo': { en: 'Web SEO', el: 'Web SEO' },
  'local-seo': { en: 'Local SEO', el: 'Local SEO' },
  'web-dev': { en: 'Web Development', el: 'Ανάπτυξη Ιστοσελίδων' },
  'social-media': { en: 'Social Media', el: 'Social Media' },
  'ai-seo': { en: 'AI SEO', el: 'AI SEO' },
  hosting: { en: 'Hosting', el: 'Hosting' },
  ads: { en: 'Ads', el: 'Διαφημίσεις' },
  maintenance: { en: 'Support', el: 'Υποστήριξη' },
  franchise: { en: 'Franchise', el: 'Franchise' },
  domains: { en: 'Domains', el: 'Domains' },
};

const URL_TO_SERVICE: Record<string, string> = {
  'web-seo': 'web_seo',
  'local-seo': 'local_seo',
  'web-dev': 'web_dev',
  'social-media': 'social_media',
  'ai-seo': 'ai_seo',
  hosting: 'hosting',
  ads: 'ads',
  maintenance: 'maintenance',
  franchise: 'franchise',
  domains: 'domains',
};

function ClientAvatar({ name, email }: { name: string; email: string | null }) {
  const label = name.trim() || email || '?';
  const initials = label
    .split(/[\s@]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary dark:text-[#7ad4d4]">
      {initials || '?'}
    </span>
  );
}

function StatusPill({ row }: { row: TechMyClientRow }) {
  const { t } = useTranslation('clients');

  if (row.any_blocked) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-800 dark:bg-red-950/50 dark:text-red-300">
        <Lock className="size-3" />
        {t('status.blocked')}
      </span>
    );
  }

  const status = row.client_status ?? 'active';
  const styles: Record<string, string> = {
    new: 'bg-muted text-muted-foreground',
    active: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300',
    done: 'bg-muted text-muted-foreground',
  };

  return (
    <span
      className={cn(
        'inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium capitalize',
        styles[status] ?? styles.active,
      )}
    >
      {t(`status.${status}`, { defaultValue: status })}
    </span>
  );
}

export function TechMyClientsPage() {
  const { serviceType: urlServiceType = '' } = useParams<{ serviceType: string }>();
  const { t, i18n } = useTranslation('clients');
  const lang: 'en' | 'el' = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const serviceType = URL_TO_SERVICE[urlServiceType] ?? '';
  const label = SERVICE_LABELS[urlServiceType]?.[lang] ?? urlServiceType;
  const [query, setQuery] = useState('');
  const { data: rows = [], isLoading } = useTechMyClients(serviceType);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r: TechMyClientRow) => {
      const contactName = [r.contact_first_name, r.contact_last_name].filter(Boolean).join(' ');
      return (
        r.client_name.toLowerCase().includes(q) ||
        contactName.toLowerCase().includes(q) ||
        (r.email ?? '').toLowerCase().includes(q) ||
        (r.industry ?? '').toLowerCase().includes(q) ||
        industryLabel(r.industry, lang).toLowerCase().includes(q)
      );
    });
  }, [rows, query, lang]);

  if (isLoading) {
    return <div className="px-4 py-6 sm:px-6 lg:px-8 text-sm text-muted-foreground">…</div>;
  }

  if (!serviceType) {
    return (
      <div className="px-4 py-6 sm:px-6 lg:px-8">
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
          Unknown service.
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        title={`${label} — ${t('my_clients')}`}
        description="Clients with activity in the last 90 days."
      />

      <FilterBar>
        <div className="relative min-w-[220px] flex-1 sm:max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by client, email, industry…"
            className="h-9 rounded-full border-border/70 bg-background pl-9 shadow-sm"
          />
        </div>
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          {filtered.length} / {rows.length}
        </span>
      </FilterBar>

      <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm">
        {filtered.length === 0 ? (
          <div className="flex h-40 items-center justify-center px-6 text-sm text-muted-foreground">
            No clients match.
          </div>
        ) : (
          <div className="h-full overflow-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm">
                <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Client</th>
                  <th className="px-4 py-3 font-medium">{t('table.industry')}</th>
                  <th className="px-4 py-3 font-medium text-right">Active jobs</th>
                  <th className="px-4 py-3 font-medium">Last activity</th>
                  <th className="px-4 py-3 font-medium">{t('status.label')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const contactName = [r.contact_first_name, r.contact_last_name]
                    .filter(Boolean)
                    .join(' ');
                  const subtitle = [contactName, r.email].filter(Boolean).join(' · ');

                  return (
                    <tr
                      key={r.client_id}
                      className="group border-b border-border/40 transition-colors last:border-b-0 hover:bg-muted/35"
                    >
                      <td className="max-w-[320px] px-4 py-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <ClientAvatar name={contactName || r.client_name} email={r.email} />
                          <div className="min-w-0">
                            <Link
                              to={`/clients/${r.client_id}`}
                              className="block truncate text-sm font-medium text-foreground transition-colors hover:text-primary"
                            >
                              {r.client_name}
                            </Link>
                            {subtitle && (
                              <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="max-w-[180px] px-4 py-3">
                        {r.industry ? (
                          <span className="inline-flex rounded-full bg-muted/60 px-2 py-0.5 text-xs text-muted-foreground">
                            {industryLabel(r.industry, lang)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <span
                          className={cn(
                            'inline-flex min-w-[1.5rem] justify-center rounded-full px-2 py-0.5 text-xs font-medium',
                            r.active_jobs > 0
                              ? 'bg-primary/10 text-primary dark:text-[#7ad4d4]'
                              : 'bg-muted text-muted-foreground',
                          )}
                        >
                          {r.active_jobs}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Clock className="size-3.5 opacity-60" />
                          {relativeFromNow(r.last_activity)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <StatusPill row={r} />
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
