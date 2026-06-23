# Recurring billing keyed off the due date (period start) — design

**Date:** 2026-06-23
**Status:** Approved (design), pending implementation plan

## Goal

Make the recurring billing lifecycle key off the **due date** — the date the next
payment falls due, which equals the **end of the already-paid period** (= the
pending payment's period **start**) — instead of the pending period's **end** date,
which is what the code uses today. Ensure onboarded recurring clients flow:

```
PAID IN FULL ──(7 days before due: next payment created)──► AWAITING PAYMENT
AWAITING PAYMENT ──(pay within window)──► PAID IN FULL
AWAITING PAYMENT ──(due date passes, unpaid)──► ON HOLD (SEO jobs frozen)
ON HOLD ──(pay)──► PAID IN FULL (SEO jobs unlocked)
```

And correct the live data that the previous (end-date) sweep mis-moved.

## Background (current state)

The feature shipped earlier today
([[project-paid-in-full-recurring]], spec
`2026-06-23-paid-in-full-recurring-unlock-design.md`) made `paid_in_full` a
non-terminal resting state, added an auto-return trigger, relaxed the overdue cron,
and ran a one-time sweep — **but every "owes / overdue" check used `end_date`.**

Concrete bug (the trigger case): **ECODIN** (`961d01a8-…`), Local SEO €200/mo —
paid period `05 May → 05 Jun` (paid), next period `05 Jun → 05 Jul` (**pending**).
Due date = **05 Jun** (end of the paid period). Today is 23 Jun, so it is unpaid and
overdue → should be **On Hold**. The end-date rule saw `end_date = 05 Jul` (future)
→ judged it paid-up → the sweep moved it to **Paid In Full**. **28 of the 39 swept
deals are in this same wrong state.**

Functions involved (current basis = `end_date`):

- `mark_overdue_payments()` (`20260610000004`) — flips `pending → overdue` where
  `end_date < current_date`; also emits overdue notifications. Cron 02:15.
- `move_overdue_deals_to_on_hold()` (latest body in `20260623140000`) — moves deals
  with a `pending` payment where `end_date <= current_date` to On Hold (excludes
  terminal/`closed`). Cron 02:05.
- `deal_payments_move_to_awaiting()` (`20260503000019`, AFTER INSERT on
  `deal_payments`) — moves a deal to Awaiting Payment on a new payment row, **but
  skips deals with `accounting_completed_at` set** → onboarded recurring clients
  never enter Awaiting.
- `deal_payments_release_from_on_hold()` (`20260623140000`, my trigger) — on a
  payment becoming `paid`, if the deal is in **On Hold** and no `end_date`-past-due
  unpaid remains, moves it to Paid In Full.

Already correct (no change): `ensure_recurring_payments()` creates the next payment
when the current period's `end_date <= current_date + 7 days` — i.e. **7 days before
the due date** (the next period's start). The Awaiting Payment column is already
subtitled **"7 days prior"**. Payment-reminder emails (−7d/+1d/+7d,
[[project-transactional-emails]]) exist but are **paused** (email sending down).

## Decisions (confirmed with product owner)

1. **Due date = the pending payment's period start** (= end of the already-paid
   period). Canonical **"owes now"** predicate for a deal:
   ```
   exists dp (status <> 'paid') where
        (billing_type in ('recurring_monthly','recurring_yearly')
           and start_date is not null and start_date <= current_date)
     or (billing_type = 'one_time'
           and end_date  is not null and end_date  <= current_date)
   ```
   i.e. **recurring → due at `start_date`; one-time → unchanged (`end_date`).**
2. **Recurring only.** The due-date change applies to recurring monthly/yearly.
   One-time project fees keep their current `end_date` behavior.
3. **Pay anytime → Paid In Full.** Marking the due payment paid from **Awaiting
   Payment** *or* **On Hold** returns the client to Paid In Full (when fully caught
   up).
4. **Onboarded recurring clients flow through Awaiting.** When the next payment is
   created (7 days before due), a paid-up recurring deal moves Paid In Full →
   Awaiting Payment. It must NOT move a deal that is already On Hold for an *earlier*
   unpaid month.
5. **Correct the live data:** re-evaluate the 39 deals the previous sweep touched on
   the due-date rule.

## Changes

### A. Overdue basis → due date (recurring = `start_date`)

- `mark_overdue_payments()`: change the WHERE so a payment is overdue when the
  **due date** has passed — recurring at `start_date <= current_date`, one-time at
  `end_date < current_date` (unchanged). Keep the notification logic intact.
- `move_overdue_deals_to_on_hold()`: change the `overdue_deals` CTE to select deals
  with an unpaid payment past its **due date** (recurring `start_date <=
  current_date`, one-time `end_date <= current_date`). Keep the terminal/`closed`
  exclusion and the `<> on_hold` guard.

### B. Onboarded recurring clients enter Awaiting (7 days prior)

- `deal_payments_move_to_awaiting()`: drop the blanket "skip if
  `accounting_completed_at is not null`" so completed recurring deals are handled.
  Move the deal to Awaiting Payment **only when it is currently in `paid_in_full`**
  (resting / good standing) or in the existing pre-completion onboarding stages —
  i.e. **never when it is in `on_hold`** (don't pull a deal out of On Hold for an
  earlier unpaid month) and never from a terminal stage. Net effect: the new
  payment row, created 7 days before its due date, moves a resting client into
  Awaiting Payment. (The −7d reminder email already fires here; it's paused.)

### C. Settle-to-Paid-In-Full covers Awaiting + uses the due-date rule

- Replace `deal_payments_release_from_on_hold` with
  `deal_payments_settle_to_paid_in_full()` (drop old trigger/fn, create new): on a
  payment becoming `paid`, if the deal is in **`on_hold` OR `awaiting_payment`** and
  has **no remaining "owes now"** payment (Decision 1 predicate), move it to
  `paid_in_full`. The existing `deals_hold_jobs_on_stage_change` trigger still
  releases the `account_on_hold` job holds on that stage change.

### D. Correct the live data (one-time, in-migration)

- Backup table `deals_due_date_resweep_backup_20260623` snapshotting each of the 39
  deals in `deals_onhold_sweep_backup_20260623` with its current stage.
- Re-evaluate those 39 on the due-date rule:
  - **owes now** (Decision 1) → `on_hold` (the hold trigger re-freezes SEO jobs);
  - else a recurring **pre-due** pending payment exists (`start_date >
    current_date`, created in the 7-day window) → `awaiting_payment`;
  - else → leave in `paid_in_full`.
- Belt-and-braces: for deals moved to `on_hold`, the stage change re-blocks SEO
  jobs via the trigger; assert blocked counts after.
- Going forward, tonight's 02:05 cron (now due-date-based) catches any others; no
  other deals were mis-moved yet (the cron hasn't run since this morning's deploy).

## Out of scope (YAGNI)

- One-time project-fee due-date semantics (unchanged: `end_date`).
- Email reminder timing/content (sending is paused; when it resumes, verify the −7d
  reminder keys off the due date — separate task).
- The v1→v2 recurring-amount cron swap ([[reference-recurring-payments]] — still
  don't swap).
- Renaming the Paid In Full column.

## Testing (TDD, small commits per task)

- `mark_overdue_payments`: recurring `pending` with `start_date <= today` → overdue;
  `start_date > today` → stays pending; one-time still keyed on `end_date`.
- `move_overdue_deals_to_on_hold`: recurring deal past due date → On Hold; pre-due →
  not; `done`/`closed` → never.
- `deal_payments_move_to_awaiting`: completed recurring deal in `paid_in_full` + new
  payment insert → `awaiting_payment`; deal in `on_hold` + new payment → stays
  `on_hold`; existing pre-completion onboarding behavior preserved; terminal
  untouched.
- `deal_payments_settle_to_paid_in_full`: pay from `on_hold` → `paid_in_full` + SEO
  unlocked; pay from `awaiting_payment` → `paid_in_full`; still owing an earlier
  month → stays.
- Data correction: ECODIN + the ~28 → `on_hold` with SEO re-frozen; genuinely
  paid-up stay `paid_in_full`; backup table populated.
- Non-destructive prod check: a `DO` block that flips a paid-up-looking deal's due
  payment and asserts the resulting stage, then `RAISE`s to roll back.

## Changes / Revert

- **Migration** `20260623150000_recurring_due_date_lifecycle.sql` (one file):
  1. `mark_overdue_payments()` — due-date basis.
  2. `move_overdue_deals_to_on_hold()` — due-date basis.
  3. `deal_payments_move_to_awaiting()` — handle completed recurring, On-Hold guard.
  4. drop `deal_payments_release_from_on_hold` → add
     `deal_payments_settle_to_paid_in_full()` (On Hold + Awaiting, due-date rule).
  5. data correction + `deals_due_date_resweep_backup_20260623`.
- **In-file ROLLBACK:** restore each function body from its prior migration
  (`mark_overdue_payments` ← `20260610000005`; `move_overdue_deals_to_on_hold` &
  `deal_payments_release_from_on_hold` ← `20260623140000`;
  `deal_payments_move_to_awaiting` ← `20260503000021`, which carries the `'new'`-stage
  guard); restore each corrected deal's stage from
  `deals_due_date_resweep_backup_20260623` (the hold trigger re-syncs jobs).
- **No frontend change** in this spec (the drag RPC `accounting_mark_paid_in_full`
  is unaffected). Atomic commit; revert = the rollback block.
