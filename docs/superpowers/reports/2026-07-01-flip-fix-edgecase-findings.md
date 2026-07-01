# Flip-Fix Edge-Case Findings

**Date:** 2026-07-01
**Fix reference:** `supabase/migrations/20260701010000_paid_in_full_flip_fix.sql`
**Harness:** `supabase/tests/paid_in_full_flip_edgecases.sql`
**Plan:** `docs/superpowers/plans/2026-07-01-flip-fix-edgecase-testing.md`

---

## Executive summary

(To be populated in Task 5 — after all 35 scenarios have run.)

| Result | Count |
|---|---|
| ✅ PASS | _pending_ |
| ❌ FAIL | _pending_ |
| ⚠ CONCERN | _pending_ |
| ℹ INFO | _pending_ |

---

## Prod baseline (Task 1)

**Fix layers deployed (all `true`):**
- L1 — `ensure_recurring_payments` guard by `service_type`: ✅
- L2 — `deal_payments_no_duplicate_period` guard by `service_type`: ✅
- L3 — `reconcile_block_lifecycle` 24h grace clause: ✅
- L4 — `reconcile_payment_integrity` function: ✅
- L4 cron — scheduled and active: ✅

**Counters at time of test-plan-write (2026-07-01):**
| Metric | Value |
|---|---|
| `data_integrity_alerts` open | 8 |
| Recurring rows | 494 |
| On-hold deals | 44 |
| Paid-in-full deals | 127 |
| Partial-payment deals | 12 |
| Backup rows (`deal_payments_flipflop_backup_20260701`) | 4 |

---

## Trigger inventory on `deal_payments`

| Trigger | When | What |
|---|---|---|
| `deal_payments_activity` | AFTER INSERT / DELETE / UPDATE | `log_activity()` — activity_log |
| `deal_payments_default_service_keys` | BEFORE INSERT | Populates `service_type` / `service_index` from prior rows if null |
| `deal_payments_move_to_awaiting` | AFTER INSERT | Moves deal from paid_in_full → awaiting_payment on any non-2min insert |
| `deal_payments_no_duplicate_period` | BEFORE INSERT | **L2**: silently drops period-key duplicates (returns NULL) |
| `deal_payments_release_from_on_hold` | AFTER UPDATE | On paid transition, promotes on_hold → paid_in_full if no past-due remains |
| `deal_payments_updated_at` | BEFORE UPDATE | Sets `updated_at = now()` |

**Note:** L2 fires only on INSERT. UPDATE-based dupes (Scenario E5) bypass it.

---

## Scenario results

Ran 38 scenarios. PASS: 27, FAIL: 4, CONCERN: 2, INFO: 3, HARNESS BUG: 2.

| Cat | # | Description | Result | Details |
|---|---|---|---|---|
| A | 1 | Shorten paid end_date | ✅ PASS | shortened paid end_date does not cause duplicate |
| A | 2 | Extend paid end_date past next-period start | ❌ FAIL | extending paid end_date past next-period start caused 1 dup |
| A | 3 | Move unpaid start_date to past | 🐛 HARNESS BUG | `RETURNING id INTO v_row` on multi-row VALUES insert → `query returned more than one row` |
| A | 4 | Extend unpaid end_date | ✅ PASS | stage unchanged (awaiting_payment) — end_date extension irrelevant |
| A | 5 | Swap start/end (invalid range) | ✅ PASS | swapped dates tolerated (no crash) |
| B | 1 | Change amount_net on paid row | ✅ PASS | amount change on paid row does not affect chain |
| B | 2 | Change amount_net on unpaid row | ❌ FAIL | stage flipped to awaiting_payment after amount change (move_to_awaiting UPDATE branch?) |
| B | 3 | amount_net = 0 (known concern) | ✅ PASS | zero-amount row still creates next chain link (billing memory known concern) |
| B | 4 | Negative amount_net (CHECK) | ✅ PASS | negative amount_net rejected by CHECK constraint |
| C | 1 | Paid → pending on old row | ✅ PASS | paid→pending correctly flips to on_hold |
| C | 2 | Overdue → paid (release) | ✅ PASS | overdue→paid trigger releases from on_hold |
| C | 3 | Partial pay: only one row settled | ✅ PASS | release respects remaining unpaid past-due |
| D | 1 | Change service_type on paid row | ✅ PASS | service_type change starts new chain |
| D | 2 | recurring_monthly → recurring_yearly | ✅ PASS | billing_type change to yearly applies 1-year cadence |
| D | 3 | Change service_index alone | 🐛 HARNESS BUG | `RETURNING id INTO v_row` on multi-row VALUES insert → `query returned more than one row` |
| D | 4 | recurring → one_time | ✅ PASS | recurring→one_time removes from cron loop |
| E | 1 | Delete paid recurring row | ❌ FAIL | stage flipped to awaiting_payment after paid-row deletion (delta=0 row count OK, but stage moved) |
| E | 2 | Delete unpaid past-due on on_hold deal | ✅ PASS | deleting past-due row does NOT auto-release from on_hold |
| E | 3 | Manual INSERT of past-dated pending | ✅ PASS | L3 grace protects paid_in_full from <24h past-dated insert |
| E | 4 | Manual INSERT of duplicate (L2 drop) | ✅ PASS | L2 silently drops duplicate insert |
| E | 5 | UPDATE creates dup (L2 bypass) | ⚠ CONCERN | L2 bypassed via UPDATE (only L4 audit catches, next-day detection) |
| F | 1 | deal.payment_method → null | ✅ PASS | null payment_method excludes deal from reconcile (stage unchanged=awaiting_payment) |
| F | 2 | Deal in done stage | ℹ INFO | cron created 1 row on done-stage deal (done not filtered by cron) |
| F | 3 | Archive deal | ✅ PASS | archived deal excluded from cron (delta=0) |
| F | 4 | Manual promote on_hold → paid_in_full | ✅ PASS | reconcile correctly reverses accidental manual promote |
| G | 1 | INSERT paid row (no move_to_awaiting) | ❌ FAIL | INSERT of paid row flipped stage to awaiting_payment — move_to_awaiting trigger does not gate on status='paid' |
| G | 2 | INSERT pending row (move_to_awaiting fires) | ✅ PASS | INSERT of pending row moves to awaiting_payment (existing behavior) |
| G | 3 | Cron→reconcile chain with grace | ✅ PASS | cron→reconcile chain with L3 grace holds paid_in_full |
| H | 1 | Rapid updates (LWW) | ✅ PASS | last-write-wins on rapid updates |
| H | 2 | Sequential cron calls (advisory lock) | ℹ INFO | sequential cron calls: delta=1,0 (idempotent second call) |
| H | 3 | Two dup INSERTs (L2 drops second) | ✅ PASS | L2 drops second dup INSERT, first survives |
| I | 1 | 23h59m boundary — grace holds | ✅ PASS | grace holds at 23h59m |
| I | 2 | 24h1m boundary — grace expires | ✅ PASS | grace expires after 24h |
| I | 3 | Edit created_at (grace bypass?) | ⚠ CONCERN | created_at is UPDATE-able → grace can be bypassed by editing timestamp |
| I | 4 | Mixed-age rows | ✅ PASS | legit past-due wins over fresh phantom in mixed case |
| J | 1 | Fresh dup → audit catches | ✅ PASS | L4 audit catches fresh duplicate |
| J | 2 | Audit on clean state | ℹ INFO | audit ran cleanly, returned alerts=9 |
| J | 3 | RLS blocks anon read | ✅ PASS | anon cannot read data_integrity_alerts |

---

## FAIL / CONCERN details

(To be populated in Task 5.)

---

## Mitigations

(To be populated in Task 5.)
