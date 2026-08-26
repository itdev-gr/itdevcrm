# Findings

Shared findings log for the 2026-08-26 payment-system full audit. Task 1 (baseline + drift check) owns F1–F10. Later tasks append their own findings continuing the numbering — do not renumber existing entries.

## Documented invariants catalogued (Step 1)

Read end-to-end: `docs/system-analysis/2026-08-04-accounting-full-audit.md`, `docs/tech/accounting/billing-model.md`, `docs/tech/accounting/payment-reminders.md`, `docs/tech/accounting/block-lifecycle.md`, `docs/tech/accounting/deal-lifecycle.md`, `docs/tech/accounting/renewal-close.md`.

Invariants the docs promise, that later tasks should treat as the claims under test:

1. `deal_payments.status` CHECK is `('pending','paid','overdue')` — **contradicted live, see F1**.
2. `start_date` is the DUE date; the entire block/on-hold lifecycle keys off it; nothing in the lifecycle ever writes `start_date`/`end_date` except accounting/seeding/recurring generation.
3. `amount_gross`/`vat_amount` are GENERATED columns; always read `amount_gross`, never the deprecated `amount`.
4. Recurring series are linked by `(deal_id, service_index)`, not `service_type`.
5. VAT defaults to 24% (Greek); Cyprus and UAE are 0%-VAT countries (centralized in `vat_rate_for_country` as of `20260720170000` — see F8, this itself supersedes the doc's "backfill keyed on clients.country='Greece'" framing, which is historical, not current).
6. Reminders key off `start_date` (due date), not `end_date`; only `pending`/`overdue` rows are eligible; `paid` rows never remind.
7. `mark_overdue_payments` runs at 02:15 UTC, before `reconcile_block_lifecycle` (02:20) and reminders (06:00).
8. The reminder window is documented as exact-day `−7 / +1 / +7` — **contradicted live, see F2** (superseded by a stage-locked, range-based, per-deal-aggregated design).
9. `reconcile_block_lifecycle` is documented as computing `target_accounting_stage(next_due, today)` per deal and moving it directly — **contradicted live, see F3** (superseded by delegating to `reconcile_deal_stage`, which `target_accounting_stage` is no longer even part of).
10. The reconciler "does NOT auto-release On-Hold → Paid in nightly mode" (`p_allow_release=false` is meaningful) — **live `reconcile_block_lifecycle`'s comment says `p_allow_release is now ignored`**; the parameter is now vestigial (kept for the same call signature), not a live behavioural switch. Behaviourally the outcome is unchanged (release is still payment-driven via `reconcile_deal_stage`'s "never auto-lift on_hold" rule), so this is a docs-are-imprecise-about-the-mechanism issue, not a behaviour change — folded into F3, not a separate finding.
11. `close_deal` never creates jobs, only moves existing ones; `release_deal_jobs` moves every non-terminal renewable job to `renewal` on entry to `paid_in_full`.
12. Blocking never moves a job's `stage_id`; it's a virtual overlay via `is_blocked`.
13. `payment_method` must be non-null before any accounting-stage move (`guard_payment_method_before_stage_move`).
14. `ensure_recurring_payments` copies `amount_net` forward from the previous row, not from the job (audit A7).
15. The 2026-08-04 audit's A0–A8 open findings (cash/VAT, pause/resume `ok` key, `partial_payment` trap, on_hold boundary disagreement, cancelled-row renewal blindness, overlap detection, price drift, mixed-rate VAT, mutable ledger) — **explicitly out of scope for re-measurement in Task 1**; later tasks re-verify these against current data.

---

## F1. `deal_payments.status` CHECK already includes `'cancelled'` — docs are wrong, DB is right

**Claim (from the brief, echoing the docs):** `billing-model.md` and `payment-reminders.md` both state the status CHECK is `('pending','paid','overdue')`. 93 `cancelled` rows exist in production, which should be impossible if that CHECK were still in force.

**Evidence:**
```sql
select conname, pg_get_constraintdef(oid) from pg_constraint
where conrelid = 'public.deal_payments'::regclass and contype = 'c';
```
Live result: `deal_payments_status_check` = `CHECK ((status = ANY (ARRAY['pending'::text, 'paid'::text, 'overdue'::text, 'cancelled'::text])))`.

Actual row counts by status (from the 1a query): `cancelled` count = 18 (cash) + 75 (online) = **93** — matches the number the brief flagged exactly.

**Refutation attempt:** Searched `supabase/migrations` for the constraint's history — it was widened to include `'cancelled'` in a migration that predates this audit (the `job_pause_billing` mechanism, per the 2026-08-04 audit's A1/A5, cancels unpaid rows on pause, which requires the CHECK to allow it). No migration reverts it. The DB is self-consistent: the CHECK, the writer (`job_pause_billing`), and the row count all agree with each other. Only the two doc files disagree with reality.

**Verdict: CONFIRMED.** The live CHECK is `('pending','paid','overdue','cancelled')`. `docs/tech/accounting/billing-model.md` line 22 and `docs/tech/accounting/payment-reminders.md` line 48 are stale and should be corrected to include `cancelled` (out of scope to edit here per the read-only mandate of this audit; flagging for the doc-fix pass).

---

## F2. `payment-reminders.md` describes a reminder design that was replaced over a month before this audit

**Claim (doc, as read):** The reminder window is exact-day: `enqueue_payment_reminders()` fires when `start_date IN (current_date+7, current_date-1, current_date-7)`, one email per payment row, cron directly calls `enqueue_payment_reminders()`.

**Evidence:** Live function body (`pg_get_functiondef`) for `enqueue_payment_reminders`, matched to repo migration `supabase/migrations/20260729110000_reminder_breakdown.sql` (latest in the chain `20260702140000_stage_locked_accounting_emails.sql` → `20260729100000_payment_reminders_same_day_aggregate.sql` → `20260729110000_reminder_breakdown.sql`):

- Classification is now **stage-locked**, not day-offset: `awaiting_payment` stage + `due_date` within `(today, today+7]` → `payment_due_soon`; `on_hold` stage + 1–6 days past due → `payment_overdue`; `on_hold` stage + ≥7 days past due → `payment_final_notice`. There is no `current_date - 7` / `current_date - 1` exact-day check anywhere in the live function.
- Emission is **aggregated per `(deal_id, template, due_date)`** (since `20260729100000`), not one row per payment.
- Emission carries a **per-service breakdown string** (since `20260729110000`) when an aggregate spans 2+ services.
- The cron (`daily_payment_reminders`, `0 6 * * *`) calls `public.run_daily_payment_reminders()`, **not** `public.enqueue_payment_reminders()` directly (repointed in `20260702140000`). That wrapper runs `reconcile_block_lifecycle(false)` first, then enqueues — so reminders are re-evaluated against a stage that was just re-asserted seconds earlier, on top of the independent 02:20 nightly reconcile.

**Refutation attempt:** Checked whether the doc's description might still apply to some other code path (e.g., a second reminder function). Grepped for `payment_due_today`/`current_date - 7` across `supabase/migrations` and `src/` — the exact-day window and the `payment_due_today` template were dropped in `20260616000005` and `20260702140000` respectively; there is only one `enqueue_payment_reminders` in the live schema and it is the stage-locked version. No alternate path exists.

**Verdict: CONFIRMED.** `docs/tech/accounting/payment-reminders.md` describes the pre-`20260702140000` design. The live mechanism (stage + day-range classification, per-deal same-day aggregation, per-service breakdown, and the `run_daily_payment_reminders` move-then-send wrapper) is a materially different implementation, not a cosmetic drift. This is a functional documentation gap that could mislead anyone reasoning about when a client receives which email.

---

## F3. `block-lifecycle.md` / `deal-lifecycle.md` describe a design superseded on 2026-07-02; `target_accounting_stage` is now dead code

**Claim (docs, as read):** `reconcile_block_lifecycle` computes `target_accounting_stage(next_due, today)` per deal in the managed set and moves the deal directly; `target_accounting_stage` is the shared boundary rule (`next_due <= today → on_hold`).

**Evidence:**
- Live `reconcile_block_lifecycle` body (md5 `3fe88e77dae19c930e420c072b4b20ae`) matches `supabase/migrations/20260702150100_reconcile_block_lifecycle_single_owner.sql` exactly. That function no longer calls `target_accounting_stage` at all — it loops over managed-stage deals and calls `public.reconcile_deal_stage(id)` for each, then does a terminal/`done` job-unblock safety sweep. The migration's own header says: *"Nightly sweep becomes a thin loop over the single rule (reconcile_deal_stage), dropping the 24h grace + the old per-deal target logic... `p_allow_release` is now ignored."*
- Live `reconcile_deal_stage` body (md5 `730380cc9965be05e8980c174c37b5ed`) matches `supabase/migrations/20260702150150_reconcile_deal_stage_respect_holds.sql` exactly. It inlines its own boundary rule (`v_next_due < current_date → on_hold`) and explicitly never auto-lifts a deal already `on_hold` (design decision "B" in that migration's header) — a behaviour block-lifecycle.md does not mention.
- Searched every non-comment call site of `target_accounting_stage` across `supabase/migrations`: all live in `reconcile_block_lifecycle` bodies from `20260626000012` through `20260702100000` — every one of them superseded by `20260702150100`. `target_accounting_stage` itself (md5 `47c041c25dc0652c5891f401185392c5`) still exists, unchanged since its only migration `20260626000010`, but nothing in the current schema calls it.

**Refutation attempt:** Checked for any other caller of `target_accounting_stage` in triggers or views (`pg_proc`/`pg_trigger` search via the same grep pattern extended to `src/` for any RPC usage) — none found. Confirmed the *migration dates*: `20260702150100`/`20260702150150` are dated 2026-07-02, which is **more than a month before** the 2026-08-04 audit report was written.

**Verdict: CONFIRMED.** Both `block-lifecycle.md` and `deal-lifecycle.md` document the pre-`20260702150100` design. `target_accounting_stage` is orphaned (still present, still correct in isolation, but unreachable from any live code path) — a candidate for the "behaviour-preserving simplification" bucket, not a bug. This also directly informs F4 below.

---

## F4. The 2026-08-04 audit's A4 finding describes a discrepancy that no longer existed on the audit date

**Claim (2026-08-04 audit report, section A4):** *"`target_accounting_stage(next_due, today)` — used by the nightly reconciler — says `next_due <= today → on_hold`. `reconcile_deal_stage` — used on every payment event — inlines the same rule as `next_due < current_date → on_hold`. On the due date itself they disagree... Live right now: 7 deals have `next_due = current_date` — exactly the 7 where the two implementations disagree."*

**Evidence:** Per F3, `reconcile_block_lifecycle` (the nightly reconciler) has not called `target_accounting_stage` since `20260702150100` (2026-07-02) — over a month before the audit's 2026-08-04 date. Since that migration, the nightly reconciler and every payment-event path both resolve to the **same single function**, `reconcile_deal_stage`, using its `<` boundary. There has been no live disagreement between "the nightly reconciler's rule" and "the payment-event rule" since 2026-07-02, because they have been the literal same code path for over a month.

**Refutation attempt:** Considered whether the 2026-08-04 auditors might have been looking at a different, still-live caller of `target_accounting_stage` that this task missed. Re-ran the call-site grep case-insensitively (see F7's lesson) across all of `supabase/migrations` — every real (non-comment, non-superseded) call site is inside `reconcile_block_lifecycle` bodies dated on or before `20260702100000`, all superseded by `20260702150100`. There is no other caller. The 5 deals presently sitting at the `next_due = current_date` boundary (down from the audit's 7 — expected, since this is a moving population) are therefore **not** a case of "two implementations disagreeing" — there is only one implementation (`reconcile_deal_stage`) touching them, applying its `<` rule consistently regardless of whether it was invoked from the nightly loop or a payment event.

**Verdict: REFUTED (stale at time of writing).** The specific mechanism A4 describes — a live nightly `target_accounting_stage` vs. an event-driven `reconcile_deal_stage` disagreeing on the boundary day — was not true in production as of 2026-07-02, and therefore was already not true on 2026-08-04 when the audit report describing it was published. The report's own migration-following method (which the current task also had to correct for, see F7) most likely inspected an intermediate migration snapshot rather than the true latest one. Practically: there is a single boundary rule live today (`<`, i.e. a deal goes `on_hold` the day *after* its due date, not on the due date itself), it is applied uniformly, and no fix is needed for A4 as originally described — later tasks should not re-open A4's proposed remedy ("single stage rule," section F.5 of the 2026-08-04 report) since the unification it called for already happened, just via a different route (deleting the second caller, not merging the two functions' bodies). `target_accounting_stage` itself is now dead code (see F3), which the 2026-08-04 report's simplification section D4 also didn't anticipate.

---

## F5. The brief's own verbatim SQL for stage distribution (step 1b) is broken and returns 0 rows

**Claim:** `select s.code, count(*) from public.deals d join public.pipeline_stages s on s.id = d.stage_id where s.board = 'accounting' group by 1 order by 2 desc;` — run exactly as given in `task-1-brief.md`.

**Evidence:** Ran verbatim; returned `[]` (zero rows), with no SQL error. Root cause, checked directly against the schema:
- `deals.stage_id` is the **sales**-pipeline stage column; the accounting stage lives in `deals.accounting_stage_id`.
- `pipeline_stages.board` values in production are `accounting_onboarding`, `ads`, `ai_seo`, `domains`, `franchise`, `hosting`, `local_seo`, `maintenance`, `sales`, `social_media`, `web_dev`, `web_seo` — there is no board literally named `'accounting'`.
Both the join column and the filter value are wrong, and because the join simply matches zero rows (a sales-stage id never equals an accounting-onboarding-board stage id), it fails silently rather than erroring — the kind of bug that's easy to miss if you don't sanity-check for an empty result.

**Refutation attempt:** Re-ran with `d.accounting_stage_id` and `s.board = 'accounting_onboarding'`; got a full, sane distribution (262 closed, 186 paid_in_full, 81 done, 31 awaiting_payment, 29 on_hold, 15 partial_payment, 6 new, 1 documents_verified — totalling 611 non-archived-ish deals, consistent with the deal volume implied by the 1a payment counts).

**Verdict: CONFIRMED (methodology bug in the brief, corrected before use).** The corrected distribution is recorded in `audit-baseline.json`. Flagging this so later tasks copying this query pattern don't repeat the mistake.

---

## F6. The brief's own verbatim SQL for the function-md5 drift check (step 3) fails with an ambiguous-column error

**Claim:** `select proname, md5(pg_get_functiondef(oid)) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and proname in (...) order by proname;` — run exactly as given.

**Evidence:** Ran verbatim; got `ERROR: 42702: column reference "oid" is ambiguous LINE 2: select proname, md5(pg_get_functiondef(oid)) from pg_proc p ... ^`. Both `pg_proc` (aliased `p`) and `pg_namespace` (aliased `n`) have an `oid` column, and the bare `oid` in `pg_get_functiondef(oid)` doesn't resolve to either alias.

**Refutation attempt:** None needed — this is a straightforward Postgres ambiguous-reference error, not a data question. Fixed by qualifying: `pg_get_functiondef(p.oid)`.

**Verdict: CONFIRMED (methodology bug in the brief, corrected before use).** The corrected query ran cleanly and is recorded (with results) in `audit-baseline.json`.

---

## F7. The brief's grep pattern for "latest migration defining a function" is case-sensitive and silently misses newer migrations

**Claim (brief, step 3):** `grep -rln "create or replace function public.<name>" supabase/migrations | sort | tail -1` finds the latest migration that defines a given function, for comparison against the live body.

**Evidence:** For `mark_overdue_payments`, the lowercase-only grep's `tail -1` returned `supabase/migrations/20260628000000_mark_overdue_due_date_basis.sql`. But three later migrations also touch that function — `20260702180000_overdue_grace_day.sql`, `20260709120000_overdue_notifications_accounting_only.sql`, `20260709130000_overdue_notifications_exclude_mkifokeris.sql` — all of which use `CREATE OR REPLACE FUNCTION` (uppercase), which the brief's lowercase-only pattern never matches. Comparing the live body against the lowercase-grep's "latest" match would have shown a spurious drift: the live function excludes `mkifokeris@itdev.gr` from overdue in-app notification recipients and requires accounting-group membership outright (no `is_admin OR` disjunct), neither of which is in the `20260628000000` body. Re-running with a case-insensitive pattern (`grep -rlin`) correctly surfaces `20260709130000` as the true latest, whose body matches the live function exactly.

The same case-sensitivity gap affected several other functions in the requested list (`ensure_recurring_payments`, `reconcile_block_lifecycle`, `recompute_job_period_dates`, `seed_deal_payments`, `release_billing_jobs_for_deal`, `release_jobs_for_deal` all had a later uppercase-styled migration that the brief's exact pattern would have missed).

**Refutation attempt:** Checked whether the newer migrations might have been reverted or superseded back to the old body — no; each carries the live-verified md5 in its own header comments (several migrations in this repo self-document a pre/post md5 check, e.g. `20260806210000_ensure_recurring_ignores_cancelled.sql`), and the md5s recorded there match what this task independently pulled from prod.

**Verdict: CONFIRMED (methodology bug in the brief, corrected before use for every function in the drift check).** Every function in step 3's list was re-searched with `grep -rlin "create or replace function public\.<name>("` before comparison. See F8 for the resulting drift verdicts.

---

## F8. Drift check result: 0 of 11 requested money functions have live-vs-repo logic drift

**Claim:** Compare each function's live `pg_get_functiondef` against its true latest repo migration (case-insensitive search, per F7) and flag any logical difference (conditions, statuses handled, windows) — not formatting.

**Evidence:** All 11 functions' live bodies are byte-for-byte identical (modulo the `CREATE OR REPLACE`/whitespace framing Postgres re-emits) to the `CREATE OR REPLACE FUNCTION` block in their true latest repo migration:

| function | latest repo migration | verdict |
|---|---|---|
| `enqueue_payment_reminders` | `20260729110000_reminder_breakdown.sql` | MATCHES-REPO |
| `ensure_recurring_payments` | `20260806210000_ensure_recurring_ignores_cancelled.sql` | MATCHES-REPO |
| `mark_overdue_payments` | `20260709130000_overdue_notifications_exclude_mkifokeris.sql` | MATCHES-REPO |
| `recompute_job_period_dates` | `20260713150000_jobs_per_type_billing.sql` | MATCHES-REPO |
| `reconcile_block_lifecycle` | `20260702150100_reconcile_block_lifecycle_single_owner.sql` | MATCHES-REPO |
| `reconcile_deal_stage` | `20260702150150_reconcile_deal_stage_respect_holds.sql` | MATCHES-REPO |
| `release_billing_jobs_for_deal` | `20260728120000_domains_service.sql` | MATCHES-REPO |
| `release_jobs_for_deal` | `20260728120000_domains_service.sql` | MATCHES-REPO |
| `seed_deal_jobs_and_payments` | `20260713150000_jobs_per_type_billing.sql` | MATCHES-REPO |
| `seed_deal_payments` | `20260720170000_vat_rate_for_country_helper.sql` | MATCHES-REPO |
| `target_accounting_stage` | `20260626000010_block_lifecycle_helpers_and_hold.sql` | MATCHES-REPO (but dead code — see F3) |

**Refutation attempt:** Deliberately looked for near-misses (a helper function extracted, an added country, a reordered clause) rather than only exact string equality, since the brief warns migrations drift cosmetically — e.g. `seed_deal_payments`/`release_billing_jobs_for_deal`/`release_jobs_for_deal` all changed shape recently (`vat_rate_for_country` helper extraction, `domains`/`franchise` service additions) and were checked against the correct post-refactor migration, not an earlier pre-refactor one that would have shown a false "drift."

**Verdict: CONFIRMED — no code-level drift found.** Every function actually deployed is exactly what the newest migration in the repo says it should be. The repo is not lying about the schema; only two narrative docs (`payment-reminders.md`, `block-lifecycle.md`/`deal-lifecycle.md`, F2/F3) and the 2026-08-04 audit's A4 narrative (F4) are stale. This means later audit tasks can trust `supabase/migrations/*` (searched case-insensitively) as ground truth for current logic — they do not need to re-verify function bodies against prod themselves for these 11 functions, only for any additional functions they inspect.

---

## F9. Cron health: all 7 money crons succeeded on their last 3 runs

**Claim:** Check the last 3 runs of every money cron for failures.

**Evidence:**
```sql
select j.jobname, r.status, r.return_message, r.end_time
from cron.job j join lateral (
  select status, return_message, end_time from cron.job_run_details d
  where d.jobid = j.jobid order by end_time desc limit 3) r on true
where j.jobname in (...) order by j.jobname, r.end_time desc;
```
All 21 rows (7 jobs × 3 runs) returned `status = 'succeeded'`, `return_message = '1 row'`. Schedule and command text pulled from `cron.job` directly confirms: `daily_ensure_recurring_payments` 02:00, `mark-overdue-payments` 02:15, `reconcile_block_lifecycle` 02:20, `reconcile_seo_renewal` 02:40, `reconcile_payment_integrity` 04:00, `daily_payment_reminders` 06:00 (→ `run_daily_payment_reminders()`, not the bare enqueuer — see F2), `drain_email_outbox` every 2 minutes via `net.http_post` to the `send-email` edge function.

**Refutation attempt:** Checked whether "succeeded" with "1 row" could mask a function that ran but did nothing useful (e.g. returned 0 due to a broken filter) — that's a data-correctness question for later tasks, not a cron-health question; at the infra level, none of the 7 jobs have failed, timed out, or been disabled recently.

**Verdict: CONFIRMED.** No cron-level incident to report. Ordering matches what the docs claim (`mark_overdue_payments` before `reconcile_block_lifecycle` before reminders), with the added wrinkle from F2/F3 that the reminder cron also re-runs `reconcile_block_lifecycle(false)` a second time at 06:00, immediately before sending.

---

## F10. `reconcile_block_lifecycle` runs twice a day, not once

**Claim:** None in the docs explicitly claim this doesn't happen, but `block-lifecycle.md` describes "nightly cron `reconcile_block_lifecycle` at 02:20 UTC" as the sole trigger for the reconciliation, giving the impression of a single daily pass.

**Evidence:** The `daily_payment_reminders` cron (06:00 UTC) calls `run_daily_payment_reminders()`, whose body (from `20260702140000_stage_locked_accounting_emails.sql`, unchanged since) is: `perform public.reconcile_block_lifecycle(false); select public.enqueue_payment_reminders() into v_created;` — i.e. the full stage reconciliation runs a second time, 3 hours 40 minutes after the dedicated 02:20 `reconcile_block_lifecycle` cron, immediately before reminders are sent.

**Refutation attempt:** Checked whether this is harmless idempotent re-assertion (most likely, since `reconcile_deal_stage` is a pure recompute-and-move-if-different function) versus a source of double-processing. `reconcile_deal_stage` only moves a deal if `v_target is distinct from cur_code`, and its side effects (`block_deal_jobs` / unblock) are themselves idempotent (`and not j.is_blocked` / unconditional clear). Running it twice in one morning should be a no-op the second time for any deal whose stage hasn't organically changed between 02:20 and 06:00 (e.g. from a manual accounting action) — which is intentional per the migration's own comment ("MOVE every deal to its column, THEN send stage-locked"), specifically so a reminder is never sent from a stage snapshot that's already stale by the time the email fires.

**Verdict: CONFIRMED as designed, not a defect.** Recorded as a baseline fact for later tasks (e.g. anyone investigating duplicate reminders or unexpected extra stage-move audit-log entries around 06:00 UTC should know this second reconcile pass is intentional, not a bug).

---

## F11. [VAT] A0 (cash/no-VAT deals charged VAT) re-measured 2026-08-26: worse, not better

**Claim (brief's re-measurement target):** 2026-08-06 baseline was 11 deals / 19 rows / €912.31 VAT collected on paid rows where `payment_method='cash' AND NOT cash_charge_vat AND vat_rate>0 AND status='paid'`.

**Evidence:** Ran the brief's exact step-1 SQL live 2026-08-26:
```sql
select d.code, d.payment_method, d.cash_charge_vat, count(*) as rows_at_24,
       sum(dp.amount_net * dp.vat_rate/100)::numeric(12,2) as vat_collected
from public.deal_payments dp join public.deals d on d.id = dp.deal_id
where d.payment_method = 'cash' and not coalesce(d.cash_charge_vat, false)
  and dp.vat_rate > 0 and dp.status = 'paid'
group by 1,2,3 order by 5 desc;
```
Result: **12 deals / 19 rows / €977.11** — codes `000299` (€264.93), `000508` (€144.00), `000329` (€96.00), `000257` (€96.00), `005023` (€64.80), `006881` (€64.80), `005510`/`000313`/`000338`/`000203` (€48.00/€48.00/€48.00/€42.58), `000477` (€36.00), `006851` (€24.00).

Movement over the 20-day window: **+1 deal, same row count (19), +€64.80 VAT collected.** The bug is not shrinking; it is actively adding new incorrectly-charged rows at roughly the same pace old ones get manually corrected.

**Refutation attempt:** Considered whether the 12th deal is just a reclassification of one of the original 11 (e.g. a deal that moved payment methods) rather than a genuinely new occurrence — inconclusive without the original 11 codes (not recorded in the 2026-08-06 report), but irrelevant to the verdict either way: whether it's a reclassification or a fresh occurrence, live money is still being over-collected today at a materially unchanged rate. See F12 for why: two deals in this list (`006851` created 2026-08-03, `006881` created 2026-08-11) were created *after* both the 2026-07-02 `cash_charge_vat` fix and the 2026-07-20 `vat_rate_for_country` centralization, proving the root cause is still live, not historical residue.

**Verdict: CONFIRMED — ongoing, worsening.** No regression fix has actually stopped new cash-no-VAT deals from being overcharged.

---

## F12. [VAT] Root cause of A0 found: `seed_deal_payments()` never checks `cash_charge_vat` — only `release_billing_jobs_for_deal`/`release_jobs_for_deal` do

**Claim:** A0 persists despite `20260702160000_cash_charge_vat.sql` (added the cash-no-VAT rule) and `20260720170000_vat_rate_for_country_helper.sql` (centralized country VAT). Investigated why.

**Evidence:** The live AFTER-INSERT trigger on `deals` (`deal_payments_seed_after_insert` → `seed_deal_jobs_and_payments`, unchanged orchestration since `20260617000013_jobs_at_won_cutover.sql`, latest body in `20260713150000_jobs_per_type_billing.sql`) does exactly:
```sql
perform public.release_billing_jobs_for_deal(target_deal_id);
perform public.seed_deal_payments(target_deal_id);
```
`release_billing_jobs_for_deal` computes `v_vat` with the full rule: `cash & not cash_charge_vat → 0; cyprus/UAE → 0; else 24`. But `seed_deal_payments` (live body = `20260720170000_vat_rate_for_country_helper.sql`, confirmed MATCHES-REPO in F8/baseline) computes:
```sql
vat := public.vat_rate_for_country(client_country);
```
— **country only, with no reference to `cash_charge_vat` anywhere in the function.** Since `deal_payments` (not `jobs`) is what's actually invoiced/collected, every cash-no-VAT deal gets a correctly-seeded 0%-VAT job but a wrongly-seeded 24%-VAT (or country-rate) first payment row, from the moment the deal is created.

Confirmed still live today via deal-level detail pulled for the F11 deals:

| deal | created | payment_method/cash_charge_vat | job vat_rate | first deal_payments row vat_rate |
|---|---|---|---|---|
| `006851` | 2026-08-03 | cash / false | 0.00 (`006851-LOCALSEO`) | 24.00 (paid €100 net → €24 VAT) |
| `006881` | 2026-08-11 | cash / false | 0.00 (`006881-LOCALSEO`, `-LOCALSEO-2`) | 24.00 on both rows (paid €70+€200 net → €64.80 VAT) |
| `005510` | 2026-07-27 | cash / false | 0.00 (`005510-ADS`) | 24.00 on both the paid AND the newer pending row |

All three were created weeks after both fix migrations. This is not historical drift left over from before the fix — it is the fix's own gap, still firing on brand-new deals.

**Refutation attempt:** Checked whether `seed_deal_payments` might be an old/dead code path superseded by something newer that does check `cash_charge_vat` — no; F8 already independently confirmed (via case-insensitive migration search) that `seed_deal_payments`'s live body exactly matches its true latest migration, `20260720170000_vat_rate_for_country_helper.sql`, which only added the UAE branch to `vat_rate_for_country` and left the cash-VAT gap completely untouched (that migration's own header lists `seed_deal_payments` as one of three functions "touched," but only for the country-helper swap, not for `cash_charge_vat` awareness).

**Verdict: CONFIRMED — this is the live, root-cause mechanism behind F11/A0.** `seed_deal_payments` needs the same `case when payment_method='cash' and not cash_charge_vat then 0.00 …` guard that `release_billing_jobs_for_deal`/`release_jobs_for_deal` already carry. This is a one-function fix (plus, separately, a decision on whether to retroactively correct/refund already-collected wrong-VAT rows — an owner decision, out of scope here).

---

## F13. [VAT] The bug self-perpetuates through recurring chains; it does not self-heal

**Claim:** Investigate whether a wrongly-seeded first period corrects itself on renewal.

**Evidence:** `ensure_recurring_payments()` (live body matches `20260806210000_ensure_recurring_ignores_cancelled.sql`, F8) generates each new period by copying the previous row's own `vat_rate` forward verbatim — `values (r.deal_id, r.service_type, r.service_index, r.billing_type, r.amount_net, r.vat_rate, next_start, next_end)` — it never recomputes VAT from `cash_charge_vat`/country. Confirmed live: deal `005510`'s second `ads` period (pending, start `2026-08-27`) inherited `vat_rate=24.00` from its already-wrong paid first period — the error propagates forward automatically, indefinitely, until a human manually edits a row.

The reverse is also visible: deal `000203`'s `local_seo` chain shows period 1 (paid, start `2026-05-29`) still at the wrong 24% (€177.42 net → €42.58 VAT, already collected, matches its share of F11's total), but periods 2–4 (from `2026-06-29` onward, including a still-pending future row) at the correct 0% — someone manually corrected the row *after* period 2 was generated (had `ensure_recurring_payments` generated period 2 itself by copying period 1, it would also read 24%, not 0%). The job snapshot (`000203-LOCALSEO`, `vat_rate=24.00`) was never updated to match either the original or the corrected value — it's a write-once field, stale from creation.

**Refutation attempt:** Checked whether some other nightly function re-normalizes `vat_rate` on unpaid rows against current deal state — no such function exists; `reconcile_payment_integrity` (04:00 cron, F9) only checks `duplicate_period` and `flip_out_of_paid_in_full`, nothing VAT-related.

**Verdict: CONFIRMED.** The defect compounds through every recurring cycle it isn't manually caught on, and even a manual catch only fixes rows generated afterward — the already-paid historical rows and the job's `vat_rate` snapshot are left permanently wrong unless someone also back-corrects them by hand.

---

## F14. [VAT] The one existing automated check for this class of bug only looks at `jobs.vat_rate`, never `deal_payments.vat_rate` — structurally blind to F11/F12

**Claim (brief, step 3):** "the blind spot that hid A0 — alerts audit jobs only."

**Evidence:** `accounting_integrity_alerts()` (live body md5 `b477063586f74cbfa131df06722715de`, matches latest migration `20260806170000_invisible_card_alert.sql`) has exactly two VAT-related checks:
- check 3 `vat_missing`: `... from jobs j join deals d ... where not j.archived and coalesce(j.amount_net,0)>0 and coalesce(j.vat_rate,0)=0 and not (cash-no-vat) and country not in (cyprus, UAE)`
- check 15 `cash_deal_with_vat`: `... from jobs j join deals d ... where not j.archived and coalesce(j.amount_net,0)>0 and coalesce(j.vat_rate,0)>0 and d.payment_method='cash' and not coalesce(d.cash_charge_vat,false)`

Both reference **only `jobs.vat_rate`**, never `deal_payments.vat_rate`, anywhere in their `WHERE` clauses (confirmed by reading the full live function text). Since `release_billing_jobs_for_deal` seeds `jobs.vat_rate` *correctly* for the cash-no-VAT case (F12), check 15 can never fire for the F11 population — their jobs are fine; only their `deal_payments` rows (the actually-collected money) are wrong. This RPC-backed dashboard (`src/features/accounting/alerts/hooks/useIntegrityAlerts.ts`, calling the same-named RPC) is the only automated surface accounting staff have for this category, and it cannot see the bug that's actually costing money.

**Refutation attempt:** Tried to empirically confirm "0 real alerts fire today" by calling `accounting_integrity_alerts()` directly — it returned `[]` for *every* check_key, not just the VAT ones. Investigated why: the function opens with `if not (public.current_user_is_admin() or public.current_user_in_group('accounting')) then return; end if;`, and under this audit's raw superuser DB connection `auth.uid()` is `null` (confirmed: `select auth.uid()` → `null`, `current_user_is_admin()` → `false`). So the empty result is an artifact of calling it outside an authenticated app session, **not** evidence about what real accounting users see — that part could not be verified live from this read-only connection and is NOT being claimed as confirmed.

**Verdict: CONFIRMED (structural blind spot, by static code reading, independent of the live-call caveat above).** `vat_missing`/`cash_deal_with_vat` would need an added `OR` arm comparing `deal_payments.vat_rate` (per billing period) against the same expected-rate formula to actually catch F11/F12. NEEDS-OWNER on whether/how to extend the check — flagging, not fixing, per this audit's read-only mandate.

---

## F15. [VAT] The brief's own step-2/step-4 SQL has the same stale-country-list bug F5–F7 already found elsewhere: it omits UAE

**Claim (brief, step 2):** "only Cyprus clients are legitimately 0%" — query filters `country not ilike 'cyprus'`.

**Evidence:** Per F8's baseline (invariant 5) and directly re-confirmed by reading `20260720170000_vat_rate_for_country_helper.sql`: `vat_rate_for_country()` — the single source of truth used by every seeding function since 2026-07-20 — returns 0% for **Cyprus and United Arab Emirates**, not Cyprus alone. Running the brief's literal step-2 query surfaces deal `006122` (client country = United Arab Emirates, `payment_method='online'`) as a "mirror bug" hit: 1 paid + 1 overdue row at 0% VAT, €350 each. Checked the deal directly: `006122`'s job (`006122-AISEO`, `vat_rate=0.00`) and both its payment rows are internally consistent and correct under the current rule. The same stale-list bug independently reappears in the brief's step-4 query (`... when cyprus then 0.00 else 24.00 end`), which would flag `006122`'s pending/overdue rows a second time for the same non-reason.

**Refutation attempt:** None needed beyond the code citation above — this is the same class of methodology bug F5/F6/F7 already catalogued in Task 1, just recurring in Task 2's brief.

**Verdict: REFUTED for deal `006122`.** Not a bug. Flagging so any future re-run of these two queries adds `and trim(coalesce(c.country,'')) not ilike 'united arab emirates'` to both.

---

## F16. [VAT] Real (non-UAE, non-zero-value) online/Greek under-collection exists, but is smaller than the raw query suggests and splits into two different explanations

**Claim (brief, step 2 mirror bug):** Online deals charged 0% VAT when they should be 24% represent under-collected money, symmetric to A0.

**Evidence:** Re-ran step 2 (UAE-corrected) against production. Real, non-zero hits, opened deal-by-deal:

- **Bulk-import legacy cohort (likely legitimate, not a live bug):** 470 deals were created in a single bulk import on **2026-06-17** (confirmed: `select created_at::date, count(*) from deals group by 1 order by 2 desc` → `2026-06-17: 470`, next-highest day is 11). Deals `000090`, `000136`, `000276` (all created 2026-06-17, `actual_close_date` backdated into May/early June, i.e. pre-dating the accounting system's own launch) show their **first** billing period at 0% VAT and every period generated afterward correctly at 24% — e.g. `000276-local_seo`: period 1 (`2026-05-22`→`06-22`, €200, 0%) then periods 2–4 all at 24%. This shape (only the earliest, pre-launch period wrong; everything generated after launch correct) is consistent with the import faithfully recording what was actually invoiced to the client before the system existed, not a live seeding defect. Combined principal ≈ €1,890 (`000090`: €1,600; `000136`: €170 across two services incl. a `hosting` row that's oddly 0% while an identical `hosting` job on deal `000090` is correctly 24% — inconsistent seeding within the same import batch, but still pre-launch-dated). **NEEDS-OWNER**: cannot be confirmed as either "correct historical record" or "import bug" without asking whoever ran the 2026-06-17 migration/import.
- **Live payment-method-drift cases (real, current, ongoing):** `000229` (created 2026-06-17, but its own `actual_close_date` = `2026-06-17`, i.e. NOT a backdated pre-launch deal) has its job **and both** payment installments at 0% VAT for a `payment_method='online'`, Greece deal — every version of the seeding code this audit found (F12, and the pre-cash_charge_vat versions back to `20260610000004`) computes 24% for Greece regardless of payment method, so 0% here can't be explained by any known seeding-code version; the only remaining explanation is the deal's `payment_method` was originally `cash` (job+payments seeded 0% consistently) and was later switched to `online` without recalculating VAT — the exact mechanism the brief's step 4 targets. €400 already paid, €400 still pending (would under-collect ≈€96 in VAT if paid as-is). `000935` (created 2026-07-07 — after every fix migration, no bulk-import backdating possible) shows the identical signature: job + both recurring periods at 0% for an online/Greek deal, €400 total. **CONFIRMED as a live, current risk** for both `000229` and `000935` — recommend accounting review the pending rows before they're marked paid.
- **Zero-value rows (immaterial):** `000084` (3 rows, €0.00 each) and `000306`'s recurring `social_media` chain (all 4 periods, €0.00 net, vs. its sibling one-time `social_media` job correctly at 24%) are technically mismatched on VAT rate but bill €0 regardless, so 0%×€0 = 24%×€0 = €0. **REFUTED as a money-impact bug** (still a minor data-hygiene nit worth a value-check constraint, not a financial finding).

**Refutation attempt:** For the bulk-import cohort, checked whether *any* post-launch-dated deal shows the same "first period free" shape (which would refute the pre-launch-invoice theory and point to a live bug instead) — found `000935`, but it doesn't match the shape (both periods, not just the first, are 0%), consistent with it being the payment-method-drift mechanism instead, not the same legacy-import mechanism as `000090`/`000136`/`000276`.

**Verdict: MIXED.** Bulk-import-cohort hits: NEEDS-OWNER (probably legitimate history, ≈€1,890 principal, cannot rule out import error). `000229`/`000935`: CONFIRMED live risk (≈€800 principal, ≈€192 VAT at stake, driven by the same class of payment-method-drift bug the brief's step 4 targets). `000084`/`000306`'s zero-value rows: REFUTED as a money bug.

---

## F17. [VAT] The seeding bug also reaches far-future one-off renewal rows, not just the next recurring period

**Claim:** Check whether F12's `seed_deal_payments` defect is limited to the *immediate* next billing period.

**Evidence:** Deal `000338` (cash, `cash_charge_vat=false`) has a `domains` renewal `deal_payments` row dated **`start_date = 2028-05-11`** (created 2026-08-04, i.e. seeded nearly two years ahead of when it's due) at `vat_rate=24.00`, while its corresponding job (`000338-DOMAINS`) is correctly `vat_rate=0.00`. Same root cause as F12 — `seed_deal_payments` doesn't check `cash_charge_vat` regardless of how far in the future the row it's creating is dated.

**Refutation attempt:** None needed; this is the same mechanism as F12, just confirming its reach extends to far-future one-off rows (domain/hosting renewals), not only near-term recurring periods.

**Verdict: CONFIRMED — same root cause as F12, wider blast radius than "next month's invoice."** If left unfixed, this specific `000338` row will silently over-collect €4.80 (€20 × 24%) in 2028 unless someone happens to notice and correct it first — a small amount, but illustrative of how long-lived the defect's effects are once seeded.

---

## F18. [RENEWAL] Generator body and stop conditions confirmed live, no drift (Step 1)

**Claim:** Read `ensure_recurring_payments`'s live body and catalogue what stops generation.

**Evidence:** Live body matches `supabase/migrations/20260806210000_ensure_recurring_ignores_cancelled.sql` exactly (already established as MATCHES-REPO in F8). The loop's candidate selection requires ALL of: `billing_type in ('recurring_monthly','recurring_yearly')`, `end_date <= current_date + 7d`, `deal.archived = false`, deal's `accounting_stage_id` code `<> 'closed'` (falls through on NULL via `coalesce(...,'')`), `dp.status <> 'cancelled'` (the A5 fix), an active non-archived job exists matching `(deal_id, service_type, billing_type)` — note: **matched by `service_type`, not `service_index`**, contrary to the documented invariant that "recurring series are linked by `(deal_id, service_index)`" — and no newer non-cancelled row already exists for that `(deal_id, service_type, billing_type)`. It copies `amount_net` and `vat_rate` forward verbatim from the row being extended (already F11/F13/A7 territory, not re-reported here).

**Refutation attempt:** Checked whether `service_index` is used anywhere in the function — no, every join/exists/not-exists predicate in the function keys on `service_type` + `billing_type` only. This means two jobs sharing a `service_type`+`billing_type` on the same deal (e.g. a service that was replaced/re-added with a new `service_index`) are treated as one interchangeable chain by the generator, even though the docs describe them as logically separate series. Not chasing this further here — no live case was found needing it (see F20's `000126` for the only near-miss, which is a different job's `service_type`, not a same-type collision) — flagging as a latent modeling gap for whoever owns the `service_index` design.

**Verdict: CONFIRMED (documentation, not code, catalogued here for later steps' reference).** No live-vs-repo drift; stop conditions are deal-archived, deal-accounting-stage-closed, cancelled-status, and no-matching-active-job — all four are exercised by real data in F19–F20 below.

---

## F19. [RENEWAL] A5 re-measured: cancelled-topped chains keep growing (47→67 of 425) but the "accidental pairing" that makes them harmless still holds for every single one, 20 days after the fix

**Claim (re-measurement target):** 2026-08-06 baseline was 47/410 chains topped by a `cancelled` row, and the migration's own text warned this population "is currently held shut only by [an] accidental pairing" between `job_pause_billing` cancelling rows and clearing `billing_active` in the same call — a pairing that `job_resume_billing` deliberately breaks.

**Evidence:** Ran the brief's exact step-2 SQL live 2026-08-26:
```sql
with heads as (
  select distinct on (dp.deal_id, dp.service_type, dp.billing_type)
         dp.deal_id, dp.service_type, dp.billing_type, dp.status, dp.end_date
  from public.deal_payments dp where dp.billing_type like 'recurring%'
  order by dp.deal_id, dp.service_type, dp.billing_type, dp.end_date desc)
select status, count(*) from heads group by 1;
```
Result: `cancelled=67, overdue=76, pending=72, paid=210` — **425 total chains** (up from 410), **67 cancelled-topped (up from 47)**, i.e. +20 chains paused in 20 days, roughly one a day — consistent with normal `job_pause_billing` usage, not an anomaly.

Went further than the brief and directly tested the exact risk the migration flagged — a cancelled-headed chain whose job has since been resumed (`billing_active=true`, not archived) while the deal itself is not archived and not accounting-`closed` (i.e., the one combination that would let the generator actually act on it today):
```sql
-- (same heads CTE) ...
select h.deal_id, d.code, h.service_type, h.billing_type, h.end_date
from heads h join public.deals d on d.id = h.deal_id
join public.jobs j on j.deal_id = h.deal_id and j.service_type = h.service_type and j.billing_type = h.billing_type
where h.status='cancelled' and not j.archived and j.billing_active and not d.archived
  and coalesce((select ps.code from public.pipeline_stages ps where ps.id=d.accounting_stage_id),'') <> 'closed';
```
Result: **0 rows.** Also checked all 67 individually for `has_active_job` (matching the generator's own `exists (... billing_active)` predicate) — every one of the 67 is `false`.

**Refutation attempt:** Tried to find even one exception to the "cancel always pairs with billing_active=false" rule across the full 67, not just a sample — none found. Also checked whether the growth rate itself (47→67) might indicate the fix isn't preventing new occurrences of the bug it targeted — no: growth in *count of paused chains* is expected and desired (pausing is a normal accounting action); what matters is whether any paused chain is simultaneously billing-active, and none are.

**Verdict: CONFIRMED — inert today, unchanged from the 2026-08-06 baseline's own caveat.** The population is growing (as expected from normal pause activity) but every single instance still respects the accidental pairing the fix relies on. No `job_resume_billing()` has decoupled the two in the 20 days since the fix shipped. This is not evidence the underlying risk is gone — `job_resume_billing` still leaves cancelled rows in place by design (per the 2026-08-06 migration header) — but there is zero live exposure as of 2026-08-26.

---

## F20. [RENEWAL] Step 3 gap scan: 22 "silently dead" active-recurring-job hits, but 21 are deals correctly excluded because they're accounting-`closed` — real defect found is that closing a deal never clears `jobs.billing_active`/`archived`, not that billing silently died

**Claim (brief, Step 3):** Active recurring jobs whose chain stopped renewing represent billing silently going dead — "lost money every month."

**Evidence:** Ran the brief's exact gap-scan SQL live. **22 hits** (job `billing_active` and not archived, `billing_type like 'recurring%'`, chain's newest non-cancelled `end_date` either NULL or >7 days stale). Pulled per-hit detail (deal `archived`, `accounting_stage` code, job `billing_active`/`archived`) for all 22:

| acct_stage | hits |
|---|---|
| `closed` | 21 |
| `paid_in_full` | 1 |

For the 21 `closed`-stage hits (e.g. `000052`, `000113`, `000132`, `000135`, `000144`, `000162`, `000176`, `000188`, `000219`, `000223`, `000242`, `000246`, `000254`, `000287`, `000298`, `000313`, `000315`, `000320`, `000336`, `000349`, `000364`): `ensure_recurring_payments`'s own WHERE clause explicitly excludes any deal whose `accounting_stage_id` resolves to `closed` (F18) — **this is the generator working as designed**, not a defect. `docs/tech/accounting/renewal-close.md` confirms `closed` is the documented terminal state "when the engagement ends," reached only via the deliberate, permission-gated `close_deal()` RPC (admin / `accounting_onboarding.complete_accounting`) — a human decision, not an accident.

The real gap: `deals_close_jobs_on_close()` (the trigger `close_deal` relies on) is documented to, on close, "for every non-archived, non-terminal-stage job... set `status='completed'`, `completed_at`, clear the block, and move `stage_id`" — **it never touches `billing_active` or `archived`**. So every one of these 21 jobs still reads `billing_active=true, archived=false` today, weeks/months after their deals closed, and several (`000052`, `000113`, `000132`, `000144`, `000188`, `000219`, `000242`, `000246`, `000254`, `000287`, `000298`, `000315`, `000320`, `000336`, `000349`, `000364`) still carry a lingering `overdue` `deal_payments` row from before close, since closing a deal also never touches outstanding `deal_payments` rows.

The 1 `paid_in_full` hit is genuinely different: `000126`'s second `ads` job (`000126-ADS-2`, `recurring_monthly`, created 2026-07-29) has **zero `deal_payments` rows of any status, ever** — checked directly, not just non-cancelled ones. `ensure_recurring_payments` can only ever extend an *existing* row; nothing seeds the first period for a job added to an already-won deal (only the deal-creation trigger, `seed_deal_jobs_and_payments`, calls `seed_deal_payments`). This job's `monthly_amount = 0.00`, so today it costs nothing — but the mechanism (a recurring job added post-hoc to an existing deal never gets an initial billing period, and the generator can't bootstrap one) is a real structural gap the brief's "billing silently dead" framing correctly anticipated, just not in the population it expected. A broader sweep for the same shape (`billing_active` recurring job, zero `deal_payments` rows ever, any deal) returned only this one `000126` row.

**Refutation attempt:** Tried to find a case where a `closed` deal *should* still be billing (i.e., closed by mistake while the client keeps paying) — checked whether any of the 21 have a payment landing *after* their deal's close; all their heads (`paid`/`overdue`) predate or match the close, none show billing activity after `closed`. Also checked reminder exposure: per F2, `enqueue_payment_reminders` only fires for deals currently in `awaiting_payment` (due-soon) or `on_hold` (overdue/final-notice) accounting stages — `closed` is neither, so these lingering `overdue` rows do **not** currently trigger client-facing reminder emails. This is reassuring for today, but is an artifact of the reminder gate, not of anything that resolves the stale `deal_payments`/`billing_active` state itself.

**Verdict: MOSTLY REFUTED as "lost money," CONFIRMED as a data-hygiene gap.** 21/22 gap-scan hits are the generator correctly respecting a human close decision, not silent billing death — but the underlying jobs/payments data is never cleaned up on close, so any report or dashboard that trusts `jobs.billing_active` (without also checking the deal's `accounting_stage`) will overcount active recurring revenue by these closed engagements, and AR/aging views may show phantom "overdue" balances from deals that are officially finished. The `000126` case is a genuine (but currently €0, so immaterial) seeding gap for jobs added after deal creation — NEEDS-OWNER if that pattern (adding a paid recurring service to an already-won deal) is ever used with a non-zero amount.

---

## F21. [RENEWAL] A6 re-measured: unchanged at 4 pairs, all June-vintage, and the affected chains have since gone dormant on their own

**Claim (re-measurement target):** 2026-08-06 baseline was 4 overlapping paid-period pairs.

**Evidence:** Ran the brief's exact step-4 SQL live 2026-08-26 — **still exactly 4 pairs**, all involving the same 3 deals as far back as this task can trace (no new deal codes): `000173` (`social_media`, 2 overlapping pairs among 3 back-to-back periods created `2026-06-22`/`06-23`/`06-24`, one insert per day — the `02:00:00` timestamps on two of the three match the nightly cron exactly, suggesting the generator extended the same chain on consecutive nights from mis-dated existing rows rather than a one-off manual entry), `000067` (`local_seo`, one pair, periods created `06-22` and `07-02`), `000051` (`local_seo`, one pair, periods created `06-22` and `06-23`).

Checked whether these three chains are still actively overlapping/growing today: `000173`'s current chain head is now **`cancelled`** (from F19's step-2b list, `end_date=2026-08-26`, paused via `job_pause_billing`) and `000051`'s current head is also **`cancelled`** (`end_date=2026-09-01`). `000067` is not in the cancelled-heads list; its current head status was not specifically re-verified beyond the fixed 4-pair count staying flat for 20+ days, which itself is strong evidence nothing new is compounding.

**Refutation attempt:** Looked for any *new* overlap pair dated after 2026-08-06 (the prior baseline date) — none found; the count and the deal codes are identical to what the 2026-08-06 baseline implies. Considered whether the pairing detector might be double-counting a single 3-period pileup as 2 pairs for `000173` — confirmed that is exactly what's happening (3 mutually-overlapping periods produce `n·(n-1)/2 = 3` pairs by strict pairwise overlap logic, but the query only returned 2 for `000173` because the earliest and latest of the three don't overlap each other, only each middle-adjacent pair does) — not a bug in the query, just worth noting the "4 pairs" describes 3 distinct incident-chains, not 4.

**Verdict: REFUTED as an active/growing risk, CONFIRMED as static historical residue.** No new overlaps have appeared since 2026-08-06 despite the generator running nightly the whole time, and 2 of the 3 affected chains have since been independently paused (unrelated to this audit). The double-billed periods themselves remain unresolved in the ledger (nobody appears to have cancelled or corrected the earlier overlapping row) — that correction is an owner decision, not something this read-only audit can act on.

---

## F22. [RENEWAL] A7 re-measured: drift population shrank from 30 to 9, no longer includes the two previously-known artifacts, but shows a new *understatement* shape on 3 rows

**Claim (re-measurement target):** 2026-08-06 baseline was 30 jobs with `monthly_amount` ≠ last-billed `amount_net`, with `000415` (double-count) and `000406` (service-swap) flagged as known grouped-billing artifacts not to be treated as real bugs.

**Evidence:** Ran the brief's exact step-5 SQL live 2026-08-26 — **9 rows**, down from 30:

| deal | job | `monthly_amount` | last billed `amount_net` | last `start_date` |
|---|---|---|---|---|
| `000090` | `000090-WEBSEO` | 0.00 | 300.00 | 2026-08-10 |
| `000289` | `000289-LOCALSEO` | 0.00 | 230.00 | 2026-08-24 |
| `000416` | `000416-WEBSEO` | 0.00 | 200.00 | 2026-08-03 |
| `006122` | `006122-AISEO` | 230.00 | 350.00 | 2026-08-20 |
| `005955` | `005955-LOCALSEO` | 200.00 | 100.00 | 2026-08-20 |
| `005523` | `005523-LOCALSEO` | 242.00 | 200.00 | 2026-09-02 |
| `005160` | `005160-LOCALSEO` | 200.00 | 201.61 | 2026-10-02 |
| `004816` | `004816-LOCALSEO` | 240.00 | 240.32 | 2026-08-03 |
| `005815` | `005815-LOCALSEO` | 241.93 | 241.94 | 2026-08-14 |

Raw sum of `(monthly_amount − amount_net)` = **−€709.94**; sum of absolute deltas = **€993.94** (recorded for context only — per the brief's own grouped-billing caveat, this is not money owed, since `amount_net` on multi-line invoices reflects the sum of several jobs, not one). Neither `000415` nor `000406` (the two previously-known artifacts) appear in the new list at all.

Three rows (`000090`, `000289`, `000416`) show a shape not seen in the 2026-08-06 baseline: `job.monthly_amount = 0.00` while the job is still `billing_active` and its live `deal_payments` chain is actively billing a real amount (€300/€230/€200 respectively, all billed within the last 3 weeks). This is the **understatement** mirror of A7's original overstatement framing — the job snapshot now reads "free" while real money keeps flowing through the payment chain, the opposite failure mode from "stale higher price still being charged."

**Refutation attempt:** Checked whether the 3 zero-`monthly_amount` rows might be legitimately `0`-priced jobs whose deal_payments values are themselves stale/wrong (i.e., the payment side is the error, not the job side) — inconclusive without asking accounting which number is authoritative for these three; flagging both directions rather than assuming the job snapshot is right. Checked whether `000415`/`000406` dropped out because they were fixed vs. because the underlying jobs got archived/paused — not traced further; out of scope to re-litigate previously-closed artifacts.

**Verdict: CONFIRMED — real improvement (30→9), but NEEDS-OWNER on the 3 new zero-`monthly_amount` rows** (`000090`, `000289`, `000416`): either the job snapshot should reflect the real €200–300 still being billed, or the payment side is charging a rate that's no longer supposed to apply. Do not add the €993.94 up as money at stake — same grouped-billing caveat as the original A7.

---

## F23. [RENEWAL] Step 6 sanity: no far-future non-domains pending rows; the one "duplicate-pending" hit is a legitimate 3-installment plan, not a duplicate

**Claim (brief, Step 6):** Check for pending rows >13 months out (domains excluded) and for >1 non-cancelled pending/overdue rows sharing `(deal, service, billing_type, start_date)`.

**Evidence:** Future-dated check returned **0 rows** — no non-domains pending row is seeded more than 13 months out live today. The duplicate-pending check returned **1 hit**: deal `000048`, `web_dev`/`one_time`, 2 pending rows both `start_date IS NULL`, amounts €533 and €533. Pulled the full row set including `deal_payment_lines.label`: the deal actually has **3** `web_dev` one-time rows total — `"website (1/3)"` (€534, already `paid`), `"website (2/3)"` (€533, `pending`), `"website (3/3)"` (€533, `pending`) — a deliberate 3-installment payment plan, all created in the same transaction (`created_at` identical to the second), where installments 2 and 3 happen to be the same amount. It is not a duplicate invoice.

**Refutation attempt:** None needed for the future-dated check (clean result). For the duplicate-pending hit, confirmed via `deal_payment_lines.label` that the two flagged rows are distinct line items ("2/3" vs "3/3"), not a double-insert of the same installment — the brief's step-6b dedup key `(deal_id, service_type, billing_type, start_date)` is too coarse for multi-installment one-time billing, where several genuinely-different installments legitimately share a NULL `start_date` (one-time rows don't carry a period boundary the way recurring ones do). This is the same class of "brief's verbatim SQL needs a caveat before calling something a bug" issue already catalogued in F5–F7/F15.

**Verdict: Future-dated check CONFIRMED clean (no hits). Duplicate-pending check REFUTED** — `000048` is a legitimate installment plan, not a duplicate-pending bug. Flagging the query's blind spot (no `label`/line-item awareness) for any future re-run rather than the data itself.

---

## F24. [STATUS] Step 1 clean: no cron gap — 0 rows are stuck `pending` past their live-logic due date

**Claim (brief, Step 1):** Check whether `mark_overdue_payments` is failing to flip rows that should be overdue.

**Evidence:** Ran the brief's verbatim query (`status='pending' and end_date < current_date`) — **0 rows**. Then re-ran split by the *actual* basis the live function uses per billing type (see F25 for why this split matters): `status='pending' and billing_type in ('recurring_monthly','recurring_yearly') and start_date < current_date` (deal not archived) — **0 rows**; and `status='pending' and billing_type='one_time' and end_date < current_date` (deal not archived) — **0 rows**.

**Refutation attempt:** Tried both the naive and the corrected-basis queries specifically because F7's lesson (this task's own F25, below) showed the naive query can hide real drift. Here both forms agree at zero, and F9 (cron health) already confirmed the `mark-overdue-payments` cron has succeeded on its last 3 runs — no reason to suspect a silent failure between checks.

**Verdict: CONFIRMED clean.** No lapsed-but-still-`pending` rows exist today under either the doc's naive due-date model or the function's real per-billing-type model. `mark_overdue_payments` is keeping up.

---

## F25. [STATUS] The brief's Step 2 query is methodologically broken the same way F5–F7/F15/F23 are: it uses `end_date` as the overdue basis for every billing type, but the live function uses `start_date` for recurring rows — all 43 "stale overdue" hits are false positives

**Claim (brief, Step 2):** Rows sitting at `status='overdue'` with `end_date >= current_date` represent stale flips that never un-flip.

**Evidence:** Ran the brief's verbatim query — **43 rows**, `max(end_date) = 2027-07-16`. Before treating this as a finding, read `mark_overdue_payments`'s live body (matches `supabase/migrations/20260709130000_overdue_notifications_exclude_mkifokeris.sql`, MATCHES-REPO per F8) closely: it flips a `pending` row to `overdue` on **two different date bases depending on `billing_type`**:
```sql
(dp.billing_type in ('recurring_monthly','recurring_yearly')
   and dp.start_date is not null and dp.start_date <  current_date)
or (dp.billing_type = 'one_time'
   and dp.end_date  is not null and dp.end_date  <  current_date)
```
For a recurring row, `start_date` is the due date and `end_date` is the *end of the billing period* (a month or a year later) — the function correctly flips a recurring row to `overdue` the day after it's *due*, long before its period *ends*. So `end_date >= current_date` on an `overdue` recurring row is the **expected, correct** shape, not staleness.

Re-ran split by billing type against each type's actual basis column: `status='overdue' and billing_type in ('recurring_monthly','recurring_yearly') and start_date >= current_date` → **0 rows**; `status='overdue' and billing_type='one_time' and end_date >= current_date` → **0 rows**. Breaking down the original 43 by billing type: 40 `recurring_monthly` (`end_date` range 2026-08-27…2026-09-25 — periods ending 1-4 weeks out, entirely normal) and 3 `recurring_yearly` (`end_date` up to 2027-07-16 — a year-long period that just started). Sample: deal `001089`, `ai_seo`, `start_date=2026-08-25` (due yesterday, correctly flipped), `end_date=2026-09-25` (period doesn't end for another month).

**Refutation attempt:** Checked every one of the 43 by billing type/basis rather than assuming — none is `one_time` (where `end_date` would be the right column and a hit would be real staleness); all 43 are recurring rows where `end_date` is simply the wrong column to gate on. Also checked for `archived_deal` overdose (a deal getting archived after its row was flipped, which `mark_overdue_payments`'s own `d.archived=false` guard wouldn't un-flip) — 0 rows.

**Verdict: REFUTED as stated — 0 real hits, 43/43 false positives from a wrong-column query.** This is the same class of bug as F5–F7/F15/F23: a brief query written against the *documented* (`billing-model.md`'s implied single "due = end_date" model) rather than the *actual* per-billing-type overdue basis the 2026-07-02 migration (`20260702180000_overdue_grace_day.sql`, which introduced the split) put live. Flagging so nobody re-runs the brief's literal step-2 SQL and reports 43 stuck-overdue rows as a real defect — there are none.

---

## F26. [STATUS] Step 3 paid-row hygiene: the few hits are already-known, immaterial patterns, not new defects

**Claim (brief, Step 3):** Check paid rows for null/inverted dates, non-positive `amount_net`, and paid rows sitting on archived deals.

**Evidence:**
```
null_dates:  6   inverted: 0   nonpositive: 8   archived_deal: 0
```
- **`null_dates` (6):** all 6 are `web_dev` / `one_time` rows (deals `000044`, `000098`, `000200`, `000513`, `005230`, `005820`), each with both `start_date` and `end_date` NULL and a real `paid_at`. This is the same shape F23 already catalogued and explained: multi-installment one-time web-dev projects (e.g. `000048`'s "website (2/3)/(3/3)") legitimately carry no period boundary — a one-time deliverable installment isn't a billing *period*, so `start_date`/`end_date` are meaningless for it and are left NULL by design at entry. Not a hygiene defect.
- **`inverted` (0):** clean.
- **`nonpositive` (8):** all 8 are `amount_net = 0.0000` (7 at `vat_rate=0`, one — `005497` — at `vat_rate=24` but still `amount_gross=0`). Deals `000084` (3 rows) and `000306` (2 rows) are exactly F16's already-flagged "zero-value rows, immaterial" population (REFUTED as a money bug there — 0%×€0 = 24%×€0 = €0 regardless of rate). Three more of the same shape not previously enumerated: `000468`, `000477`, `005497` — same pattern (recurring_monthly, €0 net), same conclusion.
- **`archived_deal` (0):** no paid row sits on an `archived=true` deal with `dp.status in ('pending','overdue')` (this query checks the archived-flag population specifically, distinct from Task 3's F20, which found 21 lingering `overdue`/`billing_active` rows on `accounting_stage='closed'` deals — `archived` and `closed` are different signals, and the `archived` one is clean).

**Refutation attempt:** For `nonpositive`, checked whether any of the 8 is a *material* mispriced row masquerading as zero (e.g. a data-entry error rather than an intentionally free service) — all 8 have `label` NULL and round €0.00, consistent with the "free tier"/goodwill-service pattern already established for `000084`/`000306` in F16, not a new class of error.

**Verdict: CONFIRMED clean / no new defect.** Every hit in this step is either explained by F23 (installment plans have no period dates) or F16 (immaterial zero-value rows) already on record. Recording the exact counts here for completeness, not as a new problem.

---

## F27. [CANCELLED] Complete consumer inventory: every DB-side function/trigger that branches on `status='cancelled'` handles it correctly; the gaps are in the two frontend surfaces that never learned about it

**Claim (brief, Step 4):** Grep every migration referencing `'cancelled'`, list every real consumer (`deal_payments.status='cancelled'` specifically, not the unrelated `pipeline_stages`/`jobs`/`pro_formas` uses of the same word), and check each handles it sanely.

**Evidence — writer:** Exactly one writer exists (confirmed by `20260806210000`'s own header and independently by grepping every `set status = 'cancelled'` in `supabase/migrations`): `job_pause_billing(p_job_id)` (`20260702100000`, unchanged since) — on pause, excuses the chain's unpaid *recurring* rows (`status in ('pending','overdue') → 'cancelled'`) for the paused job's `(deal_id, service_type)`. `job_resume_billing` never un-cancels them; it inserts a fresh `pending` row starting today (by design, per F19).

**Evidence — every DB consumer, and its verdict:**
| consumer | how it treats `cancelled` | verdict |
|---|---|---|
| `deal_payments_status_check` CHECK | allows it (widened `20260702100000`) | correct (F1) |
| `deal_payments_recurring_period_key_unique_v2` (partial unique index) | excludes cancelled rows from the uniqueness key | correct — lets `job_resume_billing`/manual re-billing reuse the same period without a unique-violation |
| `deal_next_due(deal_id)` | `status <> 'paid' and status <> 'cancelled'` | correct — a cancelled row is never "next due" |
| `ensure_recurring_payments()` | excludes cancelled from candidate selection and from the successor-guard (`20260806210000`, audit A5) | correct, and CONFIRMED inert live (F19) |
| `deal_payments_no_duplicate_period()` trigger | cancelled rows don't block a same-period re-insert | correct — supports resume |
| `deal_payments_release_from_on_hold()` trigger | excludes cancelled from "any outstanding row" check, **but only fires on an UPDATE that sets `NEW.status='paid'`** | correct in isolation, but see the gap this creates below (F28) |
| `reconcile_deal_stage()` | `v_next_due` computed with `status not in ('paid','cancelled')` | correct, but only reached for `awaiting_payment`/`paid_in_full` — `on_hold` returns before this line (see F28) |
| `reconcile_block_lifecycle()` | delegates entirely to `reconcile_deal_stage` (no direct `cancelled` reference in the live body — F3) | correct by delegation |
| `reconcile_payment_integrity()` (04:00 cron) | `duplicate_period` check excludes cancelled; `flip_out_of_paid_in_full` check uses `deal_next_due` (excludes cancelled) | correct — and this is exactly what caught F28, see below |
| `accounting_integrity_alerts()` (on-demand RPC, not cron — F14) | 4 of its checks reference cancelled: `vat`-unrelated `paid_in_full`-with-unpaid, **`on_hold_not_overdue`** (`ps.code='on_hold' and not exists(... status not in ('paid','cancelled') and start_date < current_date)`), `billing_gap` (`status<>'cancelled'`) | correct — `on_hold_not_overdue` is precisely the check that would surface F28's deadlock |
| `enqueue_payment_reminders()` | `dp.status in ('pending','overdue')` — cancelled excluded by omission | correct — verified directly in the live body, not just inferred (see correction below) |
| `recompute_job_period_dates()` | ignores status entirely except `'paid'` | correct for its narrow purpose (due-date display only cares about the newest paid period); doesn't need to know about cancelled |
| UI: `PaymentsPanel.tsx` (row badge) | renders a distinct muted/line-through "Cancelled" badge | correct display — but see F28's toggle gap |
| UI: `AccountingKanbanCard.tsx` (`paymentSummary()`) | does **not** exclude cancelled from its `paid/total` ratio | **bug — F28** |

**Refutation attempt:** Tried to find a DB-level consumer that got cancelled wrong — none did; every backend function/trigger either explicitly excludes cancelled or (correctly) doesn't need to reference it. Also grepped `src/` for any status-summing code outside `deal_payments`/`accounting_report` and `PaymentsPanel`/`AccountingKanbanCard`/`useRecurringClients` (which correctly treats cancelled as "not due," by omission from its `pending`/`overdue` filter) — no other consumer touches per-row `deal_payments.status` directly.

**Correction (`enqueue_payment_reminders`, caught in review):** the original evidence sentence for this row claimed "0 cancelled rows are inside a send-eligible window" — that is **wrong**; the live check actually run (`audit-04-status.mjs`, key `step4_cancelled_in_reminder_window`) returned **count = 4**, not 0. The query was: cancelled `deal_payments` rows whose deal is currently non-archived and sitting in an `awaiting_payment` or `on_hold` `accounting_onboarding` stage — i.e. 4 cancelled rows belong to deals that are, right now, in a stage the reminder function does target. That is real and the "0" claim should not have been made. It is still immaterial, for a reason independent of the deal's stage: `enqueue_payment_reminders`'s live body (F2) filters candidate rows with `where dp.status in ('pending','overdue')` before any stage/date logic runs — a row with `status='cancelled'` fails that predicate unconditionally and can never reach the `CASE ps.code = ...` classification, regardless of which stage its deal is in or how close `start_date` is to today. So while 4 cancelled rows do sit on reminder-eligible deals, none of them can be selected by the function; the correct live count of cancelled rows that could be emailed is 0, and it is 0 by construction of the `WHERE` clause, not because no cancelled row happens to sit on an eligible deal today.

**Verdict: CONFIRMED — the backend is fully cancelled-aware; two frontend surfaces are not.** See F28 for the two concrete, live-data-verified bugs this surfaces.

---

## F28. [CANCELLED] Two live frontend bugs from treating `cancelled` as "still counts": the Accounting Kanban mislabels 63 fully-settled deals as "Partial", and the Payments panel lets one click silently revive an excused row as paid

**Claim:** Given F27's inventory, check whether any UI surface still counts a `cancelled` row as outstanding money or as a normal togglable row.

**Evidence — Kanban miscount (data bug, 63 live hits):** `src/features/accounting/AccountingKanbanCard.tsx`'s `paymentSummary()`:
```ts
const paid = list.filter((p) => p.status === 'paid').length;
const status = paid === 0 ? 'pending' : paid === list.length ? 'paid' : 'partial';
```
`list` is the deal's full, **unfiltered** `deal_payments` array (`useAccountingDeals.ts` selects `deal_payments(id, status, invoice_number, end_date, amount_gross)` with no status filter — and its own TS type only declares `'pending'|'paid'|'overdue'`, silently dropping `'cancelled'` from the type even though the query returns it). Since `list.length` includes cancelled rows in the denominator, any deal where every *real* obligation is paid but one chain was excused via `job_pause_billing` computes `paid < list.length` and renders **"Partial"** instead of "Paid". Ran the exact equivalent SQL live:
```sql
with per_deal as (
  select deal_id, count(*) total,
         count(*) filter (where status='paid') paid,
         count(*) filter (where status='cancelled') cancelled
  from deal_payments group by deal_id)
select count(*) from per_deal pd join deals d on d.id=pd.deal_id
where pd.cancelled>0 and pd.paid>0 and pd.paid<pd.total
  and pd.paid+pd.cancelled=pd.total and d.archived=false;
```
Result: **63 non-archived deals** (out of 66 that have any cancelled row at all) currently show "Partial" on the Accounting Kanban even though every non-excused row is paid in full. Examples: `000039` (4 paid + 1 cancelled → shows Partial), `000210` (2 paid + 6 cancelled → shows Partial despite the 2 real rows both being paid).

**Evidence — toggle-to-revive bug (mechanism confirmed, exploitability confirmed, live occurrence not searched for since it'd require a write to detect):** `src/features/deals/PaymentsPanel.tsx`'s `toggleStatus()`:
```ts
const next = row.status === 'paid' ? 'pending' : 'paid';
```
This has no `cancelled` branch — clicking the status badge on a `cancelled` row (which the same file renders with a distinct line-through style, so the UI clearly *knows* it's cancelled) sets `status='paid', paid_at=now()` in one click, with no confirmation dialog (unlike the delete button two columns over, which does have a `ConfirmDialog`). Checked the DB side for a safety net: the only `BEFORE UPDATE` trigger on `deal_payments` (`deal_payments_created_at_immutable`, `20260702000000`) guards `created_at` only — nothing prevents a `cancelled → paid` transition. This would silently undo `job_pause_billing`'s "excuse" decision, re-invoicing money the accountant deliberately decided not to collect, without regenerating the job's `billing_active` state or leaving any audit trail beyond the ordinary `updated_at` bump.

**Refutation attempt:** For the kanban miscount, checked whether the "Partial" badge drives anything beyond display (stage moves, filtering, sorting) — it doesn't; `payStatus` is purely rendered into a `<span>`, so this is a display/trust bug, not a money-safety bug on its own. For the toggle, checked whether any RLS policy or permission check on `useUpdateDealPayment` restricts who can flip status — did not chase this further (out of scope: this task audits status-transition *logic*, not RLS; if only trusted accounting staff can reach this button at all, the blast radius is a mistake, not an attack — still worth fixing since the button gives no indication the click is destructive to the pause's intent).

**Verdict: CONFIRMED, both.** Kanban miscount: **live, currently visible, 63 deals** — accounting staff scanning the board for "who still owes money" will see stale "Partial" badges on fully-settled deals indefinitely (nothing ever fixes this once a chain is paused). Toggle-to-revive: **live mechanism, no live occurrence checked** (would require a write to prove, out of scope for a read-only audit) — flagging as NEEDS-OWNER: minimum fix is disabling/warning on the toggle for `cancelled` rows; the kanban fix is a one-line denominator change (`list.filter(p => p.status !== 'cancelled')`).

---

## F29. [CANCELLED] The "never auto-lift a hold" rule plus `job_pause_billing`'s excuse-in-place semantics combine into a real deadlock: deal `000233` has been on_hold with nothing left owed for 5+ weeks, flagged 4 times by the nightly integrity cron, unresolved every time

**Claim:** Check whether cancelling a deal's last outstanding row while the deal is already `on_hold` can leave it permanently stuck, since `reconcile_deal_stage`'s design decision "B" (`block-lifecycle`/F3) is to never auto-lift a hold.

**Evidence:** `reconcile_deal_stage(p_deal_id)`'s live body (MATCHES-REPO, F8):
```sql
if cur_code = 'on_hold' then
  perform public.block_deal_jobs(p_deal_id);
  return false;                                  -- never computes v_next_due at all
end if;
-- v_next_due (which excludes cancelled) is only reached for awaiting_payment/paid_in_full
```
So once a deal is `on_hold`, the function **returns before it ever re-evaluates whether the deal still owes anything** — the `status not in ('paid','cancelled')` exclusion that correctly ignores cancelled rows (F27) is dead code for any deal already sitting in `on_hold`. The only other path out of `on_hold` is `deal_payments_release_from_on_hold()`, a trigger that fires only on an `UPDATE ... SET status='paid'` — which never happens to a row that gets *cancelled* instead of paid.

Found this live via a direct query for "on_hold deals whose only non-paid rows are all cancelled": **1 hit**, deal `000233`. Detail: its `ai_seo` recurring chain has 3 paid periods (`2026-05-15`→`2026-08-15`) then a 4th period (`2026-08-15`→`2026-09-15`) that is `cancelled` (excused via `job_pause_billing`, job `is_blocked=true, blocked_reason='billing_paused', billing_active=false`); its `hosting` (yearly) and `web_dev` (one-time) rows are both `paid`. **Every row on this deal is either `paid` or `cancelled` — nothing is actually owed** — yet `deals.accounting_stage_id` still resolves to `on_hold` (`updated_at = 2026-08-20`).

This is not a fresh, undetected problem: `reconcile_payment_integrity` (04:00 cron) has fired its `flip_out_of_paid_in_full` alert for this exact deal **4 times** — `2026-07-16`, `2026-07-23`, `2026-08-16`, `2026-08-19` — every one still `resolved_at IS NULL` today. Each firing also triggers an admin `payment_integrity_alert` notification (per the function's own tail). Separately, `accounting_integrity_alerts()`'s on-demand `on_hold_not_overdue` check (F27's table) would also currently match this deal (verified its raw `WHERE` condition against `000233` directly), meaning any accountant opening the alerts dashboard should see it flagged there too, independent of the cron.

**Refutation attempt:** Checked whether `job_resume_billing` on the `ai_seo` job would fix it — it would create a fresh `pending` row starting today and unblock the job, but per the code above `reconcile_deal_stage` would *still* return early on the `on_hold` branch before even looking at that new row, so resuming billing does not release the hold either — only a human manually changing `accounting_stage_id` (or the client actually paying a brand-new invoice that happens to trigger `deal_payments_release_from_on_hold`, which requires a *pending* row to exist and be paid — there isn't one) can clear it. Checked whether this is a one-off — the live scan found exactly 1 deal in this exact shape today, but the mechanism (on_hold + pause-billing on the deal's only outstanding chain) is generic and will reproduce for any future deal that hits both conditions.

**Verdict: CONFIRMED — live, currently unresolved, real defect (not a documentation gap).** The alerting *infrastructure* correctly detects this shape (both the cron's `flip_out_of_paid_in_full` and the on-demand `on_hold_not_overdue` check), but nothing in the codebase can *resolve* it automatically, and the alert has gone unactioned for over 5 weeks across 4 separate firings — this is either a staffing/process gap (alerts aren't being triaged) or a missing feature (no "release on_hold when everything is paid-or-cancelled" path exists at all). NEEDS-OWNER: (1) should `reconcile_deal_stage` recompute `v_next_due` even for `on_hold` deals and auto-release when it comes back NULL (a narrower carve-out than fully reverting design decision B — B was about not auto-lifting on a still-open-but-not-yet-due row, not about a row that's been deliberately excused), and (2) separately, why 4 admin notifications over 5 weeks went unactioned for `000233` specifically.

---

## F30. [REMINDER] Step 1: live `enqueue_payment_reminders` vs. `payment-reminders.md` — the dedupe key itself has changed shape, not just the windows

**Claim (doc, restated for this task):** Windows are exact-day `start_date IN (today+7, today-1, today-7)`; dedupe key is `prefix:payment_id`; one email per payment row.

**Evidence:** Live body (`pg_get_functiondef('public.enqueue_payment_reminders'::regproc)`, matches `supabase/migrations/20260729110000_reminder_breakdown.sql` per F8) confirms F2's window finding and adds a dedupe-key-level correction the brief's Step 1 checklist assumed away:

- **Windows** (re-confirmed): `awaiting_payment` stage + `start_date` in `(today, today+7]` → `payment_due_soon`; `on_hold` stage + 1–6 days past due → `payment_overdue`; `on_hold` stage + ≥7 days past due → `payment_final_notice`. Statuses gate is `dp.status in ('pending','overdue')` — matches the brief.
- **Dedupe key is NOT `prefix:payment_id`.** Since `20260729100000_payment_reminders_same_day_aggregate.sql`, emission is aggregated per `(deal_id, template, due_date)`, and the key actually inserted is `dkey := r.prefix || ':' || r.deal_id || ':' || to_char(r.due_date, 'YYYYMMDD')` — three colon-delimited segments, not two. The legacy `prefix:payment_id` form is checked *only* as a one-way transition guard inside the `per_service` CTE (`where not exists (... l.dedupe_key = cl.prefix||':'||cl.payment_id ...)`) so a payment already reminded under the old per-payment scheme before the 2026-07-29 cutover doesn't get double-emailed under the new aggregate scheme — it is never the key that gets *written* going forward. This distinction matters mechanically: any query (including the brief's own Step 2/3 SQL, see F31/F34) that assumes `dedupe_key = prefix||':'||dp.id` will not match any reminder sent since 2026-07-29.
- **Guards beyond the doc:** `c.status <> 'done'` (2026-07-01, "never email closed clients"), `dp.paid_at is null` (belt-and-suspenders vs. status), `dp.created_at::date < dp.start_date` (2026-07-01, "no-backdated" rule, added after a live incident where 4 overdue reminders went out for payments created and paid the same morning — see `20260701030000_payment_reminders_no_backdated.sql`'s own header). None of these are in `payment-reminders.md`.
- **Payload:** carries `code, client_name, service_type, amount_gross, breakdown, due_date, deal_id` — one more field (`breakdown`, the per-service line-item string) than the doc's list.

**Refutation attempt:** Checked whether the legacy-key transition guard means some *current* sends could still land under the two-segment key (e.g. a fallback path) — no; every `insert into email_outbox` in the live function body builds `dkey` from the three-segment format unconditionally. The two-segment form only ever appears in a `not exists` read, never a write, in this function version.

**Verdict: CONFIRMED — doc is stale on windows (already F2) AND on the dedupe key's shape, which is new information this task adds.** This is not cosmetic: any diagnostic query written against the documented `prefix:payment_id` key silently checks nothing meaningful against live data (quantified in F31).

---

## F31. [REMINDER] Step 2: the brief's own verbatim missed-fire SQL joins on the wrong dedupe-key shape (per F30) and manufactures 126 false "missed" reminders

**Claim (brief, Step 2, run verbatim):** Payments that crossed a `−7/+1/+7` window in the last 60 days with no matching `email_log`/`email_outbox` row at `dedupe_key = prefix||':'||dp.id`.

**Evidence:** Ran the brief's exact SQL live: `pay_final: 33, pay_overdue: 35, pay_soon: 58` — **126 apparent misses**. Before accepting that, checked the dedupe-key shape per F30: since 2026-07-29 every live insert keys on `prefix:deal_id:YYYYMMDD`, not `prefix:payment_id`, so `el.dedupe_key = w.prefix || ':' || dp.id` can only ever match a row from before the 2026-07-29 cutover (or never, for any payment created after) — the `not exists` predicate is true for essentially every row in the 60-day window regardless of whether a reminder was actually sent, because it's checking the wrong key shape.

Re-ran with the key corrected to `w.prefix || ':' || dp.deal_id || ':' || to_char(dp.start_date,'YYYYMMDD')` and the extra guards from F30 (`client.status <> 'done'`, `paid_at is null`, `created_at::date < start_date`) added to match what the live function itself requires before it will even consider a row: `pay_final: 4, pay_overdue: 5, pay_soon: 7` — **16 instances (126 → 16, a 7.9× reduction)**, spanning **8 distinct payment rows** on **5 distinct deals** (`000415` ×2 payments, `000063` ×3, `000341`, `000416`, `000219`).

**Refutation attempt:** Sanity-checked a handful of the 110 rows only the broken query flagged: e.g. deal `001089` (cited in F25 as a normal, currently-overdue recurring row) has definitely received reminders under the new key format this task can see directly in `email_log` (F34's timeline queries show numerous `...:20260826`-style rows for other deals dated today) — the broken query's "miss" for such rows is purely an artifact of checking a key format nothing has written since July.

**Verdict: CONFIRMED — same class of brief-methodology bug as F5–F7/F15/F23/F25.** The real, corrected miss population is 16 instances on 5 deals, not 126. See F32 for why every one of the 16 is real and what's causing it (not an enqueuer bug).

---

## F32. [REMINDER] Step 2 corrected misses, root-caused: every one of the 16 is the deal sitting in a stage the reminder classifier doesn't cover — not an enqueuer defect

**Claim:** Investigate the 5 deals behind F31's 16 corrected misses.

**Evidence:** Pulled each hit's current `acct_stage` directly:
- `000415`, `000063`: **`partial_payment`**. The reminder CASE only classifies `awaiting_payment` (due-soon) and `on_hold` (overdue/final-notice) — `partial_payment` produces `tkey = null` and is filtered out before the dedupe check even runs. `000063`'s missed `pay_final`/`pay_overdue` hit (`start_date=2026-07-27`) is 30 days overdue as of today with zero reminder ever attempted for that specific row.
- `000341`, `000416`: currently `on_hold` — these *are* in a remindable stage today, but the `pay_soon` "miss" this task's date-offset reconstruction flagged is a methodology artifact of proxying historical stage with today's day-offset (this task has no historical `accounting_stage_id`, only the live column) — a deal now `on_hold` was very likely still `awaiting_payment` (or earlier) at the moment its `pay_soon` window would have applied, so this pair should be read as "can't confirm, can't rule out" rather than a confirmed miss.
- `000219`: **`closed`** — a closed deal is excluded from the reminder classifier entirely (same population F20 already found: closed deals retain stale `overdue` `deal_payments` rows with no reminder exposure by design).

**Refutation attempt:** Checked whether `enqueue_payment_reminders` itself has a bug that skips `partial_payment` by mistake (e.g. a typo in the `CASE` condition) — no; per F30's live body and per `20260702140000`'s own header ("Column locks: `payment_due_soon -> awaiting_payment` ... `payment_overdue/payment_final_notice -> on_hold`"), excluding every other stage from reminders — including `partial_payment` — is the explicit, documented design of the 2026-07-02 stage-lock migration, not an accident in this function. The accident, if there is one, is upstream — see F33.

**Verdict: CONFIRMED — 0 of the 16 corrected misses are enqueuer bugs.** They are all downstream of which stages the 2026-07-02 design chose to cover. F33 shows this choice has a real cost.

---

## F33. [REMINDER] Re-measures the 2026-08-04 audit's A2 ("`partial_payment` has no automatic exit") from the reminder side, and extends it: deals parked in `partial_payment` (or `closed`/`done`) never get another reminder either — a structural dead end, not just a stuck-stage gap; oldest live instance is 215 days overdue with zero reminders ever sent

**Claim:** Quantify how much unpaid money currently sits on deals in accounting stages the reminder classifier (F30/F32) doesn't cover, and check whether anything else in the pipeline would eventually catch these deals.

**Relationship to the 2026-08-04 audit's A2:** A2 ("`partial_payment` is a stage with no automatic exit — VERIFIED") already identified the root mechanism this finding depends on: both `reconcile_deal_stage` and `reconcile_block_lifecycle`'s allow-lists are `('awaiting_payment','on_hold','paid_in_full')`, `partial_payment` is in neither, and "a deal that enters `partial_payment` never leaves it automatically, no matter what the client pays — only a human dragging the card moves it." A2's own live count as of 2026-08-06 was **18 deals** stuck in `partial_payment`. This task independently re-derived the same allow-list from the live `reconcile_deal_stage` body (below) before reading A2, confirming the mechanism is unchanged 20 days later, and adds the piece A2 didn't check: **`enqueue_payment_reminders` uses the identical two-stage allow-list** (`awaiting_payment`/`on_hold` only, F30/F32) — so a deal stuck in `partial_payment` per A2 isn't just stage-frozen, it is *also* silently un-remindable for as long as it stays there. That reminder-side consequence, and its live cost in unpaid balance, is new; A2 stopped at "jobs never renew" (via `release_deal_jobs` never firing).

**Reconciling today's count with A2's 18:** re-ran a direct census of *all* non-archived deals currently sitting in `partial_payment` (not filtered by whether they still have an unpaid row) — **15 deals**, all 15 of which do have at least one `pending`/`overdue` `deal_payments` row (0 have already been fully settled while still parked in the stage). So the like-for-like comparison is **18 (2026-08-06) → 15 (2026-08-26)**, a net drop of 3 over 20 days — consistent with normal traffic (some decks get manually dragged out after a human notices, some slower than others) rather than evidence the trap has been fixed; A2's mechanism (both allow-lists exclude `partial_payment`) is still exactly the live code today. The other two rows in the table below — `closed` (27 deals) and `done` (23 deals) — are a **separate population outside A2's scope**: A2 is specifically about the `partial_payment` stage-exit trap; `closed`/`done` are *intentional* terminal stages (already the subject of Task 3's F20, which found `close_deal` never cleans up billing state) that happen to share the same downstream symptom — no reminder ever fires — for a different reason (terminal-by-design, not stuck-by-accident). They're included in this finding's money table because they add to the same "unpaid balance nothing will ever remind about" total, not because they are new instances of A2's mechanism.

**Evidence — the money:**
```sql
select ps.code as acct_stage, count(distinct d.id) as deals, count(*) as unpaid_rows,
       sum(dp.amount_gross) as unpaid_total, sum(dp.amount_gross) filter (where dp.status='overdue') as overdue_total,
       min(dp.start_date) as oldest_due
from public.deal_payments dp join public.deals d on d.id=dp.deal_id and not d.archived
join public.pipeline_stages ps on ps.id=d.accounting_stage_id and ps.board='accounting_onboarding'
where dp.status in ('pending','overdue') and ps.code not in ('awaiting_payment','on_hold')
group by 1 order by 4 desc;
```
| acct_stage | deals | unpaid_rows | unpaid_total | overdue_total | oldest_due |
|---|---|---|---|---|---|
| `closed` | 27 | 42 | €12,040.20 | €12,015.40 | 2026-04-12 |
| `partial_payment` | 15 | 25 | €11,809.35 | €3,591.03 | 2026-01-23 |
| `done` | 23 | 39 | €9,586.20 | €8,884.20 | 2026-04-24 |
| `paid_in_full` | 17 | 21 | €3,936.44 | €0 (all future-dated, expected) | 2026-09-04 |
| `new` / `documents_verified` | 1 each | 1 each | €2.00 / €1.24 | €2.00 / €1.24 | — |

The `paid_in_full` row is benign (future recurring installments already seeded ahead of a fully-paid deal — nothing overdue). The other four are not: **~€24,500 combined overdue balance** sits on deals in stages the reminder classifier structurally cannot reach.

**Evidence — worst single case, `partial_payment`:** Deal `000225`'s `hosting` row, `start_date=2026-01-23`, **215 days overdue today**, €223.20. Cross-checked whether it was ever even attempted: `exists (select 1 from email_outbox where (data->>'deal_id')::uuid = <000225>) = false`, and no `email_log` row (parsed either by legacy `payment_id` suffix or new `deal_id` prefix) matches it either — **zero reminder attempts, ever**, for a payment now 7 months late. Of the 15 `partial_payment` deals, 11 have never had a single payment-reminder attempt in either `email_outbox` or `email_log`; the other 4 (`000063`, `000415`, `000048`, `000183`) do show past reminder activity — from when they were still `awaiting_payment`/`on_hold`, before something moved them into `partial_payment`.

**Evidence — nothing auto-escalates them either:** `reconcile_deal_stage`'s live body (F8-confirmed, matches `20260702150150`) opens with `if cur_code is null or cur_code not in ('awaiting_payment','on_hold','paid_in_full') or not v_pm then return false;` — a deal in `partial_payment` fails this precondition on the very first check and the function returns immediately, computing nothing. `partial_payment` is never a value `v_target` can be assigned to elsewhere in the function either. So a deal in `partial_payment` is *simultaneously*: invisible to the reminder classifier (F32) and untouched by the nightly stage reconciler that would otherwise move it to `on_hold` (which *would* make it remindable again). The only way out is a human manually changing `deals.accounting_stage_id`. `closed`/`done` are dead ends for the same practical reason (terminal stages, F20 already established `close_deal` never revisits billing state).

**Refutation attempt:** Checked whether `partial_payment` is even a stage the system moves deals into automatically (in which case this might be a transient state that self-corrects) — no; grepping every `v_target :=`/`new_code :=` assignment across `reconcile_deal_stage`, `reconcile_block_lifecycle`, and the block-lifecycle helper triggers (`20260504000001`, `20260626000010`, `20260629120000`) turns up handling *for* a deal already in `partial_payment` (adjusting job-release behavior via `release_jobs_for_deal(partial_payment_mode, ...)`) but no code path that *sets* a deal's `accounting_stage_id` to `partial_payment` — it can only be reached by a manual staff action (Kanban column move), consistent with `stage-colors.ts` listing it as a normal, human-selectable Kanban column. So this is a real, standing accounting workflow (staff mark a deal "Partial Payment" when a client pays part of an invoice), and the reminder/reconciler blind spot activates every single time staff use it if there's a remaining unpaid installment.

**Verdict: A2 CONFIRMED, still live 20 days later (18→15 deals, same mechanism, not fixed) — and its reminder-side consequence is CONFIRMED NEW here, currently costing reminder coverage on ~€24.5k of overdue/unpaid balance, worst case 215 days silent.** This is the most material finding of Task 5. NEEDS-OWNER: either (a) extend `enqueue_payment_reminders`'s `CASE` to also classify `partial_payment` (and decide whether `closed`/`done` should ever remind, probably not), or (b) extend `reconcile_deal_stage`'s handled-stage list so a `partial_payment` deal with a payment now overdue gets escalated to `on_hold` (which is already remindable) instead of sitting frozen — option (b) also resolves A2 itself and feeds F29's `on_hold` release-deadlock population, so any fix should consider A2, F29, and this finding together.

---

## F34. [REMINDER] Step 3 wrong-fire audit: brief's SQL is broken the same way as F31 (0-signal by key-shape mismatch); corrected analysis finds 0 genuine wrong-fires; the one "5x duplicate" hit is 5 failed retries of one row, not 5 emails, and surfaces an unrelated malformed-email-address bug

**Claim (brief, Step 3):** Find reminders sent for paid/cancelled payments, suppressed/archived deals, and duplicate sends per dedupe key.

**Evidence — brief's join is dead on arrival:** `el.dedupe_key like '%:' || dp.id` assumes the key ends in `payment_id`; per F30 every live key ends in `YYYYMMDD`, so this predicate can only match by coincidence (never, in practice) for anything sent since 2026-07-29 — running it produces `[]` for the template/status breakdown join in the brief's own first query, which would read as "clean" for the wrong reason.

**Evidence — corrected wrong-fire check**, parsing the true key (`split_part(dedupe_key,':',2)::uuid` = `deal_id`, `split_part(...,3)` = due date), joined back to the matching `deal_payments` row and compared against `email_log.created_at` (send time) vs. `paid_at`:
```
total_parsed=350, no_matching_payment_row=1, now_cancelled=47, paid_before_send=0,
deal_now_archived=0, deal_now_suppressed=10
```
**`paid_before_send = 0`** — no reminder was ever sent for a payment that was *already* paid at send time (the exact race condition the brief was worried about). The 47 "now cancelled" and 10 "deal now suppressed" rows are all consistent with **correct-at-send-time, changed-afterward**: a reminder correctly fired while the row was still `pending`/`overdue`, and only later did accounting pause billing (`job_pause_billing` → `cancelled`, F27) or suppress the deal — not evidence of a wrong-fire.

**Evidence — the "5x duplicate" dedupe_key**, the brief's exact duplicate-check SQL (key-format-independent, since it only groups by exact match) surfaced one real hit: `pay_overdue:c9e5a3c9-...` × 5 in `email_log`, all `status='failed'`, all for `to_email = 'diatypos@otenet.gr / info@diatypos.gr'` — **the client's `email` field contains two addresses joined by `" / "` in a single string**, which is not a valid single recipient. Traced to one `email_outbox` row (`attempts=5`, `last_error='cancelled by admin'`) — the outbox drain retried the same row 5 times (each retry logging its own `email_log` row under the same `dedupe_key`), all failed, and someone in accounting manually cancelled it after the 5th. The underlying payment (`005048`, €300.01) was paid 3 days later regardless, via another channel presumably — no lasting harm, but the malformed `clients.email` value is a distinct, real defect (nothing validates the email column's format on write) and would break *every* email to this client, not just reminders.

**Refutation attempt:** Checked whether the 1 `no_matching_payment_row` case indicates dedupe-key parsing is unreliable more broadly — inspected it individually: it's a single historical row whose underlying `deal_payments` row for that exact `(deal_id, start_date)` no longer exists (plausibly edited/deleted after the reminder fired); immaterial at n=1 and doesn't undermine the other 349.

**Verdict: CONFIRMED — 0 genuine wrong-fires found (brief's own SQL would have reported false-clean here too, for the wrong reason). The "duplicate send" signal is a false alarm** (5 failed attempts of 1 row, not 5 delivered emails) **that incidentally surfaces a real, separate bug: `clients.email` accepts multi-address/malformed values with no validation, silently breaking delivery for that client.** NEEDS-OWNER on adding a basic email-format constraint/validation to `clients.email`.

---

## F35. [REMINDER] Step 4: delivery health is clean in aggregate (99.4% delivered, 30d), but the system genuinely never learns from a hard bounce — 2 addresses bounced repeatedly across their own reminder sequence with no suppression anywhere in the send path

**Claim (brief, Step 4):** Check 30-day bounce/complaint rate and whether previously-bounced addresses keep getting reminded.

**Evidence — aggregate health:** `select status, count(*) from email_log where template_key like 'payment_%' and created_at > now()-interval '30 days' group by 1` → `delivered: 355, bounced: 1, failed: 1` — clean.

**Evidence — repeat-bounce addresses (60-day+ view) and their full timelines:**
- `panosantoniou80@gmail.com`: `payment_due_soon` bounced **2026-07-08**; the *same underlying invoice's* `payment_overdue` bounced again **2026-07-16**; its `payment_final_notice` bounced again **2026-07-22** — three separate sends to a demonstrably-bad address for the same bill, one after another, before a later (different) invoice on **2026-08-19** finally shows `delivered` (address possibly fixed by then).
- `corfuswifttransfer@gmail.com`: bounced **2026-06-27** (`payment_final_notice`), then a *later* invoice's full 3-stage sequence bounced on **2026-07-13 / 07-21 / 07-27** (due-soon, overdue, final-notice all bounced), then a *third* invoice's due-soon bounced again on **2026-08-13** — 5 bounces across 3 separate billing cycles over 7 weeks, zero suppression at any point.

**Evidence — confirmed no suppression exists in the send path:** Read `supabase/functions/send-email/index.ts`'s `sendOne()` in full — its only two send-blocking guards are (1) `dedupe_key` already in a terminal `email_log` status (`sent/delivered/bounced/complained`) and (2) the `clients.status='done'` closed-client check. There is no query anywhere against prior `bounced`/`complained` rows for the same `to_email` before sending. A bounce is recorded (via the Resend webhook updating `email_log.status`) but never consulted.

**Refutation attempt:** Considered whether these are soft/transient bounces that would be expected to eventually succeed (which would make repeat attempts reasonable, not a bug) — `corfuswifttransfer`'s pattern (5/5 attempts bounced, 0 delivered, over 7 weeks) reads as a hard/permanent bounce (dead mailbox or typo'd address), not a transient mail-server hiccup; `panosantoniou80`'s pattern (3 bounces, then 1 delivered a month later) is more consistent with an address that was actually fixed at some point, but the system had no way to know that without just re-trying blind — which is the point: without suppression, "keep trying forever" and "the address got fixed" are indistinguishable from within the pipeline.

**Verdict: CONFIRMED — real, live gap.** No address-level bounce suppression exists anywhere in the accounting (or any) email path; `corfuswifttransfer@gmail.com` is the clean, unambiguous case (100% bounce rate across 3 independent billing cycles, still not suppressed as of this audit). NEEDS-OWNER: add a per-`to_email` hard-bounce check to `sendOne()` (skip + log `'failed'` with a distinct reason, the same way the closed-client guard does) — this is a small, well-scoped fix given the guard pattern already exists for a different condition in the same function.

---

## F36. [REMINDER] Step 5: `payment_due_today`'s template row was actually deleted 2026-07-02, not merely dormant as the brief assumed; the 3 live templates use only 4 of the enqueuer's payload fields — `client_name`/`service_type` are computed and shipped but never rendered

**Claim (brief, Step 5):** Confirm every `{{var}}` used by the 3 live templates is supplied by the enqueuer's payload (`code, client_name, service_type, amount_gross, due_date`), and confirm `payment_due_today` never enqueues while its template row is still present.

**Evidence — template vs. payload:** Read all 3 live `email_templates` rows (`payment_due_soon`, `payment_overdue`, `payment_final_notice`) in full and extracted every `{{var}}` via regex:
| template | vars actually used |
|---|---|
| `payment_due_soon` | `code`, `due_date`, `amount_gross`, `breakdown` |
| `payment_overdue` | `code`, `amount_gross`, `breakdown` |
| `payment_final_notice` | `code`, `amount_gross`, `breakdown` |

Every var used is present in the enqueuer's payload (F30) — **no renamed/missing-variable render-blank bug exists today.** But `client_name` and `service_type` — both of which the enqueuer computes and includes in every `jsonb_build_object(...)` call (and which the brief listed as expected template inputs) — are **not referenced by any of the 3 live template bodies or subjects**. They are dead payload fields: computed, shipped, silently ignored by `interpolate()`. `due_date` is likewise present in the payload but used by only 1 of the 3 templates (`payment_due_soon`) — `payment_overdue`/`payment_final_notice` never mention a date at all, by template design (their copy reads "the previously-scheduled payment" without restating which date).

**Evidence — the render mechanism itself is silent-blank by construction:** `supabase/functions/send-email/templates.ts`'s `interpolate()`: `tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => String(data[key] ?? ''))` — any `{{var}}` in a template with no matching key in `data` renders as an **empty string**, not an error, not a placeholder. Confirmed this is a live, general risk (not specific to payment reminders) — any future template edit that introduces a new `{{var}}` the enqueuer doesn't populate will ship silently blank to clients with no failure signal anywhere in the pipeline.

**Evidence — `payment_due_today` is gone, not dormant:** `select key from email_templates where key='payment_due_today'` → **0 rows**. Full key listing (27 rows) confirms it's absent from the live table entirely. Traced why: `supabase/migrations/20260702140000_stage_locked_accounting_emails.sql` Section 3 explicitly backs the row up to `email_templates_dropped_backup_20260702` and then `delete`s it, with the comment "No trigger + no automation-settings row (audit flag F9). Back up the row, then remove it." `email_log`/`email_outbox`'s last `payment_due_today` activity is **2026-06-24** (2 rows each) — predates the 2026-07-02 deletion, consistent.

**Refutation attempt:** Checked whether the brief's "template row still present" premise might refer to some other table (a frontend-side template constant, `templates.ts`) rather than the DB row — `payment_reminders.md`'s own "DB rows are authoritative" note and this function's own `renderDbTemplate`-first / `renderTemplate`-fallback logic (`index.ts` line ~213) mean the DB row is the one that matters for whether this template *could* ever fire again; it can't, because the row doesn't exist, and even the code fallback (`TEMPLATES[templateKey]`, `templates.ts`'s built-in map) was never checked for a `payment_due_today` entry — moot either way since nothing calls `enqueue_payment_reminders` with that key anymore (F30/F2).

**Verdict: REFUTED on "template row still present"** (it was deliberately deleted 2026-07-02, backed up, not dormant) **— CONFIRMED clean on variable coverage** (no live blank-render bug) **— CONFIRMED as a latent, general risk** (interpolate()'s silent-blank behavior, unrelated to reminders specifically, would hide a future mistake rather than surface it).

---

## F37. [REMINDER] Step 6: 78 non-archived deals have reminders suppressed; the largest overdue balances an owner would likely want visibility into total roughly €8,500 across the top ~10

**Claim (brief, Step 6):** List deals with `suppress_payment_reminders=true` and their unpaid balance; flag large overdue sums the owner may not realize are muted.

**Evidence:** 78 non-archived deals have `suppress_payment_reminders=true`. Roughly half (37/78) have `unpaid_rows=0` — reminders are muted but there is nothing left to remind about (harmless, likely toggled off after full settlement rather than un-toggled). The other 41 have a real muted balance; ranked by overdue amount, the top of the list:
| deal | unpaid total | overdue total | deal last touched |
|---|---|---|---|
| `000298` | €1,271.00 | €1,246.20 | 2026-08-04 |
| `000177` | €1,078.80 | €1,078.80 | 2026-07-07 |
| `000216` | €900.00 | €900.00 | 2026-07-07 |
| `000092` | €868.00 | €868.00 | 2026-07-03 |
| `000498` | €744.00 | €744.00 | 2026-07-07 |
| `000192` | €744.00 | €744.00 | 2026-08-04 |
| `000057` | €744.00 | €744.00 | 2026-07-14 |
| `000160` | €543.12 | €543.12 | 2026-07-17 |
| `005690` | €503.01 | €503.01 | 2026-07-17 |
| `000050` | €500.96 | €500.96 | 2026-07-22 |

Top-10 total: **≈€8,896 in overdue balance, currently muted from any reminder, with no other visible flag** (a suppressed deal renders no differently on the Kanban than a normally-progressing one apart from the Payment-tab toggle itself — this task did not check whether the Kanban surfaces suppression status anywhere at-a-glance).

**Refutation attempt:** Checked whether any of the top 10 look like an obvious "settled via another channel, forgot to update `deal_payments`" pattern (e.g., a `paid_at`-adjacent manual override) rather than a genuinely still-owed balance — no direct evidence either way from this read-only pass; flagging as owed-per-the-ledger, not independently verified against bank records.

**Verdict: CONFIRMED — 78 suppressed deals exist; ~41 carry a real muted balance; the top 10 alone represent ~€8,900 an owner reviewing "who owes us money" via the reminder pipeline would never be nudged about.** NEEDS-OWNER: periodic review of `suppress_payment_reminders=true` deals with `unpaid_balance > 0`, since nothing else in the system currently surfaces this combination (no dashboard, no alert check in `accounting_integrity_alerts()` references `suppress_payment_reminders` at all — grepped its live body, confirmed absent).

## F38. [LIFECYCLE] Step 1 — A2 detail: all 15 stuck `partial_payment` deals itemized; the €0-owed trap does not exist today, but one deal's "unpaid" balance is a 2027 domain renewal, not a real overdue amount

**Claim (re-measurement target):** F33 already re-measured A2's headline (15 deals, all with unpaid rows, €11.8k unpaid). This task's job was the per-deal detail: code, balance, days stuck, recurring services blocked from renewing.

**Evidence — full per-deal listing** (`s1_partial_deals_detail`, live 2026-08-26):

| deal | balance | oldest unpaid due | days overdue | recurring job(s) | renewal-blocked? |
|---|---|---|---|---|---|
| `000088` | €2,000.00 | — (start_date null) | — | none | N/A (one-time only) |
| `000063` | €1,274.83 | 2026-05-27 | 91 | `hosting` (active), `local_seo` (**stale `account_on_hold` block**, stage `new_gbp`) | anomaly, not renewal-blocked (see below) |
| `000415` | €1,240.00 | 2026-07-28 | 29 | `local_seo` ×2, **both stuck in `done` stage** | **YES** — both jobs finished their cycle and cannot reach the `renewal` lane (matches F20's mechanism exactly) |
| `000048` | €1,066.00 | — (null) | — | `hosting` (active) | no |
| `000098` | €914.50 | — (null) | — | `hosting` (active) | no |
| `000225` | €812.20 | 2026-01-23 | **215** | `hosting` (active) | no |
| `000183` | €800.00 | 2026-06-17 | 70 | none | N/A |
| `000168` | €700.00 | — (null) | — | none | N/A |
| `005073` | €678.01 | — (null) | — | none | N/A |
| `000226` | €520.00 | — (null) | — | `hosting` (active) | no |
| `005690` | €503.01 | 2026-07-16 | 41 | `hosting` (active), `web_dev` (terminal `live`, still billing_active), `web_seo` (terminal `closed`, billing_active=false) | no |
| `004556` | €496.00 | 2026-07-06 | 51 | `hosting` (active) | no |
| `000229` | €400.00 | — (null) | — | none | N/A |
| `006846` | €380.00 | 2026-08-06 | 20 | none | N/A |
| `000041` | €24.80 | **2027-05-28** | **−275 (not yet due)** | `domains` (active), `web_seo` (terminal `closed`, billing_active=false) | no |

Sum: **€11,809.35**, matching F33's headline exactly (cross-check, no drift).

**€0-owed trap (the specific check the brief asked for, analogous to F29's `000233`):** ran the exact zero-owed test against the current 15 (`s1_partial_zero_owed_trap`) — **0 rows**. No `partial_payment` deal today has every remaining row `paid`/`cancelled`. Confirms F33's "0 have already been fully settled" from the money-level view, now confirmed at the row-shape level too.

**A wrinkle the headline number hides:** `000041`'s only "unpaid" row is a `domains` renewal due **2027-05-28** — almost nine months out, not overdue at all, just already seeded (F17's mechanism: `seed_deal_payments`/renewal rows get created far ahead of when they're due). So while all 15 deals technically have a non-`paid`/`cancelled` row, one of the 15 (€24.80, the smallest balance in the list) isn't actually a collections problem today — it's a deal parked in `partial_payment` that happens to also carry a future-dated renewal row. This is a milder version of the trap A2 warned about: not "owes literally €0" but "the thing counted as 'unpaid' isn't due for most of a year."

**Recurring services blocked from renewing:** Of the 15 deals, 5 have no recurring job at all (their balance is one-time billing). Of the 10 that do have a recurring job, 9 are `hosting`/`domains`/`web_dev`/`web_seo` jobs sitting in an ordinary ongoing or terminal stage — not actually blocked from anything (billing itself, via `ensure_recurring_payments`, is **not** gated on `partial_payment` — only `closed` stops it, per F18 — so these chains keep invoicing on schedule regardless of the stuck stage). Only **`000415`** shows the real A2 mechanism live: 2 `local_seo` jobs finished their billing cycle and sit in `done`, unable to reach the `renewal` work-lane because `release_deal_jobs` only fires on arrival at `paid_in_full` — which this deal, stuck in `partial_payment`, will never reach without a human dragging the card. `000063`'s `local_seo` job shows a different anomaly: `is_blocked=true, blocked_reason='account_on_hold'` while the deal itself is `partial_payment`, not `on_hold` — a stale block left over from before the deal was moved to `partial_payment` (`deals_hold_jobs_on_stage_change()`'s `partial_payment → no-op` rule, per `deal-lifecycle.md` line 61, means the flag is never re-evaluated once the deal leaves `on_hold` for `partial_payment`). This is exactly the live population the on-demand `stale_block` check (accounting_integrity_alerts check 9) is designed to catch — confirmed still firing for this job today (see F43/F44).

**Refutation attempt:** Checked whether `000415`'s pattern might also exist elsewhere among the 15 by re-scanning all 10 recurring jobs for `job_stage_code='done'` — only `000415`'s two jobs match; no other deal in the 15 has a job stuck in `done`.

**Verdict: CONFIRMED — A2 detail complete.** No €0-owed trap exists among the 15 today (unlike F29's analogous `on_hold` case). The A2 "jobs never renew" mechanism is live and confirmed for exactly 1 of 15 deals (`000415`, 2 jobs); the other 9 recurring jobs among the 15 are unaffected because their billing doesn't require reaching `paid_in_full` to keep invoicing. `000063` surfaces a related but distinct stale-block bug, already covered by an existing (if hard-to-reach) alert check.

---

## F39. [LIFECYCLE] Step 2 — A4 formally closed: `target_accounting_stage` has zero live callers anywhere in the catalog; the single `<` rule is applied correctly to every deal at today's boundary

**Claim (brief's Step 2, corrected per the task instructions):** F4 already established A4 is stale (single rule since `20260702150100`/`20260702150150`). This task's job was to verify F4's claim from the live catalog, not re-measure the dead comparison.

**Evidence:**
- `target_accounting_stage(next_due date, today date)` still **exists** in the catalog (`s2_target_stage_exists`) — unchanged, not dropped.
- Scanned **every** function body in `public` for a textual reference to `target_accounting_stage`, excluding the function's own definition (`s2_target_stage_callers` / corrected as `target_stage_callers_fixed` in the follow-up run) — **0 rows**. No function, anywhere in the live catalog, calls it.
- Scanned every trigger definition (`pg_trigger`) for the same string (`s2_trigger_scan`) — **0 rows**. No trigger calls it either.
- Grepped `src/` (already done implicitly via F4/F8's prior work, re-confirmed here) — no RPC call site.
- Live boundary check: the 5 deals currently sitting with `deal_next_due = today` (`s2_boundary_today`) are **all** `awaiting_payment` — correct under the single live rule (`v_next_due < current_date → on_hold`; `today` is not `< today`, so they correctly stay `awaiting_payment`, not `on_hold`). There is no second implementation left to disagree with this outcome.

**Refutation attempt:** Tried to find any code path (a view, a materialized function, a scheduled report) that might reconstruct `target_accounting_stage`'s formula independently without calling the function by name (e.g., inlining `next_due <= today`) — none found; the only inlined boundary formula anywhere in the live catalog is `reconcile_deal_stage`'s own `<` rule (F3/F4), and it's used uniformly.

**Verdict: A4 formally CLOSED — no code exists that could disagree with itself.** `target_accounting_stage` is orphaned but harmless dead code (same bucket as F3 already put it in). No further re-measurement of A4 is warranted by any later task; this is the last word on it for this audit.

---

## F40. [LIFECYCLE] Step 3 — stage-vs-money mismatch sweep (corrected join): all three categories the brief asked for are clean or already explained by prior findings; no new defect

**Claim (brief's Step 3, corrected per the task instructions — `accounting_stage_id`/`accounting_onboarding`, cancelled excluded from "owed"):** Check `paid_in_full` deals with pending/overdue rows, `awaiting_payment`/`on_hold` deals owing €0, and archived deals with unpaid rows.

**Evidence:**
- **`paid_in_full` with genuinely past-due unpaid rows** (`s3_paid_in_full_but_owes`, `dp.start_date < current_date`): **0 rows.** Widening to "any non-paid/non-cancelled row regardless of date" (`s3_paid_in_full_but_owes_any`): **17 deals / 21 rows / €3,936.44** — this is exactly F33's already-recorded `paid_in_full` line, explicitly noted there as benign (future-seeded installments on already-settled deals, nothing overdue). Not re-reporting as new; cross-referencing F33.
- **`awaiting_payment`/`on_hold` owing €0** (`s3_await_or_hold_owing_zero`, no non-paid/non-cancelled row at all): **exactly 1 hit — `000233`, `on_hold`**. This is F29's already-documented deadlock case, re-derived independently here with the brief's own corrected query shape. No new instance found; `awaiting_payment` has zero such hits (consistent with `s3_stage_distribution` below: `awaiting_payment` shows `owing=31, clear=0` — every single `awaiting_payment` deal genuinely owes something, which is definitionally what the stage is for).
- **Archived deals with unpaid (`pending`/`overdue`) rows** (`s3_archived_with_unpaid`): **0 rows**, re-confirming Task 4's F26 result (`archived_deal` hygiene check) is still clean today, 20+ days later, via the accounting-stage-corrected join this time rather than F26's simpler `d.archived` check (same answer, cross-verified two ways).
- **Full stage × owed/clear distribution** (`s3_stage_distribution`, corrected `accounting_stage_id`/`accounting_onboarding` join) for context: `awaiting_payment` 31/0, `closed` 27/235, `documents_verified` 1/0, `done` 23/58, `new` 1/2, `on_hold` 25/1, `paid_in_full` 17/173, `partial_payment` 15/0. The `on_hold` 25-owing/1-clear split is F29's `000233` as the sole "clear" outlier; the `closed`/`done` owing counts (27, 23) are F20's already-documented lingering-billing-on-terminal-deals population, not new.

**Refutation attempt:** Checked whether correcting the join (vs. the brief's broken `stage_id`/`board='accounting'` literal, per F5's lesson) would surface anything F5/F33 hadn't already caught — it doesn't; every category collapses onto findings already on record (F26, F29, F33).

**Verdict: CONFIRMED clean / no new defect in any of the three categories.** All three of the brief's target mismatches are either genuinely absent (archived-with-unpaid) or already fully accounted for by F26/F29/F33 — recording the corrected counts here for completeness per the task instructions, not as new findings.

---

## F41. [LIFECYCLE] Step 4 — the retired cron is confirmed inactive and its comment is accurate; entry into `on_hold` today has exactly one code path (`reconcile_deal_stage`), reached via two callers, both verified working correctly against live data

**Claim (brief's Step 4):** Establish which migration disabled `daily_move_overdue_deals_to_on_hold` and whether `reconcile_block_lifecycle` fully supersedes it; separately, confirm what (if anything) still moves deals **into** `on_hold` on overdue, and whether it does so correctly.

**Evidence — the disabling migration:** `supabase/migrations/20260626000012_block_lifecycle_reconciler.sql`, lines 38–41:
```sql
-- Retire the old end_date overdue cron; the reconciler supersedes it.
do $$ begin
  perform cron.alter_job((select jobid from cron.job where jobname = 'daily_move_overdue_deals_to_on_hold'), active := false);
exception when others then null; end $$;
```
Live `cron.job` state confirms this is still in effect today (`s4_cron_state`): `daily_move_overdue_deals_to_on_hold` — schedule `5 2 * * *` (02:05 UTC), **`active: false`**, command `select public.move_overdue_deals_to_on_hold();` — exactly as the migration's own comment claims, and `docs/tech/accounting/block-lifecycle.md`'s "Retired" line (already accurate, unlike the rest of that doc per F3) matches reality.

**Evidence — the single live entry point:** Scanned every function whose body references both `accounting_stage_id` and `on_hold` (`s4_who_sets_onhold`) — 10 hits, but only **one** actually contains a `SET accounting_stage_id = ...` statement that can write the `on_hold` stage: `reconcile_deal_stage` (the `v_target := ... 'on_hold' ...; update public.deals set accounting_stage_id = v_target_id ...` block). Every other hit either reads the stage (`accounting_integrity_alerts`, `enqueue_payment_reminders`, `reconcile_payment_integrity`), guards against touching it (`deal_payments_move_to_awaiting`'s explicit `on_hold` skip), reacts to it after the fact (`deals_hold_jobs_on_stage_change`, `deals_sync_client_status_on_stage_change`), delegates to the real setter (`reconcile_block_lifecycle`), or is the retired function itself (`move_overdue_deals_to_on_hold`, confirmed dead per the cron state above).

`reconcile_deal_stage` itself is reached by exactly 2 live callers (`s2`/follow-up `reconcile_deal_stage_callers`): `reconcile_block_lifecycle` (the 02:20 nightly loop, and again at 06:00 via `run_daily_payment_reminders`, per F10) and `deal_payments_reconcile_stage()` — a trigger function fired `AFTER INSERT OR DELETE OR UPDATE` on every `deal_payments` row change (confirmed live on the table, `all_triggers_on_deal_payments`), installed by `20260702150200_reconcile_stage_trigger_swap.sql` as the **unified replacement** for two older, narrower triggers (see F42 — this migration's other half is a separate, previously unflagged finding).

**Evidence — it's working correctly today:** The 10 most recent `on_hold` entries (`s4_recent_onhold_entries`) all show `moved_date` matching `next_due`'s day-after — e.g. `next_due=2026-08-25` moved `2026-08-26` — i.e. every recent entry into `on_hold` fired the day after the deal's due date passed, exactly the live `<` rule (F3/F4), including entries from today's date (2026-08-26 itself), confirming the mechanism is actively firing, not stale.

**Refutation attempt:** Checked whether `move_overdue_deals_to_on_hold()` (the retired function) might still be callable directly via some other trigger or RPC despite its cron being disabled — grepped every trigger and function body for its name; the only two hits are its own definition and the cron-disabling comment. No live caller.

**Verdict: CONFIRMED — `reconcile_block_lifecycle` fully supersedes the retired cron; nothing is lost.** Entry into `on_hold` is a single, actively-exercised, correctly-behaving code path today (`reconcile_deal_stage`, called from exactly 2 places). No transition "now happens never" on the entry side — the brief's hypothesis that supersession might be incomplete is **not borne out**; the exit side is where a real gap was found (F42).

---

## F42. [LIFECYCLE] The documented automatic on_hold → paid_in_full release mechanism is dead code since 2026-07-02 — every release is now a 100% manual stage move, a materially larger and more general gap than F29's single-deal edge case

**Claim:** While investigating the entry side for F41, checked the corresponding exit-side trigger `deal_payments_release_from_on_hold()` that both `block-lifecycle.md` ("mark the payment paid ... fires `deal_payments_release_from_on_hold`") and `deal-lifecycle.md` (line 64, describing its sibling `deal_payments_move_to_awaiting()`) still document as live.

**Evidence — the trigger was dropped, not just superseded in spirit:** `supabase/migrations/20260702150200_reconcile_stage_trigger_swap.sql`:
```sql
drop trigger if exists deal_payments_reconcile_stage on public.deal_payments;
create trigger deal_payments_reconcile_stage
  after insert or update or delete on public.deal_payments
  for each row execute function public.deal_payments_reconcile_stage();

-- retire the two event-movers (functions kept for revert)
drop trigger if exists deal_payments_move_to_awaiting on public.deal_payments;
drop trigger if exists deal_payments_release_from_on_hold on public.deal_payments;
```
Live trigger inventory on `deal_payments` (`all_triggers_on_deal_payments`, 10 triggers) **confirms both are gone** — there is no `deal_payments_release_from_on_hold` or `deal_payments_move_to_awaiting` trigger in production today. Both **functions** still exist in the catalog (`old_release_function_exists`, full bodies pulled), unchanged — dead code in exactly the same sense as `target_accounting_stage` (F3/F39): present, individually correct, unreachable.

**The replacement does not reproduce the old behaviour.** The new unified trigger (`deal_payments_reconcile_stage`) fires `reconcile_deal_stage(deal_id)` on every row change — but `reconcile_deal_stage`'s `on_hold` branch (F29, "design decision B") **returns immediately** without ever computing whether the deal still owes anything:
```sql
if cur_code = 'on_hold' then
  perform public.block_deal_jobs(p_deal_id);
  return false;                                  -- never checks v_next_due
end if;
```
So marking the deal's last outstanding row `paid` — the exact mechanism both docs describe as the release trigger — **no longer releases an `on_hold` deal under any circumstance**, not just the cancelled-row edge case F29 found. This generalizes F29's finding from "cancelling the last row can deadlock a hold" to "nothing but a manual stage move can ever end a hold, for any reason, since 2026-07-02."

**Evidence this is a real, felt operational burden, not theoretical:** Queried `activity_log` for every `deals` UPDATE where `accounting_stage_id` moved from `on_hold`'s id to `paid_in_full`'s id (`onhold_release_events` / `count_distinct_users_transitions` / `total_transition_count`, `before_after`):
- **341 such transitions** total, spanning 2026-06-23 → 2026-08-26 (today).
- **Before** the 2026-07-02 trigger swap: 80 transitions, of which **34 (42.5%) carried a `null` `user_id`** — consistent with the old trigger firing inside a payment-update transaction with no authenticated session, i.e., genuinely automatic releases.
- **After** the swap: 261 transitions, of which **only 1 (0.4%) is `null`** — virtually every release since 2026-07-02 is attributed to a real staff member (`user_id` resolves to named accounting users, e.g. `973ca3fa-...` = Stavroula Pilitsou, 137 of the transitions; another user 155; a third 14). This is a clean before/after signature: the automatic path that used to handle roughly 2 in 5 releases is gone, and the other ~3 in 5 that were already manual are now effectively all of them — staff have absorbed **~260 manual "drag the card" releases over the last 8 weeks (roughly 5 per business day)** that the documentation still describes as something the system does for them.

**Historical precedent this recurrence should have been guarded against:** `deal-lifecycle.md` itself records that "the old model produced deal `000403` stuck On-Hold while fully paid" as the reason the current accounting-stage-is-the-state model was adopted. F29's `000233` (this audit) is the same failure shape recurring under the *new* model, and this finding shows the recurrence isn't confined to the cancelled-row edge case — it's structural, because the very trigger meant to prevent it was removed a month before the 2026-08-04 predecessor audit and never replaced.

**Refutation attempt:** Checked whether some other mechanism might compensate — e.g., whether `reconcile_block_lifecycle`'s nightly pass (which does call `reconcile_deal_stage` for every managed-stage deal, including `on_hold` ones) might release via a different branch — no; the nightly loop calls the exact same `reconcile_deal_stage` function with the exact same early-return for `on_hold`, so it cannot release either (this is precisely design decision B, confirmed deliberate in the migration's own header comment: "never auto-lift a hold. Keep jobs blocked; leave the column to the accountant."). Checked whether `job_resume_billing` or any other RPC might trigger a release path bypassing `reconcile_deal_stage` — no such path found (consistent with F29's own refutation attempt). This means design decision B was likely made *knowing* release would become fully manual — the gap is that neither `block-lifecycle.md` nor `deal-lifecycle.md` was updated to say so; both still describe the old automatic trigger as if it were live.

**Verdict: CONFIRMED — new finding, extends F29 from an edge case to the general rule.** Since `20260702150200`, **on_hold → paid_in_full is 100% a manual staff action**, evidenced by the null-user_id ratio collapsing from 42.5% to 0.4% at exactly that migration's date, and by ~260 real manual releases since. This is very likely an intentional design choice (decision B) rather than an accidental regression — but the two lifecycle docs both still describe an automatic mechanism that no longer exists, which will mislead anyone who reads them expecting the system to self-release paid holds. NEEDS-OWNER: (1) confirm decision B's "leave it to the accountant" tradeoff is still the intended policy given the ~5/day workload it now costs staff, and if so (2) update `block-lifecycle.md`/`deal-lifecycle.md` to stop describing the dead `deal_payments_release_from_on_hold` trigger as live.

---

## F43. [LIFECYCLE] Step 5 — `reconcile_payment_integrity`'s alert sink has been silently accumulating an unactioned backlog for 8 weeks: 342 open alerts across 217 distinct deals, and only 7 alerts have ever been resolved in the table's entire history

**Claim (brief's Step 5):** Read `reconcile_payment_integrity`'s body and its alert sink (`data_integrity_alerts`); list currently open alerts by type with counts and ages.

**Evidence — the function's true latest body** (case-insensitive search per F7's lesson: `grep -in "create or replace function public.reconcile_payment_integrity"` — 2 real hits, `20260701010000_paid_in_full_flip_fix.sql` then `20260702100000_job_billing_pause.sql`; the latter is current). Live body has **exactly 2 checks**, both writing to `public.data_integrity_alerts`:
1. `duplicate_period` — same detector as `accounting_integrity_alerts()` check 6 (recurring rows sharing `(deal_id, service_type, billing_type, start_date, end_date)`, non-cancelled), deduped per-signature while unresolved.
2. `flip_out_of_paid_in_full` — deals whose `accounting_stage_id` changed in the last 25 hours, are now `on_hold`, and have a genuinely overdue (`<= current_date`, non-null) `deal_next_due` — a same-day sanity check on deals that just moved, not (contrary to what its name might suggest) a direct detector of F29's "stuck-with-nothing-owed" deadlock shape (that shape makes `deal_next_due` return `null`, which fails this check's `<= current_date` condition — confirmed against `000233`'s own 4 historical alert rows, all of which carry a real non-null `next_due` from *before* the deal's last row was cancelled).

If any check fires, the function also inserts an admin `notifications` row (`payment_integrity_alert`) — but nothing consumes `resolved_at` afterward.

**Evidence — schema** (`s5_alerts_schema`): `id, kind, subject_type, subject_id, details (jsonb), detected_at, resolved_at, resolved_by`.

**Evidence — the open backlog** (`s5_open_alerts_by_kind`, live 2026-08-26):

| kind | open | oldest | newest | oldest age |
|---|---|---|---|---|
| `flip_out_of_paid_in_full` | **342** | 2026-07-01 | 2026-08-26 (today) | **56 days** |
| `duplicate_period` | 0 | — | — | — |

All-time (`s5_all_time_alerts_by_kind`): `flip_out_of_paid_in_full` 347 total / 342 open (5 resolved), `duplicate_period` 2 total / 0 open (both resolved).

**Evidence — the backlog is a continuous, unmanaged drip, not a one-time spike:** `flip_out_of_paid_in_full` spans **217 distinct deals** (`distinct_deals_flip`), firing at a steady 1–8/day rate every single day of the last two weeks checked (`daily_fire_rate`: 2026-08-12→08-26, never zero, peak 8/day). The worst repeat offenders (`top_repeat_deals`) fire 3–5 times each over the period (e.g. `000114` ×5, `000233` ×4 — this is F29's deal). Cross-checked `000233`'s own 4 rows again directly (`000233_alert_rows`) — confirms F29's account exactly.

**Evidence — the resolution mechanism is essentially non-existent:** Searched every migration for a writer of `resolved_at` (`resolved_at` grep across `supabase/migrations`) — the **only** place any row of this table has ever been marked resolved is a one-time, hand-written `UPDATE` statement inside `20260702000000_billing_mitigations.sql` (`update public.data_integrity_alerts set resolved_at = now() where kind = 'duplicate_period' and resolved_at is null;`), run once as part of that migration's deploy. There is **no RPC, no trigger, no scheduled job, and no frontend code anywhere in `src/`** that ever sets `resolved_at` (grepped `data_integrity_alerts` across `src/` — the only hit is the auto-generated `src/types/supabase.ts` type definition; no feature code reads or writes this table at all). The `AlertsPage.tsx`/`useIntegrityAlerts.ts` UI staff actually see (F14) queries the **different**, on-demand `accounting_integrity_alerts()` RPC — it has no relationship to this table. **`data_integrity_alerts` has no UI surface whatsoever.** The 5 historical `flip_out_of_paid_in_full` resolutions and 2 `duplicate_period` resolutions (7 total, all timestamped 2026-07-01, same day) are best explained as a one-time manual cleanup coinciding with that day's migration deploy, not an ongoing process.

**Refutation attempt:** Checked whether the admin `notifications` row insert (fired whenever `v_alerts > 0`) might itself carry a way for an admin to resolve the underlying alert from the notification UI — did not find a notifications-consumption code path that writes back to `data_integrity_alerts` (out of full scope to trace every notification-click handler in this pass, but the absence of any `resolved_at`-writing code anywhere in `src/` makes this exceedingly unlikely regardless of the notification UI's behavior). Checked whether `resolved_by uuid` (present in the schema, always null in all live rows queried) might get set by some other mechanism sometime — no live row has ever had a non-null `resolved_by`, at all, in the table's history.

**Verdict: CONFIRMED — this is the most concrete new-mechanism finding of Task 6.** The 04:00 cron is running successfully every night (per F9, no cron-health issue) and correctly detecting what it's designed to detect, but writes into a table that nothing — no dashboard, no RPC, no scheduled cleanup — ever reads or resolves. The admin notification firing alongside each new alert is the *only* signal anyone gets, and F29 already showed that signal has gone unactioned for `000233` specifically across 4 separate firings over 5+ weeks. This finding shows that's not an isolated lapse: it's structural — 217 deals' worth of `flip_out_of_paid_in_full` alerts, accumulating since the table's first day, with no path to zero. NEEDS-OWNER: either build a resolve action (even a simple admin-only "mark resolved" button reading this table) or fold its 2 checks into the `accounting_integrity_alerts()` on-demand RPC staff already use, so this detection work isn't going to waste.

---

## F44. [LIFECYCLE] Step 5 coverage map — the 2 cron-driven checks catch neither VAT bug; the 20 on-demand checks catch 2 of 5 known payment-bug classes, and only via the on-demand path this audit already showed few (if any) staff currently exercise

**Claim (brief's Step 5):** Identify which alert types exist vs. which payment bugs found by this audit (F11 VAT, F16, F20, F29, F33) each type could/couldn't catch.

**Method:** Two independent alert surfaces exist in this codebase and must not be conflated (F43 already separates them): (A) `reconcile_payment_integrity()`, the 04:00 cron, 2 checks, writing to `data_integrity_alerts` (no UI, F43); (B) `accounting_integrity_alerts()`, an on-demand RPC with 20 checks (F14), gated behind an authenticated admin/accounting session, surfaced at `AlertsPage.tsx`. Checked each of the 5 known bug classes against both surfaces' actual `WHERE` conditions, read directly from the live function bodies.

| Known bug | (A) cron `reconcile_payment_integrity` | (B) on-demand `accounting_integrity_alerts` | Why |
|---|---|---|---|
| **F11** — cash-no-VAT deals overcharged VAT on `deal_payments` (root cause F12: `seed_deal_payments` ignores `cash_charge_vat`) | **NO** — no VAT check exists in this function at all | **NO** — check 15 `cash_deal_with_vat` looks only at `jobs.vat_rate`, which F12 established is seeded *correctly*; the wrongly-seeded row lives on `deal_payments`, which no check in either surface ever reads | Structural blind spot already identified in F14; confirmed here to be total — **0 of 22 combined checks** can see this bug class |
| **F16** — online/Greek deals stuck at 0% VAT (payment-method drift) | **NO** — no VAT check | **YES (partial)** — check 3 `vat_missing` (`jobs.amount_net>0 and jobs.vat_rate=0`, not cash-no-VAT, not CY/UAE) matches F16's live cases (`000229`, `000935`) because those deals' *jobs* are also wrongly at 0%, unlike F11/F12 where only the payment row is wrong | The one bug class where the job-level check happens to align with where the error actually lives |
| **F20** — `close_deal` never clears `billing_active`/`archived` on jobs, leaving 21 closed deals with lingering active-recurring-job state | **NO** | **NO** — the closest checks (`billing_gap`, `renewal_past_due`) both explicitly exclude `closed`/`done` stages from their scope; no check targets "job still billing_active on a closed deal" | A gap by design exclusion, not oversight — the checks were written to *not* flag terminal deals, which incidentally hides this real hygiene gap |
| **F29** — `on_hold` deadlock (deal fully paid/cancelled, cannot self-release) | **Indirectly, and not the deadlock itself** — `flip_out_of_paid_in_full` requires a *non-null, currently-overdue* `deal_next_due`; once a deal reaches the "everything paid or cancelled" deadlock state, `deal_next_due` is `null` and this check goes silent for it (confirmed against `000233`'s 4 historical firings, all pre-dating its final cancelled row) | **YES** — check 8 `on_hold_not_overdue` (`on_hold` AND no non-cancelled row past due) matches `000233`'s exact final state | Cron catches the *lead-up*, not the deadlock; only the on-demand check catches the deadlock itself, and only if a human opens the dashboard |
| **F33** — deals parked in `partial_payment` become permanently un-remindable and stage-frozen | **NO** | **NO** — no check in either surface references the `partial_payment` stage at all | Complete blind spot; `partial_payment` isn't in either surface's vocabulary |

**Refutation attempt:** For each "NO," re-read the check's full `WHERE` clause (not just its title/comment) to rule out a broader condition that happens to also catch the case incidentally — none did; every "NO" above is a clean miss on the literal predicate, not a naming mismatch.

**Verdict: CONFIRMED — coverage is thin and lopsided.** Of 5 known live payment-lifecycle bug classes, the unattended cron path (A) catches **0 directly** (1 indirectly/partially, and not the part that matters); the on-demand dashboard (B) catches **2 of 5** (F16, F29), and only for staff who actively open it — which F29's own 5-week unactioned track record suggests isn't happening reliably even for the checks that do exist. The other 3 classes (F11, F20, F33) have **zero automated detection anywhere in the codebase** today. Combined with F43's finding that the cron's own alert table has no resolution path at all, the overall picture is: detection infrastructure exists in pieces, is unevenly wired to the bugs that actually cost money, and the one piece that runs unattended every night (the cron) writes to a sink nobody reads. NEEDS-OWNER: this table is the natural starting point for prioritizing which of F11/F20/F33 gets an alert check first (F11 is the highest-value target — it's actively costing collected VAT today, per F11/F12).

---

## F45. [INTEGRATION] `deal_payment_lines` hygiene: clean on cross-deal/archived-job referential integrity; the 2 "sum mismatch" hits are a genuine but immaterial scale-precision bug, not grouped billing or a data-corruption case

**Claim (brief, Step 1):** Run the four-part hygiene query — lines pointing at archived jobs, lines whose job belongs to a different deal than the payment, payments whose lines don't sum to the payment amount, and non-cancelled `paid` payments with zero lines.

**Evidence:** Ran the brief's exact SQL live 2026-08-26 against `xujlrclyzxrvxszepquy`:
```
line_to_archived_job = 0, line_cross_deal = 0, lines_sum_mismatch = 2, paid_no_lines = 1
```
- **`line_to_archived_job` / `line_cross_deal` = 0/0** — clean; no line ever points at a job that's since been archived, and no line's job belongs to a deal other than its payment's deal. Confirmed by re-running with full row detail (`s1_line_to_archived_job_detail` = `[]`).
- **`lines_sum_mismatch` = 2**, both the *same* deal (`005090`), both the *same* single job (`005090-AISEO`), one `paid` (created 2026-06-29) and one `cancelled` (created 2026-07-22, its pause-cancelled successor — an ordinary `job_pause_billing` pair, not two independent bugs). Root cause, confirmed by column introspection: `deal_payments.amount_net` is `numeric(12,4)` (4 decimal places) but `deal_payment_lines.amount_net` is `numeric(12,2)` (2 decimal places). Both payments' `amount_net` = `346.7780` — chosen so that `amount_gross` (a GENERATED column, `amount_net * 1.24`, itself `numeric(12,2)`) rounds to exactly `430.00`. The line row, however, stores `346.78` (rounded to 2dp), a **€0.002 shortfall** from the header. This is **not** the grouped-billing pattern documented for deal `000415` (one payment, one line, same job — no split across two jobs) — it is a genuine scale mismatch between the two tables' `amount_net` columns, currently invisible at 2-decimal display precision but capable of accumulating measurably on a payment split across several lines. **This exact deal-005090 mismatch is not new: it is a documented, deliberately-accepted leftover** — `docs/data-fixes/2026-07-14-payment-line-resync.md`'s "Known leftover (accepted)" section names deal `005090` verbatim with the identical `346.7780`-vs-`346.78` numbers and the identical root cause (line column too narrow at `numeric(12,2)`), and records the owner's decision to skip widening it ("deliberately skipped... If more 4-decimal nets appear, widen then"). So this finding independently re-confirms a known, already-accepted gap rather than surfacing a new one — still worth tracking per that doc's own stated threshold (a second 4-decimal-net case would justify revisiting it), but not a fresh defect.
- **`paid_no_lines` = 1**: deal `005497`, a `€0.00`-net `paid` `local_seo` recurring row (created/paid 2026-08-17/18). Zero-value, so REFUTED as a money-impact issue per the F16/F23 zero-value precedent already established in this audit — immaterial, but a legitimate data-hygiene nit (a €0 payment with no line item at all, vs. the more common pattern of a €0 line).

**Refutation attempt:** Checked whether the 2 sum-mismatch rows might instead be evidence of the grouped-billing pattern (one payment, multiple jobs/lines) that this audit was warned to check for before calling any mismatch a bug — pulled every line for both payment ids: each has exactly **one** line, for the **same** job as the payment's own `service_type`. Grouped billing is ruled out; this is a single-job, single-line, single-payment precision defect. Also checked whether `amount_net`'s 4-decimal precision is itself new/deliberate (a compensating hack for the VAT-rounding convention) — confirmed via `information_schema.columns`: `deal_payments.amount_net` has held `numeric(12,4)` since its origin migration; `deal_payment_lines.amount_net` was added later (`20260617000006_deal_payment_lines.sql`) at `numeric(12,2)`, a plain oversight in matching the parent's precision, not an intentional design choice.

**Verdict: CONFIRMED — clean on the two structural-integrity checks; the sum-mismatch is a real but sub-cent, single-instance precision bug** (fix: widen `deal_payment_lines.amount_net` to `numeric(12,4)` to match its parent, or round `deal_payments.amount_net` to 2dp at seed time). **REFUTED as a money-impact issue** for `paid_no_lines` (€0 row). No new grouped-billing or referential-integrity defect found.

---

## F46. [INTEGRATION] The 2026-08-04 audit's "the ledger is a fully mutable view" claim (A7b) re-confirmed — but the honest split is 17 silent + 7 documented-repair mutations, and 9 silent + 0 documented deletions; the architectural exposure (no period lock, hard-deletes possible) stands regardless

**Claim (brief, Step 2, echoing the 2026-08-04 audit line 137):** "The ledger is a fully mutable view, and paid rows can be hard-deleted behind a `confirm()`." Brief asks to locate the ledger object(s) and count paid payments modified after their ledger month closed.

*(Revised 2026-08-26 after reviewer feedback: the original write-up reported 24 mutations / 9 deletions as an undifferentiated headline count. Re-checked every one of the 24 mutation rows and all 9 deletion rows against `docs/data-fixes/` — 7 of the 24 mutations turn out to be owner-approved, documented repairs, not silent drift. The per-row attribution is below; the architectural point is unchanged by the correction.)*

**Evidence — the ledger objects (unchanged from the original write-up):**
```sql
select table_schema, table_name, table_type from information_schema.tables
where table_schema='public' and (table_name ilike '%ledger%' or table_name ilike '%revenue%' or table_name ilike '%report%' or table_name ilike '%pl_summary%');
```
→ `accounting_ledger_v` and `accounting_pl_summary_v`, **both plain `VIEW`s**, not tables and not materialized. Read `accounting_ledger_v`'s live definition (matches its migration chain: `20260601000006` → `20260716210000` → `20260717120000` (revert) → `20260803130000` (security-invoker fix, unrelated to shape)): it's a live `UNION ALL` over `deal_payments` (`direction='in'`) and `expenses` (`direction='out'`), joined to `deals`/`clients`/`expense_categories`, computing `event_date`/`period` from `paid_at`/`start_date` on every query. There is **no separate ledger table to drift from `deal_payments`** — a plain view *cannot* drift; it always reflects `deal_payments`'s current state by construction. The seo_renewal_ledger migration (`20260804090000`) is unrelated — it's a job-workflow cursor (`jobs.renewed_for_period`), not a financial ledger.
- The real question is therefore: **can the underlying `deal_payments` rows themselves still be changed/removed after being reported as revenue for a closed month?** Checked `pg_trigger` on `deal_payments`: the only immutability guard is `deal_payments_created_at_immutable` — nothing protects `amount_net`, `vat_rate`, `service_type`, or `status` on an already-`paid` row, and no "period lock"/"month close" mechanism exists anywhere in the schema (`grep`'d migrations and docs for `period_lock`/`ledger_lock`/`closed_period`/`freeze` — none found). **This structural fact is independent of how many of the live instances below turn out to be documented — it means a documented repair and an undocumented one are executed through the identical, unguarded code path.**

**Evidence — mutation rows, re-run read-only and persisted** (`audit-07-f46-mutations.json`, `mutations` key — re-ran the exact same query as the original pass; count is unchanged at 24, confirming the original wasn't a fluke of an unsaved run), then matched by payment id / deal code / timestamp against every doc in `docs/data-fixes/` that mentions `deal_payments` (`grep -l deal_payments docs/data-fixes/*.md` → exactly 3 docs: `2026-07-14-payment-line-resync.md` (F45's precision issue, not mutation-relevant here), `2026-08-04-deal-000403-service-change.md`, `2026-08-06-ai-seo-convert-archived-stage.md`):

| entity_id | deal | when | change | doc match |
|---|---|---|---|---|
| `17204d4c…` | `000403` | 2026-08-04 08:55 | `local_seo→web_seo`, €250 unchanged | **`2026-08-04-deal-000403-service-change.md`** — exact payment id, before/after table, owner sign-off quoted verbatim |
| `92e4d6c2…` | `000129` | 2026-08-06 14:22 | `ai_seo→local_seo`, €350 unchanged | **`2026-08-06-ai-seo-convert-archived-stage.md`** — "Deal 000129 ... deal_payments re-keyed ai_seo → local_seo", same €350 period (2026-06-09→07-09), owner-requested |
| `4e39839e…` | `006122` | 2026-08-03 15:00 | `local_seo→ai_seo`, €230 unchanged | **same doc** — timeline table: "2026-08-03 15:00 \| Converted local_seo → ai_seo via `convert_job_service_type`" for deal 006122, the incident's own trigger event |
| `190732cc…`, `b2f371ab…` | `000230` | 2026-08-04 10:30 | `local_seo→ai_seo` ×2, amounts unchanged | **same doc** — "Deal 000230 ... hit the identical bug on its 2026-08-04 10:30 convert" |
| `37dac1d3…`, `ff2aa7f9…` | `000060` | 2026-08-06 07:02 | `local_seo→ai_seo` ×2, amounts unchanged | **same doc** — "Converted local_seo → ai_seo the same day at 07:02:15" |
| `96fed868…` | `000041` | 2026-06-26 | €950→€1900 | no doc — **silent** |
| `7724e647…` | `004816` | 2026-07-03 (×2, same-day round-trip) | €240→€240.32→€240 | no doc — **silent** |
| `a23e0da2…` | `000203` | 2026-07-13 | €177.42→€220 | no doc — **silent** |
| `dbe51fae…` | `005815` | 2026-07-15 | €241.934→€241.93 (sub-cent) | no doc — **silent** |
| `074916fb…`, `ac218a3b…` | (deal since deleted, see deletions below) | 2026-07-16 | €0→€100 | no doc — **silent** |
| `67f801f4…` | `000331` | 2026-07-20 | €250→€275 | no doc — **silent** |
| `459b4bf2…` | `000079` | 2026-07-23 | €500→€250 | no doc — **silent** |
| `edf1a358…`, `8350e86a…` | `005160` | 2026-07-29 (×2) | €200→€201.61 | no doc — **silent** |
| `09265458…` | `000516` | 2026-07-29 | €0→€346.78 | no doc — **silent** |
| `708e8c96…` | `000477` | 2026-08-03 | €200→€0 (already-paid June revenue zeroed) | no doc — **silent** |
| `e90b2a97…`, `1692bfa5…` | `000214` | 2026-08-10 (×2) | `local_seo→ai_seo`, amounts unchanged | no doc — **silent** |
| `d9e270ee…`, `1233ac0c…` | `000420` | 2026-08-21 (×2) | €405→€405.24, €394.52→€394.76 | no doc — **silent** |

**Split: 7 of 24 mutations are documented, owner-approved repairs (all `service_type` re-keys with amounts left unchanged, all part of the two convert-bug/service-change incidents above); 17 of 24 remain silent** — no data-fix doc names them, though several (the small ±€0.004–€0.32 deltas) are consistent with ordinary VAT-rounding corrections rather than errors, and 9 of the 17 are the same `local_seo↔ai_seo`/`ai_seo→local_seo`-style category recodes as the documented ones, just not written up. The genuinely unexplained amount swings (`950→1900`, `500→250`, `200→0`) are entirely inside the silent 17.

**Evidence — deletion rows, re-run read-only and persisted** (`audit-07-f46-mutations.json`, `deletes` key; also `audit-07-f46-deletes-check.json` for the deal-identity follow-up): **9 already-`paid` deal_payments rows, €1,001.00 net total, hard-deleted** between 2026-06-25 and 2026-08-03. Checked all 9 against the same 3 docs — **0 match**. None of the 3 `docs/data-fixes/` files that touch `deal_payments` describe deleting a payment row (the 000129 fix explicitly did the opposite: archived the jobs instead of deleting, "per owner instruction... nothing was removed"). So the deletion count is unchanged by this correction: **9 silent, 0 documented.** Two follow-up facts worth noting for severity, not for reclassification:
  - 3 of the 9 (`dcea5757…`, `e07a3381…`, `87040db7…`, €300 combined) belong to deals `f3426085…`/`c1fc46f1…`, whose own `activity_log` rows show `code = 'HARN-B'` / `'HARN-C'` — non-numeric codes inconsistent with the `NNNNNN` pattern every real client deal in this audit uses — inserted 2026-07-02 and **entirely deleted (deal + payments together)** on 2026-08-03 by `info@itdev.gr`. This reads as sandbox/test-deal cleanup, not real client revenue, but it is still not written up in `docs/data-fixes/`, so per the reviewer's instruction it stays counted as silent.
  - The remaining 6 (`dea04cdf…` €1, `074916fb…`/`ac218a3b…` €100+€100 — the same entities that were mutated €0→€100 minutes earlier, then deleted — on an orphaned deal with no `activity_log` insert row at all, `9068f9bf…` €100 on archived deal `005936`, `983b922e…` €200 on deal `000415`, `0bc63bad…` €200 on deal `000416`) are on identifiably real, numbered client deals and remain **silent, unexplained hard deletions of paid revenue** — the strongest evidence in this finding for the architectural gap.

**Refutation attempt:** Considered whether the 7 documented matches might be coincidental (same amount, wrong incident) rather than the actual repair — ruled out: all 7 match on payment id (`000403`) or on the exact deal code + exact timestamp-to-the-second cited in the doc's own timeline (`006122`/`000230`/`000060`), which is not plausible by chance. Considered whether more of the 17 silent mutations might be covered by a data-fix doc this pass missed — re-ran `grep -l deal_payments docs/data-fixes/*.md` against the full 6-file directory (confirmed only 3 hits) and checked every one of the other 3 docs' content for `deal_payments`/payment-id mentions — none. Considered whether the 226 raw "`updated_at` in a later month than ledger period" hits (the brief's literal metric) might be mostly benign noise — confirmed yes (only 24 of 226 touch a ledger-relevant column), which is why this finding narrows to those 24 rather than the raw count.

**Verdict: CONFIRMED, with corrected counts.** Ledger mutability is structurally real (a view over an unguarded, editable source, with no period lock) and both a documented and an undocumented mutation flow through the exact same unprotected path. Of the live instances found: **mutations — 7 documented/owner-approved, 17 silent** (down from an unqualified "24"); **deletions — 0 documented, 9 silent** (unchanged; €1,001 net, 3 of which are plausibly sandbox-test cleanup rather than real client impact, leaving ~€700 net across 6 real-deal deletions as the clearest unexplained loss). The architectural point — no append-only/reversal design, no period lock, and the 2026-08-04 audit's own open policy question (line 223: "Should the ledger become append-only with reversals, or stay editable?") — is unaffected by the correction and remains NEEDS-OWNER.

---

## F47. [INTEGRATION] Won-push (CRM → sales app) is brand-new — only 2 deals have ever gone through it, both since the 2026-08-25 net-of-VAT fix, and both match net-to-net exactly

**Claim (brief, Step 3):** For deals won in the last 30 days, compare `push-won-sale`'s recorded amount in the sales DB (`cthjxcftxwxbjpqmfiko`) against the CRM deal total; after the 2026-08-25 fix, all should match net exactly.

**Evidence:** The CRM has **24** deals at sales-board stage `code='won'` with `actual_close_date` in the last 30 days. But `won_push_outbox` (the table that feeds `push-won-sale`) was only created by `supabase/migrations/20260824150000_won_deal_push.sql`, **2026-08-24** — two days before this audit — and its enqueue trigger fires only on the `leads.converted_at` transition (`old.converted_at is null and new.converted_at is not null`), with **no backfill** (the migration is explicit: "No function redefinitions... all objects are new"). So of the 24 CRM-side "won" deals, only the ones actually converted *on or after* 2026-08-24 could ever have produced an outbox row — the other 22 predate the mechanism entirely and were never expected to push.
- Live `won_push_outbox`: **exactly 2 rows, both `status='sent'`, both `attempts=1`, no errors** — deal `006357` (converted/closed 2026-08-26) and deal `006314` (converted/closed 2026-08-24, the same deal the code comment in `push-won-sale/index.ts` names as the fix's own regression test: "an earlier version divided by 1.24... deal 006314 arrived as 161.29 instead of 200").
- Compared each against the sales DB (`cthjxcftxwxbjpqmfiko.sales`, matched on `crm_deal_id`):

| CRM deal | CRM `one_time_value + recurring_monthly_value` (net) | sales.`amount` | match |
|---|---|---|---|
| `006357` | €200.00 (0 + 200) | €200 | exact |
| `006314` | €200.00 (0 + 200) | €200 | exact |

  Both `commission` fields also check out at the documented flat 23% (`46.00` = `200 × 0.23`).

**Refutation attempt:** Checked whether any *other* row in the sales `sales` table carries a `crm_deal_id` that these two might be undercounting (e.g., a manual entry later linked) — `information_schema.columns` confirms `sales.crm_deal_id` exists on exactly one table, and querying `sales` for any `crm_deal_id is not null` row, at any date, returns only these same 2 rows. There is no third case, past or present, and no non-`crm`-sourced row wrongly carries a `crm_deal_id`.

**Verdict: CONFIRMED — 0 mismatches, but the population this audit could test is 2 rows, not the 24 the brief's "won in the last 30 days" framing implies**, because the feature is 2 days old at audit time with no backfill (by design). Both live instances match net-to-net exactly, and `006314` is confirmed to be the exact previously-reported /1.24 defect's own re-push, now correct — consistent with the brief's context note, not a new occurrence. No further won-push mismatches exist to find yet; re-run this check again in 30 days once the population is large enough to be meaningful.

---

## F48. [INTEGRATION] Outbox drain: `accounting` identity is fully healthy (0 stuck, 0 failures in 14 days); but the *mechanism* has a silent dead-letter gap — a row that fails 5 times is permanently unretriable while still reading `status='pending'`, and it has already trapped 3 unrelated (`sales`-identity) rows for 5+ weeks

**Claim (brief, Step 4):** Check stuck `pending` rows (>1h old), failed rows in the last 14 days, and `recover_stale_email_claims` effectiveness.

**Evidence — accounting identity, clean:** `email_outbox` rows with `identity='accounting'` in the last 14 days: 184/184 `sent`, 0 `pending`, 0 `failed`. All-time: 1,245 `sent`, 3 `failed` — and those 3 are the *same* `diatypos@otenet.gr / info@diatypos.gr` malformed-multi-address incident already catalogued in F34 (`payment_overdue`/`localseo_gbp_access` templates, `attempts=5`, `last_error='cancelled by admin'`, dated 2026-06-26–29) — not a new finding, and already terminally resolved (an admin manually cancelled them via `email_outbox_cancel`, which is the only path that ever sets `status='failed'`).
- **Cron health, both jobs:** `drain_email_outbox` (`*/2 * * * *`) and `recover_stale_email_claims` (`*/5 * * * *`) both show **100% `succeeded`** over the last 14 days (10,080 and 4,032 runs respectively — exact expected counts for their schedules) — no infra-level incident.
- **But literal `status='pending' and created_at < now() - interval '1 hour'`** (the brief's own stuck-row criterion, run with no identity filter since none currently applies to accounting) returns **3 rows, all `identity='sales'`, stuck since 2026-07-18 through 2026-07-22 — over 5 weeks old at audit time**, all `attempts=5`, all the identical `422 validation_error: Invalid 'to' field` for the same malformed recipient `knektar1@yahoo.gr / info@euro-business.gr` (a lead follow-up sequence: `noanswer_day0`/`day2`/`day5`) — the exact same defect class as F34 (a `" / "`-joined multi-address value with no format validation anywhere upstream), just a different, still-*unresolved* instance, and outside F34's original `clients.email` scope (this is a lead/company field feeding the `sales` identity, not `clients.email`).
- **Root cause of why these 3 never clear on their own, traced to code:** `claim_email_outbox(p_limit)` — the function `drain_email_outbox`'s edge function (`send-email/index.ts`'s `drain()`) calls every 2 minutes — only claims rows `where status = 'pending' and attempts < 5`. Once a row hits `attempts=5` (5 failed sends), it can **never be claimed again**, but the send failure path (`drain()`, line 325) always resets failed rows back to `status='pending'` — never to a terminal `'failed'`. So a permanently-un-sendable row sits at `status='pending'` forever: invisible to `recover_stale_email_claims` (which only resets `status='sending'` rows, and this row is never `'sending'` again), and structurally indistinguishable by `status` alone from a healthy row about to be picked up on the next 2-minute cycle — exactly what the brief's own literal query (and any dashboard built the same way) would report as "stuck pending," with no signal that it is *permanently* stuck rather than merely due.
- **Mitigating factor found:** an admin-only "Email Health" surface exists (`src/features/system_health/hooks/useEmailOps.ts`, backed by RPCs `email_queue_rows`/`email_outbox_retry`/`email_outbox_cancel`) whose `email_queue_rows()` query filters on `status in ('pending','sending','failed')` with **no `attempts` cap**, so these 3 rows *are* visible there, with a working manual retry/cancel action — the same surface that resolved the accounting-identity `diatypos` incident in June. Nobody has visited it for this `sales`-identity incident in 5+ weeks.

**Refutation attempt:** Checked whether `attempts=5` might still be actively retried and simply not yet succeeding (i.e., "stuck" is an artifact of query timing, not a real dead-letter) — no: `claim_email_outbox`'s `WHERE attempts < 5` predicate is a hard exclusion, confirmed by reading its live `pg_get_functiondef` body directly; there is no other code path that claims `attempts >= 5` rows. Checked whether this could still self-resolve via `recover_stale_email_claims` — no, that function's `WHERE status='sending'` predicate never matches a `'pending'` row, confirmed the same way.

**Verdict: CONFIRMED for the accounting identity specifically — fully healthy, 0 stuck, 0 unresolved failures.** **CONFIRMED, separately, as a real structural gap in the shared outbox/drain mechanism** (not accounting-specific, but capable of affecting any identity including `accounting` in the future): a row can silently become permanently unretriable while still reporting `status='pending'`, with no terminal state, no automated alert, and no expiry — only a human manually opening Email Health and clicking cancel/retry ever closes it out, and that hasn't happened for the current 3 `sales`-identity rows in over 5 weeks. NEEDS-OWNER: (1) give `claim_email_outbox`'s attempts-exhausted case its own terminal status (e.g. auto-transition to `'failed'` when `attempts` reaches the cap, mirroring what `email_outbox_cancel` already does manually) so `status='pending'` always means "will be retried"; (2) add basic recipient-email-format validation upstream (same NEEDS-OWNER as F34, now with a second, independent live instance) so malformed multi-address values stop reaching the outbox at all.

---
