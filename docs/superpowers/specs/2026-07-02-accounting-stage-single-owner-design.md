# Accounting Stage — Single-Owner Simplification — Design Spec

**Date:** 2026-07-02
**Status:** Approved (brainstorming) — pending implementation plan
**Audit it fixes:** `docs/system-analysis/2026-07-02-accounting-processes-map-and-overlap-audit.md`

## Goal

The deal's `accounting_stage` is written by **three independent mechanisms** that fight each other (proven live: a `paid_in_full` deal flips to `awaiting_payment` the instant one pending charge is inserted). Every complex thing shipped recently — the 24h grace, the 4-layer flip fix, the reminder stage-lock quirks — is a **referee** for that fight.

Replace the fight with **one rule** that keys off the charge **due date** (never its creation), so the referees can retire. **Guiding principle (from the product owner):** *the accountant owns the columns; the system assists, it never overwrites.*

## The single rule

For a deal **currently in a payment-cycle column** (`awaiting_payment` / `on_hold` / `paid_in_full`), one function looks at its **earliest unpaid charge** (`deal_payments.status in ('pending','overdue')`, not `cancelled`, has a `start_date` = due date) and sets:

| Earliest unpaid charge | Column |
|---|---|
| **past due** (`due_date < today`) | **On Hold** (+ block jobs) |
| **due within 7 days** (`today ≤ due_date ≤ today+7`) | **Awaiting Payment** |
| none unpaid, or next due > today+7 | **Paid In Full** |

Keying off `due_date` (not creation) is the whole fix: a brand-new charge dated 30 days out leaves the deal in **Paid In Full**; it only moves once the charge is genuinely due. Using `< today` (strictly past) for On Hold means a charge **due today** shows as Awaiting, not On Hold — so **no 24h grace is needed.**

**Boundary — what the rule does NOT touch:** deals in `new` / `documents_verified` / `invoice_issued` / `partial_payment` / `done` / `closed`. Those are **100% the accountant's** ("we don't play with those"). The accountant moves a deal *into* the payment cycle (→ awaiting_payment when they invoice); from then on the system manages awaiting ↔ on_hold ↔ paid_in_full. This preserves **Fully Paid → Awaiting** when the next cycle's charge comes due.

## One writer, called two ways

The rule lives in **one function** (`reconcile_deal_stage(deal_id)` — the stage-moving core of today's `reconcile_block_lifecycle`, stripped of the grace and boundary-fixed). It runs:
- **On payment change** — a new `deal_payments` AFTER INSERT/UPDATE/DELETE trigger calls it for that deal → the board updates instantly (replacing `move_to_awaiting` + `release_from_on_hold`).
- **Nightly sweep** — `reconcile_block_lifecycle` iterates all deals calling the same function (safety net).

Because both paths run the *same* logic, they cannot disagree. Instant feedback, no fight.

## What is REMOVED / RETIRED (stage-conflict referees only)

- **Trigger `deal_payments_move_to_awaiting`** — deleted (the on-creation flipper; root of the bug).
- **Trigger `deal_payments_release_from_on_hold`** — deleted (subsumed: the rule promotes on_hold→paid_in_full when nothing is due).
- **The 24h grace (L3)** — removed from the reconcile (unnecessary once the rule keys off due date + uses `< today`).
- **The flip-fix *stage* layer** and the reminder stage-lock's dependence on grace — simplified accordingly.

## What STAYS (do NOT remove — orthogonal to stage-moving)

- **Billing-integrity guards — KEEP ALL:** `deal_payments_no_duplicate_period` (L2), the `ensure_recurring_payments` end_date/null-safe guards + no-legacy-fallback (L1/S1/S2/S6), the UNIQUE recurring period-key index (S4), `created_at` immutable (S5). These prevent **double-charging**, a different concern; removing them reintroduces duplicate charges.
- **`deals_hold_jobs_on_stage_change`** (job release/block on the accountant's Fully-Paid / On-Hold / Closed moves) — unchanged; still reacts to stage changes.
- **`deals_release_jobs_on_partial_payment`, `deals_close_jobs_on_close`, `deals_sync_client_status`, `guard_payment_method`** — unchanged.
- **Reminders** — unchanged (the stage-lock stays valid, since the columns are now reliably managed): due_soon from Awaiting, overdue/final from On Hold; never emails `done` clients.
- **Recurring billing cron** (`ensure_recurring_payments`), **`mark_overdue_payments`**, **integrity audit** (`reconcile_payment_integrity`, now a passive monitor) — unchanged.
- **The reminder no-backdated / paid_at / closed-client guards** — unchanged.

## Data flow (after)

```
payment recorded / created / marked overdue
  └─> deal_payments trigger → reconcile_deal_stage(deal)   [instant]
        └─> due-date rule → sets awaiting / on_hold / paid_in_full (payment-cycle deals only)
              └─> deals_hold_jobs_on_stage_change reacts (block on on_hold, release on paid_in_full)
nightly 02:20 → reconcile_block_lifecycle → reconcile_deal_stage(every payment-cycle deal)  [sweep]
accountant drags a card → their placement stands; job-reaction triggers fire as today
```

## Testing

- **Regression harness (the safety net):** re-run the existing `paid_in_full_flip_*` + `payments_accounting_full_smoke` + `enqueue_payment_reminders` harnesses (100+ scenarios) after each step. The flip scenarios should now pass by **construction** (no flip), not by grace. Scenarios that asserted grace behavior get rewritten to assert the new rule.
- **New scenarios (RAISE-harness, savepoint-rollback via the mgmt API):**
  - paid_in_full + insert a future-dated charge (due +30) → stays **paid_in_full** (the old bug; now correct with no grace).
  - paid_in_full + a charge becomes due within 7d → **awaiting_payment** (Fully Paid → Awaiting kept).
  - awaiting + charge goes past due → **on_hold** + jobs blocked.
  - on_hold + client pays all → **paid_in_full** (release_from_on_hold subsumed).
  - charge **due today** → **awaiting_payment**, not on_hold (no grace needed).
  - deal in `documents_verified`/`invoice_issued`/`partial_payment`/`done`/`closed` + payment change → **untouched**.
  - a paid charge is NOT double-created (dedup guards still hold).
- **Live dry-run** of the nightly sweep (rolled back) before/after: confirm the number of stage moves is sane and no deal churns.

## Changes / Revert

- Migration(s) apply `create or replace reconcile_deal_stage` + the new `deal_payments` reconcile trigger; `drop trigger` the two removed movers; `create or replace reconcile_block_lifecycle` without the grace. Each with a commented, verbatim revert block restoring the prior bodies/triggers (captured live via `pg_get_functiondef`).
- Sequence so the harness stays green between steps; nothing removed until its replacement is in place. Push to `main`, atomic commits.

## Out of scope

- Billing-integrity / dedup logic (kept as-is).
- Job creation timing (SEO at Fully Paid, web_dev/hosting at Partial — unchanged; that was confirmed correct earlier today).
- The email-status badge, the stage-lock reminder content, the closed-client guard.

## Risks & mitigations

- **Removing safety layers on a live billing system** — mitigated by: keep all billing-integrity guards; sequence changes with the 100+-scenario harness green between each; live rolled-back dry-runs; per-step commits with verbatim revert SQL.
- **Boundary correctness** (`< today` vs `<= today`) — covered by explicit "due today → awaiting" test.
- **A deal the accountant parked in Fully Paid with a still-unpaid overdue charge** would be moved to On Hold by the rule. That's intended ((a): reality changed). If the accountant truly settled it, the charge should be marked paid — noted for the team; not a code special-case.

## Open questions

None — model (accountant owns columns; one due-date rule for awaiting/on_hold/paid_in_full; keep Fully Paid→Awaiting; never touch Done/Closed; keep billing-integrity guards; reminders unchanged) confirmed with the product owner 2026-07-02.
