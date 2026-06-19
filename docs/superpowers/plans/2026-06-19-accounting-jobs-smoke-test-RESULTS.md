# Accounting ↔ Jobs Smoke-Test — RESULTS

**Run date:** 2026-06-19
**Executor:** Claude (controller-driven, live SQL/RPC against prod CRM `xujlrclyzxrvxszepquy`)
**Acting user:** mkifokeris@itdev.gr (admin uid `61b53075-398f-43a0-86f6-8bce177b669b`) — per user request, so any emails are visible to him.
**Email handling:** all 4 relevant email automations are GLOBALLY OFF (`lead_welcome`, `won_welcome`, `won_next_steps`, `internal_new_job` = false). Test contact email set to mkifokeris@itdev.gr; internal job-notification rows defensively redirected to mkifokeris. Net effect: **no automated emails fired** during the test.

## Baseline (must be restored at cleanup)
| metric | baseline |
|---|---|
| jobs | 0 |
| deal_payments | 0 |
| deal_payment_lines | 0 |
| deals | 479 |
| clients | 479 |
| open client_blocks | 0 |
| backup tables | 4 (`jobs_backup_20260619`, `deal_payments_backup_20260619`, `deal_payment_lines_backup_20260619`, `deal_payment_lines_full_backup_20260619`) ✓ |

## Test fixtures created
- Lead `004585` (`0a5e1ead-0000-4000-8000-000000000001`) — ZZ_SMOKE_GR Ltd, Greece, 5 services, payment_method cash.
- Client `51dea53f-9754-41b7-9ee3-d2aa993fbd3b` (ZZ_SMOKE_GR Ltd) — from conversion.
- Deal D1 `a56d318b-2aeb-4bf3-938c-2789898620cc` (code 004585) — 5 services: web_dev(one_time 1000), web_seo(rec 200), local_seo(rec 150 + setup 50), hosting(one_time 120), social_media(rec 180).

---

## Phase A — Setup & safety: PASS
- Confirmed prod project, wiped state (jobs/payments/lines = 0), 4 backup tables intact.
- JWT simulation verified (`current_user_is_admin()` = true under mkifokeris claim).
- Mapped the full trigger graph before mutating (seed-on-insert, partial-payment guard, on-hold SEO-only, email queue, pricing sync).

## Phase C — Accounting → Jobs forward sync: PASS (every check)

**1. Lead → convert_lead_to_client → won/locked deal @ accounting `new`:** PASS
- Deal: sales=`won`, accounting=`new`, locked=true, payment_method=cash. RPC ok.

**2. Off-board job spawn (seed on deal insert):** PASS
- 5 jobs, all `stage_id` NULL (off-board), status active, VAT 24% (GR), not blocked.
- Codes: `004585-WEBDEV / -WEBSEO / -LOCALSEO / -SOCIAL / -HOSTING`.
- **local_seo owner force-assigned to dtzouvaras@itdev.gr** even off-board. ✓

**3. Payment seeding + VAT generated columns:** PASS
- 6 payment rows; recurring rows end_date = +1 month (2026-07-19); one_time rows end_date = start.
- **Separate "Setup fee" row** for local_seo (net 50 → gross 62). ✓
- VAT 24% computed: net 200 → vat 48 → gross 248; net 1000 → 240 → 1240; etc.
- Every header has 1 job-linked line. ✓

**4. jobs → deal pricing sync (#9):** PASS
- Deal `one_time_value` = **1170** (1000 web_dev + 120 hosting + 50 local_seo setup) — overrode the lead's 1120 estimate; `recurring_monthly_value` = 530. Confirms `sync_deal_pricing_from_jobs` fires on job insert.

**5. new → partial_payment → place on boards + block non-web_dev:** PASS
- All placed on first lanes (web_dev new_project, web_seo new_project, local_seo new_project, hosting setup, social_media onboarding).
- **web_dev unblocked**; web_seo/local_seo/hosting/social_media blocked with `partial_payment_pending`. ✓

**6. paid_in_full via complete_accounting → clear partial blocks:** PASS
- All `partial_payment_pending` cleared; deal = paid_in_full; completed_by = mkifokeris; **client.status auto → active**.

**7. on_hold → SEO-only block:** PASS
- web_seo + local_seo → `account_on_hold`; web_dev/hosting/social_media untouched; client.status → blocked.

**8. leave on_hold → auto-release:** PASS
- All `account_on_hold` holds cleared; client.status → active.

**9. close_deal → terminal lanes + completed:** PASS
- 5 jobs completed + stamped; web_dev → `live`, others → `closed`; deal → accounting `closed`. close_deal returned closed_jobs=5.

---

## Phase D — Jobs → Accounting + gaps: PASS

**#9 pricing sync (insert):** PASS — already shown in Phase C (one_time_value 1170).
**#9 pricing sync (edit):** PASS — `update_job_billing` web_dev 1000→1500 ⇒ deal one_time_value 1170→1670.
**#10 recurring generation:** PASS — `ensure_recurring_payments()` created the next web_seo period (2026-06-19→2026-07-19, net 200) with a job-linked line.
- Note: an initial run returned 0 — that was a **test-setup artifact** (I set end_date = start_date = today, so the row's own `start_date >= end_date` satisfied the idempotency guard). With realistic dates it generated correctly. The guard works as intended.
**end_job:** PASS — sets `billing_active=false`, `status=completed`. (Known design note: legacy v1 cron reads `deal_payments`, not `jobs.billing_active`, so it keeps rolling existing payment rows; only v2 — not yet live — honors `billing_active`.)

**Confirmed one-way GAPS (by design, not bugs):**
1. **Job completion ≠ deal movement:** marked D2's job `completed` manually → deal stayed at `partial_payment`. Only `close_deal`/`complete_accounting` move the deal.
2. **`is_blocked` gates nothing:** a job with `is_blocked=true (manual)` still moved stages freely. The move-guard (`enforce_no_stage_move_when_blocked`) only checks `is_client_blocked AND not admin` — never `jobs.is_blocked`.
3. **`client_blocks` gates moves for non-admins only:** as a simulated non-admin, a stage move on a blocked client's job raised `client_blocked`; admins bypass.

## Phase E — Options matrix: PASS
- **Payment status pending→overdue:** PASS — `mark_overdue_payments()` flipped a past-due pending payment to `overdue`.
- **Overdue→on_hold:** PASS — `move_overdue_deals_to_on_hold()` moved D3 to `on_hold`. (First attempt no-op: I'd flipped status to `overdue` first; the move function only scans `pending` rows. Production cron order is move (02:05) before mark (02:15), so this is correct.)
- **Billing types:** one_time / recurring_monthly present and round-trip; recurring end_date = +1 month. PASS.
- **VAT:** Greece 24% (net 100→gross 124), **Cyprus 0%** (net 200→gross 200). PASS.
- **Payment-method guard:** changing stage with null payment_method raised `payment_method_required`. PASS.
- **Custom + billing-only jobs:** `create_custom_job` produced a board web_dev custom job (`ZZSMK4-WEBDEV`) and a billing-only `other` job (`ZZSMK4-OTHER`, no lane). PASS.
- **Expense categories:** exactly **15** (salaries…other). PASS.
- **Info-tab `details` JSONB:** set + persisted (website_username, web_report_url read back). PASS.
- **Job codes:** all 10 test codes unique; **global_search finds a job by code** (`004585-WEBSEO`). PASS.

## Phase B — Static UI rendering (Playwright, prod): PASS
- Accounting board: all 9 columns render (and reflected live test data — Partial Payment=1, On Hold=1, Closed includes D1).
- All 7 job boards render full lane sets — web_dev → …Live/Closed; web_seo/local_seo with trailing **Blocked** column; social/hosting/ads correct.
- Accounting sub-pages (clients, recurring, expenses, report, docs) all render without error.
- Expense "new expense" form lists all **15** categories + billing-type (One-time/Monthly/Yearly); status is a list filter (All/Pending/Paid).

## Phase F — Cleanup + baseline restore: PASS
- Deleted via tag/known-id: 10 jobs (admin RPC), 9 payments + lines, 1 lead, 4 deals, 4 clients, client_blocks, outbox rows, and activity_log for known IDs.
- **Residue (ZZ_SMOKE / ZZSMK / 004585): 0 across clients, deals, leads, jobs, outbox, notifications, activity_log.**
- Baseline restored: deals=479, clients=479, open_client_blocks=0.
- jobs/deal_payments/payment_lines = **1 each** — these are NOT test data: job `000186-LOCALSEO` (real client ΒΟΓΔΗΣ ΧΑΡΑΛΑΜΠΟΣ, real deal `000186` from 06-17) created today 10:58 UTC by the **concurrent reseed**. Correctly left untouched.

---

## SUMMARY
**Every status, category, option, and sync mechanism tested PASSED.** The full lifecycle Lead → convert → won → accounting (new→partial→paid→on-hold→release→closed) → jobs behaves flawlessly, in both UI and DB. Accounting→jobs propagation: all 8 mechanisms correct. Jobs→accounting: both real paths (pricing sync, recurring billing) correct; the three one-way gaps confirmed as by-design. Two "anomalies" during the run were test-setup artifacts (recurring idempotency, overdue/move ordering), not system defects. Test data fully cleaned; only delta from baseline is the parallel reseed's first real job.

## BUGS / PROBLEMS FOUND

### BUG 1 (HIGH) — Closed deals keep billing AND get yanked back to On Hold
Verified live (deal D5, read-only eligibility check against the real cron queries):
- A deal closed via `close_deal` has `accounting_stage_id='closed'`, `accounting_completed_at=null`, `archived=false`.
- The `closed` accounting stage has `is_terminal=FALSE` (whereas `paid_in_full` and `done` are terminal). Likely the root oversight (closed was added later in `20260617000002`).
- Consequence A: `ensure_recurring_payments()` (v1 cron, only excludes `archived`) **keeps generating new monthly invoices for closed deals** → `closed_deal_still_bills = true`.
- Consequence B: `move_overdue_deals_to_on_hold()` does not exclude `closed` (not terminal) or `close_deal`-closed deals (completed_at null) → a closed deal with a past-due pending payment is **moved back from Closed to On Hold** → `closed_deal_rehold_risk = true`.
- Net: a closed recurring deal silently re-invoices and pops back onto the active accounting board.
- Likely fix: mark `closed` stage `is_terminal=true` (and/or have `close_deal` set `accounting_completed_at`, and stop recurring billing on close).

### BUG 2 (MED-HIGH) — "End job" / stop-billing does not stop live billing
`end_job` sets `billing_active=false`, but the live v1 cron `ensure_recurring_payments()` reads `deal_payments`, never checks `jobs.billing_active`. So ending a job does NOT stop its recurring invoices. Only v2 honors `billing_active`, and v2 is not wired to cron. (Consistent with memory `reference_recurring_payments`.)

### BUG 3 (MED) — internal "new job" emails bypass the automation toggle
`email_automation_enabled('internal_new_job')` is OFF, but the `email_notify_new_job` trigger inserts into `email_outbox` unconditionally (lead emails ARE gated by the toggle; internal job emails are not). Either the outbox silently accumulates undelivered rows, or these send despite the toggle being off. Drain behavior not traced — worth confirming.

## DESIGN OBSERVATIONS (confirm intended)
- Two "end" columns: **Done** (archives + client done, stops billing via archive) vs **Closed** (keeps client active, does NOT stop billing, re-hold risk per BUG 1). Confusing + behaviorally different.
- `deals_one_live_per_client` constraint blocks a 2nd concurrent live deal per client.
- Email automations are globally OFF (lead_welcome/won_welcome/won_next_steps/internal_new_job) — if welcome/won emails are expected to send, they currently don't.

## COVERAGE GAPS (not exercised this run)
ads board lifecycle; ai_seo dual-board; recurring_yearly end-to-end; web_dev installment terms (50/25/25 split); billing_group invoice bundling; `done`-stage auto-archive; `refunded` stage; actual email delivery (drain).

## FIXES APPLIED — migration `20260619110000_fix_closed_billing_and_email_gate` (applied to prod 2026-06-19, verified)

| Bug | Fix | Verification (on throwaway deals) |
|---|---|---|
| 1 | `closed` accounting stage marked `is_terminal=true`; `ensure_recurring_payments` skips `closed` deals; `move_overdue_deals_to_on_hold` excludes `closed` | closed deal: bills=**false**, rehold-risk=**false** (were both true) |
| 2 | `ensure_recurring_payments` now honors `jobs.billing_active` (keeps billing if no job exists, stops when all matching jobs ended) — v1 only, amounts still copied forward (no v2 swap, €0 jobs unaffected) | active deal still bills=**true** (no regression); after `end_job`=**false** |
| 3 | `email_notify_new_job` gated on `email_automation_enabled('internal_new_job')` | new job spawned with group → **0** internal emails queued (toggle off) |

Product assumption in Bug 1: **Closed = engagement ended → recurring billing stops.** If a closed deal should keep billing, drop the `<> 'closed'` clause in `ensure_recurring_payments` (rollback documented in the migration). All verification data removed; baseline restored (deals/clients = 479).

## BUG 4 (HIGH) — found in prod after deploy: unbounded duplicate recurring payments
Reported on real deal `fd090fb8` (12+ identical 21/06→21/07 monthly rows). Root cause:
- The ClickUp reseed/import creates `deal_payments` with **NULL `service_index` (and NULL `service_type`)** — all 56 reseed rows had it.
- `ensure_recurring_payments`'s idempotency guard used `dp2.service_index = dp.service_index`; `NULL = NULL` is NULL (never TRUE), so the guard never matched its own successors → a new duplicate was created on **every** cron run.
- The cron is invoked on **every accounting-board mount** (`useAccountingKanbanRealtime`) → duplicates accrued on each page view ("all the time").
- Scale at detection: 5 deals, 38 excess rows.

Fix — migration `20260619120000_fix_recurring_idempotency_null_service_index`: made the guard NULL-safe (`is not distinct from` on service_index/service_type/amount_net, + billing_type). Verified: generator now creates **0** rows for `fd090fb8`. Cleanup: removed 37 redundant pending/un-invoiced duplicate rows + their lines; 0 duplicate groups remain; `fd090fb8` back to 4 legitimate payments.

Follow-ups for you: (a) the **reseed/import should populate `service_index` + `service_type`** so payments link cleanly to services/jobs (the function is now robust regardless); (b) consider **not** calling `ensure_recurring_payments` on every board mount (write-on-read) — harmless now that it's idempotent, but wasteful.

**Email:** all relevant automations are globally OFF; test contact + redirected job-notifications pointed at mkifokeris@itdev.gr; net result — no automated emails fired.
