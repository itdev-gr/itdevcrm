# Accounting module — full audit, 2026-08-04

Read-only audit of every accounting process and option. **Nothing was changed** — no code, no data, no schema. Every claim below that is marked VERIFIED was checked against the production database (project `xujlrclyzxrvxszepquy`) on 2026-08-04; claims that could not be confirmed are marked as such, and one claim that turned out to be wrong is recorded as REFUTED so nobody acts on it later.

## Method

Five independent code auditors covered the payment lifecycle and stage machine, duplicate/integrity defences, the job↔billing coupling, the accounting frontend, and money/VAT/ledger/documents. Their hypotheses were then tested against live data by the controller, which is the only party with database access. The split matters: several code-level findings that looked severe turned out to be latent (the shape exists, the data does not), and one turned out to be false.

Surface covered: 65 database functions whose names touch payment/billing/deal/invoice/recurring/accounting/ledger/expense/vat/period, the cron schedule, and 37 distinct accounting actions reachable from the UI.

---

## A. Confirmed defects, worst first

### A0. Cash / no-VAT clients are being charged VAT — VERIFIED, money already collected

A deal can be marked `payment_method = 'cash'` with `cash_charge_vat = false`, meaning the client pays cash and no VAT is charged. The **jobs** on those deals correctly carry 0% VAT. The **payment rows** do not: the seeding path applies the standard 24% regardless of the deal's cash flag. Reminders and documents then quote the VAT-inflated gross, and neither VAT alert catches it, because both `vat_missing` and `cash_deal_with_vat` audit `jobs`, never `deal_payments`.

Live: **54** cash/no-VAT deals exist. **11** of them carry VAT-bearing payment rows — **22** rows, of which **17 are already paid**, totalling **€912.31 of VAT collected from clients who were on no-VAT terms**.

| deal | client | rows (paid) | net | VAT collected | periods |
|---|---|---|---|---|---|
| 000299 | ΖΥΓΟΥΡΗΣ ΙΑΚΩΒΟΣ | 3 (3) | €1103.87 | **€264.93** | 29/05–17/07 |
| 000508 | PERLA BOUTIQUE | 2 (2) | €600.00 | **€144.00** | 18/06–18/07 |
| 000329 | ΤΣΙΡΟΓΙΑΝΝΗ ΑΝΑΣΤΑΣΙΑ | 2 (2) | €400.00 | €96.00 | 20/05–20/06 |
| 000257 | ΛΟΝΤΟΣ ΚΩΝΣΤΑΝΤΙΝΟΣ | 4 (2) | €800.00 | €96.00 | 08/05–08/08 |
| 005023 | Θάνος Καραθάνος | 3 (2) | €490.00 | €64.80 | 03/07–03/08 |
| 000338 | ΠΑΝΑΓΙΩΤΑΚΗΣ ΙΑΚΩΒΟΣ | 3 (1) | €600.00 | €48.00 | 21/05–21/07 |
| 005510 | Tsopanas Holidays | 1 (1) | €200.00 | €48.00 | 27/07 |
| 000313 | ORTHOCURE | 1 (1) | €200.00 | €48.00 | 23/03 |
| 000203 | ΝΤΙΜΠ ΡΑΦΑΕΛΑ | 1 (1) | €177.42 | €42.58 | 29/05 |
| 000477 | ΙΩΑΝΝΗΣ ΛΥΡΑΣ | 1 (1) | €150.00 | €36.00 | 04/06 |
| 006851 | (no client name) | 1 (1) | €100.00 | €24.00 | **03/08** |

This is **not historical** — the most recent affected row was billed on 2026-08-03, the day before this audit. Whether each of these is a genuine overcharge or a deal whose cash flag was set after the fact needs an accountant's eye per row, but the mechanism is real and still active.

### A1. Pause/Resume billing reports failure on every success — VERIFIED

`job_pause_billing` returns `{'jobs_flagged', 'payments_cancelled'}`; `job_resume_billing` returns `{'jobs_unflagged', 'new_payment_id', 'next_start', 'next_end'}`. Neither returns an `ok` key. Both hooks in `src/features/jobs/hooks/useJobBillingPause.ts` do:

```ts
if (!result.ok) throw new Error((result.errors ?? ['unknown_error']).join(', '));
```

So **every successful pause and resume throws `unknown_error` in the UI**, `onSuccess` never runs, no query is invalidated, and the screen keeps showing billing as active — while the database has already flagged the job and cancelled its unpaid payment rows.

Verified live: the RPC bodies carry no `ok` key (`pg_get_functiondef` checked directly, not the repo file).

Live consequences: **40** non-archived jobs currently blocked with `blocked_reason='billing_paused'`, **233** non-archived recurring jobs with `billing_active = false`, **56** payment rows in `cancelled`. Not all of those are mistakes, but every one of them was produced by a flow that told the operator it had failed.

This is the root cause of the "billing stopped silently" class of incident, including deal 000403 documented in `docs/data-fixes/2026-08-04-deal-000403-service-change.md`.

### A2. `partial_payment` is a stage with no automatic exit — VERIFIED

`reconcile_deal_stage` opens with:

```sql
if cur_code is null
   or cur_code not in ('awaiting_payment','on_hold','paid_in_full')
   or not v_pm then
  return false;
end if;
```

`reconcile_block_lifecycle` (nightly, 02:20 UTC) uses the same allow-list. `partial_payment` is in neither. A deal that enters `partial_payment` never leaves it automatically, no matter what the client pays — only a human dragging the card moves it.

Because `release_deal_jobs` fires on the transition **into** `paid_in_full`, a deal stuck in `partial_payment` never renews any of its service cards.

Live: **17** deals sit in `partial_payment`. **10** of them have active recurring jobs whose renewal can therefore never fire. Deal `000041` owes **€0** and has been stuck since 2026-06-22. Deals `004556` and `006095` owe nothing real — their only unpaid rows are stale twins (see A3).

### A3. Stale twin rows keep deals unpaid on paper — VERIFIED

Signature: an `overdue` row with no invoice number sitting beside a `paid` row with an invoice, for the same deal, service, billing type, date and amount.

Live: **2** such rows — `004556` (web_dev, €400, 2026-07-06) and `006095` (web_dev, €275, 2026-07-17). Both deals are consequently parked in `partial_payment` (A2) and cannot escape.

No client was wrongly emailed by these: `enqueue_payment_reminders` only targets deals in `awaiting_payment` or `on_hold`, and these are in `partial_payment`. The damage is stuck state and wrong reporting, not wrongful dunning.

### A4. One rule, two implementations, one day apart — VERIFIED

`target_accounting_stage(next_due, today)` — used by the nightly reconciler — says `next_due <= today → on_hold`.
`reconcile_deal_stage` — used on every payment event — inlines the same rule as `next_due < current_date → on_hold`.

On the due date itself they disagree: the cron calls it overdue and puts the deal **on hold** (which blocks the delivery team's cards via `block_deal_jobs` and arms the `payment_overdue`/`payment_final_notice` templates), while any payment-driven reconcile calls it `awaiting_payment` (`payment_due_soon`). The two can fight over the same deal on the same day, and which email the client receives depends on which ran last.

Live right now: **7** deals have `next_due = current_date` — exactly the 7 where the two implementations disagree. Tonight's 02:20 run will move them to `on_hold`. Separately, **12** deals currently sit in a stage that disagrees with the computed target.

### A5. Cancelled rows are invisible to the renewal generator — VERIFIED

The live `ensure_recurring_payments` filters on `billing_type`, `end_date`, deal not archived, accounting stage not `closed`, and the existence of a `billing_active` job. It has **no `status <> 'cancelled'` filter** — neither when choosing the row to extend from, nor in the successor guard `not exists (… dp2.end_date > dp.end_date)`.

So a cancelled row can seed a successor (back-billing a period that was deliberately voided), and a cancelled row with a later `end_date` can block a legitimate renewal. Pause cancels unpaid rows, which is how these arise.

Live: of **374** recurring billing chains, **36** have a cancelled row as the newest period. **7** of those are already stale. **4** services with `billing_active = true` have no non-cancelled period covering today at all:

| deal | client | job | price | covered until |
|---|---|---|---|---|
| 000090 | www.dctrade.gr | `000090-WEBSEO` | €300/mo | never |
| 000403 | ΥΔΡΑΙΟΣ ΙΩΑΝΝΗΣ | `000403-WEBSEO` | €250/mo | 2026-06-08 (57 days) |
| 006122 | Dynamis Capital FZ LLE | `006122-AISEOWEB` | €0/mo | never |
| 000066 | ΦΟΥΡΝΑΡΗ ΑΙΚΑΤΕΡΙΝΗ | `000066-MAINTENANCE` | €100/mo | gap before 2026-09-24 |

### A6. Nothing detects overlapping periods — VERIFIED

`deal_payments_no_duplicate_period` and the partial unique index catch only an **exact** tuple match. Alert #6 (`duplicate_period`) groups by the same exact tuple. Nothing looks at overlap.

Live: **4** true overlaps (different start dates, same service, both non-cancelled):

| deal | service | period A | period B | overlap |
|---|---|---|---|---|
| **000173** | social_media | 23/06→23/07 €379.03 paid | 26/06→26/07 €379.03 paid | ~1 month |
| 000051 | local_seo | 01/06→07/07 €240 paid | 01/07→01/08 €240 paid | 6 days |
| 000067 | local_seo | 09/06→09/07 €241.94 paid | 02/07→02/08 €241.94 paid | 7 days |

000173 additionally has a third €379.03 period (26/05→26/06). Two paid periods covering essentially the same month is a **probable double charge of €379.03** and needs a human decision, not a code fix.

### A7. Job price changes never reach the recurring schedule — VERIFIED

`ensure_recurring_payments` copies `amount_net` from the **previous payment row**, not from the job. `update_job_billing` does not touch pending rows. So raising or lowering a service fee on the job card changes the deal totals and the alerts, but the client keeps being billed the old figure indefinitely. The alert that would seem to cover this (`deal_value_mismatch`) compares the deal to its jobs, so it stays green.

Live: **26** active recurring jobs whose price differs from their latest paid period; **9** differ from a currently unpaid period. Three are material and are currently under-billing:

| deal | job | job price | will bill | difference |
|---|---|---|---|---|
| 000071 | `000071-LOCALSEO` | €220.16 | €169.36 | **−€50.80/mo** |
| 005523 | `005523-LOCALSEO` | €241.94 | €200.00 | **−€41.94/mo** |
| 000224 | `000224-LOCALSEO` | €200.00 | €161.29 | **−€38.71/mo** |

The remainder differ by €0.19–€0.42, consistent with net/gross rounding rather than a real price change.

Separately, deal `000415` has two local SEO jobs of €200 each, and a single €400 payment line attributed entirely to one of them — the client total is right, the per-job attribution is wrong.

### A7b. Money handling reported by the code audit — not separately verified against live data

- **Mixed-rate groups overcharge.** A grouped or prepay payment header takes `vat_rate = max(line rates)` over `sum(line nets)`. If a group mixes a 24% line with a 0% line, the header charges 24% on the whole sum. Ledger and reminders read the header gross while deal screens read the line sums, so the CRM and the client's email can show different totals for the same payment.
- **The Payments panel truncates net silently.** It initialises Net at 2 decimals and commits on blur unconditionally, over a `numeric(12,4)` column — tabbing through a row rewrites the stored net and can move the derived gross by a cent, undoing the 4-decimal backfill.
- **The ledger is a fully mutable view**, and paid rows can be hard-deleted behind a `confirm()`. For an accounting record this is the wrong shape: it should be append-only with reversals.
- **The reminder gate `created_at::date < start_date`** permanently mutes any payment created on or after its own start date — same-day and late-spawned rows never remind at all.
- **`paid_at::date` is evaluated in UTC**, so an Athens payment made late on the last day of a month files into the next month in the ledger.
- **`vat_missing` does not trim the country string**, so a client whose country has a trailing space is flagged for ever; and alert dismissals never expire, so a dismissal is permanent suppression.
- **The expense spawner lacks the end-date-extension guard** its payments twin received, and autopay would settle the resulting duplicate. (Expenses are otherwise sound: settle is idempotent, double cron runs are safe, missed weeks self-heal one period per day.)
- Documents are clean: offers, pro formas and contracts all render stored totals, with no recompute divergence. Two gaps worth noting anyway — payment PDFs load Tailwind from a CDN, and a paid pro forma never reaches the ledger.

### A8. Frontend gaps — REPORTED BY CODE AUDIT, not separately verified against live data

- `PaymentsPanel` (add/edit/delete/toggle-paid on `deal_payments`) and the deal-header stage/status/owner selects render fully editable to any deal viewer, while RLS restricts the writes to admin/accounting. Unauthorised edits silently no-op and revert, so the user believes money data changed when it did not. 9 of 37 inventoried actions have this UI/DB gate mismatch — all "visible but refused", none "hidden but callable".
- The Report MRR tile shows contracted MRR (net, from `jobs.amount_net`) as the headline and collected MRR (gross, from `deal_payments.amount_gross`) as the sub-line: net and gross on one card, neither labelled.
- Mark-paid-in-full, close-deal and pause invalidate too few query keys, leaving a stale Payments tab / Recurring page / MRR after the action.
- One-click un-pay wipes `paid_at` with no confirmation; the payment delete confirmation says only "Remove".

---

## B. Refuted — do not act on these

- **"A trigger `deal_payments_settle_to_paid_in_full` still auto-lifts holds on payment."** REFUTED. No such trigger and no such function exists in the production database (`pg_trigger` and `pg_proc` both checked). The migration that created it was superseded; the auditor missed the drop. Holds genuinely are never auto-lifted, as designed.
- **"`generate_payments_for_deal` emits NULL-`service_type` headers the renewer can never renew."** The code shape exists, but live `deal_payments` currently contains **0** rows with a NULL `service_type`. Latent, not active.
- **NULL `service_type` piercing the duplicate defences** (trigger `IS NOT DISTINCT FROM`, unique index treating NULLs as distinct, alert #6 grouping): the reasoning is correct but, as above, there are no such rows today. Latent.

---

## C. What is clean

Checked across all `deal_payments` and `deal_payment_lines`:

| check | result |
|---|---|
| VAT arithmetic (`amount_gross` vs `amount_net × (1+rate)`) | **0** discrepancies |
| Header amount vs sum of its lines | **0** drifts |
| Lines pointing at archived jobs | **0** |
| Payments with no lines | **0** |
| Negative amounts | **0** |
| `paid` without `paid_at`, or `paid_at` without `paid` | **0** each |
| NULL `service_type` | **0** |
| Exact duplicate recurring periods | **0** (the 7 same-date pairs found are one-time instalments, correctly excluded by alert #6) |

Concurrency is also sound: two concurrent inserts of the same period fail loudly with `23505` from the partial unique index rather than silently — except in the NULL-`service_type` or NULL-date case, which does not occur in the data.

---

## D. Behaviour-preserving simplifications

Each of these can be done without changing a single observable behaviour. They are offered as cleanup, not as fixes.

1. **`ensure_recurring_payments_v2` is dead code.** It is not wired to any cron, and its execute privilege is revoked. Deleting it removes a decoy that two auditors independently mistook for the live renewer.
2. **`partial_payment_pending` blocking is provably dead** — the `should_block` expression that would set it is constant false. The branch and the `blocked_reason` value can go.
3. **Three release functions with three copies of the same placement rule.** `release_jobs_for_deal`, `release_billing_jobs_for_deal` and `release_deal_jobs` are historical accretion. The shared placement rule can be extracted to one helper that all three call, leaving each function's distinct part intact.
4. **`target_accounting_stage` and the inlined rule inside `reconcile_deal_stage` should be one function** — but note this is only behaviour-preserving *after* A4 is decided, because today they differ. Sequence it after A4.
5. **Dead frontend code**: `closeTargets.ts`, `useCompleteAccounting`, `useLockDeal`, `groupAlerts` are unreferenced; one of them carries a 65-line test suite that therefore tests nothing.
6. **The duplicate-period trigger and the partial unique index encode the same rule twice.** The index is the real guarantee; the trigger's only added value is silent suppression, which A-side callers do not expect (see the open question below).

---

## E. Open questions that need a human decision

1. **000173** — was the client charged €379.03 twice for the same month, and if so is a refund or a credit note owed?
2. **000071 / 005523 / 000224** — is the job card price or the payment amount the correct one? They have been under-billing by ~€131/month combined.
3. **000415** — should the €400 line be split €200/€200 across the two local SEO jobs?
4. **004556 / 006095** — cancel the stale twin rows so the deals can leave `partial_payment`?
5. **000041** — owes €0 in `partial_payment` since June; move it to `paid_in_full`?
6. Should `deal_payments_no_duplicate_period` keep **silently** suppressing a duplicate insert, or raise? Silent suppression means a caller that then inserts a `deal_payment_lines` row for the id it expected gets a NOT NULL violation instead of a clear error.

---

## F. Suggested order of work

The dependency order matters more than the severity order:

1. **A0** (cash/no-VAT charged VAT) — stop the bleeding first: it is the only finding where clients' money has demonstrably changed hands wrongly, and it is still active.
2. **A1** (pause/resume `ok` key) — one-line contract fix, stops new instances of the whole silent-billing-stop class.
3. **A5** (cancelled filter in the renewer) — restores correct renewal for 36 chains.
4. **A2** (`partial_payment` in the reconciler allow-list) — frees 17 deals, 10 of them renewing again.
5. **A4** (single stage rule) — then apply simplification D4.
6. **A7** (price propagation) + **A6** (overlap detection as a new integrity check).
7. **A7b** money handling: mixed-rate group VAT first, then the ledger's mutability.
8. **A8** frontend gates and invalidation.
9. **D** simplifications last, once the behaviour they wrap is settled.

Data repairs (section E) are independent of all of the above and need owner decisions first.

## G. Additions to section E after the money audit

7. **A0's 17 paid rows** — for each of the 11 deals, was VAT genuinely owed (cash flag set after the fact) or is a refund/credit note due? €912.31 total.
8. Should the ledger become append-only with reversals, or stay editable? This is a policy question, not a bug fix.
