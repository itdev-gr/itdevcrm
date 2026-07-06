# 💬 Replies column on the tasks board — design

**Date:** 2026-07-06
**Status:** Approved (placement, resolved-resurfacing, title confirmed by owner)

## Problem

Unread comment replies are visible as a 💬 badge on task cards (shipped earlier today),
but a busy board still hides them among many cards. The owner wants tasks with unread
replies gathered in one place the user cannot miss.

## Decisions (confirmed)

1. **Leftmost column "💬 Replies"** (before Urgent) on the /tasks board.
2. **Move, not duplicate:** while a task has unread comments it appears ONLY in
   Replies; opening the task (which clears the unread state — existing behavior)
   returns it to its normal column instantly.
3. **Resolved tasks resurface:** a reply on a resolved task pulls it into Replies;
   opening it sends it back to Resolved.
4. Greek label «💬 Απαντήσεις».

## Approach

A **derived** column — no new storage, no DB change. The board already computes
`commentIndex` (unread comment notifications per card key, from
`unreadCommentIndex`). Column assignment gains one rule that consults it.

## Behavior spec

- `BOARD_COLUMNS` order: `['replies', 'urgent', 'high', 'medium', 'low', 'resolved']`.
- Column assignment (in `columnOf`): `hasUnreadReplies` → `'replies'`, else
  `resolved` → `'resolved'`, else importance. The flag is a new optional parameter
  (default `false`) so existing call sites (client/lead tabs etc.) are unaffected.
- **Not draggable while in Replies** (`isDraggable` gains the same optional flag);
  the column accepts no drops (`resolveDrag` returns `noop` for target `'replies'`).
  The card's Resolve/Reopen button still works; a resolved-with-unread card stays in
  Replies until opened (rule 3), then lands in Resolved.
- To me / By me / All filters apply unchanged; the 💬 count badge stays on cards.
- Deep-link `?open=` and clear-on-open behavior unchanged (already shipped).
- Empty state reuses the existing "Nothing here." copy.

## Touch points

- `src/features/tasks/taskCard.ts` — `ColumnKey` union + `BOARD_COLUMNS` +
  `columnOf(card, hasUnreadReplies?)` + `isDraggable(card, hasUnreadReplies?)` +
  `resolveDrag` noop for `'replies'`.
- `src/features/tasks/TasksKanbanBoard.tsx` — `byColumn` memo consults
  `commentIndex` (added to deps); `columnLabel` maps `'replies'` to the new i18n key;
  pass the unread flag into the card's draggable decision (via the existing
  `unreadCount` plumbing).
- `src/features/tasks/TaskKanbanCard.tsx` — draggable decision includes the flag
  (already receives `unreadComments`).
- Locales: `tasks_page.column_replies` = "💬 Replies" / «💬 Απαντήσεις» (en/el
  common.json).
- `TasksKanbanColumn.tsx` unchanged.

## Testing

- Unit (`taskCard.test.ts`): unread → `'replies'` (including resolved+unread);
  flag false/omitted → unchanged legacy behavior; `isDraggable` false with flag;
  `resolveDrag(card, 'replies')` → noop.
- Board test: a card with an unread notification renders inside
  `tasks-col-replies` (and not in its importance column); when the notifications
  mock empties (reply read), it returns to its importance column.
- `npm run build` strict; live smoke with two users (reply → card jumps to Replies;
  open → returns).

## Changes / Revert

Frontend-only; revert = git revert of the feature commits. No DB change.

## Out of scope

Home widget, client/lead Tasks tabs, sidebar counts, notifications column UI.
