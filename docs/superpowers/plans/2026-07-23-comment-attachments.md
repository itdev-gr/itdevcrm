# Inline Attachments on Comments — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Attach files (any type, ≤25 MB, multiple per message, optional text) inside task chat and every general comment thread; general-comment files also surface in the entity's Attachments tab.

**Architecture:** One `comment_attachments` table linking each file to either a `comments` row or a `task_comments` row (XOR), RLS mirroring the parent comment's visibility. Reuse the existing `attachments` storage bucket, `sanitizeStorageFileName`, and the `AttachmentGallery` renderer. Both composers (`CommentForm`, `TaskComments`) gain a paperclip + pending-file chips; files upload after the comment row is created (needs its id).

**Tech Stack:** Supabase Postgres (RLS, applied to prod via MCP), React/TS, TanStack Query, vitest, Supabase Storage.

**Spec:** `docs/superpowers/specs/2026-07-23-comment-attachments-design.md`

## Global Constraints

- Prod Supabase project CRM `xujlrclyzxrvxszepquy`; migrations applied to prod via MCP `apply_migration`. Read any function/table LIVE before editing (prod drifts).
- All harness test SQL inside `begin; … rollback;` — zero surviving prod rows. Harness identity: `set_config('request.jwt.claims', …)` BEFORE `set local role authenticated`. MCP returns only the last statement — aggregate assertions.
- Storage: reuse the existing **`attachments`** bucket. NEVER SQL-delete `storage.objects` (protect_delete trigger) — always `.remove()`. Delete the storage object BEFORE the DB row. Wrap every storage key with `sanitizeStorageFileName()` (non-ASCII keys are rejected); keep the real name in `file_name`.
- File cap: **25 MB** (`MAX_BYTES = 25 * 1024 * 1024`); no MIME allow-list (any type).
- `npm run build` (tsc -b + eslint --max-warnings=0) must pass. vitest is file-scoped ONLY (repo has prod-hitting integration tests) — never the bare suite.
- After the schema change run `npm run types:gen` (writes `src/types/supabase.ts`), commit the regenerated types.
- No PRs — one commit per task, push to `main` (`git pull --rebase` on rejection). Commit trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Privacy invariant: a task-comment file is visible ONLY to task parties (never via the broader attachments SELECT). A general-comment file is visible to all staff (matching comments' open SELECT).

## File Structure

- Create: `supabase/migrations/20260723120000_comment_attachments.sql` — table + RLS + task_comments body-CHECK relax.
- Create: `supabase/tests/comment_attachments_rls.sql` — pgTAP RLS regression (mirror `supabase/tests/` existing pattern).
- Create: `src/features/comments/hooks/useCommentAttachments.ts` — fetch (single + batch) a comment/task-comment's files.
- Create: `src/features/comments/hooks/useUploadCommentAttachment.ts` — upload one file to a comment/task-comment.
- Create: `src/features/comments/hooks/useDeleteCommentAttachment.ts` — storage-first delete.
- Create: `src/features/comments/CommentAttachButton.tsx` — shared paperclip + pending-file chip row (used by both composers).
- Modify: `src/features/comments/hooks/useCreateComment.ts`, `src/features/tasks/hooks/usePostTaskComment.ts` — return the new comment id.
- Modify: `src/features/comments/CommentForm.tsx`, `src/features/comments/CommentItem.tsx` (general composer + render).
- Modify: `src/features/tasks/TaskComments.tsx` (task composer + render).
- Modify: `src/features/notifications/notification-presenters.tsx` — "📎 attachment" fallback for empty body.
- Modify: `src/features/attachments/AttachmentsPanel.tsx` (or `CombinedAttachmentsTab.tsx`) — surface comment files for the entity.
- Modify: `src/lib/queryKeys.ts` — `commentAttachments` keys.

---

### Task 1: DB — `comment_attachments` table, RLS, body-CHECK relax

**Files:**
- Create: `supabase/migrations/20260723120000_comment_attachments.sql`
- Create: `supabase/tests/comment_attachments_rls.sql`
- Modify (generated): `src/types/supabase.ts` (via `npm run types:gen`)

**Interfaces:**
- Consumes: existing `public.comments`, `public.task_comments`, `public.is_task_party(uuid, uuid)`, admin helper (`current_user_is_admin()`), the `attachments` storage bucket.
- Produces: table `public.comment_attachments(id, comment_id, task_comment_id, storage_path, file_name, file_size, mime_type, uploaded_by, created_at)` with XOR parent + RLS; relaxed `task_comments` body CHECK (empty body allowed). Later tasks read/write it under RLS.

- [ ] **Step 1: Snapshot live pieces.** Via MCP: read the live `task_comments` CHECK constraints (`select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid='public.task_comments'::regclass`), and confirm `is_task_party`'s signature (`select pg_get_functiondef('public.is_task_party(uuid,uuid)'::regprocedure)`). Save the body-CHECK def to `.superpowers/sdd/pre-comment-attachments-taskbodycheck.sql`.

- [ ] **Step 2: Write the migration** `supabase/migrations/20260723120000_comment_attachments.sql`:

```sql
-- 20260723120000_comment_attachments.sql
-- Spec: docs/superpowers/specs/2026-07-23-comment-attachments-design.md
-- Files attached to a comment. Links to EITHER a general comment or a task
-- comment (XOR). RLS mirrors the parent's visibility exactly: general-comment
-- files are visible to all staff (comments SELECT is open); task-comment files
-- are parties-only (is_task_party) so private task files never leak. Also relax
-- the task_comments non-empty-body CHECK so an attachment-only message is valid.
--
-- ROLLBACK:
--   drop table if exists public.comment_attachments;
--   alter table public.task_comments drop constraint if exists task_comments_body_or_attachment;
--   alter table public.task_comments add constraint task_comments_body_check check (length(btrim(body)) > 0);
--   (restore the exact prior CHECK from the pre-image if its name/expr differ)

create table if not exists public.comment_attachments (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid references public.comments(id) on delete cascade,
  task_comment_id uuid references public.task_comments(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  file_size int,
  mime_type text,
  uploaded_by uuid not null references public.profiles(user_id),
  created_at timestamptz not null default now(),
  constraint comment_attachments_one_parent
    check ((comment_id is not null) <> (task_comment_id is not null))
);

create index if not exists comment_attachments_comment_id_idx on public.comment_attachments(comment_id);
create index if not exists comment_attachments_task_comment_id_idx on public.comment_attachments(task_comment_id);

alter table public.comment_attachments enable row level security;

-- A row's visibility mirrors its parent comment.
create policy comment_attachments_select on public.comment_attachments
  for select to authenticated
  using (
    comment_id is not null  -- general comments are visible to all staff
    or exists (
      select 1 from public.task_comments tc
       where tc.id = comment_attachments.task_comment_id
         and public.is_task_party(tc.user_task_id, tc.assigned_task_id)));

create policy comment_attachments_insert on public.comment_attachments
  for insert to authenticated
  with check (
    uploaded_by = auth.uid()
    and (
      comment_id is not null
      or exists (
        select 1 from public.task_comments tc
         where tc.id = comment_attachments.task_comment_id
           and public.is_task_party(tc.user_task_id, tc.assigned_task_id))));

create policy comment_attachments_delete on public.comment_attachments
  for delete to authenticated
  using (uploaded_by = auth.uid() or public.current_user_is_admin());

grant select, insert, delete on public.comment_attachments to authenticated;

-- Relax the task_comments non-empty-body CHECK (attachment-only messages).
-- The composer still blocks a truly empty message (no text AND no file);
-- the DB just no longer requires non-empty text.
do $$
declare cn text;
begin
  select conname into cn from pg_constraint
   where conrelid = 'public.task_comments'::regclass
     and pg_get_constraintdef(oid) ilike '%body%' and contype = 'c';
  if cn is not null then execute format('alter table public.task_comments drop constraint %I', cn); end if;
end $$;
```

(If the live pre-image shows the CHECK has a different shape than `length(btrim(body)) > 0`, keep the drop-by-discovery `do` block as written — it finds the body CHECK by name regardless — and put the exact prior expression in the ROLLBACK comment.)

- [ ] **Step 3: Apply** via MCP `apply_migration` (name `comment_attachments`). Expected: success.

- [ ] **Step 4: Write the pgTAP regression** `supabase/tests/comment_attachments_rls.sql`, mirroring the structure of an existing file in `supabase/tests/` (open one first to copy the `plan()/set local role/set local request.jwt.claims/throws_ok/rollback` harness exactly). Assert, in one transaction: (a) a task party can INSERT+SELECT a file on their task comment; (b) a NON-party gets 0 rows selecting it and `42501` inserting; (c) any authenticated staffer SELECTs a general-comment file; (d) a non-owner non-admin gets `42501`/0-rows deleting another's file. Use real seeded uuids from a `begin; … rollback;` fixture.

- [ ] **Step 5: Behavioral harness on prod** (rollback-wrapped, one MCP `execute_sql`, aggregated final select). Build a fixture: a `comments` row on some deal + a `task_comments` row on an assigned_task whose parties you can name. Then:
  - As an admin claim: insert a `comment_attachments` row for the general comment and one for the task comment → both succeed.
  - Switch to a NON-party authenticated claim: `select count(*) from comment_attachments where task_comment_id = <x>` → **0** (RLS hides it); `select count(*) from comment_attachments where comment_id = <y>` → **1** (general visible).
  - Insert attempt as non-party for the task comment → expect error / 0 rows.
  - Verify the task_comments body CHECK is gone: `insert into task_comments(assigned_task_id, author_user_id, body) values (<task>, <party>, '')` succeeds under a party claim.
  - `rollback;` Confirm zero rows survive.
  Record actual outputs vs expected.

- [ ] **Step 6: Regenerate types + commit.**

```bash
npm run types:gen
git add supabase/migrations/20260723120000_comment_attachments.sql supabase/tests/comment_attachments_rls.sql src/types/supabase.ts
git commit -m "feat(comments): comment_attachments table + RLS (parity with parent comment visibility)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push
```

---

### Task 2: Data hooks + make comment mutations return the new id

**Files:**
- Create: `src/features/comments/hooks/useUploadCommentAttachment.ts`
- Create: `src/features/comments/hooks/useCommentAttachments.ts`
- Create: `src/features/comments/hooks/useDeleteCommentAttachment.ts`
- Test: `src/features/comments/hooks/useUploadCommentAttachment.test.ts`
- Modify: `src/features/comments/hooks/useCreateComment.ts`, `src/features/tasks/hooks/usePostTaskComment.ts`
- Modify: `src/lib/queryKeys.ts`

**Interfaces:**
- Consumes: Task 1's `comment_attachments`; `sanitizeStorageFileName` from `@/lib/sanitizeStorageKey`; `useAuthStore`; the `attachments` bucket; `GalleryFile` shape from `AttachmentGallery`.
- Produces:
  - `useCreateComment().mutateAsync(...)` now resolves to `{ id: string }` (was `void`).
  - `usePostTaskComment().mutateAsync(...)` now resolves to `{ id: string }` (was `void`).
  - `useUploadCommentAttachment().mutateAsync(v)` where `v = { parent: { comment_id: string } | { task_comment_id: string }, file: File }` → `void`; throws `'file_too_large'` when >25 MB.
  - `useCommentAttachments(parent)` → `CommentAttachmentRow[]` where `CommentAttachmentRow = { id, storage_path, file_name, mime_type, file_size, uploaded_by }` (assignable to `GalleryFile`).
  - `useDeleteCommentAttachment().mutateAsync({ id, storage_path, parent })` → `void` (removes storage object first).
  - `queryKeys.commentAttachments(scope: string, id: string)` → `['comment-attachments', scope, id]` (scope = `'comment' | 'task_comment'`).

- [ ] **Step 1: Add query keys** to `src/lib/queryKeys.ts` (next to `attachments`):

```ts
  commentAttachments: (scope: 'comment' | 'task_comment', id: string) =>
    ['comment-attachments', scope, id] as const,
```

- [ ] **Step 2: Return the id from `useCreateComment`.** Change the insert to select the id and return it, and widen the mutation's result type to `{ id: string }`:

```ts
// useCreateComment.ts — replace the insert block + result type
return useMutation<{ id: string }, DefaultError, Vars>({
  mutationFn: captureMutation('comments', 'create', async (vars: Vars) => {
    const author_id = useAuthStore.getState().user?.id;
    if (!author_id) throw new Error('not_authenticated');
    const { data, error } = await supabase.from('comments').insert({
      parent_type: vars.parent_type,
      parent_id: vars.parent_id,
      body: vars.body,
      author_id,
      mentioned_user_ids: vars.mentioned_user_ids ?? [],
      reply_to_id: vars.reply_to_id ?? null,
    }).select('id').single();
    if (error) throw new Error(error.message);
    return { id: (data as { id: string }).id };
  }),
  onSuccess: (_d, vars) => {
    void qc.invalidateQueries({ queryKey: queryKeys.comments(vars.parent_type, vars.parent_id) });
  },
});
```

- [ ] **Step 3: Return the id from `usePostTaskComment`.** Same pattern — `.insert(row).select('id').single()`, result type `{ id: string }`, return `{ id }`.

- [ ] **Step 4: Write the failing test** `useUploadCommentAttachment.test.ts` (mirror how other hook tests mock `@/lib/supabase`): assert (a) a >25 MB file rejects with `file_too_large` before any storage call; (b) a normal upload calls `storage.from('attachments').upload` with a path that starts with `comment/<id>/` and is sanitized, then inserts a `comment_attachments` row with the correct parent FK + `uploaded_by`. Run: `npx vitest run src/features/comments/hooks/useUploadCommentAttachment.test.ts` → FAIL (module missing).

- [ ] **Step 5: Implement the three hooks.**

`useUploadCommentAttachment.ts`:

```ts
import { useMutation, useQueryClient, type DefaultError } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { useAuthStore } from '@/lib/stores/authStore';
import { captureMutation } from '@/lib/sentry/captureMutation';
import { sanitizeStorageFileName } from '@/lib/sanitizeStorageKey';

const MAX_BYTES = 25 * 1024 * 1024;

export type CommentAttachmentParent = { comment_id: string } | { task_comment_id: string };
type Vars = { parent: CommentAttachmentParent; file: File };

function parentKey(p: CommentAttachmentParent): { scope: 'comment' | 'task_comment'; id: string } {
  return 'comment_id' in p
    ? { scope: 'comment', id: p.comment_id }
    : { scope: 'task_comment', id: p.task_comment_id };
}

export function useUploadCommentAttachment() {
  const qc = useQueryClient();
  return useMutation<void, DefaultError, Vars>({
    mutationFn: captureMutation('comment_attachments', 'upload', async ({ parent, file }: Vars) => {
      if (file.size > MAX_BYTES) throw new Error('file_too_large');
      const userId = useAuthStore.getState().user?.id;
      if (!userId) throw new Error('not_authenticated');
      const { id } = parentKey(parent);
      // eslint-disable-next-line react-hooks/purity -- imperative mutationFn
      const path = `comment/${id}/${Date.now()}-${sanitizeStorageFileName(file.name)}`;
      const { error: e1 } = await supabase.storage.from('attachments').upload(path, file, {
        contentType: file.type, cacheControl: '3600', upsert: false,
      });
      if (e1) throw new Error(e1.message);
      const { error: e2 } = await supabase.from('comment_attachments').insert({
        ...('comment_id' in parent ? { comment_id: parent.comment_id } : { task_comment_id: parent.task_comment_id }),
        storage_path: path, file_name: file.name, file_size: file.size,
        mime_type: file.type, uploaded_by: userId,
      });
      if (e2) throw new Error(e2.message);
    }),
    onSuccess: (_d, { parent }) => {
      const { scope, id } = parentKey(parent);
      void qc.invalidateQueries({ queryKey: queryKeys.commentAttachments(scope, id) });
    },
  });
}
```

`useCommentAttachments.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { CommentAttachmentParent } from './useUploadCommentAttachment';

export type CommentAttachmentRow = {
  id: string; storage_path: string; file_name: string;
  mime_type: string | null; file_size: number | null; uploaded_by: string;
};

const COLS = 'id, storage_path, file_name, mime_type, file_size, uploaded_by';

export function useCommentAttachments(parent: CommentAttachmentParent | null) {
  const scope = parent && 'comment_id' in parent ? 'comment' : 'task_comment';
  const id = parent ? ('comment_id' in parent ? parent.comment_id : parent.task_comment_id) : '';
  const column = 'comment_id' in (parent ?? {}) ? 'comment_id' : 'task_comment_id';
  return useQuery({
    queryKey: queryKeys.commentAttachments(scope, id),
    enabled: !!id,
    queryFn: async (): Promise<CommentAttachmentRow[]> => {
      const { data, error } = await supabase
        .from('comment_attachments').select(COLS).eq(column, id)
        .order('created_at', { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as CommentAttachmentRow[];
    },
  });
}
```

`useDeleteCommentAttachment.ts`:

```ts
import { useMutation, useQueryClient, type DefaultError } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { captureMutation } from '@/lib/sentry/captureMutation';
import type { CommentAttachmentParent } from './useUploadCommentAttachment';

type Vars = { id: string; storage_path: string; parent: CommentAttachmentParent };

export function useDeleteCommentAttachment() {
  const qc = useQueryClient();
  return useMutation<void, DefaultError, Vars>({
    mutationFn: captureMutation('comment_attachments', 'delete', async ({ id, storage_path }: Vars) => {
      // Remove the object FIRST (surface its error) — never orphan a row over a file.
      const { error: e1 } = await supabase.storage.from('attachments').remove([storage_path]);
      if (e1) throw new Error(e1.message);
      const { error: e2 } = await supabase.from('comment_attachments').delete().eq('id', id);
      if (e2) throw new Error(e2.message);
    }),
    onSuccess: (_d, { parent }) => {
      const scope = 'comment_id' in parent ? 'comment' : 'task_comment';
      const pid = 'comment_id' in parent ? parent.comment_id : parent.task_comment_id;
      void qc.invalidateQueries({ queryKey: queryKeys.commentAttachments(scope, pid) });
    },
  });
}
```

- [ ] **Step 6: Run the test** → PASS. Then `npm run build` → clean (the two mutation return-type changes must not break `CommentForm`/`TaskComments`, which currently ignore the return value).

- [ ] **Step 7: Commit.**

```bash
git add src/features/comments/hooks/useUploadCommentAttachment.ts src/features/comments/hooks/useUploadCommentAttachment.test.ts \
        src/features/comments/hooks/useCommentAttachments.ts src/features/comments/hooks/useDeleteCommentAttachment.ts \
        src/features/comments/hooks/useCreateComment.ts src/features/tasks/hooks/usePostTaskComment.ts src/lib/queryKeys.ts
git commit -m "feat(comments): comment-attachment hooks + return new comment id from post mutations

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push
```

---

### Task 3: Shared attach control + general composer/render (CommentForm, CommentItem)

**Files:**
- Create: `src/features/comments/CommentAttachButton.tsx`
- Test: `src/features/comments/CommentAttachButton.test.tsx`
- Modify: `src/features/comments/CommentForm.tsx`, `src/features/comments/CommentItem.tsx`
- Modify: `src/features/notifications/notification-presenters.tsx` (mention fallback)

**Interfaces:**
- Consumes: `useUploadCommentAttachment`, `useCommentAttachments`, `useDeleteCommentAttachment` (Task 2), `AttachmentGallery`, `useCreateComment` now returning `{ id }`.
- Produces: `<CommentAttachButton pending={File[]} onPick={(files) => void} onRemove={(idx) => void} />` — a paperclip button + a multi-file hidden input + a chip row of pending files. Reused verbatim by Task 4.

- [ ] **Step 1: Write the failing test** `CommentAttachButton.test.tsx`: rendering with two pending files shows both names; clicking a chip's ✕ calls `onRemove(idx)`; selecting files via the input calls `onPick` with the File list. Run → FAIL (module missing).

- [ ] **Step 2: Implement `CommentAttachButton.tsx`:**

```tsx
import { useRef } from 'react';
import type { ChangeEvent } from 'react';
import { Paperclip, X } from 'lucide-react';

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type Props = {
  pending: File[];
  onPick: (files: File[]) => void;
  onRemove: (index: number) => void;
  disabled?: boolean;
};

export function CommentAttachButton({ pending, onPick, onRemove, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  function onChange(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length) onPick(files);
    if (inputRef.current) inputRef.current.value = '';
  }
  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        aria-label="Attach files"
        title="Attach files"
        className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
      >
        <Paperclip className="size-4" />
      </button>
      <input ref={inputRef} type="file" multiple onChange={onChange} className="hidden" />
      {pending.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {pending.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-1 rounded-full border border-border/70 bg-muted/50 px-2 py-0.5 text-[11px]">
              <span className="max-w-[10rem] truncate" title={f.name}>{f.name}</span>
              <span className="text-muted-foreground">{fmtSize(f.size)}</span>
              <button type="button" aria-label="Remove" onClick={() => onRemove(i)} className="text-muted-foreground hover:text-destructive">
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Run the test** → PASS.

- [ ] **Step 4: Wire into `CommentForm.tsx`.** Add `const [pending, setPending] = useState<File[]>([]);` and `const uploadFile = useUploadCommentAttachment();`. Change the submit gate to allow body-or-file, and upload after the comment is created:

```tsx
// submit(): replace the guard + create call
async function submit() {
  const hasBody = body.trim().length > 0;
  if ((!hasBody && pending.length === 0) || create.isPending) return;
  const { id } = await create.mutateAsync({
    parent_type: parentType,
    parent_id: parentId,
    body: body.trim(),
    mentioned_user_ids: resolveMentions(body),
    reply_to_id: replyToId ?? null,
  });
  for (const file of pending) {
    try {
      await uploadFile.mutateAsync({ parent: { comment_id: id }, file });
    } catch (err) {
      alert((err as Error).message); // comment is posted; let the user retry the file
    }
  }
  setPending([]);
  clearDraft();
  setQuery(null);
  tokenToUserId.current.clear();
  if (replyToId) onCancelReply?.();
}
```

Render `<CommentAttachButton pending={pending} onPick={(f) => setPending((p) => [...p, ...f])} onRemove={(i) => setPending((p) => p.filter((_, idx) => idx !== i))} disabled={create.isPending} />` next to the submit Button (in the `flex gap-2` action row, line ~195), and change the submit button's `disabled` to `create.isPending || (!body.trim() && pending.length === 0)`.

- [ ] **Step 5: Render files in `CommentItem.tsx`.** Add `const { data: files = [] } = useCommentAttachments({ comment_id: comment.id });` and `const del = useDeleteCommentAttachment();`. Below the comment body (`CommentBody`), render:

```tsx
{files.length > 0 && (
  <div className="mt-2">
    <AttachmentGallery
      files={files}
      onDelete={canDelete ? (f) => void del.mutateAsync({ id: f.id, storage_path: f.storage_path, parent: { comment_id: comment.id } }) : undefined}
    />
  </div>
)}
```

(Import `AttachmentGallery` from `@/features/attachments/AttachmentGallery` and the two hooks. `canDelete` already exists in this file.)

- [ ] **Step 6: Mention presenter fallback.** In `src/features/notifications/notification-presenters.tsx`, the `mention` presenter renders a `preview`. Where it would render an empty/blank preview, fall back to "📎 attachment". Concretely: locate the mention preview text and wrap it — `preview?.trim() ? preview : '📎 attachment'`. (Leave `task_comment` for Task 4.)

- [ ] **Step 7: Build + focused tests.** `npm run build` clean; run any existing `CommentForm`/`CommentItem` tests plus the new `CommentAttachButton.test.tsx` file-scoped. Add/extend a `CommentForm` test asserting submit is enabled with a pending file and empty body, if a `CommentForm.test.tsx` exists; otherwise note it.

- [ ] **Step 8: Commit.**

```bash
git add src/features/comments/CommentAttachButton.tsx src/features/comments/CommentAttachButton.test.tsx \
        src/features/comments/CommentForm.tsx src/features/comments/CommentItem.tsx \
        src/features/notifications/notification-presenters.tsx
git commit -m "feat(comments): attach + render files in general comment threads

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push
```

---

### Task 4: Task chat composer/render (TaskComments) + task_comment presenter

**Files:**
- Modify: `src/features/tasks/TaskComments.tsx`
- Modify: `src/features/notifications/notification-presenters.tsx` (task_comment fallback)

**Interfaces:**
- Consumes: `CommentAttachButton` (Task 3), `useUploadCommentAttachment`/`useCommentAttachments`/`useDeleteCommentAttachment` (Task 2), `AttachmentGallery`, `usePostTaskComment` now returning `{ id }`.
- Produces: task chat messages carry files (parties-only via RLS).

- [ ] **Step 1: Composer.** In `TaskComments`, add `const [pending, setPending] = useState<File[]>([]);` and `const uploadFile = useUploadCommentAttachment();`. Rewrite `submit()` to allow body-or-file and upload after post:

```tsx
async function submit() {
  const text = body.trim();
  if ((!text && pending.length === 0) || post.isPending) return;
  const { id } = await post.mutateAsync({ kind, taskId, body: text });
  for (const file of pending) {
    try { await uploadFile.mutateAsync({ parent: { task_comment_id: id }, file }); }
    catch (err) { alert((err as Error).message); }
  }
  setPending([]);
  clearDraft();
}
```

Render `<CommentAttachButton pending={pending} onPick={(f) => setPending((p) => [...p, ...f])} onRemove={(i) => setPending((p) => p.filter((_, idx) => idx !== i))} disabled={post.isPending} />` in the composer form (next to the ArrowUp button, line ~112), and change the post button's `disabled` to `post.isPending || (body.trim().length === 0 && pending.length === 0)`.

- [ ] **Step 2: Render in `TaskCommentBubble`.** Add `const { data: files = [] } = useCommentAttachments({ task_comment_id: c.id });` and `const del = useDeleteCommentAttachment();`. Below the message body block (the `whitespace-pre-wrap` `<p>`), render the same `AttachmentGallery` block as Task 3 Step 5, with `parent: { task_comment_id: c.id }` and `onDelete` gated by `canModify`.

- [ ] **Step 3: task_comment presenter fallback.** In `notification-presenters.tsx`, the `task_comment` presenter renders a `snippet`. Fall back to "📎 attachment" when the snippet is empty (`snippet?.trim() ? snippet : '📎 attachment'`).

- [ ] **Step 4: Build + tests.** `npm run build` clean; run any existing task-comments test files file-scoped. Add a focused test that the task composer's send button enables with a pending file and empty body (if a test file exists for `TaskComments`; else note it).

- [ ] **Step 5: Commit.**

```bash
git add src/features/tasks/TaskComments.tsx src/features/notifications/notification-presenters.tsx
git commit -m "feat(tasks): attach + render files in task chat (parties-only)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push
```

---

### Task 5: Surface general-comment files in the entity Attachments tab

**Files:**
- Create: `src/features/attachments/hooks/useEntityCommentFiles.ts`
- Test: `src/features/attachments/hooks/useEntityCommentFiles.test.ts`
- Modify: `src/features/attachments/CombinedAttachmentsTab.tsx` (or `AttachmentsPanel.tsx`)

**Interfaces:**
- Consumes: `comment_attachments` + `comments` (Task 1), `AttachmentGallery`.
- Produces: a "From comments" section in the deal/lead/client Attachments view listing files whose parent comment maps to this entity. Read-only (delete stays in the chat). Task files never appear (no entity).

- [ ] **Step 1: Decide the parent_type set per entity.** A file belongs to entity `(type, id)` if its parent `comments` row has: `parent_type = type AND parent_id = id`, OR (for `deal`) `parent_type in ('deal','deal_dev','deal_seo','deal_ads','deal_social') AND parent_id = id`. Job/lead/client map 1:1. Write this mapping in the hook.

- [ ] **Step 2: Failing test** `useEntityCommentFiles.test.ts`: given a `deal` entity, the hook queries `comment_attachments` joined to `comments` filtered to the 5 deal parent_types and the deal id, and returns rows shaped as `GalleryFile`. Mock `@/lib/supabase` to assert the filter set. Run → FAIL.

- [ ] **Step 3: Implement `useEntityCommentFiles.ts`:**

```ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

const DEAL_TYPES = ['deal', 'deal_dev', 'deal_seo', 'deal_ads', 'deal_social'];

export type EntityCommentFile = {
  id: string; storage_path: string; file_name: string; mime_type: string | null;
};

export function useEntityCommentFiles(parentType: 'deal' | 'lead' | 'client', parentId: string) {
  const types = parentType === 'deal' ? DEAL_TYPES : [parentType];
  return useQuery({
    queryKey: ['entity-comment-files', parentType, parentId],
    enabled: !!parentId,
    queryFn: async (): Promise<EntityCommentFile[]> => {
      const { data, error } = await supabase
        .from('comment_attachments')
        .select('id, storage_path, file_name, mime_type, comments!inner(parent_type, parent_id, archived)')
        .in('comments.parent_type', types)
        .eq('comments.parent_id', parentId)
        .eq('comments.archived', false)
        .order('created_at', { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []).map((r) => ({
        id: (r as { id: string }).id,
        storage_path: (r as { storage_path: string }).storage_path,
        file_name: (r as { file_name: string }).file_name,
        mime_type: (r as { mime_type: string | null }).mime_type,
      }));
    },
  });
}
```

(Verify the embedded-filter syntax against an existing `!inner` join in the repo; if PostgREST rejects filtering on an embedded resource this way, fall back to a two-step: fetch comment ids for the entity, then `comment_attachments.in('comment_id', ids)`.)

- [ ] **Step 4: Render** a "From comments" section in `CombinedAttachmentsTab.tsx` (deal/lead/client only): `const { data: commentFiles = [] } = useEntityCommentFiles(parentType, parentId);` and, when non-empty, a `<section>` with `<AttachmentGallery files={commentFiles} />` (no `onDelete` — read-only here). Use the existing `sectionClass`/`headerClass` and an i18n label `attachments.sections.from_comments` ("From comments" / "Από σχόλια") in both locales.

- [ ] **Step 5: Test + build.** Run the new test file-scoped; `npm run build` clean.

- [ ] **Step 6: Commit.**

```bash
git add src/features/attachments/hooks/useEntityCommentFiles.ts src/features/attachments/hooks/useEntityCommentFiles.test.ts \
        src/features/attachments/CombinedAttachmentsTab.tsx src/i18n/locales/en/sales.json src/i18n/locales/el/sales.json
git commit -m "feat(attachments): surface comment files in the entity Attachments tab

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push
```

---

### Task 6: Verification + spec flip

- [ ] **Step 1:** `npm run build` + all the plan's touched test files (file-scoped) — green.
- [ ] **Step 2: Live browser smoke** (prod after deploy; clean up after): on a deal General comment, attach a photo + a PDF → both render inline in the thread AND appear in that deal's Attachments tab under "From comments". On a task, attach a file → renders in the task chat; confirm via the RLS harness (Task 1) that a non-party can't see it and it's in NO Attachments tab. Post an attachment-only comment (no text) → allowed, renders. Delete a test file from the thread → gone from storage + row. Remove the smoke comments/files afterward. Hard-refresh for stale chunks.
- [ ] **Step 3:** Spec `Status:` → `implemented 2026-07-23`; commit + push.
