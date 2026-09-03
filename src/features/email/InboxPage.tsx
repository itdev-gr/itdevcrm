import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Mail, FolderInput } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/layout/page-shell';
import { relativeFromNow } from '@/lib/datetime';
import { useAuthStore } from '@/lib/stores/authStore';
import { htmlToText } from './htmlToText';
import { useEmailInbox, useMarkEmailRead, useEmailInboxRealtime, isInboxItemVisible, type InboxItem } from './hooks/useEmailInbox';
import { FileEmailDialog } from './FileEmailDialog';

type Tab = 'all' | 'unread' | 'mine' | 'unfiled';
type Cat = 'all' | 'sales' | 'accounting' | 'support' | 'other';

export function InboxPage() {
  const { t } = useTranslation('sales');
  const { items, refetch } = useEmailInbox();
  useEmailInboxRealtime();
  const { markRead, markAllRead } = useMarkEmailRead();
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const [cat, setCat] = useState<Cat>('all');
  const [tab, setTab] = useState<Tab>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [filing, setFiling] = useState<InboxItem | null>(null);

  // Non-admins never see mail captured by mailboxes we couldn't classify —
  // exclude it from every view, count, and the unread badge. Shared with the
  // topbar badge's unreadCount (useEmailInbox.ts) via isInboxItemVisible so
  // the two can never disagree.
  const visibleItems = useMemo(
    () => items.filter((i) => isInboxItemVisible(i, isAdmin)),
    [items, isAdmin],
  );
  const catItems = useMemo(
    () => (cat === 'all' ? visibleItems : visibleItems.filter((i) => i.category === cat)),
    [visibleItems, cat],
  );
  const visibleUnreadCount = useMemo(() => visibleItems.filter((i) => i.unread).length, [visibleItems]);

  const shown = useMemo(() => {
    if (tab === 'unread') return catItems.filter((i) => i.unread);
    if (tab === 'mine') return catItems.filter((i) => i.mine);
    if (tab === 'unfiled') return catItems.filter((i) => i.unfiled);
    return catItems;
  }, [catItems, tab]);

  const cats: { id: Cat; label: string; n: number }[] = [
    { id: 'all', label: t('inbox.cats.all'), n: visibleItems.length },
    { id: 'sales', label: t('inbox.cats.sales'), n: visibleItems.filter((i) => i.category === 'sales').length },
    {
      id: 'accounting',
      label: t('inbox.cats.accounting'),
      n: visibleItems.filter((i) => i.category === 'accounting').length,
    },
    { id: 'support', label: t('inbox.cats.support'), n: visibleItems.filter((i) => i.category === 'support').length },
    ...(isAdmin
      ? [{ id: 'other' as Cat, label: t('inbox.cats.other'), n: visibleItems.filter((i) => i.category === 'other').length }]
      : []),
  ];

  const tabs: { id: Tab; label: string; n: number }[] = [
    { id: 'all', label: t('inbox.tabs.all'), n: catItems.length },
    { id: 'unread', label: t('inbox.tabs.unread'), n: catItems.filter((i) => i.unread).length },
    { id: 'mine', label: t('inbox.tabs.mine'), n: catItems.filter((i) => i.mine).length },
    { id: 'unfiled', label: t('inbox.tabs.unfiled'), n: catItems.filter((i) => i.unfiled).length },
  ];

  function cardLink(i: InboxItem): { to: string; label: string } | null {
    if (i.job_id) return { to: `/jobs/${i.job_id}`, label: t('inbox.card.job') };
    if (i.lead_id) return { to: `/leads/${i.lead_id}`, label: t('inbox.card.lead') };
    if (i.deal_id) return { to: `/deals/${i.deal_id}`, label: t('inbox.card.deal') };
    if (i.client_id) return { to: `/clients/${i.client_id}`, label: t('inbox.card.client') };
    return null;
  }

  return (
    <div className="flex min-h-full flex-col gap-4 px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader title={t('inbox.title')}>
        <Button
          variant="outline"
          size="sm"
          disabled={visibleUnreadCount === 0}
          onClick={() => void markAllRead(visibleItems.filter((i) => i.unread).map((i) => i.id))}
        >
          {t('inbox.mark_all_read')}
        </Button>
      </PageHeader>

      <div className="flex flex-wrap gap-1.5">
        {cats.map((x) => (
          <button
            key={x.id}
            type="button"
            onClick={() => setCat(x.id)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              cat === x.id ? 'border-primary/40 bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:bg-muted',
            )}
          >
            {x.label} <span className="text-muted-foreground">({x.n})</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {tabs.map((x) => (
          <button
            key={x.id}
            type="button"
            onClick={() => setTab(x.id)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              tab === x.id ? 'border-primary/40 bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:bg-muted',
            )}
          >
            {x.label} <span className="text-muted-foreground">({x.n})</span>
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {shown.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">{t('inbox.empty')}</p>
        ) : (
          shown.map((i) => {
            const link = cardLink(i);
            const open = openId === i.id;
            const body = (i.body_text?.trim() || htmlToText(i.body_html ?? '')).trim();
            return (
              <article
                key={i.id}
                className={cn(
                  'rounded-xl border px-4 py-3 transition-colors',
                  i.unread ? 'border-primary/25 bg-primary/5' : 'border-border/60 bg-card',
                )}
              >
                <button
                  type="button"
                  className="flex w-full items-start justify-between gap-3 text-left"
                  onClick={() => {
                    setOpenId(open ? null : i.id);
                    if (i.unread) void markRead(i.id);
                  }}
                >
                  <span className="min-w-0">
                    <span className={cn('block truncate text-sm', i.unread ? 'font-semibold' : 'font-medium')}>
                      {i.from_name || i.from_email}
                      <span className="ml-2 text-xs font-normal text-muted-foreground">{i.from_email}</span>
                    </span>
                    <span className="block truncate text-sm text-foreground/90">{i.subject || '—'}</span>
                    {!open && <span className="block truncate text-xs text-muted-foreground">{i.snippet ?? ''}</span>}
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-xs text-muted-foreground">{i.sent_at ? relativeFromNow(i.sent_at) : ''}</span>
                    {link ? (
                      <Link to={link.to} className="text-xs text-[#157777] hover:underline dark:text-[#7ad4d4]" onClick={(e) => e.stopPropagation()}>
                        {link.label}
                      </Link>
                    ) : (
                      <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                        {t('inbox.unfiled_badge')}
                      </span>
                    )}
                  </span>
                </button>
                {open && (
                  <div className="mt-3 border-t border-border/60 pt-3">
                    <pre className="max-h-[40vh] overflow-y-auto whitespace-pre-wrap break-words font-sans text-sm text-foreground/90">{body || '—'}</pre>
                    {i.unfiled && (
                      <Button size="sm" className="mt-3" onClick={() => setFiling(i)}>
                        <FolderInput className="mr-1.5 size-3.5" /> {t('inbox.file_action')}
                      </Button>
                    )}
                  </div>
                )}
              </article>
            );
          })
        )}
      </div>

      <FileEmailDialog
        messagePk={filing?.id ?? null}
        fromEmail={filing?.from_email ?? ''}
        onClose={() => setFiling(null)}
        onFiled={() => {
          setFiling(null);
          void refetch();
        }}
      />
      <p className="text-xs text-muted-foreground">
        <Mail className="mr-1 inline size-3" /> {t('inbox.footnote')}
      </p>
    </div>
  );
}
