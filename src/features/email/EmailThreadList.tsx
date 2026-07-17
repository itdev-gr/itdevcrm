import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDownLeft, ArrowUpRight, ChevronDown, Reply, SquarePen } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  CommentAvatar,
  CommentEmptyState,
  formatCommentTime,
} from '@/features/comments/comment-utils';
import {
  useEmailThreads,
  type EmailCategory,
  type EmailMessageRow,
  type EmailScope,
  type EmailThread,
} from './hooks/useEmailThreads';
import { SendEmailDialog } from './SendEmailDialog';
import { useBccEmails } from './hooks/useBccEmails';
import { cleanEmailBody } from './cleanEmailBody';

// PILOT: render-time email cleanup (strip quoted history + signatures) is limited
// to these deals while we validate it. Roll out site-wide by removing this gate.
const CLEANUP_PILOT_DEAL_IDS = new Set<string>(['4fb6295f-d0bc-49b8-a4dd-f2ecf7f5f19b']);

const CATEGORY_ORDER: readonly EmailCategory[] = ['sales', 'accounting', 'technical'];
const CATEGORY_LABEL: Record<EmailCategory, { key: string; defaultValue: string }> = {
  sales: { key: 'category.sales', defaultValue: 'Sales' },
  accounting: { key: 'category.accounting', defaultValue: 'Accounting' },
  technical: { key: 'category.technical', defaultValue: 'Technical' },
};

type Props = {
  scope: EmailScope;
  clientEmail: string;
  newEmailSubject?: string;
};

type Draft = { to: string; subject: string };

export function EmailThreadList({ scope, clientEmail, newEmailSubject = '' }: Props) {
  const { t, i18n } = useTranslation('email');
  const locale = i18n.resolvedLanguage === 'el' ? 'el-GR' : 'en-GB';
  const { data: threads = [], isLoading } = useEmailThreads(scope);
  const cleanBodies = !!scope.deal_id && CLEANUP_PILOT_DEAL_IDS.has(scope.deal_id);
  const allIds = threads.flatMap((th) => th.messages.map((m) => m.id));
  const bccMap = useBccEmails(allIds);
  const [draft, setDraft] = useState<Draft | null>(null);
  // Explicit user toggles; untouched sections default to open-when-non-empty.
  const [toggled, setToggled] = useState<Partial<Record<EmailCategory, boolean>>>({});
  // Threads are collapsed by default.
  const [openThreads, setOpenThreads] = useState<Partial<Record<string, boolean>>>({});

  if (isLoading) {
    return (
      <p className="px-1 py-6 text-sm text-muted-foreground">
        {t('thread.loading', { defaultValue: 'Loading…' })}
      </p>
    );
  }

  const grouped: Record<EmailCategory, EmailThread[]> = { sales: [], accounting: [], technical: [] };
  for (const th of threads) grouped[th.category].push(th);
  const isOpen = (cat: EmailCategory) => toggled[cat] ?? grouped[cat].length > 0;

  function openReply(thread: EmailThread) {
    const newest = thread.messages[0];
    const counterparty = newest
      ? newest.direction === 'inbound'
        ? newest.from_email
        : newest.to_email
      : '';
    const base = thread.subject.replace(/^Re:\s*/i, '');
    // newEmailSubject looks like "<code> - "; extract the bare code token.
    const codeToken = newEmailSubject.replace(/\s*-\s*$/, '').trim();
    const subject =
      codeToken && !base.includes(codeToken) ? `Re: ${newEmailSubject}${base}` : `Re: ${base}`;
    setDraft({
      to: counterparty || clientEmail,
      subject,
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
          onClick={() => setDraft({ to: clientEmail, subject: newEmailSubject ?? '' })}
        >
          <SquarePen className="size-3.5" />
          {t('thread.new_email', { defaultValue: 'New email' })}
        </button>
      </div>

      {threads.length === 0 ? (
        <CommentEmptyState>
          {t('thread.empty', { defaultValue: 'No client emails yet.' })}
        </CommentEmptyState>
      ) : (
        CATEGORY_ORDER.map((cat) => (
          <section key={cat}>
            <button
              type="button"
              aria-expanded={isOpen(cat)}
              onClick={() => setToggled((s) => ({ ...s, [cat]: !isOpen(cat) }))}
              className="flex w-full items-center justify-between rounded-lg border border-border/50 bg-muted/40 px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted/60"
            >
              <span>
                {t(CATEGORY_LABEL[cat].key, { defaultValue: CATEGORY_LABEL[cat].defaultValue })}{' '}
                <span className="text-xs font-normal text-muted-foreground">
                  ({grouped[cat].length})
                </span>
              </span>
              <ChevronDown
                className={cn(
                  'size-4 text-muted-foreground transition-transform',
                  !isOpen(cat) && '-rotate-90',
                )}
              />
            </button>

            {isOpen(cat) && grouped[cat].length > 0 && (
              <div className="mt-2 space-y-3">
                {grouped[cat].map((thread) => {
                  const threadOpen = openThreads[thread.key] ?? false;
                  const lastTime = thread.last_at
                    ? formatCommentTime(thread.last_at, locale)
                    : null;
                  return (
                    <article
                      key={thread.key}
                      className="min-w-0 overflow-visible rounded-xl border border-border/50 bg-card px-4 py-4 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <button
                          type="button"
                          aria-expanded={threadOpen}
                          onClick={() =>
                            setOpenThreads((s) => ({ ...s, [thread.key]: !threadOpen }))
                          }
                          className="flex min-w-0 flex-1 items-start gap-2 text-left"
                        >
                          <ChevronDown
                            className={cn(
                              'mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform',
                              !threadOpen && '-rotate-90',
                            )}
                          />
                          <div className="min-w-0">
                            <h3 className="truncate text-[15px] font-semibold text-foreground">
                              {thread.subject}
                            </h3>
                            <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                              <span>
                                {t('thread.count', {
                                  count: thread.messages.length,
                                  defaultValue_one: '{{count}} message',
                                  defaultValue_other: '{{count}} messages',
                                })}
                              </span>
                              {lastTime && (
                                <time
                                  className="shrink-0 text-muted-foreground"
                                  dateTime={thread.last_at ?? undefined}
                                  title={lastTime.title}
                                >
                                  {lastTime.label}
                                </time>
                              )}
                            </p>
                          </div>
                        </button>
                        <button
                          type="button"
                          className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          onClick={() => openReply(thread)}
                        >
                          <Reply className="size-3.5" />
                          {t('thread.reply', { defaultValue: 'Reply' })}
                        </button>
                      </div>

                      {threadOpen && (
                        <div className="mt-3 space-y-3">
                          {thread.messages.map((m) => (
                            <EmailMessage
                              key={m.id}
                              message={m}
                              locale={locale}
                              t={t}
                              bccMap={bccMap}
                              cleanBodies={cleanBodies}
                            />
                          ))}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        ))
      )}

      {draft && (
        <SendEmailDialog
          open
          identity="personal"
          to={draft.to}
          subject={draft.subject}
          body=""
          onClose={() => setDraft(null)}
        />
      )}
    </div>
  );
}

function EmailMessage({
  message,
  locale,
  t,
  bccMap,
  cleanBodies,
}: {
  message: EmailMessageRow;
  locale: string;
  t: ReturnType<typeof useTranslation>['t'];
  bccMap: Map<string, string>;
  cleanBodies: boolean;
}) {
  const inbound = message.direction === 'inbound';
  const time = message.sent_at ? formatCommentTime(message.sent_at, locale) : null;
  const rawBody = message.body_text ?? message.snippet ?? '';
  const [showRaw, setShowRaw] = useState(false);

  const cleaned = cleanBodies ? cleanEmailBody(rawBody) : null;
  const displayBody = cleaned && !showRaw ? cleaned.visible : rawBody;
  const isEl = locale.startsWith('el');

  return (
    <div className="min-w-0 rounded-lg bg-muted/25 px-3.5 py-3">
      <div className="flex gap-3">
        <CommentAvatar
          name={message.from_name}
          email={message.from_email}
          size="sm"
          className="mt-0.5"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                inbound
                  ? 'bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300'
                  : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
              )}
            >
              {inbound ? (
                <ArrowDownLeft className="size-3" />
              ) : (
                <ArrowUpRight className="size-3" />
              )}
              {inbound
                ? t('thread.received', { defaultValue: 'Received' })
                : t('thread.sent', { defaultValue: 'Sent' })}
            </span>
            <span className="truncate text-[13px] font-semibold text-foreground">
              {message.from_name || message.from_email}
            </span>
            <span className="shrink-0 text-muted-foreground/60">→</span>
            <span className="truncate text-xs text-muted-foreground">{message.to_email}</span>
            {message.department && (
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {message.department}
              </span>
            )}
            {time && (
              <time
                className="shrink-0 text-xs text-muted-foreground"
                dateTime={message.sent_at ?? undefined}
                title={time.title}
              >
                {time.label}
              </time>
            )}
          </div>
          {(message.cc_emails || bccMap.get(message.id)) && (
            <div className="mt-0.5 space-y-0.5 text-xs text-muted-foreground">
              {message.cc_emails && (
                <div className="truncate">
                  {t('thread.cc', { defaultValue: 'Cc' })}: {message.cc_emails.split(',').join(', ')}
                </div>
              )}
              {bccMap.get(message.id) && (
                <div className="truncate">
                  {t('thread.bcc', { defaultValue: 'Bcc' })}: {bccMap.get(message.id)!.split(',').join(', ')}
                </div>
              )}
            </div>
          )}
          <div className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-foreground">
            {displayBody}
          </div>
          {cleaned?.hasHidden && (
            <button
              type="button"
              onClick={() => setShowRaw((v) => !v)}
              className="mt-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {showRaw
                ? isEl
                  ? '− Απόκρυψη ιστορικού & υπογραφών'
                  : '− Hide quoted text & signatures'
                : isEl
                  ? '···  Εμφάνιση αρχικού'
                  : '···  Show original'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
