import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Mail, FolderInput, X, Undo2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/layout/page-shell';
import { relativeFromNow } from '@/lib/datetime';
import { useAuthStore } from '@/lib/stores/authStore';
import { htmlToText } from './htmlToText';
import {
  useEmailInbox,
  useMarkEmailRead,
  useEmailInboxRealtime,
  useDismissEmail,
  dismissScopeFor,
  isInboxItemVisible,
  allowedCategoriesFor,
  type InboxItem,
  type InboxCategory,
} from './hooks/useEmailInbox';
import { FileEmailDialog } from './FileEmailDialog';

type Tab = 'all' | 'unread' | 'mine' | 'unfiled' | 'cleared';
type Cat = 'all' | InboxCategory;

export function InboxPage() {
  const { t } = useTranslation('sales');
  const { items, clearedItems, refetch } = useEmailInbox();
  useEmailInboxRealtime();
  const { markRead, markAllRead } = useMarkEmailRead();
  const { dismiss, restore } = useDismissEmail();
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const groupCodes = useAuthStore((s) => s.groupCodes);
  const [cat, setCat] = useState<Cat>('all');
  const [tab, setTab] = useState<Tab>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [filing, setFiling] = useState<InboxItem | null>(null);

  // Each role sees only its mailbox categories (owner 2026-09-04) — the same
  // rule the topbar badge counts through (allowedCategoriesFor/isInboxItemVisible
  // in useEmailInbox.ts), so list, counts and badge can never disagree.
  const allowed = useMemo(() => allowedCategoriesFor(isAdmin, groupCodes), [isAdmin, groupCodes]);
  const visibleItems = useMemo(
    () => items.filter((i) => isInboxItemVisible(i, allowed)),
    [items, allowed],
  );
  // The Όλα chip and the Άλλο chip are admin-only; other roles get one chip per
  // allowed category (Προσωπικά only when they actually have such mail). For
  // non-admins 'all' is not a chip but the unfiltered default: no chip active
  // shows everything their role allows, and clicking the active chip clears it.
  const catIds = useMemo<Cat[]>(() => {
    if (isAdmin) return ['all', 'sales', 'accounting', 'support', 'other'];
    const ids = (['sales', 'accounting', 'support'] as const).filter((c) => allowed.has(c));
    const hasPersonal = items.some((i) => i.category === 'personal') || clearedItems.some((i) => i.category === 'personal');
    return hasPersonal ? [...ids, 'personal'] : [...ids];
  }, [isAdmin, allowed, items, clearedItems]);
  const effectiveCat: Cat = catIds.includes(cat) || cat === 'all' ? cat : 'all';
  const catItems = useMemo(
    () => (effectiveCat === 'all' ? visibleItems : visibleItems.filter((i) => i.category === effectiveCat)),
    [visibleItems, effectiveCat],
  );
  const visibleUnreadCount = useMemo(() => visibleItems.filter((i) => i.unread).length, [visibleItems]);
  const clearedShown = useMemo(() => {
    const visible = clearedItems.filter((i) => isInboxItemVisible(i, allowed));
    return effectiveCat === 'all' ? visible : visible.filter((i) => i.category === effectiveCat);
  }, [clearedItems, allowed, effectiveCat]);

  const shown = useMemo(() => {
    if (tab === 'cleared') return clearedShown;
    if (tab === 'unread') return catItems.filter((i) => i.unread);
    if (tab === 'mine') return catItems.filter((i) => i.mine);
    if (tab === 'unfiled') return catItems.filter((i) => i.unfiled);
    return catItems;
  }, [catItems, clearedShown, tab]);

  const cats: { id: Cat; label: string; n: number }[] = catIds.map((id) => ({
    id,
    label: t(`inbox.cats.${id}`),
    n: id === 'all' ? visibleItems.length : visibleItems.filter((i) => i.category === id).length,
  }));

  const tabs: { id: Tab; label: string; n: number }[] = [
    { id: 'all', label: t('inbox.tabs.all'), n: catItems.length },
    { id: 'unread', label: t('inbox.tabs.unread'), n: catItems.filter((i) => i.unread).length },
    { id: 'mine', label: t('inbox.tabs.mine'), n: catItems.filter((i) => i.mine).length },
    { id: 'unfiled', label: t('inbox.tabs.unfiled'), n: catItems.filter((i) => i.unfiled).length },
    { id: 'cleared', label: t('inbox.tabs.cleared'), n: clearedShown.length },
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
            onClick={() => setCat(!isAdmin && effectiveCat === x.id ? 'all' : x.id)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              effectiveCat === x.id ? 'border-primary/40 bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:bg-muted',
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
                <div className="flex items-start gap-2">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-start justify-between gap-3 text-left"
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
                <button
                  type="button"
                  aria-label={i.dismissed ? t('inbox.restore_action') : t('inbox.clear_action')}
                  title={
                    i.dismissed
                      ? t('inbox.restore_action')
                      : dismissScopeFor(i.category) === 'shared'
                        ? t('inbox.clear_hint_shared')
                        : t('inbox.clear_hint_own')
                  }
                  className="mt-0.5 shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  onClick={() => void (i.dismissed ? restore(i) : dismiss(i))}
                >
                  {i.dismissed ? <Undo2 className="size-4" /> : <X className="size-4" />}
                </button>
                </div>
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
