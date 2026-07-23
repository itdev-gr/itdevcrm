import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUp, Check, Pencil, Trash2, X } from 'lucide-react';
import { useAuthStore } from '@/lib/stores/authStore';
import { cn } from '@/lib/utils';
import { useCommentDraft, taskThreadKey } from '@/features/comments/commentDraftStore';
import { resolveAuthorIdentity } from '@/features/comments/authorIdentity';
import { useProfileDirectory } from '@/features/comments/hooks/useProfileDirectory';
import { CommentAttachButton } from '@/features/comments/CommentAttachButton';
import { useUploadCommentAttachment } from '@/features/comments/hooks/useUploadCommentAttachment';
import { useCommentAttachments } from '@/features/comments/hooks/useCommentAttachments';
import { useDeleteCommentAttachment } from '@/features/comments/hooks/useDeleteCommentAttachment';
import { AttachmentGallery } from '@/features/attachments/AttachmentGallery';
import { useTaskComments, type TaskCommentRow } from './hooks/useTaskComments';
import { usePostTaskComment } from './hooks/usePostTaskComment';
import { useUpdateTaskComment } from './hooks/useUpdateTaskComment';
import { useDeleteTaskComment } from './hooks/useDeleteTaskComment';

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
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const { data: comments = [] } = useTaskComments(kind, taskId);
  const { data: directory } = useProfileDirectory();
  const post = usePostTaskComment();
  const uploadFile = useUploadCommentAttachment();
  const [pending, setPending] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const { text: body, setText: setBody, clear: clearDraft } = useCommentDraft(taskThreadKey(kind, taskId));

  // Resolve via the security-definer directory: profiles RLS hides other users'
  // rows, so the embedded author is null for everyone but the viewer.
  const nameOf = (c: TaskCommentRow): string => {
    const { name, email } = resolveAuthorIdentity(c.author_user_id, c.author, directory);
    return name || email;
  };

  async function submit() {
    const text = body.trim();
    if ((!text && pending.length === 0) || post.isPending || submitting) return;
    try {
      setSubmitting(true);
      const { id } = await post.mutateAsync({ kind, taskId, body: text });
      // Files upload against the freshly-posted comment; a file error alerts but
      // never rolls back the comment that already landed.
      for (const file of pending) {
        try {
          await uploadFile.mutateAsync({ parent: { task_comment_id: id }, file });
        } catch (err) {
          alert((err as Error).message);
        }
      }
      setPending([]);
      clearDraft();
    } finally {
      setSubmitting(false);
    }
  }
  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void submit();
  }
  // Enter sends, Shift+Enter newlines.
  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
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
            return (
              <TaskCommentBubble
                key={c.id}
                c={c}
                kind={kind}
                taskId={taskId}
                mine={mine}
                canModify={mine || isAdmin}
                name={mine ? t('tasks_page.you') : nameOf(c)}
                avatarName={nameOf(c)}
                fmt={fmt}
                t={t}
              />
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
        <CommentAttachButton
          pending={pending}
          onPick={(f) => setPending((p) => [...p, ...f])}
          onRemove={(i) => setPending((p) => p.filter((_, idx) => idx !== i))}
          disabled={submitting}
        />
        <button
          type="submit"
          disabled={submitting || (body.trim().length === 0 && pending.length === 0)}
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

function TaskCommentBubble({
  c,
  kind,
  taskId,
  mine,
  canModify,
  name,
  avatarName,
  fmt,
  t,
}: {
  c: TaskCommentRow;
  kind: 'user' | 'assigned';
  taskId: string;
  mine: boolean;
  canModify: boolean;
  name: string;
  avatarName: string;
  fmt: (iso: string) => string;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(c.body);
  const update = useUpdateTaskComment();
  const del = useDeleteTaskComment();
  const { data: files = [] } = useCommentAttachments({ task_comment_id: c.id });
  const delFile = useDeleteCommentAttachment();
  const isEdited = !!c.updated_at && !!c.created_at && c.updated_at !== c.created_at;
  const busy = update.isPending || del.isPending;

  async function onSave() {
    const text = draft.trim();
    if (!text || text === c.body) {
      setDraft(c.body);
      setEditing(false);
      return;
    }
    try {
      await update.mutateAsync({ kind, taskId, id: c.id, body: text });
      setEditing(false);
    } catch (err) {
      alert((err as Error).message);
    }
  }

  function onCancel() {
    setDraft(c.body);
    setEditing(false);
  }

  async function onDelete() {
    if (!confirm(t('tasks_page.comment_confirm_delete', { defaultValue: 'Delete this comment?' }))) {
      return;
    }
    try {
      await del.mutateAsync({ kind, taskId, id: c.id });
    } catch (err) {
      alert((err as Error).message);
    }
  }

  return (
    <div className="group flex gap-2.5">
      <div
        className={cn(
          'mt-0.5 flex size-7 shrink-0 select-none items-center justify-center rounded-full text-[10px] font-semibold',
          tintFor(c.author_user_id),
        )}
        aria-hidden="true"
      >
        {initials(avatarName)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline gap-1.5">
          <span className="text-xs font-semibold text-foreground">{name}</span>
          <span className="text-[10px] text-muted-foreground">{fmt(c.created_at)}</span>
          {isEdited && (
            <span className="text-[10px] italic text-muted-foreground/70">
              {t('tasks_page.comment_edited', { defaultValue: 'edited' })}
            </span>
          )}
          {canModify && !editing && (
            <span className="ml-auto flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                type="button"
                onClick={() => {
                  setDraft(c.body);
                  setEditing(true);
                }}
                aria-label={t('tasks_page.comment_edit', { defaultValue: 'Edit' })}
                title={t('tasks_page.comment_edit', { defaultValue: 'Edit' })}
                className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Pencil className="size-3" />
              </button>
              <button
                type="button"
                onClick={() => void onDelete()}
                disabled={busy}
                aria-label={t('tasks_page.comment_delete', { defaultValue: 'Delete' })}
                title={t('tasks_page.comment_delete', { defaultValue: 'Delete' })}
                className="rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="size-3" />
              </button>
            </span>
          )}
        </p>

        {editing ? (
          <div className="mt-1 space-y-1.5">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void onSave();
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  onCancel();
                }
              }}
              rows={2}
              autoFocus
              className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm shadow-sm focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
            />
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => void onSave()}
                disabled={busy || draft.trim().length === 0}
                className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                <Check className="size-3" />
                {t('tasks_page.comment_save', { defaultValue: 'Save' })}
              </button>
              <button
                type="button"
                onClick={onCancel}
                className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="size-3" />
                {t('tasks_page.comment_cancel', { defaultValue: 'Cancel' })}
              </button>
            </div>
          </div>
        ) : (
          <>
            {c.body.trim().length > 0 && (
              <div
                className={cn(
                  'mt-1 inline-block max-w-full rounded-2xl rounded-tl-sm px-3 py-1.5 text-sm',
                  mine ? 'bg-primary/10 text-foreground' : 'bg-muted text-foreground',
                )}
              >
                <p className="whitespace-pre-wrap break-words">{c.body}</p>
              </div>
            )}

            {files.length > 0 && (
              <div className="mt-1.5">
                <AttachmentGallery
                  files={files}
                  {...(canModify
                    ? {
                        onDelete: (f) =>
                          void delFile.mutateAsync({
                            id: f.id,
                            storage_path: f.storage_path,
                            parent: { task_comment_id: c.id },
                          }),
                      }
                    : {})}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
