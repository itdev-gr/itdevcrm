# "Paid In Full" as the living paid-up state (recurring unlock) — design

**Date:** 2026-06-23
**Status:** Approved (design), pending implementation plan

## Goal

Make the accounting **"Paid In Full"** column the steady home for **every** paid-up
client — brand-new or long-running recurring — and make the monthly On-Hold ↔
Paid-In-Full loop work by itself. Concretely:

1. Dragging a card to "Paid In Full" works **both ways**: it **spawns** jobs for a
   fresh client (today's behavior) and **unlocks** the frozen jobs for a client who
   already has jobs (instead of erroring).
2. **Money drives the board.** When the overdue month is marked **paid**, the card
   automatically returns from **On Hold** to **Paid In Full** and the frozen SEO
   jobs unlock — no dragging.
3. An onboarded recurring client whose month lapses **drops to On Hold
   automatically**, same as a new one (today the cron skips onboarded deals).
4. A **one-time sweep** clears the clients stuck in On Hold *right now* who are
   actually paid up.

## Background (current state)

**Accounting board** (`pipeline_stages`, board `accounting_onboarding`), order:
`new → documents_verified → invoice_issued → awaiting_payment → partial_payment →
paid_in_full → on_hold → done → closed`.

- `paid_in_full` — `is_terminal = true`, `terminal_outcome = 'paid'`,
  `triggers_action = 'complete_accounting'`. Terminal ⇒ a card here can't be moved
  out, and the overdue cron and the "back to Awaiting" trigger both skip it.
- `done` (renamed from `refunded`, migration `20260503000020`) and `closed`
  (`20260619110000`) — both `is_terminal = true`. These are the real "engagement
  over" end-states. **They must stay terminal and untouched.**
- `on_hold` — `is_terminal = false`. Used as the **unpaid** lane (confirmed with
  product owner: On Hold is for overdue payments only; deliberate/dispute holds use
  the separate block mechanisms — `clients.status`, `jobs.is_blocked`,
  `client_blocks`).

**Drag to Paid In Full today** — `AccountingOnboardingKanbanPage.onDragEnd`
(`src/features/accounting/AccountingOnboardingKanbanPage.tsx:81`) always calls
`complete_accounting(deal_id)`. That RPC
(`supabase/migrations/20260502000025_complete_accounting_extends.sql`):

- returns `already_completed` if `accounting_completed_at is not null`,
- returns `deal_not_locked` / `services_planned_empty` otherwise,
- else spawns jobs from `services_planned`, sets `accounting_completed_at`, and moves
  the deal to `paid_in_full`.

⇒ For an **existing** client (already onboarded, or jobs created manually since the
June re-baseline where `services_planned` is empty) the drag **errors** — this is
exactly why a stuck client "can't be moved to fully paid."

**Job freeze/unlock** — `deals_hold_jobs_on_stage_change()`
(`supabase/migrations/20260618000014_onhold_holds_seo_jobs_only.sql`), an
AFTER-UPDATE trigger on `deals` firing when `accounting_stage_id` changes:

- → `on_hold`: blocks `web_seo`/`local_seo`/`ai_seo` jobs with
  `blocked_reason = 'account_on_hold'`.
- → any other stage: **releases exactly the `account_on_hold` holds.**

⇒ The unlock we want already happens automatically on *any* stage change out of
On Hold. We do not modify this trigger; we just make sure the deal reaches
`paid_in_full`.

**Overdue → On Hold cron** — `move_overdue_deals_to_on_hold()` (current body in
`supabase/migrations/20260619110000_fix_closed_billing_and_email_gate.sql:93`). Runs
daily 02:05 UTC. Moves deals with a past-due `pending` payment to On Hold, but only
where:

- `accounting_completed_at is null`  ← **blocks onboarded recurring clients**, and
- the current stage is **not terminal** and not `closed`  ← also blocks `paid_in_full`
  while it's terminal.

**New-payment → Awaiting trigger** — `deal_payments_move_to_awaiting()`
(`20260503000019`) moves a deal to Awaiting Payment on a new payment row, but
**skips deals with `accounting_completed_at` set** and skips terminal stages. Desired:
a resting onboarded client should NOT be yanked to Awaiting when next month's row is
generated — they should stay in Paid In Full until actually overdue. (No change
needed, given we mark onboarded deals completed — see Change D.)

**Marking a payment paid** — `PaymentsPanel` `toggleStatus`
(`src/features/deals/PaymentsPanel.tsx:73`) just updates `deal_payments.status` →
`'paid'` (+ `paid_at`). So the auto-return must hook the **database** (trigger on
`deal_payments`), not the React handler, so it fires no matter who/what marks paid.

## Decisions (confirmed with product owner)

1. **Paid In Full = living resting state** (Q1-A). New deal ⇒ spawn; existing deal ⇒
   unlock. Same column does both.
2. **Money drives the board** (Q2-A): paid ⇒ auto-return + unlock; overdue ⇒
   auto-drop to On Hold. Manual drag still works as override.
3. **One-time sweep of the current backlog** (Q3-A).
4. **Catch-up rule:** a deal leaves On Hold only when it has **zero** past-due unpaid
   payments. Owing an earlier month ⇒ stays on hold.
5. **New-vs-existing test = "does the deal already have non-archived jobs?"** (robust
   to the manual-jobs workflow), not the legacy `accounting_completed_at` flag.
6. **Column label unchanged** ("Paid In Full" / "Πλήρως Εξοφλημένο") to avoid
   retraining accounting. (Relabel is a trivial follow-up if wanted.)
7. **On Hold is the unpaid lane only** ⇒ auto-return may release any deal in On Hold
   with no past-due unpaid payments.

## Changes

### A. Make `paid_in_full` non-terminal

- Migration: `update public.pipeline_stages set is_terminal = false where board =
  'accounting_onboarding' and code = 'paid_in_full';` (leave `terminal_outcome`
  and `triggers_action` as-is — nothing reads `paid_in_full`'s `terminal_outcome`).
- `done` and `closed` stay terminal — verify in the same migration (assert, no-op
  update) so the cron sweep can never touch a finished client.

### B. "Both ways" drag — new RPC `accounting_mark_paid_in_full(deal_id)`

- New migration adds `accounting_mark_paid_in_full(target_deal_id uuid)` (security
  definer; same permission gate as `complete_accounting`:
  `current_user_is_admin() OR current_user_can('accounting_onboarding',
  'complete_accounting')`). Logic:
  - If the deal has **any non-archived job** *or* `accounting_completed_at is not
    null` ⇒ **existing client**: set `accounting_stage_id = paid_in_full`, and set
    `accounting_completed_at = now()` / `accounting_completed_by = auth.uid()` if
    null. (The stage change fires `deals_hold_jobs_on_stage_change` ⇒ jobs unlock; and
    `client_status_auto_transitions` ⇒ client back to `active`.) Return `{ok:true,
    mode:'unlocked'}`.
  - Else ⇒ **fresh onboarding**: delegate to `complete_accounting(target_deal_id)`
    (unchanged spawn path) and pass through its result (`{ok, errors}` /
    `mode:'spawned'`).
- `complete_accounting` itself is **not** changed.
- Frontend: `AccountingOnboardingKanbanPage.onDragEnd` — for the `paid_in_full`
  target, call the new RPC (new hook `useMarkPaidInFull`) instead of
  `complete.mutateAsync`; keep the existing error-alert handling. The
  `payment_method` precheck stays. (`useCompleteAccounting` may remain for any other
  caller; verify none break.)

### C. Auto-return on payment — new trigger `deal_payments_release_from_on_hold()`

- New migration adds an AFTER-UPDATE trigger on `public.deal_payments` (security
  definer) firing when `status` becomes `'paid'` (`new.status = 'paid' and old.status
  is distinct from 'paid'`):
  - Load the deal; proceed only if it is currently in the **`on_hold`** stage.
  - Compute "still owes": `exists (select 1 from deal_payments dp where dp.deal_id =
    new.deal_id and dp.status <> 'paid' and dp.billing_type <>
    'recurring_test_2min' and dp.end_date is not null and dp.end_date <=
    current_date)`.
  - If it does **not** still owe ⇒ `update deals set accounting_stage_id =
    paid_in_full where id = new.deal_id`. The existing `deals_hold_jobs_on_stage_change`
    trigger then unlocks the `account_on_hold` jobs; `client_status_auto_transitions`
    sets the client back to `active`.
- Pure stage move — **does not** call `complete_accounting`, so no jobs are spawned.
- Idempotent / safe: if the deal isn't in On Hold, or still owes, it's a no-op.

### D. Overdue cron sees onboarded recurring clients

- Migration re-creates `move_overdue_deals_to_on_hold()` from the
  `20260619110000` body with **one change**: drop the
  `and d.accounting_completed_at is null` clause. Keep everything else, including the
  terminal/`closed` exclusion (so `done`/`closed` stay protected) and the
  `<> on_hold_id` guard.
- With `paid_in_full` now non-terminal (Change A), an onboarded recurring client whose
  payment is past due drops to On Hold automatically; the hold trigger freezes its SEO
  jobs.
- (No change to `deal_payments_move_to_awaiting`: marking onboarded deals completed in
  Change B means new monthly payment rows won't drag a resting client to Awaiting.)

### E. One-time backlog sweep (in-migration, runs once)

- In the same release migration, after the trigger/cron changes:
  - For every deal currently in `on_hold` with **no** past-due unpaid payment (same
    "still owes" predicate as Change C, negated), set `accounting_stage_id =
    paid_in_full`. The hold trigger unlocks their `account_on_hold` jobs.
  - Belt-and-braces: also `update jobs set is_blocked=false, blocked_reason=null,
    blocked_at=null where blocked_reason='account_on_hold'` for those swept deals
    (in case any deal-level move didn't cascade as expected).
- Clients who genuinely still owe stay in On Hold.
- Snapshot the affected deal ids + prior stage into a `*_backup_20260623` table for
  rollback, per project convention.

## Out of scope (YAGNI)

- Relabeling the column (keep "Paid In Full").
- Distinguishing payment-holds from deliberate/dispute holds inside the On Hold lane
  (confirmed On Hold = unpaid only; non-payment holds use the block mechanisms).
- Touching `done`/`closed` semantics, `ensure_recurring_payments`, or the v1→v2 cron
  (recurring-payments memo still says don't swap).
- Any change to job-board (web_seo/local_seo/etc.) stages.

## Testing (TDD, small commits per task)

- **`accounting_mark_paid_in_full`** (pg/RPC): deal with jobs ⇒ moves to
  `paid_in_full`, no new jobs, `account_on_hold` jobs unlocked, client `active`; deal
  with no jobs + valid `services_planned` ⇒ spawns (delegates to
  `complete_accounting`); permission denied for non-accounting.
- **`deal_payments_release_from_on_hold`**: on-hold deal, last overdue paid ⇒ moves to
  `paid_in_full` + jobs unlock; on-hold deal still owing an earlier month ⇒ stays;
  deal not on hold ⇒ no-op; `recurring_test_2min` rows ignored.
- **`move_overdue_deals_to_on_hold`**: onboarded recurring deal with past-due payment
  ⇒ now moved to On Hold; `done`/`closed` deal with unpaid ⇒ **not** moved;
  `paid_in_full` (non-terminal) ⇒ moved when overdue.
- **Sweep**: on-hold-but-paid-up deals end in `paid_in_full` with jobs unlocked;
  on-hold-and-owing deals untouched; backup table populated.
- **Frontend**: `onDragEnd` to Paid-In-Full calls `useMarkPaidInFull`; existing-client
  drag no longer alerts an error; `payment_method` precheck preserved.
- Migrations applied to prod via Supabase MCP (DDL); verify with a round-trip on a
  scratch deal.

## Changes / Revert

- **Migrations** (one release migration file, atomic):
  1. `pipeline_stages('paid_in_full').is_terminal` `true → false`.
  2. New RPC `accounting_mark_paid_in_full(uuid)`.
  3. New trigger + fn `deal_payments_release_from_on_hold()` on `deal_payments`.
  4. `move_overdue_deals_to_on_hold()` re-created without the
     `accounting_completed_at is null` clause.
  5. One-time sweep + `*_backup_20260623` snapshot.
- **In-file ROLLBACK:** restore `paid_in_full.is_terminal = true`; `drop function
  accounting_mark_paid_in_full(uuid)`; `drop trigger`/`drop function
  deal_payments_release_from_on_hold`; re-create `move_overdue_deals_to_on_hold()`
  from the `20260619110000` body (with the `accounting_completed_at is null` clause);
  re-hold/restore swept deals from the backup table.
- **Code:** new `useMarkPaidInFull` hook; edit `AccountingOnboardingKanbanPage`
  (`onDragEnd`); i18n keys for any new error/mode strings (en + el). Atomic commits per
  task; revert = `git revert` of those commits + the rollback migration.
