# Unread-comment badge on task cards — design

**Date:** 2026-07-06
**Status:** Approved (indicator style, clearing, scope confirmed by owner)

## Problem

When someone comments on a task, the other party gets a bell notification — but the
task's card on the /tasks board shows nothing. Users working from the board miss new
comments unless they happen to open the bell.

## Decisions (confirmed)

1. **Indicator:** a small 💬 chip with the unread count on the task card's meta row.
2. **Clearing:** opening the task (detail dialog, where the thread renders) clears the
   badge AND marks the matching bell notifications read — card and bell stay in sync,
   cross-device.
3. **Scope:** /tasks board cards only (home widget, client/lead Tasks tabs unchanged).

## Approach

Derive the badge from the **existing** `task_comment` notifications (written by the
`task_comments_notify_other_party` DB trigger since 2026-06-25, one row per recipient
with `read_at`). No DB changes.

Key facts the design rests on:
- `notifications.payload` for `task_comment` carries `task_kind`
  (`'user_task' | 'assigned_task'`) and `task_id`.
- The trigger never notifies the comment's author → no false badges for own comments.
- `useNotifications()` (the bell) is capped at `limit(20)` across all types — **it cannot
  be reused** for counts; the badge needs its own uncapped unread-only query.
- `useNotificationsRealtime()` (mounted app-wide by the top-bar bell) invalidates the
  `['notifications']` query-key **prefix** on any change to my notification rows, so a
  new `['notifications', 'unread-comments']` key refreshes live for free.

## Components

### Data hook — `useUnreadCommentNotifs()` (new, `src/features/notifications/hooks/`)

Query key `queryKeys.unreadCommentNotifs()` = `['notifications', 'unread-comments']`
(prefix-covered by the realtime invalidation). Fetches
`from('notifications').select('id, payload').eq('type', 'task_comment').is('read_at', null)`
(RLS already scopes to the signed-in user; no limit — unread task comments are few).

### Grouping helper — `unreadCommentIndex(rows)` (pure, `src/features/tasks/commentBadge.ts`)

Builds `Map<cardKey, { count, notifIds }>` where `cardKey` = `` `${kind}:${task_id}` ``
mapped from `payload.task_kind` (`user_task`→`user`, `assigned_task`→`assigned`) —
same key format as `TaskCard.key`. Ignores rows with missing/malformed payload.

### Card UI — `TaskKanbanCard`

New optional prop `unreadComments?: number`. When > 0, renders a chip in the meta row
(next to the Personal/code chip): `💬 N`, primary-tinted like the existing delegated
badge. No layout change otherwise.

### Clearing — `TasksKanbanBoard` open paths

Two open paths exist and BOTH must clear:
1. `onOpen` (card click) — already calls `markOpened(meId, card.id)`; extend it to look
   up the card's `notifIds` in the index and call a new bulk
   `useMarkNotificationsRead()` (single `update … in('id', ids)`, invalidates the
   `['notifications']` prefix → bell + badge refresh together).
2. The `?open=<key>` deep-link effect — it currently calls `setOpenKey` directly and
   bypasses `onOpen` (pre-existing gap: it never cleared the new-task highlight
   either). Extend the effect to also `markOpened` + mark the comment notifications
   read — fixing both in one place.

Opening a task with no unread comments does nothing extra.

### Board wiring

`TasksKanbanBoard` calls the hook + helper and passes `unreadComments` per card down
through `TasksKanbanColumn`. `MyTasksPage`/board mounts nothing new for realtime — the
bell's app-wide subscription suffices (verify at implementation; if the bell were ever
unmounted, mounting `useNotificationsRealtime()` on the board is safe — unique channel
per instance).

## Edge cases

- Unread comment notifications older than the bell's 20-row window still count (own query).
- A task deleted after a comment: its notification rows remain; no card matches → no
  badge anywhere; bell entry still works as today. No change.
- `task_comment` notifications for tasks not on my board (e.g. filtered out) simply
  don't match a card — no error.
- Marking read is idempotent; concurrent open on two devices resolves via realtime.

## Not changing

DB schema/triggers, notifications column/bell UI, home widget, client/lead Tasks tabs,
task-comment RLS, the new-task amber highlight.

## Testing

- Unit: `unreadCommentIndex` (grouping, kind mapping, malformed payload), card chip
  render at 0/1/N, board open-handler marks the right notif ids (mocked mutation).
- `npm run build` strict.
- Live smoke: user A comments on a task assigned to B → B's board card shows 💬 1
  live; B opens the card → chip gone and bell count decremented; A sees no badge for
  their own comment.

## Changes / Revert

- **Frontend only**: new `useUnreadCommentNotifs.ts`, `useMarkNotificationsRead.ts`,
  `commentBadge.ts` (+ tests); edits to `TaskKanbanCard.tsx`, `TasksKanbanBoard.tsx`,
  `TasksKanbanColumn.tsx`, `queryKeys.ts`. Revert = git revert; no data migration.
