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

_pending — populated in Task 5._

| Group | # | Description | Result | Details |
|---|---|---|---|---|
| A | 1–8 | Deal onboarding lifecycle | _pending_ | |
| B | 1–7 | Payment status transitions | _pending_ | |
| C | 1–7 | Recurring chain (single service) | _pending_ | |
| D | 1–5 | AI SEO 3-row split | _pending_ | |
| E | 1–4 | Web dev installments | _pending_ | |
| F | 1–5 | Partial payment stage | _pending_ | |
| G | 1–5 | Stage state-machine transitions | _pending_ | |
| H | 1–5 | Deal toggles + archival | _pending_ | |
| I | 1–3 | Client-level blocks | _pending_ | |
| J | 1–4 | Cron interaction matrix | _pending_ | |
| K | 1–3 | Email + notification side effects | _pending_ | |

---

## FAIL / CONCERN root-cause traces

_pending — populated in Task 6._

---

## Prioritised mitigations

_pending — populated in Task 6._
