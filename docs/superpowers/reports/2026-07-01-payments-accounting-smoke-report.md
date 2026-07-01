# Payments & Accounting Full Smoke Report

**Date:** 2026-07-01
**Plan:** `docs/superpowers/plans/2026-07-01-payments-accounting-full-smoke.md`
**Harness:** `supabase/tests/payments_accounting_full_smoke.sql`
**Fix reference:** `supabase/migrations/20260701010000_paid_in_full_flip_fix.sql`

---

## Executive summary

(Populated in Task 6 after all 56 scenarios have run.)

| Result | Count |
|---|---|
| ✅ PASS | _pending_ |
| ❌ FAIL | _pending_ |
| ⚠ CONCERN | _pending_ |
| ℹ INFO | _pending_ |
| 🐛 HARNESS BUG | _pending_ |

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

_pending — populated in Task 6._

---

## Prioritised mitigations

_pending — populated in Task 6._
