import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FilterBar, PageHeader } from '@/components/layout/page-shell';
import { CallLink } from '@/components/CallLink';
import { BlockBadge } from '@/features/client_blocks/BlockBadge';
import { industryLabel } from '@/lib/industries';
import { cn } from '@/lib/utils';
import { useMyClients } from './hooks/useMyClients';
import { CreateClientDialog } from './CreateClientDialog';

export function ClientsListPage() {
  const { t, i18n } = useTranslation('clients');
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const { data: clients = [], isLoading, error } = useMyClients();

  const q = search.trim().toLowerCase();
  const visible = useMemo(() => {
    if (!q) return clients;
    return clients.filter((c) => {
      const contact = [c.contact_first_name, c.contact_last_name].filter(Boolean).join(' ');
      const haystack = [
        c.name,
        contact,
        c.email,
        c.phone,
        c.industry,
        industryLabel(c.industry, lang),
        c.country,
        c.code,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [clients, q, lang]);

  if (error) {
    return (
      <div className="px-4 py-6 sm:px-6 lg:px-8">
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
          {error.message}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader title={t('my_clients')}>
        <Button onClick={() => setOpen(true)}>
          <Plus className="size-4" />
          {t('new_client')}
        </Button>
      </PageHeader>

      <FilterBar>
        <div className="relative min-w-[220px] flex-1 sm:max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('search_placeholder')}
            className="h-9 rounded-full border-border/70 bg-background pl-9 shadow-sm"
          />
        </div>
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          {visible.length} / {clients.length}
        </span>
      </FilterBar>

      <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm">
        {isLoading ? (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">…</div>
        ) : visible.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="text-sm text-muted-foreground">{t('empty')}</p>
            {!search && (
              <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
                <Plus className="size-3.5" />
                {t('new_client')}
              </Button>
            )}
          </div>
        ) : (
          <div className="h-full overflow-auto">
            <table className="w-full min-w-[900px] border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm">
                <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-medium">{t('table.name')}</th>
                  <th className="px-4 py-3 font-medium">{t('table.contact')}</th>
                  <th className="px-4 py-3 font-medium">{t('table.email')}</th>
                  <th className="px-4 py-3 font-medium">{t('table.phone')}</th>
                  <th className="px-4 py-3 font-medium">{t('table.industry')}</th>
                  <th className="px-4 py-3 font-medium">{t('table.country')}</th>
                  <th className="px-4 py-3 font-medium">{t('table.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((c) => {
                  const contactName = [c.contact_first_name, c.contact_last_name]
                    .filter(Boolean)
                    .join(' ');
                  return (
                    <tr
                      key={c.id}
                      className="group border-b border-border/40 transition-colors last:border-b-0 hover:bg-muted/35"
                    >
                      <td className="max-w-[240px] px-4 py-3">
                        <div className="flex min-w-0 items-center gap-2">
                          <Link
                            to={`/clients/${c.id}`}
                            className="truncate font-medium text-primary hover:underline"
                          >
                            {c.name}
                          </Link>
                          <BlockBadge clientId={c.id} />
                        </div>
                      </td>
                      <td className="max-w-[160px] truncate px-4 py-3 text-muted-foreground">
                        {contactName || <span className="text-muted-foreground/50">—</span>}
                      </td>
                      <td className="max-w-[200px] truncate px-4 py-3">
                        {c.email ? (
                          <a
                            href={`mailto:${c.email}`}
                            className="text-muted-foreground transition-colors hover:text-primary"
                          >
                            {c.email}
                          </a>
                        ) : (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {c.phone ? <CallLink phone={c.phone} /> : <span className="text-muted-foreground/50">—</span>}
                      </td>
                      <td className="max-w-[140px] truncate px-4 py-3 text-muted-foreground">
                        {c.industry ? (
                          industryLabel(c.industry, lang)
                        ) : (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {c.country || <span className="text-muted-foreground/50">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          to={`/clients/${c.id}`}
                          className={cn(
                            'inline-flex rounded-lg px-2.5 py-1 text-xs font-medium text-primary transition-colors',
                            'opacity-70 group-hover:opacity-100 hover:bg-primary/10',
                          )}
                        >
                          {t('actions.view')}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <CreateClientDialog
        open={open}
        onOpenChange={setOpen}
        onCreated={(id) => navigate(`/clients/${id}`)}
      />
    </div>
  );
}
