import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal, Pencil, Reply, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/lib/stores/authStore';
import { cn } from '@/lib/utils';
import type { CommentRow } from './hooks/useComments';
import { useUpdateComment } from './hooks/useUpdateComment';
import { useArchiveComment } from './hooks/useArchiveComment';
import { CommentForm } from './CommentForm';
import { CommentAvatar, CommentBody, formatCommentTime } from './comment-utils';
import { resolveAuthorIdentity } from './authorIdentity';
import { useProfileDirectory } from './hooks/useProfileDirectory';

type Props = {
  comment: CommentRow;
  replies?: CommentRow[];
  nested?: boolean;
};

export function CommentItem({ comment, replies = [], nested = false }: Props) {
  const { t, i18n } = useTranslation('sales');
  const locale = i18n.resolvedLanguage === 'el' ? 'el-GR' : 'en-GB';
  const myId = useAuthStore((s) => s.user?.id ?? null);
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const update = useUpdateComment();
  const archive = useArchiveComment();
  const [editing, setEditing] = useState(false);
  const [replying, setReplying] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onDoc(ev: MouseEvent) {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(ev.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menuOpen]);

  const { data: directory } = useProfileDirectory();
  const { name: authorName, email: authorEmail } = resolveAuthorIdentity(
    comment.author_id,
    comment.author,
    directory,
  );
  const displayName = authorName || authorEmail;
  const time = formatCommentTime(comment.created_at, locale);
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
    <article
      className={cn(
        'group min-w-0 shrink-0 overflow-visible rounded-xl transition-colors',
        nested
          ? 'bg-muted/25 px-3.5 py-3'
          : 'border border-border/50 bg-card px-4 py-4 shadow-sm hover:border-border/80 hover:bg-card',
      )}
    >
      <div className="flex gap-3.5">
        <CommentAvatar
          name={authorName}
          email={authorEmail}
          size={nested ? 'sm' : 'md'}
          className="mt-0.5"
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="truncate text-[15px] font-semibold text-foreground">{displayName}</span>
                <time
                  className="shrink-0 text-xs text-muted-foreground"
                  dateTime={comment.created_at}
                  title={time.title}
                >
                  {time.label}
                </time>
                {isEdited && (
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {t('comments.edited', { defaultValue: 'edited' })}
                  </span>
                )}
              </div>
              {authorName && (
                <p className="break-all text-xs text-muted-foreground">{authorEmail}</p>
              )}
            </div>

            {(canEdit || canDelete) && !editing && (
              <div className="relative shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100" ref={menuRef}>
                <button
                  type="button"
                  aria-label={t('comments.more', { defaultValue: 'More actions' })}
                  className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  onClick={() => setMenuOpen((v) => !v)}
                >
                  <MoreHorizontal className="size-4" />
                </button>
                {menuOpen && (
                  <div className="absolute right-0 top-9 z-20 min-w-[9rem] overflow-hidden rounded-lg border border-border/70 bg-popover py-1 shadow-lg">
                    {canEdit && (
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                        onClick={() => {
                          setMenuOpen(false);
                          setEditing(true);
                        }}
                      >
                        <Pencil className="size-3.5" />
                        {t('comments.edit', { defaultValue: 'Edit' })}
                      </button>
                    )}
                    {canDelete && (
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-muted dark:text-red-400"
                        onClick={() => {
                          setMenuOpen(false);
                          void onDelete();
                        }}
                      >
                        <Trash2 className="size-3.5" />
                        {t('comments.delete', { defaultValue: 'Delete' })}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {editing ? (
            <div className="mt-3 space-y-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={3}
                className="block w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm focus:border-[#1a9696]/40 focus:outline-none focus:ring-2 focus:ring-[#1a9696]/20"
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
            <>
              <CommentBody body={comment.body} className="mt-3" />

              {!replying && (
                <div className="mt-3">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    onClick={() => setReplying(true)}
                  >
                    <Reply className="size-3.5" />
                    {t('comments.reply', { defaultValue: 'Reply' })}
                  </button>
                </div>
              )}
            </>
          )}

          {replying && (
            <div className="mt-3 rounded-lg border border-border/60 bg-muted/20 p-3">
              <CommentForm
                parentType={comment.parent_type}
                parentId={comment.parent_id}
                replyToId={comment.id}
                onCancelReply={() => setReplying(false)}
              />
            </div>
          )}

          {replies.length > 0 && (
            <div className="mt-3 space-y-2 border-l-2 border-[#1a9696]/25 pl-3">
              {replies.map((r) => (
                <CommentItem key={r.id} comment={r} nested />
              ))}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
