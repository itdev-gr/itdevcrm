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
import {
  CLIENTS_LIST_TABLE_COLS,
  CLIENTS_LIST_TABLE_MIN_WIDTH,
  tableCellClass,
  tableSectionBorder,
} from './clientsTableLayout';

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
            <table
              className="w-full table-fixed border-collapse text-sm"
              style={{ minWidth: CLIENTS_LIST_TABLE_MIN_WIDTH }}
            >
              <colgroup>
                {CLIENTS_LIST_TABLE_COLS.map((w, i) => (
                  <col key={i} className={w} />
                ))}
              </colgroup>
              <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm">
                <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className={cn(tableCellClass, 'font-medium text-foreground/80')}>{t('table.name')}</th>
                  <th className={cn(tableCellClass, tableSectionBorder, 'font-medium')}>{t('table.contact')}</th>
                  <th className={cn(tableCellClass, 'font-medium text-foreground/80')}>{t('table.email')}</th>
                  <th className={cn(tableCellClass, 'font-medium')}>{t('table.phone')}</th>
                  <th className={cn(tableCellClass, tableSectionBorder, 'font-medium')}>{t('table.industry')}</th>
                  <th className={cn(tableCellClass, 'font-medium')}>{t('table.country')}</th>
                  <th className={cn(tableCellClass, 'font-medium')}>{t('table.actions')}</th>
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
                      <td className={tableCellClass}>
                        <div className="flex min-w-0 items-start gap-2">
                          <Link
                            to={`/clients/${c.id}`}
                            className="min-w-0 font-medium text-primary transition-colors hover:underline"
                            title={c.name}
                          >
                            {c.name}
                          </Link>
                          <BlockBadge clientId={c.id} />
                        </div>
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
                        {c.phone ? <CallLink phone={c.phone} /> : <span className="text-muted-foreground/50">—</span>}
                      </td>
                      <td className={cn(tableCellClass, tableSectionBorder, 'text-muted-foreground')}>
                        {c.industry ? (
                          <span className="inline-flex rounded-full bg-muted/60 px-2 py-0.5 text-xs">
                            {industryLabel(c.industry, lang)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </td>
                      <td className={cn(tableCellClass, 'text-muted-foreground')}>
                        {c.country || <span className="text-muted-foreground/50">—</span>}
                      </td>
                      <td className={tableCellClass}>
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
