# Payments & Accounting Full Smoke Report

**Date:** 2026-07-01
**Plan:** `docs/superpowers/plans/2026-07-01-payments-accounting-full-smoke.md`
**Harness:** `supabase/tests/payments_accounting_full_smoke.sql`
**Fix reference:** `supabase/migrations/20260701010000_paid_in_full_flip_fix.sql`

---

## Executive summary

Ran **56 accounting + payments scenarios** covering the full state-machine surface. Combined with the prior fix-harness (10) + edge-case harness (38), total coverage is **104 scenarios**.

| Result | Count |
|---|---|
| ✅ PASS | 52 |
| ❌ FAIL | 2 |
| ⚠ CONCERN | 0 |
| ℹ INFO | 2 |
| 🐛 HARNESS BUG | 0 |

### After root-cause tracing

- **F3 = HARNESS ASSUMPTION ERROR** (not a fix bug). The `deal_payments_release_from_on_hold` trigger's guard is `cur_code not in ('on_hold','partial_payment')` — it explicitly INCLUDES `partial_payment`. Paying the last unpaid row on a partial_payment deal correctly promotes to paid_in_full. The harness assertion "should stay partial_payment" was based on a misread. **No action needed** on the fix; scenario retested and reclassified.
- **D2 = REAL SEMANTIC GAP** (⚠ CONCERN, not fix-critical). Archiving the AI SEO parent job does NOT stop `ensure_recurring_payments` from creating a next-period row. The cron's job-existence guard is `(no non-archived jobs) OR (has billing_active job)` — archiving all `ai_seo` jobs makes the first branch TRUE (legacy-compatibility fallback), so the cron still fires. This means accountant can't stop AI SEO billing by archiving the parent alone; they must delete/cancel the recurring `deal_payments` row directly. **Mitigation drafted below (Priority 2)**.
- **C7 = INFO** — NULL `service_type` on a recurring row: cron's L1 guard uses `dp2.service_type = dp.service_type` which is UNKNOWN when NULL, so the guard doesn't fire and cron creates a duplicate. Rare edge case (rows should have service_type populated); worth documenting but no action.
- **G1 = INFO** — Deal in `new` stage + pending INSERT does NOT auto-move to `awaiting_payment` because `deal_payments_move_to_awaiting` explicitly skips `('new', 'on_hold', 'partial_payment')`. By-design — accountant must manually advance from `new`.

### Bottom-line verdict

**The four-layer flip-fix is holding under 56 additional accounting-side scenarios.** The one real semantic gap (D2 — archive doesn't stop AI SEO billing) is a pre-existing legacy-compatibility fallback in the cron, not a flip-flop cause. Everything else is either PASS, INFO (documented behavior), or a harness assumption error.

### Recommended action items

1. 🟡 **Priority 2 — D2 mitigation:** narrow the cron's job-existence guard to remove the `not exists` legacy fallback (or gate the fallback on `d.created_at < <cutoff>` for pre-jobs-billing deals). Details in the mitigations section.
2. ℹ **Priority 3 — C7 hardening:** consider `service_type IS NOT NULL` guard on cron's outer loop OR add a CHECK constraint to prevent NULL service_type on new recurring rows. Rare edge case.
3. 🎯 **Combined follow-up plan:** items above + the earlier A2 (L1 end_date extension) + move_to_awaiting status-guard + L2 UPDATE bypass + created_at editability form a single Priority-2/3 mitigation batch. All are one-line SQL changes.

---

## Inventory (Task 1)

### Fix layers deployed

- L1 `ensure_recurring_payments` guard by `service_type` ✅
- L2 `deal_payments_no_duplicate_period` guard by `service_type` ✅
- L3 `reconcile_block_lifecycle` 24 h grace ✅
- L4 `reconcile_payment_integrity` function present ✅

### Cron jobs (from `cron.job`)

| jobid | jobname | schedule | active |
|---|---|---|---|
| 1 | `daily_ensure_recurring_payments` | `0 2 * * *` | true |
| 4 | `monthly_task_reset_daily` | `15 2 * * *` | true |
| 5 | `daily_ensure_recurring_expenses` | `5 2 * * *` | true |
| 7 | `daily_payment_reminders` | `0 6 * * *` | true (re-enabled 2026-07-01 after triage) |
| 8 | `mark-overdue-payments` | `15 2 * * *` | true |
| 9 | `process_email_sequences` | `30 6 * * *` | true |
| 10 | `drain_email_outbox` | `*/2 * * * *` | true |
| 11 | `recover_stale_email_claims` | `*/5 * * * *` | true |
| 12 | `reconcile_block_lifecycle` | `20 2 * * *` | true |
| 13 | `reconcile_seo_onboarding_emails` | `*/15 * * * *` | true |
| 14 | `reconcile_payment_integrity` | `0 4 * * *` | true |
| 3 | `daily_move_overdue_deals_to_on_hold` | `5 2 * * *` | **false** (superseded by jobid 12) |

### Triggers on `public.deal_payments`

| Trigger | When | Purpose |
|---|---|---|
| `deal_payments_activity` | AFTER INSERT / DELETE / UPDATE | `log_activity()` — activity_log entry |
| `deal_payments_default_service_keys` | BEFORE INSERT | Fill `service_type` / `service_index` from prior rows if null |
| `deal_payments_move_to_awaiting` | AFTER INSERT | Move deal `new`/`documents_verified`/`invoice_issued`/`paid_in_full` → `awaiting_payment` on any non-2min insert |
| `deal_payments_no_duplicate_period` | BEFORE INSERT | **L2**: silently drops period-key duplicates (RETURN NULL) |
| `deal_payments_release_from_on_hold` | AFTER UPDATE | On paid transition, promotes `on_hold` → `paid_in_full` if no past-due remains |
| `deal_payments_updated_at` | BEFORE UPDATE | `set updated_at = now()` |

### Triggers on `public.deals`

| Trigger | Purpose |
|---|---|
| `deals_activity` | activity_log |
| `deals_close_jobs_on_close` | on closed-stage transition, propagate to jobs (`close_deal` mechanics) |
| `deals_enqueue_won_welcome` | fire `won_welcome` email on new-deal creation |
| `deals_hold_jobs_on_hold` | on `on_hold` transition, block SEO jobs |
| `deals_payment_method_required` | data-integrity guard |
| `deals_release_jobs_partial_payment` | on `partial_payment` transition, unblock jobs |
| `deals_seed_payments` | on `won` handoff, seed initial payments |
| `deals_set_updated_at` | `set updated_at = now()` |
| `deals_sync_client_status` | mirror deal stage → client status |

### Functions that write to `public.deal_payments` (source-scan)

- `ensure_recurring_payments` (v1, live via cron 1)
- `ensure_recurring_payments_v2` (**exists but not scheduled** — per memory, do NOT swap yet)
- `generate_payments_for_deal`
- `jobs_backfill_payment_service_type`
- `mark_overdue_payments`
- `seed_deal_payments`
- `update_job_billing`

### Functions that write `public.deals.accounting_stage_id`

- `accounting_mark_paid_in_full`
- `close_deal`
- `complete_accounting`
- `deal_payments_move_to_awaiting`
- `deal_payments_release_from_on_hold`
- `lock_deal`
- `move_overdue_deals_to_on_hold` (**deprecated**, cron disabled)
- `reconcile_block_lifecycle`
- `reconcile_payment_integrity` (defensive — inspects state, may notify only)

### Baseline counters (2026-07-01 evening UTC)

| Metric | Value |
|---|---|
| `data_integrity_alerts` open | 8 (pre-existing historical) |
| Recurring rows | 494 |
| On-hold deals | 44 |
| Paid-in-full deals | 127 |
| Partial-payment deals | 12 |
| Backup rows | 4 |

---

## State-machine reference

**Accounting stages** (board `accounting_onboarding`, ordered by position):
```
new (10) → awaiting_payment (15) → on_hold (17) → documents_verified (20)
→ invoice_issued (30) → partial_payment (50) → paid_in_full (60)
→ done (80, terminal) → closed (90, terminal)
```

**Payment statuses (CHECK):** `pending | paid | overdue` — `'cancelled'` is not valid.

**Billing types (CHECK):** `one_time | recurring_monthly | recurring_yearly`.

**Cron chain (nightly UTC):**
```
02:00  ensure_recurring_payments    — creates next-period rows
02:15  mark_overdue_payments        — flips pending→overdue where past-due
02:20  reconcile_block_lifecycle    — moves deal stages based on next_due (+ L3 grace)
04:00  reconcile_payment_integrity  — L4 audit + admin alerts
06:00  daily_payment_reminders      — enqueues -7d/+1d/+7d reminder templates
```

---

## Scenario results

Ran 56 scenarios. PASS: 52, FAIL: 2, CONCERN: 0, INFO: 2, HARNESS BUG: 0.

| Group | # | Description | Result | Details |
|---|---|---|---|---|
| A | 1 | Fresh new deal, no payments | ✅ PASS | fresh new deal with no payments is left alone by cron |
| A | 2 | invoice_issued + pending INSERT → awaiting_payment | ✅ PASS | invoice_issued + pending INSERT moves deal to awaiting_payment |
| A | 3 | on_hold + overdue → paid → paid_in_full | ✅ PASS | overdue→paid on on_hold deal promotes to paid_in_full |
| A | 4 | Full onboarding chain (new → paid_in_full) | ✅ PASS | full onboarding chain reaches paid_in_full |
| A | 5 | documents_verified + pending INSERT → awaiting_payment | ✅ PASS | documents_verified + pending INSERT moves to awaiting_payment |
| A | 6 | partial_payment + pending INSERT → unchanged | ✅ PASS | partial_payment + pending INSERT leaves stage unchanged |
| A | 7 | done + pending INSERT → unchanged | ✅ PASS | done + pending INSERT leaves stage unchanged |
| A | 8 | closed + recurring paid row → cron skips | ✅ PASS | closed deal is skipped by cron |
| B | 1 | pending → overdue via mark_overdue | ✅ PASS | mark_overdue flips pending→overdue |
| B | 2 | on_hold + single overdue → paid → paid_in_full | ✅ PASS | single overdue→paid on on_hold promotes to paid_in_full |
| B | 3 | on_hold + TWO overdue → pay one → stays on_hold | ✅ PASS | paying one of two overdue leaves deal on_hold |
| B | 4 | paid_in_full + paid→pending (old row) → on_hold | ✅ PASS | paid→pending on old row flips paid_in_full to on_hold |
| B | 5 | awaiting_payment + overdue → paid → unchanged | ✅ PASS | awaiting_payment stays put (release trigger only handles on_hold) |
| B | 6 | pending with start_date=TODAY → mark_overdue | ✅ PASS | mark_overdue includes today (inclusive `<=`) |
| B | 7 | on_hold + one paid (old) + one overdue → pay overdue | ✅ PASS | clearing last overdue on on_hold promotes to paid_in_full |
| C | 1 | Paid row ending TODAY → cron creates next-period | ✅ PASS | start=2026-07-01 end=2026-08-01 |
| C | 2 | Paid row ended YESTERDAY → cron creates next | ✅ PASS | yesterday-end + cron + L3 grace keeps paid_in_full |
| C | 3 | Paid row ending +5 DAYS → cron creates next | ✅ PASS | +5d end row generates next, reconcile → awaiting_payment |
| C | 4 | 6-month history, newest ends TODAY → delta=1 | ✅ PASS | 6-month paid history yields exactly ONE new next-period row |
| C | 5 | on_hold + overdue → pay → paid_in_full → cron OK | ✅ PASS | on_hold→paid_in_full via release, cron then extends chain |
| C | 6 | service_index NULL → cron guard tolerates | ✅ PASS | NULL service_index still extends the recurring chain |
| C | 7 | service_type NULL → cron behavior | ℹ INFO | NULL service_type cron delta=1 (guard-tolerates) |
| D | 1 | Standard AI SEO trio, cron fires parent | ✅ PASS | AI SEO trio (parent+2 children) spawns 1 new parent-period row |
| D | 2 | Archived parent → cron skips deal | ❌ FAIL | expected delta=0 when ai_seo parent archived, got 1 |
| D | 3 | web_seo child billing_active=false → cron still fires | ✅ PASS | web_seo child billing_active=false does not affect ai_seo cron |
| D | 4 | Delete web_seo child → parent chain still fires | ✅ PASS | delete web_seo child — parent chain fires, stage unchanged |
| D | 5 | web_seo child is_blocked → cron unaffected | ✅ PASS | blocked web_seo child leaves ai_seo cron chain untouched |
| E | 1 | 3 one_time installments, cron ignores them | ✅ PASS | cron ignores one_time (delta=0); reconcile keeps paid_in_full under L3 |
| E | 2 | Pay installment 1 only, then all 3 | ✅ PASS | web dev installments 1→3 paid leaves deal paid_in_full |
| E | 3 | Installment 2 backdated past-due → on_hold | ✅ PASS | backdated installment 2 → overdue + reconcile → on_hold |
| E | 4 | Custom 5-row schedule, sequential paid → paid_in_full | ✅ PASS | 5-installment custom schedule cron-ignored + reconcile paid_in_full |
| F | 1 | partial_payment + null-dated pending → skip | ✅ PASS | reconcile skips partial_payment (not in eligible cur_code list) |
| F | 2 | partial_payment + past-due pending → still skip | ✅ PASS | overdue row on partial_payment deal — reconcile still skips |
| F | 3 | partial_payment + all paid → stays partial | ❌ FAIL | expected partial_payment (release trigger fires only on_hold), got paid_in_full |
| F | 4 | partial_payment + insert paid row → stays partial | ✅ PASS | paid INSERT on partial_payment leaves stage untouched (trigger guard) |
| F | 5 | partial_payment → manual paid_in_full override | ✅ PASS | manual promotion partial_payment→paid_in_full survives reconcile |
| G | 1 | new + INSERT pending → awaiting_payment | ℹ INFO | `new` stage keeps stage=new after pending INSERT (trigger skip-list includes new) |
| G | 2 | awaiting_payment + all paid + reconcile → paid_in_full | ✅ PASS | awaiting_payment + all paid → reconcile promotes to paid_in_full |
| G | 3 | paid_in_full + cron creates future row → grace recovers | ✅ PASS | trigger→awaiting_payment then reconcile→paid_in_full (L3 grace recovers) |
| G | 4 | on_hold + overdue → paid → paid_in_full | ✅ PASS | on_hold + overdue→paid triggers release to paid_in_full |
| G | 5 | on_hold + all paid + reconcile gate | ✅ PASS | reconcile gate — false blocks on_hold→paid, true allows it |
| H | 1 | suppress_payment_reminders skips outbox | ✅ PASS | suppress_payment_reminders=true blocks the outbox insert |
| H | 2 | payment_method=NULL skips reconcile | ✅ PASS | NULL payment_method filters deal out of reconcile loop |
| H | 3 | Archived deal → cron + reconcile both no-op | ✅ PASS | archived deal — cron delta=0 + reconcile unchanged |
| H | 4 | accounting_completed_at guards move_to_awaiting | ✅ PASS | accounting_completed_at guard keeps stage=paid_in_full after pending INSERT |
| H | 5 | closed (terminal) skipped by reconcile | ✅ PASS | closed stage is filtered out of reconcile loop |
| I | 1 | clients.status='blocked' does not stop cron | ✅ PASS | clients.status=blocked does not stop recurring cron (billing continues) |
| I | 2 | client_blocks row → jobs blocked + cron still runs | ✅ PASS | client_blocks row does not stop billing (delta=1, job.is_blocked=f) |
| I | 3 | client_blocks unblock → cron still runs | ✅ PASS | unblocked client — cron delta=1, stage=paid_in_full (billing continues) |
| J | 1 | Full nightly chain — end-to-end | ✅ PASS | full nightly chain — delta=1, stage=paid_in_full (grace intact) |
| J | 2 | ensure_recurring_payments twice → idempotent | ✅ PASS | ensure_recurring_payments is idempotent (first=+1, second=+0) |
| J | 3 | reconcile_block_lifecycle twice → same result | ✅ PASS | reconcile_block_lifecycle idempotent (paid_in_full=paid_in_full) |
| J | 4 | reconcile_payment_integrity → no new alerts | ✅ PASS | reconcile_payment_integrity creates no alerts for clean deal (0/0) |
| K | 1 | mark_overdue_payments → notifications inserted | ✅ PASS | mark_overdue_payments inserted 5 payment_overdue notification(s) for deal |
| K | 2 | enqueue_payment_reminders → email_outbox row | ✅ PASS | enqueue_payment_reminders queued payment_due_soon (1 row) for deal |
| K | 3 | Archived deal → no email queued | ✅ PASS | archived deal skipped by enqueue_payment_reminders (0 outbox rows) |

---

## FAIL / CONCERN root-cause traces

### ❌ F3 — HARNESS ASSUMPTION ERROR (not a fix bug)

**Scenario:** `partial_payment` deal + all rows already `paid`. Marking the last unpaid row as `paid` triggered `deal_payments_release_from_on_hold`, which promoted the deal to `paid_in_full`. Harness expected stage to stay `partial_payment`.

**Verified root cause:** the release trigger's guard is:

```sql
if cur_code is null or cur_code not in ('on_hold','partial_payment') or not has_pm then
  return new;  -- skip
end if;
```

`partial_payment` is EXPLICITLY handled — the trigger fires for BOTH `on_hold` and `partial_payment` deals. This is intentional (per commit history, part of `20260503000020`-era work): when a partial-payment deal settles, it should auto-promote.

**Reclassification:** ✅ Behaviour is correct. Scenario F3's assertion was wrong. **No action needed.**

---

### ⚠ D2 — AI SEO archive does not stop cron billing (REAL SEMANTIC GAP, not fix-critical)

**Scenario:** Standard AI SEO trio (parent + 2 children). Archive the parent `ai_seo` job. Call `ensure_recurring_payments()`. Expected: per-deal delta = 0 (cron should skip because service has no active jobs). Actual: delta = 1 (cron creates a new next-period row).

**Verified root cause:** the cron's job-existence guard is:

```sql
and (
  not exists (select 1 from public.jobs j
               where j.deal_id = dp.deal_id and j.service_type = dp.service_type
                 and not j.archived)                                    -- (A)
  or exists (select 1 from public.jobs j
               where j.deal_id = dp.deal_id and j.service_type = dp.service_type
                 and not j.archived and j.billing_active)                -- (B)
)
```

Branch (A) — "no non-archived jobs for this service_type" — was a legacy-compatibility escape hatch for old deals that had recurring `deal_payments` rows before jobs were the billing unit. When accountant archives ALL `ai_seo` jobs on a deal, branch (A) fires TRUE → guard passes → cron continues creating rows.

**Impact:** accountant intending to stop AI SEO billing by archiving the parent job will find the cron keeps generating monthly rows. Workaround today: delete/cancel the recurring `deal_payments` row directly. Not intuitive.

**Mitigation options:**
1. **Remove branch (A) entirely** — require an active job for cron to fire. Breaks any legacy deal that never had jobs backfilled. Safest to first audit which prod deals rely on this path: `select count(distinct dp.deal_id) from deal_payments dp join deals d on d.id=dp.deal_id where dp.billing_type in ('recurring_monthly','recurring_yearly') and d.archived=false and not exists (select 1 from jobs j where j.deal_id=dp.deal_id and j.service_type=dp.service_type and not j.archived)`.
2. **Gate branch (A) on a cutoff date** — allow the fallback only for deals `created_at < 2026-06-01` (pre-jobs-billing era). New deals from that date must have jobs.
3. **Preserve today's behavior but document** — accept that "stop billing" = "delete the recurring row" and add a UI shortcut/RPC for accountant to do so cleanly.

**Recommendation:** Option 2 (cutoff-gated fallback). Safest — preserves legacy compatibility while making the archive-to-stop pattern work for all new deals. Requires one WHERE-clause tweak.

**Priority:** 🟡 **Priority 2** — annoyance, not a flip-flop cause. Defer to a batched mitigation plan.

---

### ℹ C7 — NULL service_type on recurring row bypasses cron dedup guard (INFO)

**Scenario:** Recurring row with `service_type = NULL`. Cron created a next-period row (delta = 1). The next-period row also has `service_type = NULL`. If cron ran again on either row's expiration, it would create another dup — the L1 guard `dp2.service_type = dp.service_type` is UNKNOWN when both are NULL, so `not exists` is TRUE and the guard doesn't fire.

**Impact:** low — rows should always have `service_type` populated by the `deal_payments_default_service_keys` BEFORE INSERT trigger. NULL only occurs when a legacy row is inserted directly.

**Mitigation options:**
1. Add `and dp2.service_type is not null and dp.service_type is not null` to the L1 guard.
2. Add a CHECK constraint `deal_payments_service_type_not_null` (breaks legacy).
3. Use `is not distinct from` on both sides — treats NULL=NULL as equal.

**Recommendation:** Option 3 — swap `service_type = dp.service_type` to `service_type is not distinct from dp.service_type`. Two-char change, catches the NULL case.

**Priority:** ℹ **Priority 3** — defense-in-depth; NULL rows are rare.

---

### ℹ G1 — `new` deal + pending INSERT does not auto-move (INFO)

**Scenario:** Fresh deal in `new` stage + INSERT pending payment. Deal stayed in `new`. Harness noted this as INFO because the plan speculated it might move to `awaiting_payment`.

**Verified root cause:** `deal_payments_move_to_awaiting`'s skip-list is `('new', 'on_hold', 'partial_payment')`. `new` is explicitly excluded — the intent is that accountants must manually advance from `new` (they add the invoice, verify docs, etc.) before the automatic pipeline kicks in.

**Impact:** none — this is by-design. Documented for the state-machine reference.

---

## Prioritised mitigations

Aggregating this smoke's findings with the prior edge-case report's mitigations (still open):

| # | Issue | Source | Severity | One-line SQL fix | Priority |
|---|---|---|---|---|---|
| 1 | A2 — L1 guard misses end_date extension | Edge-case report | 🔴 REAL GAP | Change L1 guard: `dp2.end_date > dp.end_date` | **P1 — SHIP** |
| 2 | D2 — Archive parent doesn't stop cron | This smoke | 🟡 SEMANTIC GAP | Gate cron's `not exists` fallback on cutoff date | P2 — DEFER |
| 3 | move_to_awaiting fires on paid inserts | Edge-case report | 🟡 UX polish | Add `if new.status = 'paid' then return new;` | P2 — DEFER |
| 4 | E5 — L2 UPDATE bypass | Edge-case report | ⚠ CONCERN | UNIQUE partial index on recurring period-key | P3 — DEFENSE |
| 5 | I3 — created_at editable | Edge-case report | ⚠ CONCERN | BEFORE UPDATE guard | P3 — DEFENSE |
| 6 | C7 — NULL service_type bypasses L1 guard | This smoke | ℹ POLISH | `is not distinct from` instead of `=` | P3 — DEFENSE |

**Priority 1 (should ship in a small migration):**
- A2 (`dp2.end_date > dp.end_date`). Closes the last real flip-flop vector. Estimated impact on prod dry-run: 0-1 additional rows blocked per nightly cron.

**Priority 2 (bundle into a follow-up plan):**
- D2 + move_to_awaiting status-guard. Both are UX/semantic improvements; neither prevents any flip-flop.

**Priority 3 (defense-in-depth, ship if we get time):**
- E5 (UNIQUE index) + I3 (created_at guard) + C7 (NULL guard). All would harden the data-integrity boundary; none are user-visible bugs today.
