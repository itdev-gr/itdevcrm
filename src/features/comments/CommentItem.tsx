import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/lib/stores/authStore';
import type { CommentRow } from './hooks/useComments';
import { useUpdateComment } from './hooks/useUpdateComment';
import { useArchiveComment } from './hooks/useArchiveComment';
import { CommentForm } from './CommentForm';

type Props = {
  comment: CommentRow;
  replies?: CommentRow[];
};

export function CommentItem({ comment, replies = [] }: Props) {
  const { t } = useTranslation('sales');
  const myId = useAuthStore((s) => s.user?.id ?? null);
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const update = useUpdateComment();
  const archive = useArchiveComment();
  const [editing, setEditing] = useState(false);
  const [replying, setReplying] = useState(false);
  const [draft, setDraft] = useState(comment.body);

  const date = new Date(comment.created_at).toLocaleString();
  const author = comment.author?.full_name || comment.author?.email || comment.author_id;
  const canEdit = isAdmin || (myId !== null && myId === comment.author_id);
  const canDelete = canEdit;
  const isEdited =
    !!comment.updated_at && !!comment.created_at && comment.updated_at !== comment.created_at;

  async function onSaveEdit() {
    if (!draft.trim() || draft === comment.body) {
      setEditing(false);
      return;
    }
    try {
      await update.mutateAsync({
        id: comment.id,
        parent_type: comment.parent_type,
        parent_id: comment.parent_id,
        body: draft.trim(),
      });
      setEditing(false);
    } catch (err) {
      alert((err as Error).message);
    }
  }

  async function onDelete() {
    if (!confirm(t('comments.confirm_delete', { defaultValue: 'Delete this comment?' }))) return;
    try {
      await archive.mutateAsync({
        id: comment.id,
        parent_type: comment.parent_type,
        parent_id: comment.parent_id,
      });
    } catch (err) {
      alert((err as Error).message);
    }
  }

  return (
    <div className="rounded-md border bg-white p-3">
      <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
        <span className="font-medium text-slate-700">{author}</span>
        <span className="whitespace-nowrap">
          {date}
          {isEdited && (
            <span className="ml-1 italic">
              · {t('comments.edited', { defaultValue: 'edited' })}
            </span>
          )}
        </span>
      </div>

      {editing ? (
        <div className="mt-2 space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setDraft(comment.body);
                setEditing(false);
              }}
            >
              {t('comments.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={update.isPending || !draft.trim()}
              onClick={onSaveEdit}
            >
              {t('comments.save', { defaultValue: 'Save' })}
            </Button>
          </div>
        </div>
      ) : (
        <p className="mt-1 whitespace-pre-wrap text-sm">{comment.body}</p>
      )}

      {!editing && (
        <div className="mt-1 flex gap-3 text-[11px] text-slate-500">
          <button
            type="button"
            className="hover:text-slate-900"
            onClick={() => setReplying((v) => !v)}
          >
            {replying
              ? t('comments.cancel', { defaultValue: 'Cancel' })
              : t('comments.reply', { defaultValue: 'Reply' })}
          </button>
          {canEdit && (
            <button type="button" className="hover:text-slate-900" onClick={() => setEditing(true)}>
              {t('comments.edit', { defaultValue: 'Edit' })}
            </button>
          )}
          {canDelete && (
            <button type="button" className="text-red-600 hover:text-red-800" onClick={onDelete}>
              {t('comments.delete', { defaultValue: 'Delete' })}
            </button>
          )}
        </div>
      )}

      {replying && (
        <div className="mt-2 border-l-2 border-slate-200 pl-3">
          <CommentForm
            parentType={comment.parent_type}
            parentId={comment.parent_id}
            replyToId={comment.id}
            onCancelReply={() => setReplying(false)}
          />
        </div>
      )}

      {replies.length > 0 && (
        <div className="mt-3 space-y-2 border-l-2 border-slate-200 pl-3">
          {replies.map((r) => (
            <CommentItem key={r.id} comment={r} />
          ))}
        </div>
      )}
    </div>
  );
}
