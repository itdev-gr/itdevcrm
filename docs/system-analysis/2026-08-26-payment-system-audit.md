# Payment system — full audit, 2026-08-26

Read-only audit of the whole money path: every payment method, every VAT rule, the renewal generator, the status machine, the reminder pipeline, the accounting-stage lifecycle, and the integrations that carry money out of the CRM. **Nothing was changed** — no code, no data, no schema, no migration. Every number below was measured against the production database (project `xujlrclyzxrvxszepquy`) on **2026-08-26** unless a different date is stated on the number itself.

This audit is the successor to `docs/system-analysis/2026-08-04-accounting-full-audit.md` (findings A0–A8) and to the 2026-08-06 job-lifecycle sweep recorded in the `accounting-audit-open-findings` memory note. Section B maps every one of those older findings to its status today.

## Method

Seven independent research tasks each probed one subsystem with exact SQL against prod **plus** a code read of the governing function, and each was required to *attempt to refute* its own finding before it could be recorded. 48 findings (F1–F48) were produced and every one was review-verified. Findings that failed refutation are recorded as REFUTED in section D so nobody spends time on them later.

Two method notes that materially shaped the results:

- **The repo is trustworthy.** All 11 money functions deployed in prod are byte-for-byte what their newest migration says (F8, checked 2026-08-26). There is **zero live-vs-repo drift**. Where a document and the database disagree, the database is right and the document is stale.
- **Several of this audit's own starting queries were wrong**, in ways that manufacture convincing-looking bugs (43 "stuck overdue" rows, 126 "missed reminders", 22 "silently dead" billing chains — all false). Those query traps are catalogued in Appendix 1 so a future re-run does not rediscover them as findings.

Where a finding is new, it carries a **B-number** (B1–B16). Where it re-measures an older finding, it carries that finding's original letter (A0–A8, or S1–S3 for the 2026-08-06 sweep items).

---

## A. Confirmed bugs, ranked by money impact

Ranking: money actually at stake first, then silent-failure risk (things that break without telling anyone), then hygiene.

### Tier 1 — money

Within this tier, A0 is placed first even though its euro figure is the smallest: it is the only defect where clients' money has **demonstrably already changed hands wrongly**, and it is still producing new instances. B1 carries the largest exposure (money not collected), B2 the largest integrity risk to money already recorded.

#### A0. Cash / no-VAT clients are still charged VAT on their payment rows — **WORSE than on 2026-08-06**

**What happens.** A deal set to `payment_method = 'cash'` with `cash_charge_vat = false` gets a correctly 0%-VAT **job** and a wrongly 24%-VAT **payment row**. `deal_payments` is what is invoiced, reminded on, and collected — so the client pays VAT they were told they would not pay.

**Root cause (new information — not known on 2026-08-04).** `public.seed_deal_payments()` (live body = `supabase/migrations/20260720170000_vat_rate_for_country_helper.sql`) computes VAT as `vat := public.vat_rate_for_country(client_country)` — **country only, with no reference to `cash_charge_vat` anywhere in the function**. Its sibling `release_billing_jobs_for_deal` / `release_jobs_for_deal` *do* carry the full rule (`cash & not cash_charge_vat → 0`), which is exactly why the job is right and the payment row is wrong. Both are invoked by the same after-insert trigger `deal_payments_seed_after_insert → seed_deal_jobs_and_payments`.

Two secondary mechanisms make it permanent:
- `ensure_recurring_payments()` copies `vat_rate` forward verbatim from the previous row, so a wrong first period reproduces itself every cycle, indefinitely, until a human edits a row by hand (deal `005510`'s second `ads` period, pending, start 2026-08-27, inherited 24%).
- The defect reaches far-future one-off renewal rows too: deal `000338` carries a `domains` row dated **`start_date = 2028-05-11`** at 24% VAT against a 0%-VAT job — €4.80 that will silently over-collect in 2028 unless someone notices first.

**Evidence (2026-08-26).** Paid rows on cash/no-VAT deals carrying VAT: **12 deals / 19 rows / €977.11 collected** (2026-08-06 baseline: 11 deals / 19 rows / €912.31). Movement over 20 days: **+1 deal, +€64.80**. Worst rows: `000299` €264.93, `000508` €144.00, `000329` €96.00, `000257` €96.00, `005023` €64.80, `006881` €64.80. Two of the affected deals — `006851` (created 2026-08-03) and `006881` (created 2026-08-11) — were created *after* both the 2026-07-02 `cash_charge_vat` fix and the 2026-07-20 country-VAT centralization, which proves the cause is live code and not historical residue.

**Fix direction.** Give `seed_deal_payments()` the same `case when payment_method='cash' and not cash_charge_vat then 0.00 …` guard the two job-release functions already carry; separately decide (owner) what to do about the €977.11 already collected and about the already-seeded wrong rows still pending.

---

#### B1. Deals in `partial_payment` / `closed` / `done` are invisible to the reminder pipeline **and** to the stage reconciler — €24,493.87 overdue that nothing will ever chase

**What happens.** A staff member marks a deal "Partial Payment" on the Kanban when a client pays part of an invoice. From that moment the deal is simultaneously (a) never classified by the reminder function and (b) never touched by the nightly reconciler that would otherwise escalate it to `on_hold` — where it *would* be remindable again. The remaining balance goes silent forever. `closed` and `done` (terminal by design) share the symptom for a different reason.

**Root cause.** Two allow-lists that both exclude `partial_payment`:
- `enqueue_payment_reminders()` (`20260729110000_reminder_breakdown.sql`) classifies only `awaiting_payment` (due-soon) and `on_hold` (overdue / final notice). Any other stage yields a null template key and is filtered out before the dedupe check runs.
- `reconcile_deal_stage()` (`20260702150150`) opens with `if cur_code is null or cur_code not in ('awaiting_payment','on_hold','paid_in_full') … then return false;` — a `partial_payment` deal fails on the first line and the function computes nothing. No code path anywhere sets a deal *to* `partial_payment` either; it is reachable only by a human dragging the card, so this activates every single time the stage is used with a balance outstanding.

This is the reminder-side consequence of the prior audit's **A2**, which stopped at "jobs never renew". A2's mechanism is unchanged live code 20 days later.

**Evidence (2026-08-26).** Unpaid rows on non-archived deals in stages the reminder classifier cannot reach:

| accounting stage | deals | unpaid rows | unpaid total | of which overdue | oldest due |
|---|---|---|---|---|---|
| `closed` | 27 | 42 | €12,040.20 | €12,015.40 | 2026-04-12 |
| `partial_payment` | 15 | 25 | €11,809.35 | €3,591.03 | 2026-01-23 |
| `done` | 23 | 39 | €9,586.20 | €8,884.20 | 2026-04-24 |
| `new` / `documents_verified` | 1 / 1 | 1 / 1 | €2.00 / €1.24 | €2.00 / €1.24 | — |
| *(`paid_in_full`, 17 deals / €3,936.44 — benign: future-dated installments, nothing overdue)* | | | | €0 | 2026-09-04 |

**€33,438.99 unpaid, of which €24,493.87 is already overdue**, sits where no reminder can reach. Worst single case: deal `000225`'s `hosting` row, due **2026-01-23 — 215 days overdue**, €223.20, with `email_outbox` and `email_log` both confirming **zero reminder attempts, ever**. Of the 15 `partial_payment` deals, **11 have never had a single payment reminder attempted**; the other 4 were reminded only while they were still `awaiting_payment`/`on_hold`.

**Fix direction.** Either add `partial_payment` to `enqueue_payment_reminders`'s CASE, or (better, because it also resolves A2 and feeds B5) add it to `reconcile_deal_stage`'s handled-stage list so an overdue partial-payment deal escalates to `on_hold` and becomes remindable through the existing path.

---

#### B2. There is no period lock and no immutability guard on paid revenue: 17 silent post-payment mutations and 9 silent hard deletions (€1,001 net)

**What happens.** `accounting_ledger_v` and `accounting_pl_summary_v` are **plain views** over `deal_payments` — they cannot drift, because they always show the current state of the source. That is the problem: changing or deleting a `deal_payments` row silently rewrites months that were already reported as revenue. Nothing prevents it.

**Root cause.** The only `BEFORE UPDATE` trigger on `deal_payments` is `deal_payments_created_at_immutable` (`20260702000000`), which guards `created_at` and nothing else. `amount_net`, `vat_rate`, `service_type` and `status` are freely editable on an already-`paid` row, hard deletes are permitted, and no `period_lock` / `closed_period` / `freeze` mechanism exists anywhere in the schema (grepped across migrations and docs — none found). A documented owner-approved repair and an undocumented edit travel the identical unguarded path.

**Evidence (2026-08-26).** Of 226 raw "row touched in a later month than its ledger period" hits, 24 actually touched a ledger-relevant column. Matched row-by-row against every file in `docs/data-fixes/`:

- **Mutations: 7 documented, 17 silent.** The 7 documented ones are all `service_type` re-keys with amounts unchanged, matching `2026-08-04-deal-000403-service-change.md` and `2026-08-06-ai-seo-convert-archived-stage.md` on payment id or on deal code + timestamp-to-the-second. The unexplained **amount** swings are all inside the silent 17: `000041` €950→€1900 (2026-06-26), `000079` €500→€250 (2026-07-23), `000477` €200→€0 (2026-08-03 — already-paid June revenue zeroed), `000331` €250→€275, `000203` €177.42→€220. Several others (±€0.004–€0.32) are consistent with ordinary VAT-rounding corrections.
- **Deletions: 0 documented, 9 silent** — **9 already-`paid` rows, €1,001.00 net, hard-deleted between 2026-06-25 and 2026-08-03.** Of these, 3 rows (~€300) belong to deals coded `HARN-B`/`HARN-C`, which do not match the `NNNNNN` pattern of every real client deal and read as sandbox/test cleanup — plausible, but not written up anywhere, so still counted as silent. The remaining 6 (~€701) are on identifiably real, numbered client deals (`005936`, `000415`, `000416`, plus an orphaned deal) and are the clearest unexplained loss of recorded revenue in this audit.

This substantiates, with live instances, the 2026-08-04 audit's A7b claim that "the ledger is a fully mutable view" — which that audit explicitly did not verify against data.

**Fix direction.** Decide the policy first (append-only with reversals vs. editable — owner question), then at minimum block `DELETE` and amount/status edits on `paid` rows past a closed period with a trigger, and require every exception to leave a `docs/data-fixes/` note.

---

#### B3. VAT *under*-collection from payment-method drift: two live deals billing 0% on Greek/online terms

**What happens.** A deal originally created as `cash` (so job + payment rows correctly seeded at 0%) is later switched to `payment_method='online'`, and nothing recomputes VAT. The deal then bills a Greek client 0% VAT — the mirror image of A0.

**Root cause.** No code path anywhere recalculates `vat_rate` on existing jobs or payment rows when `deals.payment_method` or `cash_charge_vat` changes; `vat_rate` is a write-once snapshot on both tables.

**Evidence (2026-08-26).** `000229` (job + **both** installments at 0% for an online/Greek deal; €400 already paid, €400 still pending) and `000935` (created 2026-07-07, i.e. after every fix migration; job + both recurring periods at 0%, €400 total). No version of the seeding code this audit examined — current or historical — computes 0% for a Greek online deal, so the only consistent explanation is a post-hoc payment-method change. **≈€800 principal across the two; ≈€192 of VAT at stake if the still-unpaid rows are collected as they stand.**

**Fix direction.** Recompute `vat_rate` on unpaid rows when `payment_method`/`cash_charge_vat` changes (or refuse the change while unpaid rows exist), and review these two deals' pending rows before they are marked paid.

*Not a bug, checked and cleared:* deal `006122` (United Arab Emirates) at 0% is correct — UAE is a 0%-VAT country in `vat_rate_for_country` since 2026-07-20 (see D).

---

#### B4. Closing a deal never cleans up its billing state — 21 closed deals still look like active recurring revenue, 16 carry phantom overdue balances

**What happens.** `close_deal()` moves jobs to a terminal stage but leaves `jobs.billing_active = true`, `jobs.archived = false`, and any outstanding `deal_payments` rows exactly as they were. Any report, dashboard or MRR figure that trusts `jobs.billing_active` without also checking the deal's accounting stage **overstates active recurring revenue**, and AR/aging views show overdue balances for engagements that are officially finished.

**Root cause.** `deals_close_jobs_on_close()` sets `status='completed'`, `completed_at`, clears the block and moves `stage_id` — it never touches `billing_active` or `archived`, and `close_deal` never touches `deal_payments` at all.

**Evidence (2026-08-26).** 21 non-archived, `billing_active` recurring jobs sit on `closed`-stage deals (`000052, 000113, 000132, 000135, 000144, 000162, 000176, 000188, 000219, 000223, 000242, 000246, 000254, 000287, 000298, 000313, 000315, 000320, 000336, 000349, 000364`), of which **16 also still carry a lingering `overdue` `deal_payments` row** from before close. This re-measures the 2026-08-06 sweep's "~20 churned jobs on `closed` still hold `billing_active = true`" item — unchanged, and now root-caused. Reassuringly, these do **not** generate client emails: the reminder classifier does not cover `closed` (which is B1's mechanism working in our favour here).

**Fix direction.** Have `deals_close_jobs_on_close()` clear `billing_active` (and decide, as policy, whether outstanding rows on a closed deal should be cancelled or left as a receivable).

---

### Tier 2 — silent failure risk

#### B5. Automatic release from `on_hold` has been dead since 2026-07-02; a deal that owes nothing can be stuck on hold forever

**What happens.** Both `block-lifecycle.md` and `deal-lifecycle.md` still describe a trigger that lifts a hold when the last payment is marked paid. That trigger does not exist. Every `on_hold → paid_in_full` release since 2026-07-02 is a manual card drag — roughly **5 per business day**. And when the last outstanding row is *cancelled* rather than paid (the normal `job_pause_billing` "excuse this period" action), there is no path out at all.

**Root cause.** `supabase/migrations/20260702150200_reconcile_stage_trigger_swap.sql` dropped both `deal_payments_release_from_on_hold` and `deal_payments_move_to_awaiting` and replaced them with one unified trigger calling `reconcile_deal_stage()`. But that function's `on_hold` branch returns immediately (`perform block_deal_jobs(...); return false;`) — design decision "B", never auto-lift a hold — so it never re-checks whether the deal still owes anything. Both old functions still exist in the catalog as dead code.

**Evidence (2026-08-26).** 341 `on_hold → paid_in_full` transitions in `activity_log` between 2026-06-23 and today. **Before** the 2026-07-02 swap: 80 transitions, 34 of them (42.5%) with a `null user_id` — the signature of an automatic, trigger-driven release. **After**: 261 transitions, only 1 (0.4%) null — ~260 releases absorbed by named staff in 8 weeks. The deadlock case is live: deal **`000233`** has been `on_hold` since at least 2026-07-16 with every row `paid` or `cancelled` — **nothing owed** — and the 04:00 integrity cron has flagged it **4 times** (2026-07-16, 07-23, 08-16, 08-19), all still `resolved_at IS NULL` today. `deal-lifecycle.md` records the same failure shape (deal `000403`, stuck on hold while fully paid) as the reason the current model was adopted.

**Fix direction.** Add a narrow carve-out to `reconcile_deal_stage` — release `on_hold` when the recomputed `deal_next_due` is NULL (everything paid or excused) — which is strictly narrower than reverting decision B; and update the two lifecycle docs either way.

---

#### B6. The nightly integrity cron writes to a table nobody reads: 342 open alerts across 217 deals, 7 resolutions ever

**What happens.** `reconcile_payment_integrity()` runs successfully at 04:00 every night and correctly detects what it is designed to detect — into `public.data_integrity_alerts`, which has **no UI surface whatsoever**. The alerts dashboard staff actually use (`AlertsPage.tsx` / `useIntegrityAlerts.ts`) calls a completely different function (`accounting_integrity_alerts()`), unrelated to this table.

**Root cause.** No RPC, no trigger, no scheduled job and no code in `src/` ever writes `resolved_at` (the only hit for `data_integrity_alerts` in `src/` is the generated `types/supabase.ts`). The single historical writer is a one-off `UPDATE` inside `20260702000000_billing_mitigations.sql`. The only live signal is an admin `notifications` row per firing.

**Evidence (2026-08-26).** `flip_out_of_paid_in_full`: **342 open**, oldest 2026-07-01 (**56 days**), newest today, spanning **217 distinct deals**, firing 1–8 per day every day of the last two weeks. All-time: 347 alerts, 5 resolved. `duplicate_period`: 2 all-time, both resolved. `resolved_by` has never been non-null on any row in the table's history. B5's deal `000233` is in there 4 times; `000114` 5 times.

**Fix direction.** Either give this table a minimal admin "mark resolved" view, or fold its two checks into the `accounting_integrity_alerts()` RPC staff already open.

---

#### B7. Alert coverage does not point at the bugs that cost money — 0 of 27 checks can see A0

**What happens.** Two alert surfaces exist and are easy to conflate: (A) `reconcile_payment_integrity()`, 2 checks, unattended nightly cron, no UI (B6); (B) `accounting_integrity_alerts()`, **25 checks**, on-demand RPC behind an authenticated admin/accounting session. **27 checks combined.** Mapped against the five live bug classes this audit confirmed:

| bug class | cron (2 checks) | on-demand (25 checks) |
|---|---|---|
| **A0** — cash/no-VAT VAT on `deal_payments` | no | no — checks 3 (`vat_missing`) and 15 (`cash_deal_with_vat`) read **only `jobs.vat_rate`**, which is seeded *correctly*; no check in either surface ever reads `deal_payments.vat_rate` |
| **B3** — online/Greek deals at 0% | no | **yes (partial)** — `vat_missing` catches these because their *jobs* are also wrong |
| **B4** — closed deals still `billing_active` | no | no — the nearest checks explicitly exclude `closed`/`done` |
| **B5** — `on_hold` deadlock | indirectly, and not the deadlock itself (`flip_out_of_paid_in_full` needs a non-null overdue `deal_next_due`; the deadlock state produces NULL) | **yes** — check 8 `on_hold_not_overdue` matches `000233`'s exact state |
| **B1** — `partial_payment` dead end | no | no — neither surface's vocabulary contains `partial_payment` |

**Evidence (2026-08-26).** Every "no" above was established by reading the check's full live `WHERE` clause, not its name. **0 of the 27 combined checks can see the one bug class that is actively costing collected money (A0).** Three of five classes have zero automated detection anywhere in the codebase. The two that *are* detectable are only visible to a human who opens the dashboard — and B5/B6 show that is not happening reliably.

**Fix direction.** Add a `deal_payments`-level arm to `vat_missing`/`cash_deal_with_vat` (highest value — it is the only class currently costing collected money), then decide which of B1/B4 gets a check next.

---

#### B8. No bounce suppression anywhere in the send path — dead addresses are dunned indefinitely

**What happens.** A hard bounce is recorded (`email_log.status='bounced'`, via the Resend webhook) and then never consulted. The same address keeps receiving the full 3-stage dunning sequence, bill after bill.

**Root cause.** `supabase/functions/send-email/index.ts`'s `sendOne()` has exactly two send-blocking guards: an already-terminal `dedupe_key`, and the `clients.status='done'` closed-client check. There is no query against prior `bounced`/`complained` rows for the same `to_email`.

**Evidence (2026-08-26).** Aggregate 30-day health is fine — `payment_*` templates: 355 delivered, 1 bounced, 1 failed (99.4%). But per address: `corfuswifttransfer@gmail.com` bounced **5 times across 3 separate billing cycles** over 7 weeks (2026-06-27, then 07-13 / 07-21 / 07-27, then 08-13) with 0 deliveries and no suppression at any point; `panosantoniou80@gmail.com` bounced on all three stages of the same bill (2026-07-08 / 07-16 / 07-22).

**Fix direction.** Add a per-`to_email` hard-bounce check to `sendOne()` that skips and logs a distinct reason — the identical guard pattern already exists three lines away for closed clients.

---

#### B9. The email outbox has a dead-letter trap: a permanently un-sendable row stays `status='pending'` forever

**What happens.** After 5 failed sends a row can never be claimed again, but the failure path always resets it to `pending` — so it is indistinguishable, by status, from a healthy row about to go out. No terminal state, no alert, no expiry. The **accounting** identity is currently clean, but the mechanism is shared and can trap accounting rows just as easily.

**Root cause.** `claim_email_outbox(p_limit)` claims `where status = 'pending' and attempts < 5`; `drain()` in `send-email/index.ts` (line ~325) resets failures to `'pending'`, never `'failed'`. `recover_stale_email_claims` only resets `status='sending'` rows, so it never sees these.

**Evidence (2026-08-26).** Accounting identity: **184/184 sent in the last 14 days, 0 pending, 0 failed**; all-time 1,245 sent / 3 failed, and those 3 are the June `diatypos` incident already closed manually. Both drain crons ran 100% successfully (10,080 and 4,032 runs). But the literal stuck-row query returns **3 rows, all `identity='sales'`, stuck since 2026-07-18…22 — over 5 weeks — all at `attempts=5`** with `422 Invalid 'to' field`. They are visible in the admin Email Health surface (`useEmailOps.ts`, which does not cap on `attempts`) and have a working manual retry/cancel — nobody has looked.

**Fix direction.** Transition attempts-exhausted rows to a terminal `'failed'` status so `pending` always means "will be retried".

---

#### B10. Nothing validates recipient email format — one malformed value silently breaks every email to that contact

**What happens.** A contact record holds two addresses joined by `" / "` in a single field. Every send to that recipient fails at the provider with `422 Invalid 'to' field`, retries to exhaustion, and (per B9) sits in the queue forever.

**Root cause.** No CHECK constraint, no application-level validation, on `clients.email` or on the lead/company email feeding the `sales` identity.

**Evidence (2026-08-26).** Two independent live instances: `clients.email = 'diatypos@otenet.gr / info@diatypos.gr'` (5 failed `pay_overdue` attempts on one €300.01 payment for deal `005048`; resolved only because an admin cancelled it manually, and the client paid through another channel 3 days later) and `knektar1@yahoo.gr / info@euro-business.gr` (the 3 rows still stuck from B9). Note this is what a "5× duplicate send" alarm actually was — 5 retries of one row, not 5 emails (see D).

**Fix direction.** Add a basic format constraint/validation on the email columns at write time.

---

#### B11. The frontend counts `cancelled` rows as outstanding — 63 fully-settled deals show "Partial", and one click can revive an excused row as paid

**What happens.** Two separate UI defects from the same blind spot. (1) The Accounting Kanban labels a deal "Partial" whenever any row is unpaid *including* rows deliberately excused via `job_pause_billing`. (2) The Payments panel's status badge is a toggle with no `cancelled` branch — one click on a cancelled row sets it `paid` with `paid_at = now()`, no confirmation, silently undoing the accountant's decision not to collect.

**Root cause.** `src/features/accounting/AccountingKanbanCard.tsx`'s `paymentSummary()` computes `paid === list.length` over the deal's **unfiltered** `deal_payments` array (and `useAccountingDeals.ts`'s TS type declares only `'pending'|'paid'|'overdue'`, silently dropping `'cancelled'` from the type while the query still returns it). `src/features/deals/PaymentsPanel.tsx`'s `toggleStatus()` is `const next = row.status === 'paid' ? 'pending' : 'paid'`. On the DB side the only `BEFORE UPDATE` trigger guards `created_at`, so nothing blocks `cancelled → paid`.

**Evidence (2026-08-26).** The equivalent SQL run live returns **63 non-archived deals** (of 66 with any cancelled row) where every non-excused row is paid but the card renders "Partial" — e.g. `000039` (4 paid + 1 cancelled), `000210` (2 paid + 6 cancelled). The badge is display-only (it drives no stage move or filter), so this is a trust/reporting bug, not a money-mover. The toggle bug is a confirmed *mechanism*; no live occurrence was searched for, because detecting one would require a write.

**Fix direction.** One-line denominator fix (`list.filter(p => p.status !== 'cancelled')`), and disable-or-confirm the toggle for cancelled rows.

*Backend note:* all 12 DB-side consumers of `deal_payments.status='cancelled'` were inventoried and **every one handles it correctly** (the CHECK, the partial unique index, `deal_next_due`, `ensure_recurring_payments`, both duplicate-period defences, `reconcile_deal_stage`, `reconcile_payment_integrity`, `accounting_integrity_alerts`, `enqueue_payment_reminders`). The gaps are exclusively frontend.

---

#### B12. A recurring job added to an already-won deal never gets a first billing period

**What happens.** Only the deal-creation trigger seeds payment rows. `ensure_recurring_payments()` can only *extend* an existing chain — it cannot bootstrap one. So a recurring service added to a deal after it was won bills nothing, forever, while showing `billing_active = true`.

**Evidence (2026-08-26).** Exactly one live instance in the whole database: `000126-ADS-2` (`recurring_monthly`, created 2026-07-29) has **zero `deal_payments` rows of any status, ever**. Its `monthly_amount` is €0.00, so today it costs nothing — the mechanism is the finding, not the amount.

**Fix direction.** Seed the first period when a billing-active recurring job is created on an already-won deal (or teach the generator to bootstrap from the job when no chain exists).

---

### Tier 3 — hygiene

#### B13. `deal_payment_lines.amount_net` is `numeric(12,2)` under a `numeric(12,4)` parent

Deal `005090`'s payment header stores `346.7780` while its single line stores `346.78` — a €0.002 shortfall, invisible at display precision but able to accumulate on a payment split across several lines. Root cause: `20260617000006_deal_payment_lines.sql` added the child column at 2 decimals while `deal_payments.amount_net` has been 4 decimals since its origin migration. **This is a known, owner-accepted leftover** — `docs/data-fixes/2026-07-14-payment-line-resync.md` names deal `005090` with these exact numbers and records the decision to skip widening it until a second case appears. Live count on 2026-08-26: still exactly one deal (2 rows: the paid row and its pause-cancelled successor). **Fix direction:** widen the child column to `numeric(12,4)`, if and when the owner's own stated threshold is crossed.

#### B14. Template interpolation silently renders unknown variables as empty strings

`supabase/functions/send-email/templates.ts`'s `interpolate()` is `tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => String(data[key] ?? ''))` — a `{{var}}` with no matching payload key ships blank to the client with no failure signal anywhere. **No live blank-render bug exists today** (all vars used by the three live payment templates are supplied), but the enqueuer computes and ships two fields — `client_name` and `service_type` — that no template references, so payload and template have already drifted apart once without anyone noticing. **Fix direction:** log (or fail) on an unmatched variable instead of substituting empty string.

#### B15. The renewal generator keys chains on `service_type`, not `service_index` as documented

`ensure_recurring_payments()`'s every join, `exists` and `not exists` predicate matches on `(deal_id, service_type, billing_type)`. `docs/tech/accounting/billing-model.md` states recurring series are linked by `(deal_id, service_index)`. Two jobs sharing a service type on one deal (e.g. a service replaced and re-added with a new index) are therefore treated as one interchangeable chain. **No live case needing it was found on 2026-08-26** — recorded as a latent modelling gap for whoever owns the `service_index` design.

#### B16. Documentation drift and dead code

Four documents describe mechanisms that were replaced weeks before the previous audit, and four code objects are now unreachable. None of this is a data bug; all of it will mislead the next person who reasons about the system.

| document | what is stale (as of 2026-08-26) |
|---|---|
| `billing-model.md` (line 22), `payment-reminders.md` (line 48) | claim the `deal_payments.status` CHECK is `('pending','paid','overdue')`; the live CHECK also allows `'cancelled'`, and 93 such rows exist |
| `payment-reminders.md` | describes exact-day `−7/+1/+7` windows, one email per payment row, cron calling `enqueue_payment_reminders()` directly, and a `prefix:payment_id` dedupe key. Live since 2026-07-02/07-29: stage-locked classification, per-`(deal, template, due_date)` aggregation with a per-service breakdown, a `run_daily_payment_reminders()` wrapper, and a three-segment `prefix:deal_id:YYYYMMDD` key |
| `block-lifecycle.md`, `deal-lifecycle.md` | describe `reconcile_block_lifecycle` computing `target_accounting_stage()` per deal (it delegates entirely to `reconcile_deal_stage` since 2026-07-02), and describe `deal_payments_release_from_on_hold` as a live trigger (dropped 2026-07-02, see B5) |

Dead code, all confirmed unreachable from any live path by a full catalog + trigger scan: `target_accounting_stage()` (0 callers in any function, trigger or `src/`), `deal_payments_release_from_on_hold()` and `deal_payments_move_to_awaiting()` (functions kept, triggers dropped), `move_overdue_deals_to_on_hold()` (its cron `daily_move_overdue_deals_to_on_hold` is `active: false` and correctly superseded).

---

## B. Cross-reference: 2026-08-04 audit + 2026-08-06 sweep → status today

All re-measurements dated **2026-08-26**. "Not re-measured" means this audit's probe set did not cover it — it is neither confirmed nor cleared.

| # | 2026-08-04 / 2026-08-06 finding | Status today | Re-measured |
|---|---|---|---|
| **A0** | Cash/no-VAT deals charged VAT on payment rows | **WORSE** — and root cause now identified (`seed_deal_payments` ignores `cash_charge_vat`); self-perpetuating through renewals; reaches rows dated 2028 | 11 deals / 19 rows / €912.31 (08-06) → **12 deals / 19 rows / €977.11** |
| **A1** | Pause/Resume report failure on every success (`ok` key) | **FIXED** — migration `20260806090000`, verified live 2026-08-06. Not re-tested in this audit; no downstream symptom observed | — |
| **A2** | `partial_payment` has no automatic exit | **STILL OPEN** — identical live code; extended by **B1** (also un-remindable). 1 of the 15 shows the renewal-block mechanism live (`000415`, 2 `local_seo` jobs stuck in `done`); the other 9 recurring jobs keep invoicing normally, since billing is not gated on `partial_payment` | 18 deals (08-06) → **15 deals / €11,809.35**; all 15 owe something; no €0-owed trap today |
| **A3** | Stale twin rows keep deals unpaid on paper (`004556`, `006095`) | **STILL OPEN (partial)** — `004556` is still parked in `partial_payment` with a €496 balance whose oldest unpaid row is dated 2026-07-06, matching the twin's signature; `006095` is no longer in `partial_payment`. A dedicated twin-row query was not re-run | partial |
| **A4** | One stage rule, two implementations, one day apart | **STALE-CLOSED — do not action.** The mechanism did not exist on the day A4 was written: `reconcile_block_lifecycle` stopped calling `target_accounting_stage` on 2026-07-02, a month earlier. Confirmed twice (call-site grep, then a full live-catalog + trigger scan finding **0 callers**). The 5 deals sitting at today's boundary are all correctly `awaiting_payment` under the single `<` rule. Simplification D4 is moot for the same reason | 7 boundary deals (08-04) → 5, all correct |
| **A5** | Renewal generator ignores `cancelled` | **FIXED** (`20260806210000`) **and inert.** The cancelled-topped population is growing as expected from normal pausing, but **all 67 have `billing_active = false`** — the risky combination (cancelled head + billing-active job + non-closed deal) returns **0 rows**. The `job_resume_billing` decoupling risk the fix's own header flagged has not materialised in 20 days | 47 of 410 chains (08-06) → **67 of 425**; live exposure **0** |
| **A6** | Nothing detects overlapping periods | **STILL OPEN, but static** — no new overlap has appeared since 2026-08-06 despite the generator running nightly; 2 of the 3 affected chains have since been paused independently. The double-billed periods themselves are still uncorrected in the ledger (owner decision) | 4 pairs (08-06) → **still exactly 4 pairs across 3 chains** (`000173` ×2, `000067`, `000051`) |
| **A7** | Job price changes never reach the recurring schedule | **IMPROVED** — and both previously-known artifacts (`000415`, `000406`) have dropped out. A **new shape** appeared: 3 jobs at `monthly_amount = 0.00` while their chains actively bill €200–€300 (the *understatement* mirror of A7's original framing) → owner decision. **Per-job drift sums are still not money owed** (grouped billing / service swaps); the €993.94 absolute-delta figure is context only | 30 rows (08-06) → **9 rows** |
| **A7b** | *Mixed-rate group VAT overcharge* | **Not re-measured** | — |
| **A7b** | *Payments panel truncates net silently* | **Not re-measured**; the related column-precision gap is confirmed as **B13** | — |
| **A7b** | *The ledger is a fully mutable view; paid rows hard-deletable* | **CONFIRMED live and quantified → B2.** Views cannot drift (they are plain views over `deal_payments`); the exposure is the unguarded source table — 17 silent mutations, 9 silent deletions, €1,001 net | new live evidence |
| **A7b** | *Reminder gate `created_at::date < start_date` mutes same-day rows* | **STILL LIVE, by design** — confirmed present in the live enqueuer body; it was added deliberately on 2026-07-01 after 4 wrongly-dunned same-day payments (`20260701030000`). The trade-off it makes (late-spawned rows never remind) is unchanged | confirmed present |
| **A7b** | *`paid_at::date` evaluated in UTC / month attribution* | **Not re-measured** | — |
| **A7b** | *`vat_missing` doesn't trim country; dismissals never expire* | **Not re-measured** | — |
| **A7b** | *Expense spawner lacks the end-date guard; document/PDF notes* | **Out of scope** — this audit covered income, not expenses or documents | — |
| **A8** | Frontend permission gates, MRR tile, invalidation, one-click un-pay | **Not systematically re-audited.** Two new frontend defects were found in the surfaces this audit did touch (**B11**), one of which — the unguarded one-click status toggle — is the same class as A8's "one-click un-pay wipes `paid_at` with no confirmation" | partial |
| **S1** | 2026-08-06 sweep: three one-time `web_dev` jobs never invoiced, €2,350 net (`000233` €800, `000280` €750, `000420` €800) | **Not re-measured — still an open owner decision.** Two cross-links worth noting: `000233` is also B5's deadlocked deal, and `000420` appears twice in B2's silent-mutation list (2026-08-21) | — |
| **S2** | 2026-08-06 sweep: `release_jobs_for_deal`'s `partial_payment_pending` blocking is unreachable dead code | **Not re-measured** — carried forward (same item as prior audit's simplification D2) | — |
| **S3** | 2026-08-06 sweep: `000045-AISEOLOC` payment line on a zero-amount child; ~20 churned `closed` jobs still `billing_active` | **STILL OPEN, root-caused → B4** — 21 such closed deals, 16 of them also carrying a lingering `overdue` row, because `deals_close_jobs_on_close()` never touches billing state. The `000045` line item was not re-checked | ~20 → **21** |

**New this audit:** B1–B16 (section A). **Verified-clean list from 2026-08-06** (no job on an archived stage, no billing-only card on a board, no off-board job on a paid-in-full deal, no AI-SEO parent missing a child, no card lagging its paid periods, the 13 duplicate service groups) was **not re-hunted**, per the plan's own instruction; nothing this audit found contradicts it.

---

## C. Owner decisions — policy questions, not bugs

These need a human answer before any code or data is touched. They are deliberately kept out of section A.

**Money already moved**

1. **A0 — the €977.11 already collected** (12 deals, 19 paid rows, measured 2026-08-26). For each deal: was VAT genuinely owed (the cash flag was set after the fact), or is a refund / credit note due? This is item 7 of the prior audit's section G, re-measured and grown.
2. **The 2026-06-17 bulk-import cohort** — deals `000090`, `000136`, `000276` (of 470 imported that day) show their *first* billing period at 0% VAT and every later period correctly at 24%, with close dates backdated before the accounting system launched. ≈€1,890 principal. This is most likely a faithful record of what was invoiced pre-launch — but it cannot be confirmed as either correct history or an import bug without asking whoever ran the import. Note one internal inconsistency: a `hosting` row on `000136` is 0% while an identical `hosting` job on `000090` is 24%.
3. **B3 — deals `000229` and `000935`** are billing Greek/online clients at 0% VAT. ≈€800 principal; ≈€192 of VAT at stake on the rows not yet paid. Should the pending rows be corrected before they are collected?
4. **A6 — the 4 overlapping paid periods** (`000173` ×2, `000067`, `000051`, unchanged since 2026-08-06). `000173` is a probable double charge of €379.03 for the same month. Refund, credit note, or accept?
5. **B2 — the 6 unexplained hard deletions on real client deals** (≈€701 net of the €1,001 total; the other ~€300 is plausibly `HARN-*` sandbox cleanup). Should these be reconstructed, or written up as accepted? And the 17 silent mutations — particularly `000041` €950→€1900, `000079` €500→€250, `000477` €200→€0 — do they each have a story?
6. **S1 — the €2,350 of never-invoiced one-time `web_dev` jobs** (`000233` €800, `000280` €750, `000420` €800, figures from 2026-08-06, not re-measured today): invoice, write off, or confirm they were taken outside the CRM?
7. **A7 successor — 3 jobs at `monthly_amount = 0.00` while actively billing** €300 / €230 / €200 (`000090-WEBSEO`, `000289-LOCALSEO`, `000416-WEBSEO`, all billed within 3 weeks of 2026-08-26). Which side is authoritative — the job card price or the payment chain? *Do not read the €993.94 aggregate drift figure as money owed.*

**Policy and design**

8. **Should a paid-off `on_hold` deal release itself?** Design decision "B" (never auto-lift a hold) is deliberate, but it now costs staff ~5 manual releases per business day (~260 in 8 weeks) and produced B5's `000233` deadlock. A narrow carve-out — release when nothing is owed — is available without reverting B.
9. **Should `partial_payment` deals be remindable, escalate automatically to `on_hold`, or neither?** This decides B1 and A2 together. Note €24,493.87 is currently overdue behind this question (2026-08-26).
10. **Should the ledger become append-only with reversals, or stay editable?** (Item 8 of the prior audit's section G, unchanged.) Concretely: should a `paid` row past a closed month be undeletable, and should amount/status edits require a reversal entry?
11. **Should reminders be suppressed for hard-bounced addresses** (B8), and should the system stop dunning after N bounces?
12. **78 deals have `suppress_payment_reminders = true`** (2026-08-26). About 37 have nothing outstanding — harmless. The other ~41 carry a real muted balance; the top 10 alone are **≈€8,896 in overdue balance that nothing will ever nudge** (`000298` €1,246.20, `000177` €1,078.80, `000216` €900.00, `000092` €868.00, `000498`/`000192`/`000057` €744.00 each, `000160` €543.12, `005690` €503.01, `000050` €500.96). No dashboard and no alert check anywhere references `suppress_payment_reminders`. Should suppressed-and-owing be a periodic review, or a permanent decision per deal? (The ledger figures are as-recorded; they were not verified against bank records.)
13. **Which alert gets built first?** B7 shows 3 of 5 live bug classes have no detection at all. A0 is the highest-value target — it is the only one currently costing collected money.
14. **Process question:** deal `000233` produced 4 admin notifications over 5 weeks and none was actioned; 342 alerts sit unresolved across 217 deals. Is this a staffing/triage gap, a missing UI (B6), or both?
15. **A3 — deal `004556`**: cancel the stale twin row so the deal can leave `partial_payment`?

---

## D. Refuted — do not act on these

Each of the following looked like a finding and is not. They are recorded so nobody rediscovers them.

- **A4 (one rule, two implementations)** — stale on the day it was published; there has been a single boundary rule since 2026-07-02 and `target_accounting_stage` has zero callers (verified twice, 2026-08-26). Do not "unify the two rules"; there is one.
- **"43 stale overdue rows that never un-flip"** — 0 real. `mark_overdue_payments` correctly uses `start_date` for recurring rows and `end_date` for one-time rows; all 43 are recurring rows whose *period* simply has not ended yet. Both correct-basis queries return 0.
- **"126 missed reminders in 60 days"** — 16 after correcting the dedupe key shape, and **0 of the 16 are enqueuer bugs**: they are all deals sitting in a stage the classifier does not cover (which is B1), plus 2 that cannot be judged because historical stage is not retained.
- **"Duplicate pending rows on `000048`"** — a deliberate 3-installment plan (`website (1/3)` paid, `(2/3)` and `(3/3)` pending), confirmed via `deal_payment_lines.label`.
- **"Deal `006122` is billing 0% VAT wrongly"** — correct. The UAE is a 0%-VAT country in `vat_rate_for_country` since 2026-07-20; the brief's Cyprus-only country list was stale.
- **Zero-value rows** (`000084`, `000306`, `000468`, `000477`, `005497`) — VAT-rate mismatches on €0.00 rows. 0% × €0 = 24% × €0. Data-hygiene nit, not money.
- **"22 recurring chains have silently died"** — 21 of the 22 are the generator correctly refusing to bill a deal a human deliberately closed. The real finding underneath is B4 (nothing cleans up on close). The 22nd is B12.
- **"A reminder was sent 5 times for one payment"** — 5 *failed retries* of one outbox row, not 5 delivered emails; the real finding underneath is B10.
- **"The `payment_due_today` template is still present and could fire"** — the row was backed up and **deleted** on 2026-07-02 (`20260702140000`, Section 3). It cannot fire; last activity of any kind was 2026-06-24.
- **"Won-push amounts mismatch"** — 0 mismatches. Both live rows (`006357`, `006314`) match net-to-net exactly at €200 with the correct 23% commission. The feature is 2 days old with no backfill, so the testable population is 2 rows, not the 24 deals won in 30 days. Re-check in 30 days.

---

## E. What is clean

Confirmed healthy on **2026-08-26**, so these do not need re-hunting:

| check | result |
|---|---|
| Live-vs-repo drift across all 11 money functions | **0** — every deployed function is exactly its newest migration |
| Cron health (7 money jobs × last 3 runs) | **21/21 succeeded**; ordering matches the docs (02:00 renew → 02:15 overdue → 02:20 reconcile → 04:00 integrity → 06:00 reminders) |
| Rows stuck `pending` past their real due date | **0** (under both the naive and the per-billing-type basis) |
| Rows stuck `overdue` that should have un-flipped | **0** |
| Paid rows with inverted dates / paid rows on archived deals | **0** / **0** |
| Archived deals carrying unpaid rows | **0** (verified two ways) |
| `deal_payment_lines` pointing at archived jobs / at another deal's job | **0** / **0** |
| Reminders fired for an already-paid payment | **0** of 350 parsed sends |
| Non-domains pending rows seeded >13 months out | **0** |
| Backend consumers of `deal_payments.status='cancelled'` | all 12 handle it correctly (the gaps are frontend — B11) |
| `accounting` email identity, last 14 days | **184/184 sent**, 0 pending, 0 failed |
| Payment-reminder delivery, last 30 days | 355 delivered / 1 bounced / 1 failed (99.4%) |
| Won-push (CRM → sales) amount fidelity | 2/2 exact, commission correct |
| Live reminder templates vs. enqueuer payload | every `{{var}}` used is supplied — no blank-render bug today |

---

## Appendix 1 — query traps (do not re-run these SQL shapes)

Six of this audit's own starting queries produced convincing false findings. Any future re-measurement must use the corrected forms.

| trap | why it is wrong | corrected form |
|---|---|---|
| `deals.stage_id` joined to `pipeline_stages.board = 'accounting'` | the accounting stage is `deals.accounting_stage_id`, and the board is `accounting_onboarding`. Returns **0 rows, no error** | join `accounting_stage_id`, board `'accounting_onboarding'` |
| `grep -rln "create or replace function public.<name>"` | case-sensitive; misses every migration written with `CREATE OR REPLACE` (which several later ones are), so the "latest" file is wrong and a spurious drift appears | `grep -rlin` |
| Country VAT lists that name only Cyprus | UAE has been a 0%-VAT country since 2026-07-20 | use `vat_rate_for_country()` as the source of truth |
| `overdue` gated on `end_date` for all billing types | recurring rows are due on `start_date`; `end_date` is the period end. Produced 43 false positives | split the basis by `billing_type` |
| `dedupe_key = prefix || ':' || payment_id` | the key has been `prefix:deal_id:YYYYMMDD` since 2026-07-29. Produced 126 false "missed" reminders, and made the wrong-fire check silently match nothing | parse `split_part(dedupe_key, ':', 2/3)` |
| duplicate-pending keyed on `(deal, service, billing_type, start_date)` | one-time installment rows legitimately share a NULL `start_date`; the key cannot see `deal_payment_lines.label` | include the line label before calling anything a duplicate |
| `pg_get_functiondef(oid)` with two joined catalogs | ambiguous column reference; errors out | qualify as `p.oid` |

---

## Appendix 2 — self-review against the audit plan

- **Every task's findings are represented.** Task 1 baseline/drift → section E, B16, Appendix 1. Task 2 VAT → A0, B3, C2, B7. Task 3 renewals → A5, A6, A7, B4, B12, B15. Task 4 status machine → E, B11, B5 (`000233`), Appendix 1. Task 5 reminders → B1, B8, B10, B14, C12, D. Task 6 lifecycle → A2 detail, A4 closure, B5, B6, B7. Task 7 integrations → B2, B13, D (won-push), B9, B10.
- **No REFUTED finding is presented as a bug.** A4, the 43 stale-overdue rows, the 126 missed reminders, `000048`, `006122`, the zero-value rows, the 21 "dead" chains, the 5× duplicate send, `payment_due_today`, and the won-push comparison are all in section D only.
- **Every money figure carries its measurement date.** All are 2026-08-26 unless the text states otherwise (2026-08-04 and 2026-08-06 baselines are labelled as such; S1's €2,350 is explicitly marked not re-measured).
- **The A7 caveat is respected.** No per-job price-drift sum is quoted as money owed anywhere; the €993.94 figure appears once, labelled as context only.
- **Corrections from review applied.** The alert coverage figure is **0 of 27** (2 cron checks + 25 on-demand checks), not 0 of 22. The ledger mutability split is 17 silent + 7 documented mutations and 9 silent + 0 documented deletions, not an undifferentiated 24/9.
- **Owner decisions are separated from bugs** (section C), as in the 2026-08-04 audit's sections E and G.
- **Read-only mandate honoured.** No code, data, schema or migration was changed by this audit. Every fix in section A is stated as a direction, not applied.

### Suggested order of work (dependency order, not severity order)

1. **A0** — `seed_deal_payments` guard. It is the only defect where client money is demonstrably changing hands wrongly, and it is still creating new instances.
2. **B7's first check** — a `deal_payments`-level VAT arm on the existing alerts, so A0's class can never go unseen again.
3. **B1 / A2 together** — one decision (C9) fixes the largest € exposure and unfreezes 15 deals.
4. **B5** — the `on_hold` release carve-out; gated on decision C8, and it also clears `000233`.
5. **B4** — clear `billing_active` on close; cheap, and it fixes reporting for 21 deals.
6. **B11** — two one-line frontend fixes (denominator, toggle guard).
7. **B8 / B9 / B10** — the email trio; B10 is a constraint, B8 and B9 are guards in code that already has the pattern.
8. **B2** — after decision C10, because the shape of the fix depends on the policy.
9. **B6, B12, B13, B14, B15, B16** — hygiene and documentation, once the behaviour they describe has settled.

Data repairs in section C are independent of all of the above and need owner decisions first.
