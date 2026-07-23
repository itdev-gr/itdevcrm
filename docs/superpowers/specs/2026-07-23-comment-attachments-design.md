# Inline attachments on comments — design

Date: 2026-07-23
Status: implemented 2026-07-23 (commits 425c952, 3b78b05, 731038c, cf7ca4a, 8cf4681, 9a648c2; prod RLS harness proved both privacy directions; 43 tests + build green; attach control live on prod)

## Accepted scope narrowing (post-implementation)
Per owner decision #2, the "surface in the Attachments tab" applies to **deal/lead/client** (which use `CombinedAttachmentsTab`). Job pages use `AttachmentsPanel` directly, so job-scoped comment files render **inline in the thread** but are not aggregated in the job's Attachments tab. Channel jobs (web_dev/seo/ads/social) route comments to the deal's `deal_*` channel, so their files DO appear under the deal's tab; only hosting/non-channel job comment files are inline-only. Extending `useEntityCommentFiles` to accept `'job'` is a possible future enhancement, out of scope here.

## Goal

Let staff attach files (photos, PDFs, documents — any type) directly inside a comment/message, in BOTH:
- **Task chat** (`task_comments`, parties-only), and
- **Every general comment thread** (`comments`): client, deal, lead, job, plus the deal channels Dev/SEO/Ads/Social.

A comment may carry multiple files and optional text (a comment can be attachment-only). Files uploaded in a general comment ALSO appear in that entity's existing Attachments tab. Task chat files stay in the chat (tasks have no Attachments tab).

## Owner decisions (2026-07-23)

- **Multiple files + optional text** per comment; attachment-only comments allowed.
- Comment files **also surface in the existing Attachments tab** (deal/lead/client).
- File limit **25 MB** per file (reuse existing `MAX_BYTES`); **any type** (no MIME allow-list — matches the current attachments system); block nothing new.
- Approach **A** chosen (single `comment_attachments` table), NOT reusing the `attachments` table — reusing it would leak private task files to non-parties (attachments SELECT is broader than task RLS).

## Architecture

The two comment tables are disjoint with different RLS, so the feature is inherently two-headed but shares one file table and one renderer.

### DB — `public.comment_attachments`
One row per file:
```
id uuid pk default gen_random_uuid()
comment_id       uuid null references public.comments(id) on delete cascade
task_comment_id  uuid null references public.task_comments(id) on delete cascade
storage_path text not null
file_name    text not null   -- original name for display/download
file_size    int
mime_type    text
uploaded_by  uuid not null references public.profiles(user_id)
created_at   timestamptz not null default now()
constraint comment_attachments_one_parent
  check ((comment_id is not null) <> (task_comment_id is not null))
```
Indexes on `comment_id` and `task_comment_id`.

**RLS — each file inherits its parent comment's visibility (this is the whole point of approach A):**
- SELECT: `comment_id` row → visible if the parent `comments` row is visible (comments SELECT is open to all staff → mirror as `true` for comment-linked rows); `task_comment_id` row → `is_task_party` of the parent task_comment's task.
- INSERT: `uploaded_by = auth.uid()` AND the same parent-visibility predicate (can't attach to a task you're not a party to).
- UPDATE: none needed (files are immutable; replace = delete + re-add).
- DELETE: `uploaded_by = auth.uid()` OR admin (mirrors comment edit/delete ownership).

(No realtime subscription on `comment_attachments` — a new file rides the existing parent-comment refetch: the comment insert already refreshes the thread on both sides, and each bubble fetches its own files.)

Implement RLS predicates via small SQL helpers or inline `exists` against the parent tables + existing `is_task_party()` / admin helpers. Add a pgTAP test `supabase/tests/comment_attachments_rls.sql` proving: non-party CANNOT see/insert a task-comment file; any staff CAN see a general-comment file; non-owner non-admin cannot delete.

### Storage
- Reuse the existing **`attachments`** bucket + its storage policies (SELECT/INSERT open to authenticated; delete owner/admin).
- Path: `comment/{parent_comment_id_or_task_comment_id}/{Date.now()}-{sanitizeStorageFileName(file.name)}`.
- Delete via Storage API `.remove([path])` **before** deleting the DB row (existing fail-safe). NEVER SQL-delete storage objects (protect_delete trigger).

### Body-optional change
`task_comments.body` currently has a non-empty CHECK. Relax so an insert is valid when body is empty AND the client is attaching ≥1 file. Because attachments are inserted AFTER the comment row (need its id), enforce "empty body ⇒ must have file" in the composer (client-side), and change the CHECK to allow empty/whitespace body (drop the non-empty constraint; empty text-only comments are already prevented by the composer's submit gate). `comments.body` is nullable text already — composer gate covers it; no DB change there.

### Frontend

**New hooks** (`src/features/comments/hooks/` and reused by tasks):
- `useUploadCommentAttachment` — patterned on `useUploadAttachment` (25 MB check, sanitize, storage upload, insert `comment_attachments` row with the correct parent FK). Accepts `{ kind: 'comment' | 'task_comment', parentId, file }`.
- `useCommentAttachments(parentKind, parentId)` — fetch a comment's files (or batch-fetch for a thread).
- `useDeleteCommentAttachment` — storage-first delete.

**Composers** — add to BOTH `src/features/comments/CommentForm.tsx` and `src/features/tasks/TaskComments.tsx`:
- A paperclip button + hidden multi-file `<input>`; selected files held in local state as a chip row (name + size + remove ✕) BELOW the textarea, before send.
- On submit: create the comment row first, then upload each pending file to `comment_attachments` under the new comment's id; clear pending files + draft on success. If a file upload fails, surface the error but keep the (already-posted) comment; let the user retry the file.
- Submit gate: enabled when body non-empty OR ≥1 pending file.

**Rendering** — in `src/features/comments/CommentItem.tsx` (general) and the task bubble `TaskCommentBubble` (in `TaskComments.tsx`): fetch the comment's files and render via the existing **`AttachmentGallery`** (image/PDF tiles + lightbox, other types as download link; pass `bucket="attachments"`). Batch signed URLs as that component already does.

**Attachments tab (decision #2):** extend the deal/lead/client Attachments view (`CombinedAttachmentsTab` / `AttachmentsPanel`) to also list files from `comment_attachments` whose parent `comments` row maps to this entity — mapping the deal channels (`deal_dev/deal_seo/deal_ads/deal_social`, parent_id = deal id) and `job/lead/client/deal` back to the entity. Show them in the existing gallery (optionally under a "From comments" grouping). Read-only there (delete stays in the chat). Task-comment files never appear here (tasks have no entity/tab).

### Notifications
A photo-only comment (empty body) would otherwise produce an empty notification preview. The two notification triggers (`fanout_mention_notifications()` for comments, `task_comments_notify_other_party()` for task_comments) fire on the comment insert — BEFORE the attachment rows exist — so they cannot count files. **Presenter-only fix, no trigger change:** in `notification-presenters.tsx` (`mention`, `task_comment`), when the preview/snippet is empty, render "📎 attachment" instead of a blank line. Minimal and correct for the common photo-only case.

## Non-goals (YAGNI)
- No drag-and-drop (file-picker only, matches the rest of the app).
- No new realtime subscription on general `comments` threads (they refresh on refetch today; task threads already live-update — attachments ride that).
- No new file-type/MIME restrictions beyond the existing 25 MB size cap.
- No editing a posted comment's attachments (delete + re-add).
- Task chat gets no Attachments tab.

## Testing
- pgTAP `comment_attachments_rls.sql`: party/non-party visibility + insert + owner/admin delete (per the repo's RLS test pattern).
- Frontend vitest (file-scoped): composer submit gate (body-or-file), pending-file chip add/remove, attachment-only submit path; the upload hook's sanitize + 25 MB guard; presenter "📎" fallback for empty body.
- `npm run build` clean; `npm run types:gen` after the migration (both `comment_attachments` and the relaxed task_comments must land in `src/types/supabase.ts`).
- Live browser smoke (read-only-ish, cleaned after): attach a photo + PDF to a deal General comment → renders inline + appears in the deal Attachments tab; attach to a task comment → renders inline, NOT visible to a non-party (verify via a second account or RLS test), NOT in any tab. Delete a test file (storage + row) after.

## Changes / Revert
- Migration rollback: `drop table public.comment_attachments;` restore the `task_comments` body CHECK; (storage objects created during testing removed via Storage API).
- Frontend: revert commits.
- Storage: test files removed via `.remove()` (never SQL).
