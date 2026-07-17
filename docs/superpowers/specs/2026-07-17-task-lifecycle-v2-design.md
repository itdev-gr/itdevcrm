# Dual-Resolve Task Lifecycle v2 — viewer-relative Resolved + 7-day auto-close

**Date:** 2026-07-17
**Status:** Approved (owner)

## Problem

Half-resolved dual-resolve tasks pile up on users' boards: after one party
stamps their side, the card stays in the stamper's urgency columns until the
OTHER party acts — which often never happens. Users perceive their board as
full of work that is, for them, finished.

## Owner decisions

1. **Viewer-relative Resolved:** when MY side is stamped, the card moves to
   the Resolved column FOR ME (even while the task is still open). The other
   party keeps seeing it in their urgency columns with the awaiting badge.
2. **Replies win:** a new comment from the other party resurfaces the card in
   my Replies column (existing behavior — must keep precedence over the new
   viewer-relative Resolved).
3. **7-day auto-close, half-resolved only:** a task with exactly one side
   stamped and NO activity for 7 days closes automatically. Activity =
   `greatest(task.updated_at, latest task_comments.created_at)` — both task
   tables auto-touch `updated_at` on every UPDATE (set_updated_at triggers),
   and task comments link via `task_comments.user_task_id` /
   `assigned_task_id`. Fully-open idle tasks are NOT auto-closed.
4. **Notify both parties on auto-close** (in-app only, no email):
   "Το task έκλεισε αυτόματα (7 μέρες χωρίς κίνηση)".
5. **AI summary fires for auto-close too:** the existing
   `enqueue_task_summary` AFTER-UPDATE triggers key on the open→terminal
   transition regardless of path, so the auto-close lands in
   `task_summary_outbox` and the 10-minute `task-summary-drain` cron produces
   the Greek summary as today. No summary-side changes.
6. **Backfill = first run:** currently-stuck half-resolved tasks idle ≥7 days
   close on the first run. A manual dry-run (candidate list) is shown to the
   owner before invoking the function manually post-deploy.

## Design

### Frontend (all in `src/features/tasks/`)

- **`taskCard.ts`**
  - New pure helper `viewerSideStamped(card: TaskCard): boolean` — true when
    the viewer's own side is stamped: relation `'mine'` (viewer = assignee) →
    `assigneeResolvedAt`, `'delegated'` (viewer = creator) →
    `creatorResolvedAt`, `'other'` → false.
  - `columnOf(card, hasUnreadReplies)`: precedence becomes
    replies → terminal resolved → **viewer-side stamped → 'resolved'** →
    importance.
  - `resolveDrag(card, target)`:
    - onto `'resolved'`: unchanged for unstamped cards (`{type:'resolve'}`);
      a viewer-side-stamped open card is already in Resolved → `noop`.
    - off `'resolved'` onto an importance column: terminal card → `reopen`
      (unchanged); open viewer-side-stamped card → NEW action
      `{ type: 'withdraw'; importance }` (withdraw my stamp, set importance).
  - `DragAction` union gains `withdraw`.
- **`hooks/useTaskBoardActions.ts`** — `withdraw` branch: call
  `unresolve_task(p_kind, p_task_id)` RPC, then direct-update `importance`
  on the task's table (importance writes are not guarded). Returns null (no
  popup).
- **Home widget** (`src/features/home/` / `src/features/assigned_tasks/`
  open-tasks hooks): rows whose viewer side is stamped disappear from the
  viewer's open-task widget lists (they are "done for me"). Same
  viewer-side rule as the board; the row still appears for the other party.
- **Notifications presenter**: new type `task_auto_closed` rendered with the
  existing task deep-link routing (`payload.task_kind` = `user_task` /
  `assigned_task` + `task_id`, matching `readPath()`); el/en i18n copy.
- The resolve-awaiting popup shipped 07-17 (`awaitingPopupKey`) stays as-is.

### Database (one migration + cron)

- **`auto_close_stale_tasks()`** (SECURITY DEFINER, `search_path=public`):
  - `set_config('app.task_resolve_rpc','1', true)` so the terminal guard
    passes (same txn-local GUC the RPCs use).
  - For `user_tasks`: candidates = `completed_at IS NULL` AND exactly one of
    `creator_resolved_at`/`assignee_resolved_at` set AND
    `greatest(updated_at, coalesce(max(task_comments.created_at), updated_at))
    < now() - interval '7 days'`. Update: fill the missing `*_resolved_at`
    with `now()` (leave its `*_resolved_by` NULL — the NULL `_by` beside a
    non-NULL `_at` marks "closed automatically"), set `completed_at = now()`.
  - For `assigned_tasks`: same shape; terminal write is `status='resolved'`,
    `resolved_at = now()`.
  - Insert in-app `notifications` rows (type `task_auto_closed`, payload
    `{task_kind, task_id, title}`) for both parties (distinct, non-null).
  - Existing summary-enqueue triggers fire automatically on the transition.
- **Cron:** `cron.schedule('auto_close_stale_tasks', '35 2 * * *', …)` —
  after the 02:00-02:30 nightly block.

### Explicitly unchanged

- `resolve_task` / `unresolve_task` RPCs, terminal guard triggers, summary
  outbox/edge fn, ResolvedArchive (terminal-only history), task dialogs'
  withdraw/confirm buttons, the awaiting popup.

## Testing

- Unit (vitest): `viewerSideStamped`, new `columnOf` precedence (replies >
  terminal > viewer-stamped > importance), `resolveDrag` withdraw/noop
  matrix, widget filtering, notification presenter case.
- Board actions hook: withdraw branch calls `unresolve_task` then importance
  update (mocked supabase).
- DB: dry-run SELECT of candidates on prod before first manual invocation;
  post-run verification (counts, a sampled task's stamps/summary/notification).
- Do NOT run the full vitest suite (parts hit production); run named files.

## Changes / Revert

- Frontend: atomic commits per task; `git revert` cleanly.
- DB rollback SQL:
  `select cron.unschedule('auto_close_stale_tasks');
   drop function if exists public.auto_close_stale_tasks();`
  Auto-closed tasks can be reopened from the UI (terminal→open stays
  allowed); notifications rows are inert data.
