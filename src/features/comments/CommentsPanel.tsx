import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useComments, type CommentRow } from './hooks/useComments';
import { CommentItem } from './CommentItem';
import { CommentForm } from './CommentForm';

type Props = {
  parentType: 'client' | 'deal' | 'job' | 'lead';
  parentId: string;
};

export function CommentsPanel({ parentType, parentId }: Props) {
  const { t } = useTranslation('sales');
  const { data: comments = [] } = useComments(parentType, parentId);

  // Open scrolled to the latest message (comments are oldest-first), and follow
  // new ones as they post.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const toBottom = () => {
      el.scrollTop = el.scrollHeight;
    };
    toBottom();
    // Re-run after the flex/grid layout settles and comment items finish
    // rendering (the pane isn't scrollable on the first frame).
    const t1 = setTimeout(toBottom, 60);
    const t2 = setTimeout(toBottom, 300);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [comments.length]);

  // Group replies under their parent (single level — no nested threads).
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
    <div className="flex flex-col gap-3 lg:min-h-0 lg:flex-1">
      <div ref={scrollRef} className="space-y-2 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-1">
        {tops.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('comments.empty')}</p>
        ) : (
          tops.map((c) => (
            <CommentItem key={c.id} comment={c} replies={repliesByParent.get(c.id) ?? []} />
          ))
        )}
      </div>
      <CommentForm parentType={parentType} parentId={parentId} />
    </div>
  );
}
