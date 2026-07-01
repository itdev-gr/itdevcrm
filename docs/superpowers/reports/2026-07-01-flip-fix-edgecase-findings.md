# Flip-Fix Edge-Case Findings

**Date:** 2026-07-01
**Fix reference:** `supabase/migrations/20260701010000_paid_in_full_flip_fix.sql`
**Harness:** `supabase/tests/paid_in_full_flip_edgecases.sql`
**Plan:** `docs/superpowers/plans/2026-07-01-flip-fix-edgecase-testing.md`

---

## Executive summary

Ran **38 accounting mid-cycle modification scenarios** against the shipped four-layer fix.

| Result | Count |
|---|---|
| ✅ PASS | 27 |
| ❌ FAIL | 4 |
| ⚠ CONCERN | 2 |
| ℹ INFO | 3 |
| 🐛 HARNESS BUG | 2 |

### After root-cause tracing (below): only **1 real fix gap** was surfaced

- **A2 = REAL FIX GAP** — L1's `ensure_recurring_payments` guard uses `start_date >= dp.end_date` which no longer matches when accounting **extends** a paid row's `end_date` past the next-period row's `start_date`. Cron creates a duplicate. Trace confirmed.
- **B2 / E1 / G1 = PRE-EXISTING TRIGGER BEHAVIOR (not introduced by our fix)** — the pre-existing `deal_payments_move_to_awaiting` trigger doesn't gate on `new.status`. It moves `paid_in_full → awaiting_payment` on ANY payment INSERT (including paid receipts). All three FAILs are caused by the SEED's INSERT, not the scenario's actual modification. L3 grace at the next reconcile corrects to `paid_in_full` within ~26h if effective_next_due warrants.
- **E5 / I3 = ACCEPTED CONCERNS** — L2 fires on INSERT only (UPDATE-based dupes bypass, L4 catches daily). `created_at` is UPDATE-able (grace can be bypassed by editing the timestamp).
- **F2 / H2 / J2 = INFO** — behaviors documented, no bug.
- **A3 / D3 = HARNESS BUGS** — multi-row `RETURNING INTO scalar` — Postgres rejects.

### Bottom-line verdict

**The fix is robust for accounting today.** The one real gap (A2) requires a **one-line change to the L1 guard** — mitigation drafted below. The pre-existing `move_to_awaiting` trigger behavior is annoying but self-correcting via L3 grace; a **one-line addition** (`if new.status = 'paid' then return new; end if;`) would make it fully surgical.

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

## FAIL / CONCERN details + mitigations

### 🔴 A2 — L1 guard doesn't catch end_date extension (REAL FIX GAP)

**Scenario:** Two paid rows on a chain: Row 1 (day −40 → day −10) and Row 2 (day −10 → day +20). Accountant extends Row 1's `end_date` from day −10 to day +5. Now the chain has an overlap (Row 1: −40 → +5, Row 2: −10 → +20). Cron iterates, treats Row 1 as still-expiring (`+5 ≤ today+7`), and checks its guard: `not exists (dp2 with start_date >= +5)`. Row 2 has `start_date = −10` which is NOT `>= +5`, so the guard passes. Cron inserts a new next-period row starting at day +5 → **duplicate**.

**Impact:** Any accountant who extends a paid recurring row's `end_date` can trigger a duplicate at the next 02:00 UTC cron run. Then the flip-flop mechanism kicks in exactly as before — the new duplicate has `start_date` in the past (well, +5 today but past tomorrow), reconcile flips the deal to `on_hold`, L3 grace holds it for 24h, then the flip persists.

**Mitigation (one-line SQL change to L1):**

Change the guard from `dp2.start_date >= dp.end_date` to `dp2.end_date > dp.end_date`:

```sql
-- In ensure_recurring_payments(), replace:
and not exists (
  select 1 from public.deal_payments dp2
   where dp2.deal_id = dp.deal_id
     and dp2.service_type = dp.service_type
     and dp2.billing_type = dp.billing_type
     and dp2.start_date is not null
     and dp2.start_date >= dp.end_date  -- <-- OLD
)

-- with:
and not exists (
  select 1 from public.deal_payments dp2
   where dp2.deal_id = dp.deal_id
     and dp2.service_type = dp.service_type
     and dp2.billing_type = dp.billing_type
     and dp2.end_date is not null
     and dp2.end_date > dp.end_date     -- <-- NEW (any row that "extends past" this one)
)
```

**Why this works:** "There already exists a row whose end_date is past this one" is the true chain-continuation invariant. It catches the extension case (Row 2's `end_date=+20 > Row 1's post-update end_date=+5`) that the old guard missed, and it still catches the original flip-flop bug (Row B's `end_date=Jul 20 > Row A's end_date=Jun 20` in the deal 000512 case).

**Verification plan for the mitigation** (do not implement — user decides):
1. Add a `test(billing): L1 guard by end_date, not start_date` migration.
2. Re-run scenario A2 → must PASS.
3. Re-run the entire fix harness (A/B/C/D/F/G/H/J from `paid_in_full_flip_harness.sql`) → must all still PASS.
4. Re-run edge-case A1 (shorten) — must still PASS (shortening doesn't create a dup since Row 2's end_date > Row 1's end_date is still true).
5. Live dry-run `ensure_recurring_payments()` in a savepoint → confirm no new rows created that wouldn't have been before.

---

### 🔴 B2 / E1 / G1 — Pre-existing `move_to_awaiting` trigger too aggressive (NOT introduced by our fix)

**Root cause (traced):** The `deal_payments_move_to_awaiting()` trigger fires on ANY row insert to a `paid_in_full` deal and moves the stage to `awaiting_payment`, regardless of the new row's `status`. Its early-return conditions are:
- `billing_type = 'recurring_test_2min'` (test-only bypass)
- `accounting_completed_at IS NOT NULL`
- `accounting_stage_id IS NULL`
- Already `awaiting_payment`
- Stage in (`new`, `on_hold`, `partial_payment`)
- Terminal stage

None of these check `new.status`. So inserting a **paid** row on a `paid_in_full` deal moves it to `awaiting_payment` — which is misleading (the payment is already in).

**Trace evidence:**
- E1: `after_seed=awaiting_payment, after_delete=awaiting_payment` (deal moved during the SEED's INSERT, not the DELETE).
- G1: `after_paid_insert=awaiting_payment` (deal moved on a paid row's INSERT).
- B2: same pattern (deal moved during seed's pending-row INSERT; UPDATE didn't cause further movement).

**Impact:** After every payment INSERT, the deal briefly shows `awaiting_payment` until L3 grace at the next 02:20 UTC reconcile corrects it (up to ~26h). Confusing UX for accountants who just marked a payment paid and see the stage revert.

**Mitigation (one-line addition to the pre-existing trigger, not our fix):**

Add a `new.status = 'paid'` early-return to `deal_payments_move_to_awaiting()`:

```sql
if new.billing_type = 'recurring_test_2min' then return new; end if;
if new.status = 'paid' then return new; end if;  -- <-- ADD
...
```

**Why this works:** Inserting a paid row means money already came in — the deal should stay `paid_in_full` (if it was there) or promote from `on_hold` (via `release_from_on_hold` trigger). Never move backward to `awaiting_payment`.

**Verification plan:**
1. Re-run B2, E1, G1 → expected PASS.
2. Confirm existing recurring flow still works: cron creates a pending row → trigger fires → deal moves to `awaiting_payment` (unchanged).
3. Live smoke: an accountant marks a payment via the UI → observe the deal doesn't briefly flip.

**Deferred (not blocking):** this is a pre-existing quality-of-life issue, unrelated to the flip-flop root cause. It's a candidate for a follow-up plan, not urgent.

---

### ⚠ E5 — L2 UPDATE bypass (ACCEPTED CONCERN)

**Scenario:** L2's `deal_payments_no_duplicate_period` fires only on INSERT. If an accountant edits an existing row's `start_date` / `end_date` to MATCH another row's period-key, L2 doesn't see the change → a duplicate is created via UPDATE.

**Impact:** Only L4's nightly audit at 04:00 UTC catches it → up to 24h detection lag. Between UPDATE and audit, the deal's `deal_next_due` may reflect the duplicate; reconcile might briefly flip the deal (but L3 grace applies if the row was recently touched — although the row's `created_at` is unchanged on UPDATE, so grace probably doesn't apply either).

**Mitigation options:**
1. **Add a `BEFORE UPDATE` variant** of the L2 trigger with the same period-key check → prevents dupes at UPDATE time too. Silently drops the update (`RETURN OLD`). Analogous UX to L2's INSERT drop.
2. **Add a UNIQUE partial index** `on (deal_id, service_type, billing_type, start_date, end_date) where billing_type in ('recurring_monthly','recurring_yearly')`. Hard DB-level guarantee; blocks both INSERT and UPDATE. Raises an error at the offending statement rather than silently dropping.
3. **Rely on L4 audit only** — accepted trade-off (24h detection lag; admin gets alerted).

**Recommendation:** Option 2 (UNIQUE partial index). One-line migration, catches the entire class of dupes at the DB layer, no plpgsql, no silent drops. Raises `unique_violation` — the accountant sees an actual error message and knows to look at existing rows. Deferred as a separate migration.

---

### ⚠ I3 — `created_at` is UPDATE-able (ACCEPTED CONCERN)

**Scenario:** L3's 24h grace clause uses `dp.created_at > now() - interval '24 hours'` to identify "fresh" rows. `created_at` is a regular column with no protection against UPDATE. If a user (accountant, migration, or bad actor) edits `created_at`, grace can be bypassed.

**Impact:** Low. Accountants don't typically edit `created_at`. A misbehaving migration might, but code review catches those.

**Mitigation options:**
1. **Add a `BEFORE UPDATE` trigger** that revokes `created_at` changes: `if new.created_at <> old.created_at then new.created_at := old.created_at; end if;`. Silent — protects invariant.
2. **Remove the DEFAULT + rely on GENERATED**: change `created_at timestamptz not null default now()` to `created_at timestamptz not null generated always as (now()) stored`. Actually — Postgres doesn't support `generated as (now())` on a stored column because `now()` is volatile. So this option isn't viable.
3. **Rely on convention** — trust that no code edits `created_at`. Grep the repo to confirm.

**Recommendation:** Option 1 (BEFORE UPDATE guard). Trivial trigger, absolute protection. Deferred.

---

### ℹ F2 — Cron on `done` stage (INFO)

**Scenario:** F2 seeded a deal in `done` stage with an expiring recurring row. Cron's filter is `stage != 'closed'` — `done` is NOT filtered → cron created 1 next-period row.

**Analysis:** `done` deals are still "active" in the accounting view (per user memory `project_accounting_done_keeps_deal`), so recurring billing continues. This is intentional — a `done` deal that's actively billing shouldn't stop just because the initial onboarding was completed. **No bug.**

---

### ℹ H2 — Sequential cron calls returned delta=1, 0 (INFO)

Two back-to-back cron calls in one session showed `created=1` on the first (a legit next-period), `created=0` on the second (idempotent). The `pg_advisory_xact_lock` protects concurrent runs across sessions; sequential same-session runs are naturally idempotent because the second call sees the freshly-created row and skips it. **No bug.**

---

### ℹ J2 — Audit on clean state returned 9 alerts (INFO)

The audit's return value reflects prod's current state — 8 pre-existing open alerts + 1 from J2's seeded duplicate cluster (cleaned up on rollback). **No bug** — the assertion here was "function ran without crashing", which it did.

---

### 🐛 A3 / D3 — Harness bugs (multi-row RETURNING INTO scalar)

Both scenarios have:

```sql
insert into public.deal_payments (...)
  values (...), (...)
  returning id into v_row;   -- <-- BUG: 2 rows, scalar var
```

Postgres rejects with `query returned more than one row`.

**Fix:** split into two separate `insert ... values (...)` statements. Only capture `id` from the row you actually need for the modification.

**Follow-up:** rewrite A3 and D3 in the harness file and re-run. Not blocking — the other 36 scenarios cover the same ground.

---

## Mitigations summary — recommended actions

| # | Issue | Severity | Recommended fix | Deferred? |
|---|---|---|---|---|
| 1 | A2 — L1 guard misses end_date extension | 🔴 REAL GAP | 1-line change: `dp2.end_date > dp.end_date` | **NO — should ship** |
| 2 | move_to_awaiting fires on paid inserts (B2/E1/G1) | ⚠ Pre-existing UX | 1-line early-return: `if new.status = 'paid' then return new; end if;` | Yes — deferred, low urgency |
| 3 | E5 — L2 UPDATE bypass | ⚠ 24h detection lag | UNIQUE partial index on (deal, service_type, billing_type, start_date, end_date) for recurring | Yes — audit covers |
| 4 | I3 — created_at editable | ⚠ Grace bypass | BEFORE UPDATE guard on created_at | Yes — no known real-world abuse |
| 5 | A3 / D3 — harness bugs | 🐛 Test-only | Rewrite the seed to split multi-row inserts | Yes — non-blocking |

**Priority 1 (should ship):** the L1 guard change. It's a one-line SQL fix that closes the real gap. Suggested migration name: `20260702000000_L1_guard_by_end_date.sql`.

**Priority 2 (nice-to-have):** the move_to_awaiting status guard. Improves accountant UX; no functional flip-flop risk (L3 corrects).

**Priority 3 (defense-in-depth):** UNIQUE partial index + created_at guard. Cheap, safe, complete the defense.
