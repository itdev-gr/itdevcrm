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
    <div className="space-y-3">
      {tops.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('comments.empty')}</p>
      ) : (
        <div className="space-y-2">
          {tops.map((c) => (
            <CommentItem key={c.id} comment={c} replies={repliesByParent.get(c.id) ?? []} />
          ))}
        </div>
      )}
      <CommentForm parentType={parentType} parentId={parentId} />
    </div>
  );
}
