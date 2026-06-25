import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUp } from 'lucide-react';
import { useAuthStore } from '@/lib/stores/authStore';
import { cn } from '@/lib/utils';
import { useTaskComments, type TaskCommentRow } from './hooks/useTaskComments';
import { usePostTaskComment } from './hooks/usePostTaskComment';

function authorName(c: TaskCommentRow): string {
  return c.author?.full_name || c.author?.email || '—';
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

// Deterministic soft tint per author so the thread reads as a conversation.
const AVATAR_TINTS = [
  'bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-200',
  'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-200',
  'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200',
  'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-950/60 dark:text-fuchsia-200',
  'bg-cyan-100 text-cyan-700 dark:bg-cyan-950/60 dark:text-cyan-200',
];
function tintFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_TINTS[h % AVATAR_TINTS.length]!;
}

export function TaskComments({ kind, taskId, locale }: {
  kind: 'user' | 'assigned';
  taskId: string;
  locale: string;
}) {
  const { t } = useTranslation('common');
  const meId = useAuthStore((s) => s.user?.id ?? '');
  const { data: comments = [] } = useTaskComments(kind, taskId);
  const post = usePostTaskComment();
  const [body, setBody] = useState('');

  function submit() {
    const text = body.trim();
    if (!text || post.isPending) return;
    post.mutate({ kind, taskId, body: text }, { onSuccess: () => setBody('') });
  }
  function onSubmit(e: FormEvent) {
    e.preventDefault();
    submit();
  }
  // Enter sends, Shift+Enter newlines.
  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  const fmt = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));

  return (
    <section className="flex min-h-0 flex-col gap-2.5">
      <h4 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {t('tasks_page.comments_title')}
        {comments.length > 0 && (
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {comments.length}
          </span>
        )}
      </h4>

      <div className="max-h-56 space-y-3 overflow-y-auto pr-1">
        {comments.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border/70 px-3 py-4 text-center text-xs text-muted-foreground">
            {t('tasks_page.comments_empty')}
          </p>
        ) : (
          comments.map((c) => {
            const mine = c.author_user_id === meId;
            const name = mine ? t('tasks_page.you') : authorName(c);
            return (
              <div key={c.id} className="flex gap-2.5">
                <div
                  className={cn(
                    'mt-0.5 flex size-7 shrink-0 select-none items-center justify-center rounded-full text-[10px] font-semibold',
                    tintFor(c.author_user_id),
                  )}
                  aria-hidden="true"
                >
                  {initials(authorName(c))}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="flex items-baseline gap-1.5">
                    <span className="text-xs font-semibold text-foreground">{name}</span>
                    <span className="text-[10px] text-muted-foreground">{fmt(c.created_at)}</span>
                  </p>
                  <div
                    className={cn(
                      'mt-1 inline-block max-w-full rounded-2xl rounded-tl-sm px-3 py-1.5 text-sm',
                      mine ? 'bg-primary/10 text-foreground' : 'bg-muted text-foreground',
                    )}
                  >
                    <p className="whitespace-pre-wrap break-words">{c.body}</p>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <form onSubmit={onSubmit} className="flex items-end gap-2">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={t('tasks_page.comment_placeholder')}
          className="max-h-28 min-h-9 flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm shadow-sm transition-colors focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
        />
        <button
          type="submit"
          disabled={post.isPending || body.trim().length === 0}
          aria-label={t('tasks_page.comment_post')}
          title={t('tasks_page.comment_post')}
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          <ArrowUp className="size-4" />
        </button>
      </form>
    </section>
  );
}
