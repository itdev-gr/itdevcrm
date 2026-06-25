import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useTaskComments } from './hooks/useTaskComments';
import { usePostTaskComment } from './hooks/usePostTaskComment';

export function TaskComments({ kind, taskId, locale }: {
  kind: 'user' | 'assigned';
  taskId: string;
  locale: string;
}) {
  const { t } = useTranslation('common');
  const { data: comments = [] } = useTaskComments(kind, taskId);
  const post = usePostTaskComment();
  const [body, setBody] = useState('');

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const text = body.trim();
    if (!text) return;
    post.mutate({ kind, taskId, body: text }, { onSuccess: () => setBody('') });
  }

  const fmt = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));

  return (
    <section className="space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t('tasks_page.comments_title')}
      </h4>
      <div className="max-h-48 space-y-2 overflow-y-auto pr-1">
        {comments.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('tasks_page.comments_empty')}</p>
        ) : (
          comments.map((c) => (
            <div key={c.id} className="rounded-md border border-border/60 bg-muted/40 px-2.5 py-1.5">
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  {c.author?.full_name || c.author?.email || '—'}
                </span>{' '}
                · {fmt(c.created_at)}
              </p>
              <p className="whitespace-pre-wrap text-sm text-foreground">{c.body}</p>
            </div>
          ))
        )}
      </div>
      <form onSubmit={onSubmit} className="flex items-end gap-2">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          placeholder={t('tasks_page.comment_placeholder')}
          className="min-h-9 flex-1 resize-y rounded-md border border-border bg-background px-2 py-1 text-sm"
        />
        <Button type="submit" size="sm" disabled={post.isPending || body.trim().length === 0}>
          {t('tasks_page.comment_post')}
        </Button>
      </form>
    </section>
  );
}
