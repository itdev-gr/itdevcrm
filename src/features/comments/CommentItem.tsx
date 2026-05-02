import type { CommentRow } from './hooks/useComments';

export function CommentItem({ comment }: { comment: CommentRow }) {
  const date = new Date(comment.created_at).toLocaleString();
  const author = comment.author?.full_name || comment.author?.email || comment.author_id;
  return (
    <div className="rounded-md border bg-white p-3">
      <div className="flex items-baseline justify-between text-xs text-muted-foreground">
        <span className="font-medium">{author}</span>
        <span>{date}</span>
      </div>
      <p className="mt-1 whitespace-pre-wrap text-sm">{comment.body}</p>
    </div>
  );
}
