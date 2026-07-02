# Stage-Locked Accounting Emails — Design Spec

**Date:** 2026-07-02
**Status:** Approved (brainstorming) — pending implementation plan
**Author:** collaborative brainstorm (product owner + Claude)

## Goal

Every automated **accounting** email must fire **only** when the deal is in its
one correct accounting column, and the board **move must happen before the
send**. No accounting email may go out to a deal sitting in the wrong column.

Concretely, the product owner's rule:
- You cannot send the 7-days-before reminder unless the deal is in **Awaiting Payment**.
- You cannot send the final notice unless the deal is already in **On Hold**.
- The deal is moved into the correct column **first**, then the email is sent.

## Current state (why this is needed)

Accounting emails today (`identity='accounting'`), from
`enqueue_payment_reminders()` (cron `daily_payment_reminders`, 06:00 UTC) and
the onboarding trigger:

| Email | Fires (today) | Current gate |
|---|---|---|
| `payment_due_soon` | payment due in exactly 7 days | broad whitelist* |
| `payment_overdue` | exactly 1 day past due | broad whitelist* |
| `payment_final_notice` | exactly 7 days past due | broad whitelist* |
| `won_welcome` | deal enters accounting onboarding (once/deal) | fires on entry |
| `payment_due_today` | **nothing** — text exists but unwired (audit flag F9) | — |
| `contract_send` | manual send | — |

\* All three reminders share **one broad whitelist**
(`invoice_issued, awaiting_payment, partial_payment, paid_in_full, on_hold`),
so a `payment_final_notice` can currently reach a deal that is only in
`awaiting_payment` — the exact behaviour we want to stop.

**The board already moves deals by due-date.** `reconcile_block_lifecycle()`
(cron 02:20 UTC) assigns the accounting column from the earliest unpaid due
date (`deal_next_due`):

- `next_due` NULL → `paid_in_full`
- `next_due <= today` → `on_hold`
- `next_due <= today + 7` → `awaiting_payment`
- else → `paid_in_full`
- with a 24h anti-flap grace that can hold a *freshly-created* overdue row in
  `paid_in_full` for up to 24h.

So the "move" logic largely exists and is correct. This change is mainly
(1) **lock each email to its one column**, and (2) **guarantee the move runs
first**.

## Design

### 1. Nightly chain — move, then send

Introduce a thin wrapper the cron calls, running in strict order:

1. `reconcile_block_lifecycle(false)` — move every deal into its correct column.
2. **then** `enqueue_payment_reminders()` — the stage-gated enqueuer.

The `daily_payment_reminders` cron is repointed at this wrapper (e.g.
`run_daily_payment_reminders()`), so no reminder is evaluated until the deal is
in its final column for the day. The standalone 02:20 `reconcile_block_lifecycle`
cron stays (idempotent; harmless to run twice).

`enqueue_payment_reminders()` itself stays **pure** (only reads the *current*
stage, does not move deals) so it can be unit-tested against a deal pre-set to
any column.

### 2. Strict per-email stage lock (replaces the shared whitelist)

Each template is bound to exactly one column, using **windows** (Option A) with
once-per-payment dedup:

| Email | Sends only if column is | Timing window (due date = `deal_payments.start_date`) |
|---|---|---|
| `payment_due_soon` | **Awaiting Payment** | not yet due, due within 7 days: `today < due_date <= today + 7` |
| `payment_overdue` | **On Hold** | 1–6 days past due: `1 <= today - due_date <= 6` |
| `payment_final_notice` | **On Hold** | ≥7 days past due: `today - due_date >= 7` |

- Candidate rows: `deal_payments.status in ('pending','overdue')`, deal not
  archived, `suppress_payment_reminders = false`, client email present.
- Dedup unchanged: `dedupe_key = <prefix>:<payment_id>` checked against
  `email_log` (sent) and `email_outbox` (pending/sending/sent) — each template
  fires **at most once per payment (= per period)**.
- If the deal is not in the required column, the email is simply not enqueued.

**Why windows, not exact ±offsets:** the 24h anti-flap grace can hold a
freshly-created overdue payment in `paid_in_full` on its exact +1 day, so an
exact-offset gate would occasionally *miss* the overdue email entirely. Windows
+ dedup never miss and fire at essentially the same time (a deal enters Awaiting
Payment exactly ~7 days before due; enters On Hold the day it becomes overdue).

### 3. Drop `payment_due_today`

Deactivate the template (set inactive / remove its automation wiring) —
resolves audit flag F9. No day-0 email; the first overdue email is `payment_overdue`
at +1 day.

### 4. `won_welcome` — unchanged

Fires once when the deal enters accounting onboarding. It is a one-time entry
event, so it cannot fire from a "wrong" column — no gating needed.
`contract_send` and `custom` are manual — untouched.

### 5. Cancel now-out-of-scope queued rows

When the tighter gate ships, any currently `pending`/`sending` reminder rows in
`email_outbox` whose deal is no longer in the required column are cancelled
(status → `failed`, `last_error = 'cancelled by stage-lock 20260702'`), with a
backup table (`email_outbox_stagelock_backup_20260702`) recording prior status
for reversibility — same pattern as migration `20260701020000`.

### 6. Update the email catalog (PDF + HTML)

Update `docs/system-analysis/2026-07-02-email-catalog.html` so each of the three
reminder cards states its **locked column**, `payment_due_today` is marked
**removed/deactivated**, and the intro notes "each accounting email sends only
from its matching board column, after the nightly move." Then regenerate
`2026-07-02-email-catalog.pdf` via headless Chrome
(`--headless --print-to-pdf`). (No generator script exists; PDF was ad-hoc.)

## Components & data flow

```
cron daily_payment_reminders (06:00 UTC)
  └─> run_daily_payment_reminders()            [NEW wrapper]
        ├─ reconcile_block_lifecycle(false)    [existing — MOVE]
        └─ enqueue_payment_reminders()         [MODIFIED — stage-locked SEND]
              └─ inserts into email_outbox (dedup per payment+template)
                    └─ drain_email_outbox (every 2 min) -> Resend
```

- **`run_daily_payment_reminders()`** — orchestrator; what does it do: move then
  send; depends on the two functions below.
- **`enqueue_payment_reminders()`** — pure stage-gated enqueuer; input: current
  DB state; output: outbox rows + count; depends on `pipeline_stages`,
  `deal_payments`, `deals`, `clients`.
- **`reconcile_block_lifecycle()`** — unchanged mover.

## Testing

Extend `supabase/tests/enqueue_payment_reminders.sql` (savepoint-rollback,
terminal `RAISE`), calling `enqueue_payment_reminders()` directly against a deal
pre-set to a specific column:

- **Positive:** deal in Awaiting + due in 5d → exactly one `payment_due_soon`.
  Deal in On Hold + 2d overdue → one `payment_overdue`. Deal in On Hold + 9d
  overdue → one `payment_final_notice`.
- **Negative (the core of the request):** deal in Awaiting + 9d overdue →
  **no** `payment_final_notice`. Deal in `paid_in_full`/`partial_payment` →
  no reminder. Deal in Awaiting + 3d overdue → no `payment_overdue` (wrong
  column).
- **Dedup:** second run same day → 0 new rows.
- **Chain:** seed a deal whose due date implies On Hold but leave it in the wrong
  column; run `run_daily_payment_reminders()`; assert it was moved to On Hold
  *and* the correct email queued (move-before-send).
- **Suppression / closed client / archived:** still skipped.

## Changes / Revert

- **Migration** `supabase/migrations/20260702140000_stage_locked_accounting_emails.sql`:
  1. `create or replace enqueue_payment_reminders()` — per-template window + column lock.
  2. `create or replace run_daily_payment_reminders()` wrapper; repoint the
     `daily_payment_reminders` cron to it.
  3. Deactivate `payment_due_today` template.
  4. Backup + cancel out-of-scope queued reminder rows.
- **Revert** (embedded, commented): restore the `20260701020000` body of
  `enqueue_payment_reminders()`, repoint the cron back to `enqueue_payment_reminders()`,
  reactivate `payment_due_today`, restore cancelled outbox rows from the backup
  table, drop the wrapper + backup table.
- Docs: catalog HTML + regenerated PDF committed alongside.
- Push directly to `main` (no PR).

## Out of scope

- Sales/technical/internal/system emails (lead_welcome, noanswer, offer_followup,
  reengage, won_next_steps, GSC/GBP access, task/job notifications, password reset).
- The `reconcile_block_lifecycle` move logic itself (already correct; unchanged).
- The bad-client-email data fixes (ΔΙΑΤΥΠΟΣ etc.) — separate data task.

## Open questions

None — mapping, windows, chain ordering, and due-today removal confirmed with
the product owner 2026-07-02.
