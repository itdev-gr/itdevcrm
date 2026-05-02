import { useTranslation } from 'react-i18next';
import { useComments } from './hooks/useComments';
import { CommentItem } from './CommentItem';
import { CommentForm } from './CommentForm';

type Props = {
  parentType: 'client' | 'deal' | 'job';
  parentId: string;
};

export function CommentsPanel({ parentType, parentId }: Props) {
  const { t } = useTranslation('sales');
  const { data: comments = [] } = useComments(parentType, parentId);
  return (
    <div className="space-y-3">
      {comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('comments.empty')}</p>
      ) : (
        <div className="space-y-2">
          {comments.map((c) => (
            <CommentItem key={c.id} comment={c} />
          ))}
        </div>
      )}
      <CommentForm parentType={parentType} parentId={parentId} />
    </div>
  );
}
