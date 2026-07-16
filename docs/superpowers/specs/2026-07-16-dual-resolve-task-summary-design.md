# Dual-sided task resolve + AI resolve-summary — design

**Date:** 2026-07-16 · **Status:** approved-pending-owner-review · **Owner ask:** tasks must be resolved by BOTH sides (opener may still want to add something after the assignee resolves), and on full resolve an agent posts a short Greek summary of the task's internal discussion into the linked entity's comments, so the communication is archived and nobody has to dig through tasks.

## Product decisions (owner, 2026-07-16)

1. **Scope:** dual resolve applies to every task with two distinct parties — `user_tasks` where `created_by ≠ user_id`, and all `assigned_tasks` where creator ≠ assignee. Self-tasks close with a single resolve, as today.
2. **No reset:** one side's ✓ stays when the other side keeps commenting; it is only removed manually by its owner (while the task isn't fully closed). No automatic invalidation.
3. **Summary destination:** posted into the linked entity's comments thread (same channel the ✅ marker already targets) AND stored on the task row (`summary` column) so unlinked tasks keep an archive too.
4. **Privacy:** understood and accepted — task comments are parties-only, the summary makes the gist visible to all staff. That is the point (archive). Summary is factual/professional, never verbatim quotes.

## Current behavior (verified in code)

- `assigned_tasks.status` `'open'|'resolved'`; BEFORE-UPDATE trigger `assigned_tasks_stamp_resolved` stamps `resolved_at/resolved_by_user_id` on open→resolved and clears on reopen (`20260512000001_assigned_tasks.sql:83-99`). `user_tasks` lifecycle = `completed_at` null/set; creator in `created_by`, assignee in `user_id`.
- ALL downstream effects key off that single terminal transition: `task_resolved` notification, ✅ auto-comment into the entity thread (`20260709170000_task_auto_comments.sql`, channel routing extended in `20260716100000_ads_social_channels_unread.sql:92-100`).
- Resolve is triggered from 4 places, all direct `.update()`: tasks-kanban drag (`useTaskBoardActions.ts:24-38`), `AssignedTaskDetailDialog` → `useResolveAssignedTask.ts:8-13`, inline `AssignedTasksTab.tsx:97-110`, `UserTaskDetailDialog` → `useToggleTaskComplete` (`useDeleteTask.ts:24-44`).
- RLS today lets either party (or admin) flip the terminal state alone — the gap this feature closes.
- Async-work pattern to copy: `email_outbox` + statement-level pulse `net.http_post` via vault secrets + cron backstop (`20260625150002_email_instant_pulse.sql`), drained with `FOR UPDATE SKIP LOCKED` claim RPC.
- No LLM usage exists anywhere in the repo yet.

## Design

### 1. Schema (one migration)

Both `user_tasks` and `assigned_tasks` get:

- `creator_resolved_at timestamptz`, `creator_resolved_by uuid`
- `assignee_resolved_at timestamptz`, `assignee_resolved_by uuid`
- `summary text` (filled by the summarizer; null until then)

Existing `status` / `completed_at` remain the **terminal close** — untouched semantics, so every existing trigger/notification/✅ fires exactly once, unchanged. Reopen (resolved→open / clearing `completed_at`) also clears both side-stamps (extend `assigned_tasks_stamp_resolved`; add the equivalent small trigger for `user_tasks`).

New table `task_summary_outbox`: `id, task_kind text check ('user','assigned'), task_id uuid, status text check ('pending','sending','sent','failed') default 'pending', attempts int default 0, last_error text, created_at, sent_at`. Claim RPC `claim_task_summaries(p_limit)` mirrors `claim_email_outbox` (recover-stale + `FOR UPDATE SKIP LOCKED`).

### 2. Resolve RPCs (the only write path)

`resolve_task(p_kind text, p_task_id uuid)` — SECURITY DEFINER:

- Resolves caller side from `auth.uid()`: assignee → stamps assignee side; creator → stamps creator side; both roles (self-task) → stamps both; **admin → stamps both (force-close), matching today's admin power**. Not a party and not admin → error.
- Idempotent per side (re-stamping your side is a no-op).
- When both sides are stamped → sets the terminal state (`status='resolved'` / `completed_at=now()`) inside the same call; downstream triggers fire as today.
- On a FIRST one-sided stamp → inserts a `task_confirm_pending` notification for the other party (payload mirrors existing task notif shape: task_kind, task_id, title, source_code, parent_type/parent_id) — deep link resolves via the existing `readPath()` contract (`/tasks?open=<kind>:<id>` or job-targeted variant).

`unresolve_task(p_kind, p_task_id)` — removes ONLY the caller's own stamp, only while the task is not terminally closed. Full reopen of closed tasks stays the existing (admin) flow.

**Guard:** BEFORE-UPDATE trigger on both tables rejects a direct open→terminal transition unless a transaction-local GUC set by the RPCs is present (`set_config('app.task_resolve_rpc','1',true)`). Reopen direction stays as today. This closes the RLS gap without touching the update policies (which other columns rely on).

### 3. Frontend

- All four resolve entry points call `resolve_task` (replaces direct updates). `taskCard.ts` mapping gains the two side-stamps; `resolveDrag` + `isDraggable` extend so the **creator** ('delegated') can also drag-to-stamp, not only the assignee.
- A half-resolved task stays in its urgency column with a badge: «Αναμονή επιβεβαίωσης — <name>» (who is pending). It moves to the Resolved lane only on full close (lane semantics unchanged).
- Dialogs (`AssignedTaskDetailDialog`, `UserTaskDetailDialog`, inline `AssignedTasksTab`): the button reads «Resolve» normally; if the other side already stamped, it reads «Επιβεβαίωση & κλείσιμο»; if YOU already stamped, it becomes «Αναίρεση ✓» (calls `unresolve_task`) plus an "awaiting other side" status row. `AssignedTasksTab.tsx:48` gate widened to include the creator (aligning with the dialog's `isParty`).
- Notifications: new presenter for `task_confirm_pending` (reuses `readPath`). In-app only — no new email (create-time email stays the only task email; can be added later if asked).
- Resolved task detail shows the stored `summary` when present.

### 4. Summarization pipeline

- AFTER-UPDATE triggers on both tables, `WHEN` = the terminal transition, insert into `task_summary_outbox` (fires exactly once thanks to §2). Statement-level pulse trigger `net.http_post`s `/functions/v1/summarize-task {drain:true}` using vault `project_url` + new vault secret `task_summary_secret`, wrapped in `exception when others then null`. pg_cron backstop every 10 min. Attempts cap 5 → status `failed` with `last_error`.
- New edge function `supabase/functions/summarize-task` (registered in `config.toml`, `verify_jwt=false`), modeled on send-email: constant-time bearer check against `TASK_SUMMARY_SECRET`, service-role client, drain loop over claimed rows:
  1. Load task + its `task_comments` (author names via profiles).
  2. **Zero comments → mark `sent` and do nothing else** (the ✅ marker suffices; no LLM call).
  3. Call OpenAI Chat Completions: model from `OPENAI_MODEL` env (default `gpt-4o-mini`), temperature 0.2, ~300 output tokens. System prompt (Greek): factual 3–5 line summary — τι ζητήθηκε, τι έγινε, τι αποφασίστηκε, τυχόν εκκρεμότητες; no verbatim quotes, no salutations. Input = title, description/notes, department, then comments as `Όνομα (ημ/νία): κείμενο`, oldest-first, truncated from the oldest side to stay within a safe input budget.
  4. Write `summary` onto the task row; insert a `comments` row `🤖 Σύνοψη task: «<title>»\n<summary>` with `task_key` back-reference, author = the final resolver (same convention as ✅), into the SAME target thread as the ✅ comment. Routing lives in a new SQL helper `task_comment_target(p_kind, p_id)` that reproduces the existing CASE (deal→General, web_dev→Dev, seo→SEO, ads/social→their channels, hosting→job thread, user tasks→client/lead; unlinked → no comment, summary on task only). The CASE is intentionally duplicated from the ✅ trigger rather than refactoring it (that migration belongs to a concurrent workstream); a comment in both places cross-references them.
  5. Mark outbox row `sent`.
- A summary failure NEVER blocks or reverts the resolve — the task is closed regardless; the outbox retries.

### 5. Secrets

`OPENAI_API_KEY` (+ optional `OPENAI_MODEL`) and `TASK_SUMMARY_SECRET` as edge-function secrets; `task_summary_secret` mirrored in vault for the pulse. Never in code, docs, or migrations. The key shared in chat must be **rotated at OpenAI after deployment** and the secret updated (standing rule for chat-shared tokens).

## Edge cases

- Creator == assignee (self-task): single stamp closes; no confirm-pending notification.
- Admin resolves: force-close both sides (unchanged admin semantics); summary still generated.
- Reopen after full close: side-stamps cleared; a later re-close generates a NEW outbox row (summary re-posted; dedupe not needed — reclose is rare and a fresh summary is correct).
- Party leaves/deleted: admin force-close is the escape hatch.
- Greek + emoji content in comments: OpenAI handles UTF-8; body built with parameterized inserts (no encoding tricks needed).
- Realtime: task lists already invalidate on update; side-stamp changes ride the same channels.

## Verification

- Unit (vitest, scoped files only — suite hits prod): pure gating helpers (who may stamp/unstamp; button-state mapper), outbox claim logic if extracted as pure SQL tested via a scoped integration check on staging-safe data.
- Manual e2e on prod with test accounts (admin + one sales rep): rep resolves → badge + notification to creator; creator confirms → task closes, ✅ + 🤖 summary appear in the right channel, `summary` stored; unresolve flow; self-task single-stamp; zero-comment task skips the 🤖 comment.
- `npm run build` green; edge function deployed via MCP; migration applied only after owner go-ahead (standing rule).

## Changes / Revert

- One migration (columns + guard/stamp triggers + RPCs + outbox + pulse + cron + helper): paired rollback SQL kept in the migration header comment (drop triggers/RPCs/outbox/columns; `summary` column drop loses stored summaries).
- New edge function `summarize-task` (delete to revert) + `config.toml` entry.
- Frontend: atomic commits per task, `git revert` each.
- No changes to existing ✅/notification triggers except the reopen-clears-stamps extension (explicitly reverted by rollback SQL).
