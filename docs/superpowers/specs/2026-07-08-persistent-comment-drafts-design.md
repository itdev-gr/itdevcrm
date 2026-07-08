# Persistent comment drafts

**Date:** 2026-07-08
**Status:** Approved (design + persistence choice confirmed by user)

## Problem

Typing in a comment box and then switching tabs, navigating, or refreshing loses
the unsent text. Both comment composers hold the draft in a component-local
`useState('')`; when the surrounding container unmounts (Radix `TabsContent`
unmounts inactive tabs; the task dialog unmounts on close), the state is
discarded. The user wants the text to stay until they post it or clear it.

## User decision

Persistence = **localStorage**, per comment thread: the draft survives tab
switches, in-app navigation, and a full browser refresh/close, and is removed
only when the comment is posted or the box is emptied. Stale drafts (>30 days)
are pruned so nothing accumulates forever. (Alternative — in-memory/session-only
— was declined.)

## Current state (verified 2026-07-08)

- `src/features/comments/CommentForm.tsx` — the open-comments composer. Local
  `const [body, setBody] = useState('')`. Props `{ parentType:
  'client'|'deal'|'job'|'lead', parentId, replyToId?, onCancelReply? }`. Rendered
  by `CommentsPanel` (top-level box on deal/lead/client/job pages) and by
  `CommentItem` (inline reply, with `replyToId` + `onCancelReply`). @mentions are
  resolved on submit from the typed `@Name` text (case-insensitive scan of the
  users list in `resolveMentions`), so only the raw text needs preserving — the
  in-session `tokenToUserId` map is a best-effort optimisation, not required for
  correctness.
- `src/features/tasks/TaskComments.tsx` — the task-dialog comments composer. Local
  `const [body, setBody] = useState('')`. Props `{ kind: 'user'|'assigned',
  taskId, locale }`. Rendered by `TaskDetailShell`.
- These are the only two comment composers (`CommentForm` + `TaskComments`).
- Existing localStorage convention: Zustand `persist` store
  (`src/features/tasks/tasksSeenStore.ts` → `itdevcrm-tasks-seen-v1`,
  `src/features/jobs/jobsBoardSortStore.ts` → `itdevcrm-jobs-board-sort-v1`,
  with a `partialize` + a `*.test.ts` that resets `setState` + `localStorage.clear()`
  per test).

## Design

### New store — `src/features/comments/commentDraftStore.ts`

Zustand + `persist`, localStorage key `itdevcrm-comment-drafts-v1`.

```ts
type DraftEntry = { text: string; savedAt: number };
type State = {
  drafts: Record<string, DraftEntry>;
  getDraft: (key: string) => string;              // '' when absent
  setDraft: (key: string, text: string) => void;  // empty/whitespace → delete key
  clearDraft: (key: string) => void;              // delete key (post success)
};
```

- `setDraft(key, text)`: if `text.trim() === ''` → remove the key; else upsert
  `{ text, savedAt: Date.now() }` (raw `text`, not trimmed — preserve caret-adjacent
  spaces while typing).
- `clearDraft(key)`: remove the key.
- Pruning: on rehydrate (`persist` `onRehydrateStorage`), drop entries whose
  `savedAt` is older than 30 days (`DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000`).
- `partialize: (s) => ({ drafts: s.drafts })`.

### Thin hook — `useCommentDraft(key: string)` (same file)

Returns `{ text, setText, clear }` selecting `drafts[key]?.text ?? ''` and binding
`setDraft(key, …)` / `clearDraft(key)`, so a composer swaps its `useState('')` for
one line and gets persistence for free.

### Key scheme

- `CommentForm` top-level: `comment:<parentType>:<parentId>`.
- `CommentForm` reply: `comment:<parentType>:<parentId>:reply:<replyToId>`.
- `TaskComments`: `task:<kind>:<taskId>`.

A `commentDraftKey(...)` helper builds these (keeps composers declarative and the
scheme testable).

### Composer wiring

- `CommentForm`: replace `useState('')` with
  `const { text: body, setText: setBody, clear: clearDraft } = useCommentDraft(key)`.
  `setBody` already flows through `onChange` and the `applyMention` insert path, so
  both persist automatically. On successful `create.mutateAsync`, call `clearDraft()`
  (replacing `setBody('')`). If the mutation throws, the draft is preserved (no
  clear). Cancelling a reply (`onCancelReply`) does NOT clear — text stays until
  posted or emptied, so nothing is lost unexpectedly.
- `TaskComments`: replace `useState('')` with `useCommentDraft(key)`; on post
  success `onSuccess`, call `clear()` (replacing `setBody('')`).

## Behavior summary

- Text persists across tab switches, navigation, and refresh, per thread, per device.
- Cleared on: successful post, or the box being emptied/whitespace-only.
- NOT cleared on: tab switch, navigation, refresh, reply Cancel, failed post.
- Reply drafts are keyed per comment and independent of the top-level draft.

## Error handling

- Store reads/writes are synchronous localStorage via `persist`; a full/blocked
  localStorage throws inside `persist` and is swallowed by zustand (draft simply
  won't persist — no crash). No extra handling needed.
- Failed post leaves the draft intact (clear runs only on success).

## Testing

- `commentDraftStore.test.ts` (mirrors the existing store tests; reset `setState`
  + `localStorage.clear()` per test): default '' when absent; `setDraft` upserts;
  empty/whitespace `setDraft` deletes; `clearDraft` deletes; independent keys;
  persists under `itdevcrm-comment-drafts-v1`; prune drops a >30-day-old entry on
  rehydrate and keeps a fresh one; `commentDraftKey` helper output.
- Light component tests (network hooks mocked): `CommentForm` restores a seeded
  draft into the textarea and clears the store key on submit; `TaskComments`
  restores + clears on post.
- `npm run build` (strict tsc + eslint --max-warnings=0) is the authoritative gate.

## Changes / Revert

- Frontend-only. New files: `commentDraftStore.ts` (+ test), component tests.
  Modified: `CommentForm.tsx`, `TaskComments.tsx` (swap the `useState` line + clear
  call). No DB/RLS/API/storage/edge-function change; comment posting, @mention
  resolution, and RLS untouched.
- Revert: `git revert` the commits (or delete the store/hook + restore the two
  `useState('')` lines). Leftover `itdevcrm-comment-drafts-v1` localStorage entries
  are harmless and self-prune.
