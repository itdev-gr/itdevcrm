import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useComments, type CommentRow } from './hooks/useComments';
import { CommentItem } from './CommentItem';
import { CommentForm } from './CommentForm';
import { CommentEmptyState } from './comment-utils';

type Props = {
  parentType: 'client' | 'deal' | 'job' | 'lead';
  parentId: string;
};

function scrollCommentsToBottom(el: HTMLElement) {
  el.scrollTo({ top: el.scrollHeight, behavior: 'instant' });
}

export function CommentsPanel({ parentType, parentId }: Props) {
  const { t } = useTranslation('sales');
  const { data: comments = [] } = useComments(parentType, parentId);

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const syncScroll = () => scrollCommentsToBottom(el);
    syncScroll();

    const t1 = window.setTimeout(syncScroll, 80);
    const t2 = window.setTimeout(syncScroll, 320);

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [comments.length]);

  const repliesByParent = new Map<string, CommentRow[]>();
  const tops: CommentRow[] = [];
  for (const c of comments) {
    if (c.reply_to_id) {
      const list = repliesByParent.get(c.reply_to_id) ?? [];
      list.push(c);
      repliesByParent.set(c.reply_to_id, list);
    } else {
      tops.push(c);
    }
  }

  return (
    <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] gap-4 overflow-hidden">
      <div
        ref={scrollRef}
        className="min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain scroll-smooth pr-1.5 [scrollbar-gutter:stable]"
      >
        <div className="space-y-4 pb-24 pt-0.5">
          {tops.length === 0 ? (
            <CommentEmptyState>{t('comments.empty')}</CommentEmptyState>
          ) : (
            tops.map((c) => (
              <CommentItem key={c.id} comment={c} replies={repliesByParent.get(c.id) ?? []} />
            ))
          )}
        </div>
      </div>

      <div className="shrink-0 rounded-xl border border-border/60 bg-card p-4 shadow-sm">
        <p className="mb-3 text-sm font-medium text-foreground">
          {t('comments.new_comment', { defaultValue: 'New comment' })}
        </p>
        <CommentForm parentType={parentType} parentId={parentId} />
      </div>
    </div>
  );
}
