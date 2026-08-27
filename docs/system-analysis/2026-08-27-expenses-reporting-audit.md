# Expenses & reporting — full audit, 2026-08-27

**Headline exposure, in four numbers (2026-08-27):** the YTD profit figure shown on every visit to `/accounting/report` is overstated by **€5,504.16** because 100% of this year's paid expenses silently fall past a 1,000-row fetch cap and read as zero (E22). The P&L itself recognises only **€25,721.40 of €82,739.06** of real expenses — 31.1% — leaving **€57,017.66 pending**, of which **€44,463.76 is already past its own due date** (E10). A further **€8,250.80** across 13 payment rows has no date of any kind and cannot be attributed to any month (E18). And the accounting PDF the owner wants to rely on prints at most **40 rows per side**, in a font that cannot render Greek at all (E28, E29).

Read-only audit of the whole expense and reporting path: the `expenses` table and its recurring generator, the `accounting_ledger_v` / `accounting_pl_summary_v` views, the month-attribution rule, the Report and Dashboard frontends, the permission gates, and the CSV/PDF export surfaces. **Nothing was changed** — no code, no data, no schema, no migration. Every number below was measured against the production database (project `xujlrclyzxrvxszepquy`) on **2026-08-27** unless a different date is stated on the number itself.

This audit is the expense-side companion to `docs/system-analysis/2026-08-26-payment-system-audit.md` (the revenue side, findings A0–A8 / B1–B17). Where that audit already owns a finding — ledger mutability (B2 and its underlying F46), the cash/no-VAT charge (A0), the frontend permission sweep (A8) — this report cites it and does not re-derive it.

## Method

Five independent research tasks each probed one area with exact SQL against prod **plus** a code read of the governing view, function or hook, and each was required to *attempt to refute* its own finding before it could be recorded. 34 findings (E1–E34) were produced and every one was review-verified. Findings that failed refutation are recorded in section D so nobody spends time on them later.

Three method notes that shaped the results:

- **The math is right; the inputs are not.** An independent month-by-month recompute straight from `deal_payments` and `expenses` — never reading either view — matches `accounting_pl_summary_v` **to the cent, every month, both sides, net/VAT/gross** (E16, E24). Every reporting error in this audit is a *fetch*, *data-completeness* or *presentation* error, not an arithmetic one.
- **The repo is trustworthy.** `accounting_ledger_v`, `accounting_pl_summary_v` and `ensure_recurring_expenses()` are each byte-for-byte their newest migration in prod (E6, E7, E8). Zero live-vs-repo drift. Where a document and the database disagree, the database is right.
- **Three load-bearing invariants** are established in full in Appendix 1 and are relied on throughout: the ledger view carries **every** status unfiltered; the P&L view filters to `status='paid'` on both sides; and a row is attributed to the month it was *paid* (`coalesce(paid_at::date, start_date)`), cash-basis, in UTC.

---

## A. Confirmed bugs, ranked by how much they distort the reported numbers

**Read this first.** The single largest distortion in the reported P&L — **€57,017.66 of expenses the business has incurred but the P&L cannot see** — is *not* a code bug. The views are correct and are faithfully reporting the data they are given; the expense side is simply only 31.1% reconciled while the income side is 82.3% collected (E19). That asymmetry needs an owner decision, not a patch, and it is **decision D2 in section C**. Everything ranked below is a defect in code or in a view that can be fixed without a policy call.

### Tier 1 — numbers that are wrong on screen or in a file today

#### E22. The always-on YTD strip drops every expense in the year — reported YTD profit overstated by €5,504.16, today

**What happens.** `/accounting/report` computes a year-to-date summary **unconditionally on every page load**, independent of the preset the user selected, and shows it permanently in the KPI strip. That summary currently reads `total expense = €0.00`. It is not zero.

**Root cause.** `src/features/accounting_report/hooks/usePLSummary.ts:37-41` and `src/features/accounting_report/hooks/useLedger.ts:24-29` both issue a plain `supabase.from('accounting_ledger_v').select(...)` with a date range and **no `.range()`, no `.limit()`, no `count: 'exact'` and — in `usePLSummary`'s case — no `.order()` at all**. PostgREST caps the response at 1,000 rows and returns HTTP 200; the app never sees a truncation signal. `ReportPage.tsx:34-35` wires the YTD call in permanently; `ReportHeader.tsx:170-188` renders it.

**Evidence (2026-08-27).** The 2026 YTD range is already **1,284 ledger rows** — over the cap today. With no `ORDER BY` anywhere (the view body has none either), the planner runs the `deal_payments` arm of the `UNION ALL` first and in full — confirmed by live `EXPLAIN` — so all **1,152 income rows** are returned before the expense arm is reached. Reproducing the exact unordered `LIMIT 1000` split with `row_number() over ()`: **every single `direction='out'` row for the year is dropped — all 32 paid (€25,721.40) and all 100 pending — plus 90 paid income rows (€20,217.24)**.

| | displayed today | true (E16 baseline) |
|---|---|---|
| YTD income net | ≈ €203,373.92 | €223,591.16 |
| YTD expense net | **€0.00** | €25,721.40 |
| YTD net profit | ≈ €203,373.92 | €197,869.76 |

**Net effect: +€5,504.16 on the profit figure the owner sees on every visit.** Selecting the `this_year` preset explicitly is *also* over the cap but fails differently — `useLedger` does call `.order('event_date', desc)`, so it deterministically drops the **284 oldest events** (2026-01-23 → 2026-06-22). The two would visibly disagree with each other for the same selected range.

**Fix direction.** One shared paginated-fetch helper: `.order()` on a stable key, `.range()` looped until a short page returns, and `count: 'exact'` asserted against the rows actually received so a truncation can never again be silent. Same helper serves E23 and the PDF endpoint in section D.

---

#### E29 + E34. The accounting PDF prints 40 rows per side — a normal month loses ~89% of its lines, and the totals do not match the rows shown

**What happens.** A PDF exported for any real month contains a summary block computed over the whole range, followed by a row list that has been cut to the first 40 lines per side with no "40 of N" note anywhere in the file or the UI. The document is internally inconsistent: its own totals cannot be reconciled against its own rows.

**Root cause.** `src/features/accounting_report/utils/exportPDF.ts:33` and `:44` — `for (const r of input.incomeRows.slice(0, 40))` and the identical line for expenses. The full array length is never read, never compared to 40, never surfaced. On top of that, both arrays come from `useLedger` via `ReportPage.tsx:40-52` → `ExportMenu.tsx:16-18,34-40`, so a wide range is *also* subject to E22's 1,000-row cap first (E27, E34) — two independent truncations stacking.

**Evidence (2026-08-27).** Paid income rows per month, from this audit's own baseline: **368 (2026-06), 301 (2026-07), 226 (2026-08)**. Exported as a single month, each keeps 40 — **89.1%, 86.7% and 82.3% of the lines dropped** respectively, and only the most recent 40 (`useLedger` orders `event_date` descending). A YTD export loses the 284 oldest rows to the fetch cap *and then* keeps 40 of what remains.

**Fix direction.** Delete the 40-row cap as part of replacing this file entirely (section D); no bounded row list belongs in a document titled "all income / all expenses".

---

#### E23. The Dashboard's default view drops 70% of leads, and distorts the source mix, not just the totals

**What happens.** Opening `/dashboard` — no clicks, default preset — shows lead counts and a "Leads by source" breakdown computed from an arbitrary ~1,000-row cross-section of the period.

**Root cause.** `src/features/dashboard/hooks/useDashboardData.ts:15-31` (`useDashboardLeads`) has the identical defect to E22 — no `.order()`, no `.range()`, no `.limit()` — on a 6,641-row table. `DashboardPage.tsx:227` defaults the preset to `last_6_months`.

**Evidence (2026-08-27).** `last_6_months` (2026-03-01 → 2026-08-27) = **3,365 rows**, so **2,365 of 3,365 (70%) never arrive**. `last_month` = 1,177; `this_year` = 4,675; `last_12_months` = 6,188 (84% missing). Only `this_month` (161) is safe. Because `leads` has no supporting index, the kept and dropped halves span the *same* date range — the survivors are an arbitrary cross-section, not "the most recent 1,000". Worse, survival is uneven by source and therefore reshapes the chart: `import` 25.1% survives, `meta` 17.9%, `manual` 11.8%, `franchise` **9.4%**.

Latent siblings of the same defect, safe only because of current volume: `useDashboardDeals` (609 rows, no guard at all) and `useRecurringCollected` (768 rows) — both break silently the day they cross 1,000.

**Fix direction.** Same shared paginated helper as E22; or aggregate server-side the way `useMonthlyPL` already does (it reads `accounting_pl_summary_v` pre-grouped, ~25 rows, and is structurally immune — E27).

---

#### E12. A corrected price on a recurring expense does not stick — future periods keep renewing at the old amount

**What happens.** An admin edits one period of a recurring expense to match the real invoice. Every period already spawned keeps the old number, and every period spawned later copies whatever the chain tip held *at spawn time* — so the correction is trapped on a single row, permanently.

**Root cause.** `ensure_recurring_expenses()` copies `r.amount_net` forward from the chain's current tip (`supabase/migrations/20260601000004_ensure_recurring_expenses.sql:34`, carried into `20260707000000_expenses_autopay.sql:46`). Nothing propagates an edit backwards or forwards. This is the direct expense-side analogue of the revenue-side price-drift finding (A7 in the 2026-08-26 audit).

**Evidence (2026-08-27).** The live SUPABASE `recurring_monthly` chain: head €216.00 (never edited); second period spawned by cron on 2026-07-08 at €216, **manually edited to €228.00 on 2026-08-03 06:01:35**; third period spawned on **2026-07-31 — before that edit — at €216.00**. The corrected €228 never re-enters the chain. All 23 other recurring chains currently carry a single consistent amount, so this has fired exactly once so far — €12/month, and growing every renewal until someone re-edits by hand.

**Fix direction.** Either propagate an amount edit to all not-yet-paid future periods of the same chain, or make the generator read the price from a chain-level definition rather than from the previous row.

---

#### E25. The Expenses page and the Report page disagree about what happened in a given month

**What happens.** Filtering `/accounting/expenses` to August does not show the expenses August's P&L counts. There is no in-UI explanation of the difference.

**Root cause.** `src/features/accounting_report/hooks/useExpenses.ts:63-64` filters the raw table on `start_date` (`.gte('start_date', from).lte('start_date', to)`). Every other reporting surface — both views, `usePLSummary`, `useLedger` — attributes on `coalesce(paid_at::date, start_date)` (Invariant 3). Two different questions, one label.

**Evidence (2026-08-27).** **14 of 135 expenses** have `paid_at` in a different calendar month than `start_date` — all from the 2026-08-03 reconciliation session (`CURSOR`, `brevo`, `anthropic`, `MARIOS`, `DIMITRIS TZOUVARAS` and others with July `start_date` and 2026-08-01/03 `paid_at`).

The date math itself is clean everywhere: `formatRange.ts:10-15,21-41`, `DashboardPage.tsx:57-76` and `monthFilter.ts:13-19` are all fully UTC (`Date.UTC`, `getUTC*`), matching the DB session timezone exactly — there is no timezone bug in any of the three utilities.

**Fix direction.** Label the Expenses page filter "started in" and/or add a "recognised in" mode keyed on `paid_at`. Which one is the default is the owner's call (decision D6).

---

### Tier 2 — the PDF cannot say what the owner needs it to say

These four are the reason section D exists. They are listed as findings, but none of them should be patched in place: they are all resolved by replacing `exportPDF.ts` with the endpoint specified in section D.

#### E28. Greek text cannot render in the accounting PDF at all

`exportPDF.ts` is the **only** jsPDF-based PDF in the entire repository (`grep -rln "jspdf|jsPDF" src` → one hit). It calls `new jsPDF(...)` (line 17) and then only `setFontSize`/`text` — there is no `setFont` with a custom family, no `addFont`, no `addFileToVFS` anywhere in the repo, and **zero `.ttf` files** under `src` or `public`. jsPDF's four built-in fonts are PDF core fonts with WinAnsi/Adobe-Standard encoding — no Greek code points, in any jsPDF version. Every other business-document PDF (`api/contract-pdf.ts`, `api/offer-pdf.ts`, `api/proforma-pdf.ts`) deliberately uses headless Chromium over an HTML template declared `<html lang="el">` with a Google-Fonts Inter face, *specifically* to get Greek right. Live expense vendors already include `ΜΕΤΑ ΑΔΣ` and `ΕΝΟΙΚΙΟ ΜΑΓΑΖΙ`; `counterparty` for income rows is the client's business name. `exportPDF.ts:35,46` print those strings straight into `doc.text()`.

#### E31. The PDF prints gross-only — no VAT figure and no net-basis profit, ever

`exportPDF.ts:26-29` reads exactly 3 of `PLSummary`'s 8 fields (`totalIncomeGross`, `totalExpenseGross`, `netProfitGross`) and never touches `totalIncomeNet`, `totalIncomeVat`, `totalExpenseNet`, `totalExpenseVat` or `netProfitNet`. Per row it prints only `r.amount_gross`; `r.amount_net` and `r.vat_amount` are on every row and never read. The two things the owner explicitly asked to see — **net-basis profit** and a **VAT summary** — are each one field-read away and neither is printed.

#### E32. No monthly subtotals, no year totals — it is a flat dump of one selected range

There is no grouping logic in the file: one title, one range label, a 3-line summary, then two flat reverse-chronological loops. `LedgerRow.period` (`'2026-08'`) is present on every row and never used. `PDFInput` accepts exactly one `summary: PLSummary` for the whole range — there is no shape in which per-month figures could even be passed. Producing monthly subtotals today means re-running the export once per month and reassembling by hand.

#### E33. Income lines carry a client name but no deal identity — and that is a view-level gap

`accounting_ledger_v`'s income arm (`supabase/migrations/20260717120000_revert_ledger_collection_month.sql:24-38`) joins `deals` **only to reach `client_id`** and never selects `d.id` or `d.title`. `LedgerRow` has no deal field; the closest is `source_id`, which is the payment row's own id. So "income lines with client + deal" is only half-satisfiable anywhere in the app — PDF, CSV and the on-screen Income Breakdown alike. `service_type` is not a substitute: two deals for the same client with the same service type are indistinguishable. **This one must be fixed before the new PDF is built**, and it needs a migration, not export code.

The expense side, by contrast, already fully satisfies its half: `category_key = cat.key` and `counterparty = e.vendor` on every row.

---

### Tier 3 — hygiene

- **E15. Zero receipts on file.** `receipt_path` is null on **all 135** expenses. The upload feature exists and works (`useUploadReceipt.ts`, wired into `ExpenseDetailDialog.tsx:181-192`); it has never been used in production — consistent with 89 of the 135 rows arriving via a bulk import that bypassed the UI. A substantiation/compliance gap, not a P&L error.
- **E17. UTC month-boundary truncation is real in mechanism, and has cost nothing so far.** `paid_at::date` truncates in the session's UTC zone, so a settlement within ~2–3h of UTC midnight could land in the previous Athens day. Live check across **every** row of both tables, all statuses: **0 misattributions**. Reason: all 895 paid `deal_payments` carry `paid_at` between 06:00 and 15:00 UTC (Greek business hours), and the one automated path that could hit the boundary — `settle_autopay_expenses()` (`20260707000000_expenses_autopay.sql:67`) — *deliberately* stamps `paid_at = start_date::timestamptz`, exact midnight UTC, with an inline comment explaining it attributes to the period month. That is the safer choice, not a riskier one. Worth a permanent fix (`at time zone 'Europe/Athens'` explicitly) so it never depends on session state. Manual paths stamp real time: `useMarkExpensePaid.ts:15`, `useCreateExpense.ts:38`, `PaymentsPanel.tsx:109`, `JobsBillingPanel.tsx:563`, and the prepay RPC at `20260716220000_accounting_prepay_months.sql:75`.
- **E3. `billing-model.md` line 22 is stale** — it documents `deal_payments.status` as `CHECK ('pending','paid','overdue')`. The live constraint has four values; `cancelled` is real, populated (95 rows) and intentional per the 2026-08-26 audit. Doc fix only.
- **Audit-trail nit (from E10's workflow inventory).** `NewExpenseDialog`'s "submit and mark paid" path never passes `paidByUserId` to `useCreateExpense`, so expenses paid at creation time have no "who paid it" attribution, unlike the detail-dialog path. No P&L impact.

---

## B. The independently recomputed P&L, month by month

Recomputed directly from `deal_payments` and `expenses` on **2026-08-27** — `status='paid'` only, `event_date = coalesce(paid_at::date, start_date)`, grouped by month, **without reading either view**. Diffed afterwards against `accounting_pl_summary_v` *and* against a month-grouped query over `accounting_ledger_v`: **exact match to the cent on every field of every month** (E16). Only three months in the entire live dataset carry non-zero paid activity.

| month | income net | income VAT | income gross | rows | expense net | expense VAT | expense gross | rows | profit net | profit gross | trustworthy today? |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **2026-06** | €100,150.67 | €19,556.80 | €119,707.46 | 368 | €0.00 | €0.00 | €0.00 | **0** | €100,150.67 | €119,707.46 | **No** — income side is sound, but **not one expense in the entire month was ever marked paid**. The "profit" line is income with nothing deducted. |
| **2026-07** | €71,239.72 | €14,439.28 | €85,679.00 | 301 | €193.80 | €0.00 | €193.80 | **4** | €71,045.92 | €85,485.20 | **No** — €193.80 of recognised cost against €71k of income is not a real cost base. Same cause as June (E10). |
| **2026-08** | €52,200.77 | €10,221.38 | €62,422.15 | 226 | €25,527.60 | €0.00 | €25,527.60 | 28 | €26,673.17 | €36,894.55 | **Partly** — income: yes. Expenses: the only month with meaningful reconciliation (the 2026-08-03 session), but it contains costs whose periods belong to earlier months, and €57k of backlog is still outside it. Treat the profit line as indicative, not final. |
| **totals (paid basis)** | **€223,591.16** | **€44,217.46** | **€267,808.61** | 895 | **€25,721.40** | **€0.00** | **€25,721.40** | 32 | **€197,869.76** | **€242,087.21** | — |

Three qualifications apply to **every** row of this table, and none of them is an arithmetic error:

1. **Expense VAT is €0.00 in every month because 100% of live expenses carry `vat_rate = 0.00`** (E5) — 135 of 135 rows, including `software` (52 rows), `ads_spend` and `hosting_domains`, despite a DB default of `24.00` (`20260601000002_expenses.sql:7`) and a UI default of `'24'` (`NewExpenseDialog.tsx:44`). `total_expense_vat` and `total_expense_gross` are therefore currently indistinguishable from net across the whole expense side. Decision D1.
2. **The table is paid-basis and therefore excludes €57,017.66 of pending expenses** (E10) and **€8,250.80 of income rows with no date at all** (E18). That is the correct behaviour for a paid-only P&L; it is not a full picture of what the business owes and is owed.
3. **Correct math over mutable rows is a weaker guarantee than it sounds.** The 2026-08-26 audit's **B2** (and its underlying finding F46) established that `deal_payments` rows are freely editable and hard-deletable with no period lock and no audit trail — 17 silent mutations and 9 silent deletions, €1,001 net, already observed. E13 finds the same class of exposure on the expense side. A correct P&L computed today can show a different number tomorrow with no record of why (E21). Cited, not re-derived.

*(Amounts here are the ledger's own; they were not reconciled against bank statements. The gross total is the sum of the three monthly gross figures; it sits one cent below net + VAT because of the sub-cent rounding residual described in section E — €0.008 across 368 June rows, not an error.)*

---

## C. Owner decisions — policy, not bugs

These need a human answer before any code or data is touched. They are deliberately kept out of section A.

**D1 — Is "every expense at 0% VAT" deliberate?** (E5, 2026-08-27.) All 135 live expenses have `vat_rate = 0.00`, against a DB default of 24 and a UI default of 24. No migration or seed sets zero, so this is either 135 manual overrides or a bulk import path that never carried VAT. If it is deliberate practice — expenses recorded net of reclaimed VAT, with the VAT credit tracked in the accountant's books — say so and the PDF should print a note to that effect. If it is a data gap, the entire expense-side VAT column of the P&L is meaningless and needs backfilling before any VAT summary can be published. **This blocks the PDF's VAT section.**

**D2 — What is the €57,017.66 pending expense backlog?** (E10, 2026-08-27.) 103 of 135 expenses sit at `pending`; 77 of them (**€44,463.76**) are already past their own due date. The mark-paid workflow is not broken — `ExpenseDetailDialog.tsx:194-225` → `useMarkExpensePaid.ts:5-31` works, the create-and-pay path works, and nightly autopay (`settle_autopay_expenses()`, cron `daily_ensure_recurring_expenses` at 02:05 UTC, 7/7 successful runs) works; 32 rows prove all of it. The backlog is an **incomplete reconciliation after the 2026-08-03 bulk import** (89 of 135 rows created that morning between 05:27 and 06:32 UTC; two clean-up passes the same day at 06:10–06:40 and 14:35 marked 32 of them paid; 103 were never revisited). The three oldest pending rows are the chain heads of SUPABASE, Local Viking and `ΕΝΟΙΚΙΟ ΜΑΓΑΖΙ` (shop rent) — each a single row covering ~11 months of arrears (2025-08 → 2026-07), still unpaid on paper while the *newest* period of the same rent chain **is** marked paid. A business does not go 11 months without paying rent; these were almost certainly paid in reality and never reconciled. Decide: bulk-mark the genuinely-paid historical rows, or confirm which are truly owed and chase them. Until then the P&L understates 2026 costs by roughly two-thirds.

**D3 — Should deleting a recurring expense's head row be blocked?** (E13, latent — confirmed by code, **0 live occurrences**.) Every period in a chain points `parent_expense_id` at the chain **head**, and the FK is `on delete set null` (`20260601000002_expenses.sql:18`). Deleting the head therefore nulls the parent on *every* period at once, splintering one chain into N single-row chains under the generator's `coalesce(parent_expense_id, id)` key (`ensure_recurring_expenses.sql:16-20`) — after which the generator can spawn a duplicate period starting exactly where an existing period already starts, independently payable. `useDeleteExpense.ts:8-9` is a bare `.delete().eq('id', id)` with no guard beyond the generic confirm dialog. Live check for orphaned children: **0 rows** — no head has ever been deleted. Pick one: block deletion of a row with children, switch the FK to `restrict`/`cascade`, or re-key the generator off something undeletable.

**D4 — What should happen to the 13 dateless payment rows?** (E18, €8,250.80, 2026-08-27.) 13 `deal_payments` rows have **both** `paid_at` and `start_date` NULL, so `accounting_ledger_v.period` is NULL and they vanish from any month-grouped query. All 13 are `pending`, so they correctly contribute €0 to the paid-only P&L — this is a completeness gap, not a math error — but any "expected income" or aging view built on the ledger silently loses €8,250.80 of real receivables, up to €2,000 on a single row. Their `created_at` values run 2026-06-22 → 2026-08-06, with **10 of the 13 created on 2026-06-22 across about an hour and three quarters** (the remaining one on that cluster's edge is dated 2026-06-25) — a batch creation event, not independent one-offs. `start_date` has no `NOT NULL` constraint (`20260503000010_deal_payments.sql:16`), so nothing prevents more. Backfill the dates, then decide whether to add the constraint plus a required UI field. **A monthly-subtotal PDF structurally cannot show these rows until they have a date.**

**D5 — Is `deal_payments` meant to be readable by 20 non-admin accounts?** (E26, 2026-08-27.) The Report and Expenses **pages** are correctly admin-gated: `/accounting/*` requires the `accounting` group (`router.tsx:274-304`) and those two children are additionally wrapped in `AdminGuard`. The `expenses` **table** matches — its RLS `qual` is `current_user_is_admin()` for all commands. But `deal_payments_select` is `current_user_is_admin() OR current_user_can('sales','view') OR current_user_can('clients','view') OR current_user_can('accounting_onboarding','view')`. **20 distinct non-admin accounts currently satisfy that** — 16 of them via `clients.view`, an ordinary, broadly-granted staff permission. Any of them can call the Supabase client from browser devtools and read every payment on every deal, bypassing `AdminGuard` entirely. Decide whether `clients.view` is meant to imply "can see every client's full payment history" (then document it) or whether the policy should be narrowed/scoped. **This must be settled before an API endpoint exists that serves the whole income ledger as a single file** (section D). Related to the 2026-08-26 audit's A8, recorded here as a fresh, live-verified instance rather than assumed identical.

**D6 — What should the Expenses page's month filter mean?** (E25.) "Started in" (today's behaviour, defensible for an accounts-payable view) or "recognised in" (matching every other reporting surface)? 14 rows currently differ. Either is fine; the label must say which.

**D7 — Should the ledger become append-only?** Unchanged from the 2026-08-26 audit's decision C10 / finding B2. Recorded here only because sections A and B both depend on the answer: every "the math is right" verdict in this audit is conditional on the rows not having been silently rewritten.

---

## D. The PDF roadmap — the full-financials report the owner asked for

The owner's end goal, restated concretely: **one PDF, for a chosen period, containing every income line with its client and deal, every expense line with its vendor and category, subtotals per month, totals for the year, net-basis profit and a VAT summary — in correct Greek, admin-only.**

Today's `exportPDF.ts` cannot deliver any part of that: it garbles Greek (E28), prints 40 rows per side (E29), shows gross-only with no VAT and no net profit (E31), has no month grouping at all (E32), and cannot name a deal because the view never exposes one (E33). It should be **replaced, not repaired** — and the codebase already contains the pattern to replace it with.

### D.1 Fix these E-numbers first, in this order — then build

1. **E22 — the paginated fetch.** Build one shared helper (`.order()` on a stable key + `.range()` loop + `count: 'exact'` assertion that throws when the received count ≠ the exact count). The PDF endpoint must use the same helper. Nothing downstream is worth building on a fetch that silently truncates. *Also fixes E23, E27, E34 and the two latent hooks.*
2. **D5 / E26 — the permission decision, enforced.** The new endpoint returns the entire income ledger in one response. `contract-pdf.ts` relies on RLS for its authorisation, and `deal_payments` RLS **does not restrict to admins**. The endpoint must therefore carry an **explicit admin check of its own** (`current_user_is_admin()` via the user-scoped client) before it fetches anything — not inherited RLS. Settle D5 first so the check encodes the intended policy.
3. **E33 — the ledger view migration.** Add `deal_id` and `deal_title` to `accounting_ledger_v`'s income arm (the `deals` join already exists). "Income lines with client + deal" is impossible until this lands. Bundle **E18's `start_date` backfill** into the same migration window — both are ledger-attribution work, and a monthly-subtotal report cannot represent a dateless row.
4. **D1 / E5 — the VAT decision.** A "VAT summary" section that prints €0.00 input VAT against €44,217.46 output VAT, with no explanation, is worse than no section. Either backfill real expense VAT or have the template print an explicit note stating that expenses are recorded net of reclaimed VAT.
5. **D2 / E10 — the €57,017.66 reconciliation.** Optional as a *technical* blocker, mandatory as a *credibility* one: a beautifully paginated PDF showing €193.80 of July costs is still wrong. Ship the PDF before this if you like, but do not circulate its profit line until this is answered.
6. **Then build.** E28, E29, E31, E32 need no separate fix — they disappear with the file they live in.

Independent of the build, and not blockers: **E12** (price drift), **E13/D3** (chain-head delete guard), **E15** (receipts), **E17** (explicit Athens timezone), **E25/D6** (filter label), **E3** (doc fix).

### D.2 Architecture — the house pattern, not jsPDF

Follow `api/contract-pdf.ts` + `api/_contract-pdf-template.ts` exactly; that pattern was built with Greek as a first-class concern and is already proven in production for contracts, offers and proformas.

- **New endpoint `api/financial-report-pdf.ts`**, `export const config = { maxDuration: 60 }` (raise if a full-year render needs it), all runtime imports deferred inside the handler as the existing files do, wrapped in `withSentry('financial-report-pdf', handler)`.
- **Auth, in this order:** `Authorization: Bearer <session token>` → anon-key user client (never service-role for reads, so a dropped header denies rather than escalates) → `auth.getUser(token)` → **explicit admin assertion** (step 2 above) → 403 otherwise. Service-role client only for storage, exactly as `contract-pdf.ts` splits them.
- **Data fetch, server-side and complete:** paginate `accounting_ledger_v` over `event_date` with the shared helper; assert the exact count. Take the per-month subtotals from **`accounting_pl_summary_v`** rather than re-summing rows — it is pre-grouped, ~25 rows total, structurally immune to the row cap (E27), and it is the same source the on-screen figures use, so document and screen cannot disagree. Cross-check the two: if summed rows ≠ the view's subtotal for a month, fail the request rather than print a document that does not add up.
- **Template `api/_financial-report-template.ts`:** `<!doctype html><html lang="el"><head><meta charset="utf-8"/>` + the Google-Fonts Inter stylesheet and `font-family: 'Inter', 'Helvetica Neue', Arial, sans-serif`, identical to `_contract-pdf-template.ts:132-139`. Inter has full Greek coverage. Escape all interpolated strings (`escapeHtml`, already in that file).
- **Rendering:** `puppeteer-core` + `@sparticuz/chromium`, `page.setContent(html, { waitUntil: 'networkidle0' })`, and `await document.fonts.ready` before measuring — as `contract-pdf.ts:121-153` does. **Diverge from the contract here:** a financial report is multi-page tabular content, so use real A4 pagination (`page.pdf({ format: 'A4', printBackground: true, displayHeaderFooter: true })` with a page-number footer template), plus CSS `thead { display: table-header-group }` so column headers repeat on every page and `tr { break-inside: avoid }`. Do **not** copy the contract's single-tall-page height trick.
- **Delivery:** stream the bytes back as `application/pdf`. If a stored copy is wanted, mirror the contracts flow — private bucket, `upsert`, 5-minute signed URL — and keep the path non-guessable; this file contains every client's payment history.
- **Frontend:** `ExportMenu.tsx` calls the endpoint with the session token instead of `downloadPDF`; **delete `src/features/accounting_report/utils/exportPDF.ts` and drop the `jspdf` dependency** (`package.json:35`) — it has no other consumer anywhere in the repo.

### D.3 Period selection

Reuse `rangeForPreset` (`formatRange.ts` — already fully UTC-safe, E25) and extend it with `this_quarter` / `last_quarter` / `this_year` / `last_year` alongside the existing month presets and custom range. Pass the resolved `from`/`to` as ISO dates in the query string; the server re-resolves and **prints the resolved range on the document** together with the attribution rule in plain words — *"amounts are recognised on the date they were paid; unpaid rows fall back to their due date"* — so a reader can never mistake which basis they are looking at. If the `includePendingExpenses` toggle is honoured, its state must be printed on the document too.

### D.4 Document structure

1. **Header band** — brand band + logo per the contracts template; report title, resolved period, generated-at timestamp (UTC and Athens), "prepared for internal use".
2. **Summary** — income net / VAT / gross, expense net / VAT / gross, **net-basis profit** and gross-basis profit, side by side. This is the section E31 is missing entirely.
3. **VAT summary** — output VAT (income), input VAT (expenses), net VAT position, plus the D1 note if the 0%-expense policy is confirmed rather than fixed.
4. **Income lines** — grouped by month, ordered by date: date · deal code + deal title (E33) · client · service type · net · VAT · gross. **Monthly subtotal row after each month.**
5. **Expense lines** — grouped by month: date · vendor · category · billing type · net · VAT · gross · status. **Monthly subtotal row after each month.** Pending rows only if explicitly opted in, and visually distinguished.
6. **Month-by-month table** — one row per month (income net/VAT/gross, expense net/VAT/gross, profit net/gross), then a **year-total row**. This is section B of this report, generated.
7. **Footer** — page N of M, and an explicit **row-count reconciliation line** ("312 income lines, 41 expense lines, all rows in period included"). After E22/E29, the document must be able to prove it is complete.

---

## E. Refuted — do not act on these

- **"The ledger view filters out non-paid rows."** (E1.) False, and the opposite matters: `accounting_ledger_v` is a plain `UNION ALL` with **no `WHERE` on status anywhere** — 1,190 payment rows and 135 expense rows, all four payment statuses and both expense statuses, pass straight through. Filtering happens one layer up, in `accounting_pl_summary_v`. Any consumer reading the ledger directly without its own `status='paid'` filter would show €82,739.06 of expense cash-out instead of the real €25,721.40 — a 3.2× overstatement. The current consumers do filter correctly (E30); this is a trap for the next one.
- **"Pending / cancelled / overdue rows leak into the PDF as if realised."** (E30.) They do not. `ReportPage.tsx:40-52` filters `incomeRows` to `status === 'paid'` with no override path, and `expenseRows` to paid — or pending only when the user explicitly flips `includePendingExpenses` (default `false`). `usePLSummary` applies the identical rule to the summary numbers, so a PDF is internally self-consistent with its own totals. The PDF's problems are row *counts* and presentation, not status filtering.
- **"The P&L views compute the wrong numbers."** (E16, E20, E24.) They do not. Independent recompute matches to the cent, every month, both sides; a second cross-check one layer down against `accounting_ledger_v` agrees too. `net_profit_net` and `net_profit_gross` are each built from same-basis inputs — no net/gross mixing anywhere. A single sub-cent residual (−€0.008 on €119,707.46 in 2026-06) is a double-rounding artifact of the *checking* query, not of the schema.
- **"`vat_amount` / `amount_gross` could have been miscomputed."** (E14, E20.) Structurally impossible on both tables — both columns are `GENERATED ALWAYS ... STORED` (`round(amount_net + amount_net*vat_rate/100, 2)` and `round(amount_net*vat_rate/100, 2)`). No application path can write them. Live mismatches against the real generation expression: 0/135 expenses, 0/895 paid payments.
- **"UTC truncation is misattributing months."** (E17.) Mechanism real, live impact zero — 0 rows in either table, all statuses. See Tier 3.
- **"The 103 pending expenses mean mark-paid is broken."** (E10.) It is not; it works through three separate paths and 32 rows prove it. The cause is reconciliation, not the workflow — which is why it is decision D2 and not a bug in section A.

---

## F. What is clean

Confirmed healthy on **2026-08-27**, so these do not need re-hunting:

| check | result |
|---|---|
| `accounting_ledger_v` / `accounting_pl_summary_v` / `ensure_recurring_expenses()` vs. newest migration | **0 drift** — each is byte-for-byte its latest migration (E6, E7, E8) |
| Independent P&L recompute vs. both views | **exact match to the cent**, every month, both sides, net/VAT/gross (E16) |
| `usePLSummary`'s own aggregation vs. the independent baseline | **zero diff** on all 3 months, for ranges under the row cap — E22 is purely a fetch bug (E24) |
| Orphaned `expenses.category_id` / null categories | **0** / **0**; 15 categories, all unarchived, unique keys (E4) |
| Duplicate or gapped recurring expense periods | **0** / **0** across 23 chains (E11) |
| `daily_ensure_recurring_expenses` cron (02:05 UTC), last 7 runs | **7/7 succeeded**, sub-second, no missed days (E9) |
| `amount_net < 0`, `end_date < start_date`, paid rows missing `paid_at`/`payment_method` | **0** each — all DB-enforced by CHECK constraints (E15) |
| Future-dated expense rows (13) | all legitimate 7-day-lookahead pre-spawns, not data errors (E10, E15) |
| Frontend date-boundary math (`formatRange`, `DashboardPage`, `monthFilter`) | **fully UTC**, matches the DB session exactly (E25) |
| Month misattribution from UTC truncation, all rows all statuses | **0** (E17) |
| `expenses` table RLS | **admin-only**, matching the UI gate (E26) |
| Dashboard P&L trend chart (`useMonthlyPL`) | reads the pre-aggregated view — structurally immune to the row cap (E27) |
| PDF status filtering | correct — paid-only, with an explicit opt-in for pending expenses (E30) |

---

## Appendix 1 — the three invariants everything above rests on

1. **`accounting_ledger_v` applies no status filter.** Plain `UNION ALL` of every `deal_payments` row (`direction='in'`) and every `expenses` row (`direction='out'`). Live proof: 1,190 payments = 1,190 ledger `in` rows; 135 expenses = 135 ledger `out` rows; all statuses present. Confirmed against `pg_get_viewdef` — no `WHERE` on either arm.
2. **`accounting_pl_summary_v` filters to `status='paid'`, per direction, on all 8 aggregate columns.** `sum(CASE WHEN direction='in' AND status='paid' THEN … END)` and the `out` equivalent, with both `net_profit_*` columns built from those same guarded sums. Pending, overdue and cancelled rows contribute exactly 0.
3. **Month attribution is cash-basis, UTC:** `event_date = coalesce(paid_at::date, start_date)`, `period = to_char(event_date, 'YYYY-MM')`, both arms. A row lands in the month it was *collected/paid*; unpaid rows fall back to their due date (payments) or period start (expenses). This is the behaviour explicitly reinstated by `20260717120000_revert_ledger_collection_month.sql` after the owner rejected accrual-basis attribution on 2026-07-17 — `20260716210000` is superseded and dead. Session `TimeZone` is `UTC`.

Two constraint facts worth keeping: `expenses.status` permits only `('pending','paid')` — live 135 = 103 + 32, nothing else. `deal_payments.status` permits four values — live 1,190 = 86 pending + 895 paid + 114 overdue + 95 cancelled.

---

## Appendix 2 — self-review against the audit plan

- **Every task's findings are represented.** Task 1 (E1–E9) → Appendix 1, section E, D1, section F. Task 2 (E10–E15) → D2, A/E12, D3, Tier 3, section F. Task 3 (E16–E21) → section B, D4, Tier 3/E17, section B qualification 3, section E. Task 4 (E22–E27) → A/E22, A/E23, A/E25, D5, section F. Task 5 (E28–E34) → A/E29+E34, Tier 2, section D, section E.
- **No REFUTED finding is presented as a bug.** E1 and E30 appear only in section E; E1's *underlying* fact (the ledger is unfiltered) is stated as Invariant 1 and as a trap for future consumers, never as a defect. E17's live-impact half is in Tier 3 and section F, labelled zero-impact.
- **Every € figure carries its measurement date.** All are 2026-08-27 unless stated otherwise. The €1,001 in section B qualification 3 is explicitly a 2026-08-26 figure cited from the sibling audit and not re-derived.
- **Corrections from review applied.** E18's clustering is stated as **10 of 13 rows on 2026-06-22 over ~1h45m** (the 15:07 row is 2026-06-25), not the findings file's "12 of 13 in one hour". The prepay RPC citation is `20260716220000_accounting_prepay_months.sql:75`. The Dashboard `last_6_months` loss is stated as 2,365 of 3,365 (70%) from the row counts, rather than the findings file's rounded 72%.
- **Owner decisions are separated from bugs** (section C), and the one finding with two halves (E25) appears as a bug for the disagreement and as decision D6 for the label.
- **The PDF section answers the end goal concretely** — endpoint file, auth order, data source per section, template file, Chromium settings, period presets, document structure section by section, and an ordered prerequisite list naming the exact E-numbers. The build itself is deliberately left to a follow-up plan.
- **Read-only mandate honoured.** No code, data, schema or migration was changed by this audit. Every fix in sections A and D is stated as a direction, not applied.

### Suggested order of work

1. **E22** — the shared paginated fetch. It is the only defect that puts a wrong number in front of the owner on every single page load, and it is a prerequisite for the PDF.
2. **E23** — the same helper applied to the Dashboard hooks, including the two latent ones.
3. **D5 / E26** — the permission decision and an explicit admin gate, before any endpoint serves the whole ledger.
4. **E33 + E18** — one ledger-attribution migration: deal identity on income rows, dates backfilled on the 13 dateless rows.
5. **D1 / E5** — the VAT decision, then the PDF's VAT section becomes meaningful.
6. **Build the PDF endpoint** (section D) — E28, E29, E31, E32 resolve with it; delete `exportPDF.ts` and the `jspdf` dependency.
7. **E12, E13/D3, E25/D6, E15, E17, E3** — hygiene and guards, independent of the above.

**D2 (the €57,017.66 reconciliation) is independent of all of it and needs an owner answer first** — it is the largest number in this report and no amount of code will move it.
