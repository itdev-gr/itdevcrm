# Replies column: persistent membership — design

Date: 2026-07-17
Status: approved by owner (chat), amendment: both relations (mine + delegated) qualify

## Problem

The 💬 Απαντήσεις (Replies) column on `/tasks` is currently an *unread inbox*: a card
appears there only while it has unread `task_comment` notifications, and opening the
card marks them read and sends the card back to its importance column. The owner wants
the column to be a **stable view of every task of mine that has been replied to**,
identical in behaviour for every user. Reading a reply must not remove the card.

## Rule (per viewer)

A card sits in the Replies column iff **all three** hold:

1. **The viewer is a party** — the task is assigned to them (`relation === 'mine'`)
   **or** they created/delegated it (`relation === 'delegated'`). Cards with
   `relation === 'other'` (admin all-team view) never enter Replies.
2. **The task has at least one comment authored by someone other than the viewer**
   (the viewer's own comments are not "replies to them").
3. **The task is not terminally resolved.** Open tasks stay in Replies — including
   dual-resolve tasks awaiting the other side's confirmation. The card leaves the
   column only when the task fully closes. A reopened task that already has foreign
   comments re-enters Replies immediately.

The rule is evaluated against each viewer's own user id, so every user sees their own
Replies set. Board filters still apply first (`Σε εμένα` / `Από εμένα` / `Όλες`):
the column shows the qualifying subset of whatever the active filter admits.

## What does NOT change

- The 💬 unread-count badge keeps its current lifecycle (derived from unread
  `task_comment` notifications; cleared when the card is opened). Column membership
  becomes independent of read state.
- Resolved tasks that receive new comments show in **Επιλύθηκαν** with a 💬 badge;
  they do not resurface into Replies.
- Bell notifications, task dialogs, comment threads: untouched.

## Behaviour change: drag re-enabled in Replies

Cards now *live* in Replies while discussed, so they must remain operable:

- `isDraggable` no longer blocks cards in Replies (previous "read-first" rule dies).
- Drag to **Επιλύθηκαν** = resolve (existing dual-resolve semantics; one-sided
  resolve keeps the card in Replies with the awaiting chip since the task is still open).
- Drag to an importance column = change importance; the card visually stays in
  Replies (membership rule wins) with its importance chip updated.
- Dropping *onto* Replies stays a no-op (`resolveDrag` target `replies` → noop).

## Column precedence (columnOf)

`resolved` > `replies` > importance. (Today `replies` is checked first; the new order
makes rule 3 structural — a resolved card can never render in Replies.)

## Data

New hook `useTaskRepliesIndex(cards, meId)` in `src/features/tasks/hooks/`:

- Input: the board's card keys split by kind (`user:<id>` / `assigned:<id>` via the
  existing `splitTaskIdsByKind`).
- Two PostgREST queries on `task_comments` — one per task-id column — selecting only
  `user_task_id` / `assigned_task_id`, filtered `.neq('author_user_id', meId)` and
  `.in(<id column>, ids)`, **chunked** (≤~100 ids per `.in()`) and **paged with
  `.range()`** to dodge the silent 1000-row cap.
- Output: `Set<string>` of card keys that have at least one foreign comment.
- RLS: `task_comments` SELECT is already party-scoped (+admin), which exactly matches
  rule 1 for non-admin viewers; admins can read everything but rule 1's relation gate
  keeps `other` cards out of their Replies.
- Freshness: every foreign comment on my task also creates a `task_comment`
  notification for me, and the bell's realtime invalidation refreshes
  `['notifications']`-prefixed queries. The replies query watches the unread-notif
  data (same trigger as the badge) plus normal `['task-comments']`/mutation
  invalidations from the dialogs; no new realtime channel.

No schema, RLS, or trigger changes. Frontend-only.

## Touch points

- `src/features/tasks/taskCard.ts` — `columnOf(card, hasReply)` (new semantics +
  precedence), `isDraggable` (drop the unread-replies block). Unit tests updated.
- `src/features/tasks/TasksKanbanBoard.tsx` — compute `hasReply` per card from the
  new index + relation gate; stop routing on unread count (badge logic stays).
- New `src/features/tasks/hooks/useTaskRepliesIndex.ts` (+ pure helper for
  chunking/key-building, unit-tested).
- `src/features/tasks/commentBadge.ts` — unchanged (badge still uses unread index);
  `splitTaskIdsByKind` reused.
- Board tests (`TasksKanbanBoard`/`taskCard`/drag) adjusted: replies membership now
  driven by the mocked replies index, not unread notifs.

## Testing

- Unit: columnOf precedence (resolved beats replies; replies beats importance;
  relation `other` excluded), isDraggable matrix, chunk/page helper, index builder
  (foreign vs own comments).
- Hook test: query filters (`neq` author, id chunking) and key set output.
- Board test: card with foreign comment renders in Replies after notifications are
  read; delegated card with reply also in Replies; resolved card with reply renders
  in Resolved.
- Manual smoke on prod after deploy: comment as counterpart → card enters Replies,
  open card (badge clears, card stays), resolve both sides → card leaves.

## Revert

Single revert of the frontend commits restores the unread-inbox behaviour; no data
migration involved.
