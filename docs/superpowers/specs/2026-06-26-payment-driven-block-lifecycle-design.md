# Payment-driven block & On-Hold lifecycle — Design

**Date:** 2026-06-26
**Status:** Draft for review (no implementation yet)

## Problem

The block/On-Hold automation is structurally sound but has three weaknesses:
1. **Timing is inconsistent** — reminders use the payment **due date** (`start_date`), but auto-hold and auto-release use the **period-end date** (`end_date`), ~a month later for monthly clients.
2. **State drifts** — block state is set by one-time events with nothing re-asserting it, so a missed event (e.g. a data import) leaves stale state (found: deal 000403 stuck On-Hold while fully paid; 46 "blocked" client labels with 0 enforcement rows).
3. **Scope** — On-Hold currently blocks only SEO jobs; the desired rule is "block everything except the website and hosting".

## Goal

A single, self-correcting lifecycle driven by the payment **due date**, that is "100% correct" because the system **re-asserts** the right state nightly rather than relying solely on events.

## Hard constraints (non-negotiable)

- **NEVER modify payment dates.** All logic only **reads** `deal_payments.start_date` / `end_date` (the dates accounting entered). It never writes, recomputes, or overwrites them. Existing recurring-payment generation is left exactly as-is.
- Reversible: every change ships as a migration with rollback; one-time data reconciliation has a backup table.

## The model

**Single source of truth = the deal's accounting stage.** "Blocked" is *defined as* the deal being in a blocked stage — never a separate flag that can drift.

| Concept | Definition |
| --- | --- |
| **Blocked stages** | `on_hold`, `partial_payment` |
| **Resting/active stages** | `paid_in_full`, `awaiting_payment`, `new`, `documents_verified`, `invoice_issued` |
| **Terminal (never auto-touched)** | `done`, `closed` |
| **Due date** | the unpaid payment's `start_date` (the date reminders already use) |
| **Next due** | the *earliest* unpaid payment's `start_date` for the deal |

### Stage transitions

**A. Toward On-Hold — automatic, nightly, due-date driven.** For every deal **not** in `done`/`closed` that **has at least one payment with a due date** (Q1: "only once billing exists"):
- `next_due ≤ today` and unpaid → move to **`on_hold`**.
- `today < next_due ≤ today + 7` → move to **`awaiting_payment`**.
- The nightly mover only *moves* deals that are in the managed set `{awaiting_payment, on_hold, paid_in_full}`; it never yanks a deal out of `new`/`documents_verified`/`invoice_issued`/`partial_payment` (those stay accounting-driven). Deals with no payment/due date are never touched.

**B. Toward release — when accounting confirms payment.** When the deal enters **`paid_in_full`** (accounting marks the due payment paid / moves the deal there):
- **Unblock** all the deal's jobs.
- **Move** the unblocked jobs to their renewal lane: web_seo/local_seo (incl. AI SEO children) → **`renewal`**; social_media/ads → **`active`**. web_dev + hosting untouched (never blocked).
- Set the client status back to **`active`**.

> Robustness note (flagged for review): to prevent stuck states like 000403, I recommend release **auto-fires the moment accounting marks the last due payment `paid`** (auto-advancing the deal to `paid_in_full`), since "accounting processes the payment" is the human money-confirmation step. The unblock+renewal logic runs on the `paid_in_full` transition regardless of whether it was reached manually or auto-advanced.

### Job blocking rules

When a deal is in a **blocked stage** (`on_hold` / `partial_payment`), block all its **open** jobs (non-archived, non-terminal stage) **except**:
- **web_dev** (the website) — never blocked.
- **hosting** — never blocked.
- **ai_seo billing parents** — billing-only records with no work board; nothing to block (the real AI SEO work is their web_seo/local_seo children, which **are** blocked).

So the blocked set = open `web_seo`, `local_seo`, `social_media`, `ads` jobs of that deal (per-deal, Q2: per-deal not per-client). Blocking sets `is_blocked=true, blocked_reason='account_on_hold'`. "Blocking" pauses *our work*; it does **not** take a website offline or stop a hosting server.

### Client status linkage

- Deal enters a blocked stage → set `clients.status='blocked'` (the red label finally means something).
- Deal enters `paid_in_full` → set `clients.status='active'`.
- This keeps the label consistent automatically (fixes the 46-vs-0 drift). The separate hard `client_blocks` ledger is left untouched (still admin-only, unused).

### The nightly reconciler (what makes it "100% correct")

A single nightly job that, for every deal **not** in `done`/`closed`:
1. Applies the stage transitions (A) above.
2. **Re-asserts job-block flags to match the deal's stage** — blocked stage ⇒ all eligible jobs blocked; non-blocked stage ⇒ all `account_on_hold` blocks cleared. (It only heals the **flag**; it does **not** re-move job stages — the Renewal/Active move happens once, on the release event, so accounting/SEO can move jobs freely afterward.)

Because the flag is re-asserted every night, any drift (manual edit, import, missed event) self-heals within 24h. Events still fire for instant response; the reconciler is the safety net.

## One-time reconciliation (clean slate)

On rollout, for every deal **except** `done`/`closed`:
- Place it in the correct category by its current payment state (using the due-date rules above) — fixes stuck states (000403 → `paid_in_full`; the 27 "owing current period" → correctly `on_hold`; etc.).
- Re-assert job-block flags to match.
- Backup affected deals/jobs to `*_block_lifecycle_backup_20260626` before changing anything.

## Scope / exclusions

- **Excluded entirely:** deals in `done` or `closed`; deals with no payment/due date; web_dev and hosting jobs (never blocked); ai_seo billing parents.
- **Boards affected by the unblock move:** web_seo, local_seo (→ renewal), social_media, ads (→ active).
- UI: extend the "Blocked" indicator to the social_media + ads boards (today only web_seo/local_seo show a Blocked column), so blocked work is visible everywhere it can occur.

## Replaces / removes

- `move_overdue_deals_to_on_hold()` (end_date-based cron) → replaced by the new due-date nightly reconciler.
- `deals_hold_jobs_on_stage_change()` (SEO-only hold) → rewritten for the new scope (all except web_dev/hosting) + Renewal/Active move + client-status linkage.
- `deal_payments_release_from_on_hold()` (end_date-based) → re-based on due date / folded into the release event.

## Decisions still open (confirm at spec review)

1. **Release trigger:** auto-advance to `paid_in_full` the moment the last due payment is marked `paid` (recommended, robust) **vs.** only when accounting manually moves the deal there. *(Either way the unblock+renewal runs on the `paid_in_full` transition.)*
2. **`partial_payment`:** treat as a blocked stage that stays blocked until `paid_in_full` (per decision 5). Confirm the nightly mover should leave `partial_payment` for accounting (not auto-move it).
3. **One-time reconciliation** may auto-move some currently-paid On-Hold deals to `paid_in_full` (clean slate). Confirm that's wanted, or whether those should be left for accounting to release manually.

## Testing

- **Pure date logic** (TDD): a function `target_stage(next_due, today)` → `on_hold | awaiting_payment | paid_in_full | none`, fully unit-tested for boundaries (−8d, −7d, −1d, due day, overdue).
- **Trigger/reconciler**: rolled-back transaction tests asserting block/unblock + stage moves for each service type, and that web_dev/hosting are never blocked.
- **Date safety**: a test asserting no `deal_payments.start_date`/`end_date` is ever written by the new code paths.

## Changes / Revert

| Change | Revert |
| --- | --- |
| New nightly reconciler function + cron | drop cron + function; re-enable `move_overdue_deals_to_on_hold` cron |
| Rewritten `deals_hold_jobs_on_stage_change` (scope + renewal move + client status) | restore prior version (migration `20260618000014`) |
| Release re-based on due date | restore `deal_payments_release_from_on_hold` from `20260623140000` |
| UI: Blocked column on social/ads boards | revert commit |
| One-time data reconciliation | restore from `*_block_lifecycle_backup_20260626` |

All payment dates remain exactly as accounting entered them — no date is ever written by this work.
