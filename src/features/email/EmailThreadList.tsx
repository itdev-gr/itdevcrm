import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDownLeft, ArrowUpRight, ChevronDown, Reply } from 'lucide-react';
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

const CATEGORY_ORDER: readonly EmailCategory[] = ['sales', 'accounting', 'technical'];
const CATEGORY_LABEL: Record<EmailCategory, { key: string; defaultValue: string }> = {
  sales: { key: 'category.sales', defaultValue: 'Sales' },
  accounting: { key: 'category.accounting', defaultValue: 'Accounting' },
  technical: { key: 'category.technical', defaultValue: 'Technical' },
};

type Props = {
  scope: EmailScope;
  clientEmail: string;
};

type ReplyTarget = { to: string; subject: string };

export function EmailThreadList({ scope, clientEmail }: Props) {
  const { t, i18n } = useTranslation('email');
  const locale = i18n.resolvedLanguage === 'el' ? 'el-GR' : 'en-GB';
  const { data: threads = [], isLoading } = useEmailThreads(scope);
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null);
  // Explicit user toggles; untouched sections default to open-when-non-empty.
  const [toggled, setToggled] = useState<Partial<Record<EmailCategory, boolean>>>({});

  if (isLoading) {
    return (
      <p className="px-1 py-6 text-sm text-muted-foreground">
        {t('thread.loading', { defaultValue: 'Loading…' })}
      </p>
    );
  }

  if (threads.length === 0) {
    return (
      <CommentEmptyState>
        {t('thread.empty', { defaultValue: 'No client emails yet.' })}
      </CommentEmptyState>
    );
  }

  const grouped: Record<EmailCategory, EmailThread[]> = { sales: [], accounting: [], technical: [] };
  for (const th of threads) grouped[th.category].push(th);
  const isOpen = (cat: EmailCategory) => toggled[cat] ?? grouped[cat].length > 0;

  function openReply(thread: EmailThread) {
    setReplyTo({
      to: clientEmail,
      subject: `Re: ${thread.subject.replace(/^Re:\s*/i, '')}`,
    });
  }

  return (
    <div className="space-y-3">
      {CATEGORY_ORDER.map((cat) => (
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
              {grouped[cat].map((thread) => (
                <article
                  key={thread.key}
                  className="min-w-0 overflow-visible rounded-xl border border-border/50 bg-card px-4 py-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="truncate text-[15px] font-semibold text-foreground">
                        {thread.subject}
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        {t('thread.count', {
                          count: thread.messages.length,
                          defaultValue_one: '{{count}} message',
                          defaultValue_other: '{{count}} messages',
                        })}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      onClick={() => openReply(thread)}
                    >
                      <Reply className="size-3.5" />
                      {t('thread.reply', { defaultValue: 'Reply' })}
                    </button>
                  </div>

                  <div className="mt-3 space-y-3">
                    {thread.messages.map((m) => (
                      <EmailMessage key={m.id} message={m} locale={locale} t={t} />
                    ))}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      ))}

      <SendEmailDialog
        open={replyTo !== null}
        identity="personal"
        to={replyTo?.to ?? ''}
        subject={replyTo?.subject ?? ''}
        body=""
        onClose={() => setReplyTo(null)}
      />
    </div>
  );
}

function EmailMessage({
  message,
  locale,
  t,
}: {
  message: EmailMessageRow;
  locale: string;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  const inbound = message.direction === 'inbound';
  const time = message.sent_at ? formatCommentTime(message.sent_at, locale) : null;
  const bodyText = message.body_text ?? message.snippet ?? '';

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
          <div className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-foreground">
            {bodyText}
          </div>
        </div>
      </div>
    </div>
  );
}
