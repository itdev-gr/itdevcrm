# Design: Tasks post into comment threads (clickable) + Resolve everywhere

**Date:** 2026-07-09
**Status:** Approved in conversation. Decisions: auto-comment on create AND resolve; all linked tasks; click opens the task dialog in place; resolve rights stay participants+admin (no RLS change).

## Problem

Tasks are invisible to people following a deal/job/client/lead conversation, and
personal tasks opened via `UserTaskDetailDialog` cannot be resolved from most
surfaces (the dialog has no resolve control at all).

## Feature 1 — Task auto-comments

When a linked task is **created**, a comment is posted automatically into the
right thread, authored by the task creator:
> 📋 New task: "Verify GBP listing" — for Maria, due 12 Jul · high

When it's **resolved** (each open→resolved transition), a closing comment by the
resolver:
> ✅ Task resolved: "Verify GBP listing"

**Thread mapping** (reuses the shipped channel model):

| Task | Thread |
|---|---|
| assigned_task on deal | `('deal', deal_id)` — General |
| assigned_task on web_dev job | `('deal_dev', deal_id)` |
| assigned_task on web/local/ai_seo job | `('deal_seo', deal_id)` |
| assigned_task on other job | `('job', job_id)` |
| user_task with client_id | `('client', client_id)` |
| user_task with lead_id | `('lead', lead_id)` |
| user_task unlinked | posts nowhere |

**Mechanism:** DB triggers (house idiom). One migration adds:
- `comments.task_key text null` — back-reference `'assigned:<uuid>' | 'user:<uuid>'`.
- 4 trigger functions+triggers (AFTER INSERT + AFTER UPDATE on each task table),
  `security definer`, inserting real `comments` rows (`mentioned_user_ids='{}'` →
  no mention fanout). Authors: create = task creator (`created_by ?? user_id` /
  `created_by_user_id`); resolve = `resolved_by_user_id ?? auth.uid() ?? assignee`
  (assigned) / `auth.uid() ?? user_id` (user tasks).
- Bodies: user task `📋 New task: "<title>" — for <assignee name>, due <DD Mon> · <importance>`;
  assigned task same minus due (no due_at column). Resolve: `✅ Task resolved: "<title>"`.
  Assignee names from `profiles`; dates `at time zone 'Europe/Athens'`.
- Notes: task edits/renames do NOT update old comments (event log). Task deletion
  leaves the comment with a dangling task_key (click shows "not found"). The
  auto-comment fires `comments_activity` (normal activity entry) — acceptable.

## Feature 2 — Click-to-open

`CommentItem` treats a comment with a parseable `task_key` as clickable: an
"Open task" affordance opens the matching dialog **in place** (no navigation):
- `assigned:<id>` → `AssignedTaskDetailDialog taskId=<id>` (self-fetching; Resolve inside, isParty-gated).
- `user:<id>` → new `useUserTask(id)` hook (single `user_tasks` row + lead join,
  mirroring `useTaskBoardData`'s select) → `userTaskToCard(row, meId)` →
  `UserTaskDetailDialog`.
- RLS may hide the task from non-participants (user_tasks: assignee/creator/admin;
  assigned: +accounting). If the fetch returns nothing → small muted dialog
  "Task not found or you don't have access."

New pure helper `parseTaskKey(key): { kind: 'assigned'|'user'; id: string } | null`
(rejects malformed keys). `CommentRow` type + `useComments` select gain `task_key`.

## Feature 3 — Resolve everywhere

Audit result: every assigned-task surface already has isParty-gated Resolve. The
single gap is **`UserTaskDetailDialog` — no resolve control**, which breaks:
client Tasks tab (user tasks), lead Tasks tab, ClientOpenTasksList, and /tasks
board + deep-links for creator/admin who aren't the assignee.

**Fix:** add a footer Resolve button to `UserTaskDetailDialog` (via
`TaskDetailShell`'s `footer` slot, mirroring `AssignedTaskDetailDialog:136-142`):
- Shown when `!card.resolved` and (`card.relation === 'mine' | 'delegated'` or
  `isAdmin` from auth store) — participants+admin, matching today's model
  (RLS already enforces it server-side).
- Uses `useToggleTaskComplete`; widen that hook's invalidations from just
  `['user-tasks']` to also `['client-tasks']`, `['lead-tasks']`, `['tasks']`,
  `['comments']` so every surface (and the new auto-comments) refresh.

## Instant freshness

Same-page comment panels refresh immediately after task actions: invalidate the
`['comments']` prefix in `useUpsertTask`, `useCreateAssignedTask`,
`useResolveAssignedTask`, `useToggleTaskComplete`, and `useTaskBoardActions`.
(Cross-user freshness = existing refetch-on-focus model, unchanged.)

## Testing

- Unit: `parseTaskKey` (valid assigned/user, malformed, empty).
- Component: `UserTaskDetailDialog` resolve button — shown for mine/delegated/admin,
  hidden for other/resolved; click fires the mutation.
- Component: `CommentItem` with `task_key` renders the open affordance; without it,
  unchanged; click opens the right dialog (mocked).
- Migration: rolled-back prod DO-block at apply time — create fake deal+web_dev job+
  seo job+client+lead+tasks, assert comments landed in deal/deal_dev/deal_seo/client/
  lead threads with task_key; resolve one, assert the ✅ comment; RAISE to roll back.

## Changes / Revert

**Changes:** migration `2026…_task_auto_comments.sql` (task_key column + 4 triggers;
prod apply after go-ahead); `useUserTask.ts`, `parseTaskKey` (in a small
`taskCommentRef.ts`), `CommentItem` click affordance + dialogs, `UserTaskDetailDialog`
footer Resolve, invalidation widenings in 5 hooks (+tests).

**Revert:** drop the 4 triggers + functions (`drop trigger … ; drop function …`),
optionally keep the inert `task_key` column (or drop it); `git revert` frontend
commits. Auto-comments already posted remain as ordinary comments (deletable by
admin) — no data restore needed.
