# Findings

All live numbers below were pulled 2026-08-27 against prod (project `xujlrclyzxrvxszepquy`) via the Supabase Management API `database/query` endpoint (SELECT-only). Session `TimeZone` confirmed as `UTC` for every query in this task.

## Invariants (load-bearing — every later task in this audit tests against these)

1. **`accounting_ledger_v` applies NO status filter.** The view is a plain `UNION ALL` of every row in `deal_payments` (direction `'in'`) and every row in `expenses` (direction `'out'`), with no `WHERE` clause on `status` anywhere in the view body. Live proof: `deal_payments` total row count (1190) == ledger `direction='in'` row count (1190); `expenses` total row count (135) == ledger `direction='out'` row count (135). Every `deal_payments.status` value (`pending`, `paid`, `overdue`, `cancelled`) and every `expenses.status` value (`pending`, `paid`) appears in the ledger.
2. **`accounting_pl_summary_v` (the actual P&L) filters to `status = 'paid'` only, per direction.** Every `sum(...)` in the view is gated `CASE WHEN direction = 'in' AND status = 'paid' ...` / `CASE WHEN direction = 'out' AND status = 'paid' ...`. Pending, overdue, and cancelled rows pass through `accounting_ledger_v` untouched but contribute exactly `0` to every `accounting_pl_summary_v` column. Any consumer that reads `accounting_ledger_v` directly (instead of `accounting_pl_summary_v`) and does not itself filter `status='paid'` will double-count uncollected money as if it were realized income/expense.
3. **Month attribution column:** both arms compute `event_date := coalesce(paid_at::date, start_date)` and `period := to_char(event_date::timestamptz, 'YYYY-MM')`. A row is attributed to the month it was **collected/paid** (`paid_at`) when that is set; otherwise it falls back to `start_date` (the due date for `deal_payments`, the period-start date for `expenses`). This is the cash-basis behavior explicitly reinstated by the 2026-07-17 revert (`20260717120000_revert_ledger_collection_month.sql`) after the owner rejected accrual-basis (covered-period) attribution.
4. **Timezone: UTC.** The database session `TimeZone` is `UTC` (`current_setting('TimeZone')` = `UTC`, confirmed live). `paid_at` is `timestamptz`; the `paid_at::date` cast in the `coalesce` truncates to a calendar date **in the session's UTC timezone**, not in Athens local time (UTC+2/+3). The later `to_char(event_date::timestamptz, 'YYYY-MM')` cast-back is a no-op with respect to timezone (date → midnight-UTC timestamptz → formatted back in the same UTC zone reproduces the same date), so it introduces no *additional* timezone dependency — the only TZ-sensitive step is the initial `paid_at::date` truncation. Practical consequence: a payment or expense marked paid within roughly 2–3 hours of UTC midnight (i.e. within the first 2–3 hours of the Athens calendar day) can be attributed to the *previous* UTC calendar day/month relative to Athens wall-clock time. This is a latent month-boundary risk, not yet confirmed to have caused a misattribution (see E-block below).
5. **`expenses.status` CHECK constraint only permits `('pending', 'paid')`** — live: `CHECK ((status = ANY (ARRAY['pending'::text, 'paid'::text])))`. `overdue` and `cancelled` (both valid for `deal_payments`) are not valid `expenses` statuses at the DB level. Live distribution confirms this exactly: 135 expenses total = 103 `pending` + 32 `paid`, zero of anything else.
6. **`deal_payments.status` CHECK constraint permits `('pending', 'paid', 'overdue', 'cancelled')`** — live: `CHECK ((status = ANY (ARRAY['pending'::text, 'paid'::text, 'overdue'::text, 'cancelled'::text])))`. Live distribution: 1190 total = 86 pending + 895 paid + 114 overdue + 95 cancelled.

---

## E1 — The ledger view filters out non-paid rows

**Claim:** `accounting_ledger_v` only surfaces settled money — pending/overdue/cancelled rows are excluded, so anyone reading the "ledger" is only seeing realized cash flow.

**Evidence:**
```sql
select direction, status, count(*) as n, sum(amount_net) as sum_net
  from public.accounting_ledger_v group by direction, status order by direction, status;
```
Live (2026-08-27): `in/cancelled=95 (€23,072.04 net)`, `in/overdue=114 (€28,498.76)`, `in/paid=895 (€223,591.16)`, `in/pending=86 (€19,477.58)`, `out/paid=32 (€25,721.40)`, `out/pending=103 (€57,017.66)`. All four `deal_payments` statuses and both `expenses` statuses are present. Row counts match the raw tables 1:1 (1190 and 135 respectively — no rows dropped).

**Refutation attempt:** Checked for an RLS policy or `WHERE` predicate that might silently drop rows for the querying role — none exists; `security_invoker = true` only changes *whose* RLS applies, not whether the view itself filters by status. Checked the view SQL text directly (pulled via `pg_get_viewdef` and via `pg_views.definition`) — no `WHERE` clause exists on either arm of the `UNION ALL`.

**Verdict: REFUTED.** The claim is false. `accounting_ledger_v` is unfiltered by status (see Invariant 1). Filtering to realized money happens one layer up, in `accounting_pl_summary_v` (Invariant 2). Any UI/report reading `accounting_ledger_v` directly must apply its own `status='paid'` filter or it will misrepresent pending/overdue/cancelled amounts as real cash flow.

---

## E2 — The P&L summary view already excludes unrealized money

**Claim:** `accounting_pl_summary_v.total_income_*` / `total_expense_*` / `net_profit_*` only ever reflect `status='paid'` rows, so pending expenses (103 rows, €57,017.66 net) and pending/overdue/cancelled deal_payments cannot inflate the reported P&L.

**Evidence:** Live view definition (`pg_views.definition`, `accounting_pl_summary_v`):
```
sum(CASE WHEN ((direction = 'in') AND (status = 'paid')) THEN amount_net ELSE 0 END) AS total_income_net, ...
sum(CASE WHEN ((direction = 'out') AND (status = 'paid')) THEN amount_net ELSE 0 END) AS total_expense_net, ...
```
Every one of the 8 aggregate columns is gated the same way, both directions.

**Refutation attempt:** Looked for any column in the view without the `status='paid'` guard — none; all 8 sums (net/vat/gross × income/expense, plus the two net_profit columns which are built from the same guarded sums) carry the identical `AND status = 'paid'` predicate.

**Verdict: CONFIRMED.**

---

## E3 — `billing-model.md` accurately documents `deal_payments.status`

**Claim:** `docs/tech/accounting/billing-model.md` (line 22) documents the full set of valid `deal_payments.status` values: `CHECK ('pending','paid','overdue')` (`overdue` added `20260610000004`).

**Evidence:** Live constraint: `deal_payments_status_check: CHECK ((status = ANY (ARRAY['pending'::text, 'paid'::text, 'overdue'::text, 'cancelled'::text])))` — four values, not three. Live data has 95 `cancelled` rows (8% of all deal_payments), which the sibling payment-system audit (2026-08-26) already established as a legitimate, intentional status.

**Refutation attempt:** Checked whether `cancelled` was added after this doc line was last edited and the doc is simply stale by design pending an update elsewhere — found no changelog/TODO referencing this gap; the doc's CHECK list is presented as current/authoritative ("`status text` | CHECK (...)").

**Verdict: REFUTED — doc/live mismatch confirmed.** `billing-model.md` line 22 is stale: it omits `cancelled`, a real, populated (95 rows), and (per the 2026-08-26 sibling audit) intentional status value. This is a doc-fix item, not a data-integrity bug — flagging so a later task doesn't rely on the doc's incomplete status list. NEEDS-OWNER only in the sense of "someone should patch the doc"; no code/data change implied.

---

## E4 — No orphaned `expenses.category_id` references, no null categories

**Claim:** Every `expenses.category_id` resolves to a live row in `expense_categories`, and no expense is missing a category.

**Evidence:**
```sql
select e.id from public.expenses e
 where e.category_id is not null
   and not exists (select 1 from public.expense_categories cat where cat.id = e.category_id);
-- 0 rows
select count(*) from public.expenses where category_id is null; -- 0
```

**Refutation attempt:** Also checked `expense_categories` for duplicate `key`s or archived categories still referenced by non-archived expenses — `expense_categories` has exactly 15 rows (`salaries` … `other`), all `archived = false`, unique `key`; the `expenses` ↔ `expense_categories` inner join in `accounting_ledger_v` (`join public.expense_categories cat on cat.id = e.category_id`) therefore cannot silently drop any expense row.

**Verdict: CONFIRMED.**

---

## E5 — Expenses carry a realistic VAT rate

**Claim:** `expenses.vat_rate` reflects real Greek VAT treatment per category (DB column default `24.00` — `supabase/migrations/20260601000002_expenses.sql:7`, `vat_rate numeric(5,2) not null default 24.00 check (vat_rate >= 0 and vat_rate <= 100)`, unchanged by any later migration; `NewExpenseDialog.tsx` also defaults its form field to `'24'` — `src/features/accounting_report/components/NewExpenseDialog.tsx:44`, `const [vatRate, setVatRate] = useState('24');`), so `vat_amount`/`amount_gross` on the expense side of the ledger are meaningful.

**Evidence:**
```sql
select vat_rate, count(*) from public.expenses group by vat_rate;
-- vat_rate = 0.00, n = 135
```
**100% of live expenses (135/135), across every category including `software`, `ads_spend`, and `hosting_domains`** (categories that would typically carry 24% Greek VAT or at least a non-zero reverse-charge rate), have `vat_rate = 0.00` and therefore `vat_amount = 0.00`. `amount_gross == amount_net` for every single expense row. No seed/migration hardcodes `vat_rate = 0` for expenses (checked `20260601000004_ensure_recurring_expenses.sql` and `20260707000000_expenses_autopay.sql` — the recurring spawner only ever copies `r.vat_rate` forward from the parent row, it never sets `0` explicitly), so this is either (a) 135 independent manual entries where every user overrode the UI's `24` default down to `0`, or (b) a bulk import path outside the UI that never set VAT.

**Refutation attempt:** Considered whether some expense categories (`salaries`, `bank_fees`, `taxes_vat`) are legitimately VAT-exempt in Greece — true for some, but that only accounts for a subset of the 135 rows (`salaries` alone is 7+2+13+14=36 rows); it does not explain `software` (4+11+22+15=52 rows), `ads_spend` (2), `hosting_domains` (3), or `equipment`/`marketing`/`travel`/`training` (0 rows currently, but no VAT-exempt category theory covers `software`/`ads_spend`/`hosting_domains` being 0% across the board).

**Verdict: NEEDS-OWNER.** Cannot determine from code/migrations alone whether "every expense recorded at 0% VAT" is deliberate bookkeeping practice (e.g. accounting always records expenses net-of-reclaimed-VAT and tracks the VAT credit elsewhere) or a systematic data-entry/import gap that means `accounting_pl_summary_v.total_expense_vat` and `total_expense_gross` are silently meaningless (always equal to net) for the entire expense side of the P&L. Whichever it is, any later task computing/validating VAT reporting off the expense side of the ledger should know the live data currently carries zero VAT information.

---

## E6 — `ensure_recurring_expenses()` matches its latest repo migration

**Claim:** the live function body for `ensure_recurring_expenses()` matches `supabase/migrations/20260707000000_expenses_autopay.sql` (the latest of the 4 migrations that reference it — `20260601000004` defines it, `20260601000008` only schedules a cron, `20260628010000` only revokes/regrants EXECUTE, `20260707000000` is the last one that redefines the body, adding `payment_method`/`autopay` to the spawner's `INSERT`).

**Evidence:** `pg_get_functiondef` live text (md5 `5aab7c2d077c446c9ada7dbc709dc282`) is byte-for-byte identical (modulo the `CREATE OR REPLACE FUNCTION ... AS $function$ ... $function$` wrapper Postgres re-emits vs. the migration's `create or replace function ... as $$ ... $$` source syntax) to the function body in `20260707000000_expenses_autopay.sql` lines 12–54, including the `insert into public.expenses (category_id, vendor, billing_type, amount_net, vat_rate, start_date, end_date, status, notes, parent_expense_id, created_by, payment_method, autopay)` column list.

**Refutation attempt:** Grepped case-insensitively for any migration after `20260707000000` touching `ensure_recurring_expenses` (`grep -riln "ensure_recurring_expenses" supabase/migrations`) — the 4 files found are exactly the 4 already accounted for; nothing later.

**Verdict: CONFIRMED — MATCHES-REPO, no drift.**

---

## E7 — `accounting_ledger_v` matches its latest repo migration

**Claim:** the live `accounting_ledger_v` SELECT body matches `supabase/migrations/20260717120000_revert_ledger_collection_month.sql` (the latest migration that does `create or replace view` on it; `20260803130000_ledger_security_invoker_and_realtime.sql` only runs `alter view ... set (security_invoker = true)`, it does not touch the SELECT body).

**Evidence:** Live `pg_views.definition` (md5 `56b5563adeb25143a0edd5f7a15627c8`) is structurally identical to `20260717120000`'s body: same two arms, same `coalesce(paid_at::date, start_date)` event_date/period expressions, same joins, same column list/order (Postgres normalizes case/whitespace when re-emitting the view definition, which accounts for the only textual differences).

**Refutation attempt:** Grepped case-insensitively for `create or replace view public.accounting_ledger_v` across all migrations — **4 real hits** (a 5th match in `20260716210000` is a commented-out line, not a redefinition):
1. `20260601000006_accounting_ledger_view.sql` — original definition.
2. `20260601100001_amount_net_precision_4dp.sql` — VAT-precision rewrite.
3. `20260716210000_ledger_period_month_attribution.sql` — switched `recurring_monthly`/`recurring_yearly` rows to accrual-basis attribution (covered-period `start_date` instead of `coalesce(paid_at, start_date)`), built on a spec assumption while the owner was away.
4. `20260717120000_revert_ledger_collection_month.sql` — reverted #3 the next day once the owner confirmed cash-basis was wanted; restores the `coalesce(paid_at::date, start_date)` expression for both arms.

`20260717120000` is later than `20260716210000` by filename timestamp, and its own header comment documents that it is an explicit revert of `20260716210000` ("Owner confirmed on 2026-07-17 they want CASH-BASIS ... the pre-07-16 behavior"). So `20260716210000` is superseded/dead — it was live for less than a day — and `20260717120000` is the correct "latest" migration to diff the live view against (this is the same reasoning behind Invariant 3 above). Also confirmed `20260803130000` (later still) only contains `ALTER VIEW ... SET (...)`, no `CREATE OR REPLACE VIEW`.

**Verdict: CONFIRMED — MATCHES-REPO, no drift.** (The known, already-audited `security_invoker` history — lost by `20260717120000`, restored by `20260803130000` — is out of scope here per the sibling 2026-08-26 payment-system audit; current live state has `security_invoker = true`, matching the current repo end-state.)

---

## E8 — `accounting_pl_summary_v` matches its latest repo migration

**Claim:** the live `accounting_pl_summary_v` body matches `supabase/migrations/20260601100001_amount_net_precision_4dp.sql` (the latest `create or replace view` for it; `20260803130000` again only does `alter view ... set (security_invoker = true)`).

**Evidence:** Live `pg_views.definition` (md5 `e9f77bfd4f6aec56378160d2d5f882dc`) matches `20260601100001` lines 90–104 exactly (same 8 `status='paid'`-gated sums plus the two `net_profit_*` differences, same `group by period`, same `from public.accounting_ledger_v`).

**Refutation attempt:** Grepped case-insensitively for `accounting_pl_summary_v` across all migrations — 3 total mentions, but only 2 are real `create or replace view` redefinitions: `20260601000007_accounting_pl_summary_view.sql` (initial create) and `20260601100001_amount_net_precision_4dp.sql` (drop-then-recreate, still `with (security_invoker = true)`). The 3rd mention, `20260803130000_ledger_security_invoker_and_realtime.sql`, is `ALTER VIEW ... SET (security_invoker = true)` only — not a body redefinition, so it doesn't count as a competing "latest" for the SELECT text. No migration after `20260601100001` redefines the body.

**Verdict: CONFIRMED — MATCHES-REPO, no drift.**

---

## E9 — `daily_ensure_recurring_expenses` cron is healthy

**Claim:** the `daily_ensure_recurring_expenses` cron job (`5 2 * * *` → `select public.run_daily_expenses();`, i.e. 02:05 UTC) has been running successfully.

**Evidence:** `cron.job_run_details` for jobid 16, last 7 runs (2026-08-21 through 2026-08-27), all `status = 'succeeded'`, all completing in well under a second, all firing at `02:05:00` UTC as scheduled. No `failed` or missing days in the 7-day window.

**Refutation attempt:** Checked `cron.job.active` — `true`. Checked the wrapper `run_daily_expenses()` actually calls both `ensure_recurring_expenses()` and `settle_autopay_expenses()` (per `20260707000000_expenses_autopay.sql` lines 152–158) — confirmed by reading the migration; not independently re-verified against a live `pg_get_functiondef` in this task (out of this task's scope — `run_daily_expenses`/`settle_autopay_expenses` drift-checking belongs to whichever later task covers autopay).

**Verdict: CONFIRMED.**

---

## E10 — [EXPENSES] The 103 pending expenses are a reconciliation gap after a bulk import, not a workflow gap or intended design

**Claim:** 103 of 135 expenses (76%) sit at `status='pending'` forever because the mark-paid mechanism doesn't work or doesn't exist — a workflow gap.

**Evidence:**

Workflow inventory (code read, not assumed):
- `src/features/accounting_report/components/ExpenseDetailDialog.tsx:194-225` — a working "mark paid" button + payment-method input, calling `useMarkExpensePaid` (`src/features/accounting_report/hooks/useMarkExpensePaid.ts:5-31`), which does `update ... set status='paid', paid_at=now(), payment_method=..., paid_by=<current user>`.
- `src/features/accounting_report/components/NewExpenseDialog.tsx:249-256` — a second path, "submit and mark paid" at creation time, wired to `useCreateExpense` (`src/features/accounting_report/hooks/useCreateExpense.ts:24-40`), which inserts directly with `status: isPaid ? 'paid' : 'pending'`. Note: this path never sets `paid_by` (the `paidByUserId` field in `CreateExpenseInput` is declared but never passed by the dialog), so expenses created-and-marked-paid this way have no "who paid it" attribution, unlike the detail-dialog path — a minor audit-trail gap, not a P&L bug.
- Autopay (`supabase/migrations/20260707000000_expenses_autopay.sql`): `set_expense_autopay()` (lines 87-141) lets an admin flag a *recurring* chain (`one_time` explicitly rejected, line 101-103) for auto-settlement; `settle_autopay_expenses()` (lines 61-76) runs nightly via `run_daily_expenses()` → cron `daily_ensure_recurring_expenses` (02:05 UTC, confirmed healthy in Task 1 E9) and flips `pending→paid` only for rows where `autopay AND status='pending' AND start_date <= current_date AND payment_method IS NOT NULL`.

So the mark-paid mechanism is real and functioning — proven by the fact 32 of 135 rows are already `paid`, several with `paid_by` set to a real user and `paid_at` timestamps. This rules out "nothing to mark them paid" (workflow gap).

Live classification of the 103 pending:
```sql
select billing_type,
       count(*) filter (where end_date < current_date) as past_due,
       count(*) filter (where end_date >= current_date or end_date is null) as current_or_future,
       sum(amount_net) filter (where end_date < current_date) as past_due_net
from public.expenses where status='pending' group by 1;
```
| billing_type | past_due | current_or_future | past_due_net |
|---|---|---|---|
| one_time | 69 | 2 | €39,891.76 |
| recurring_monthly | 8 | 23 | €4,572.00 |
| recurring_yearly | 0 | 1 | €0.00 |
| **total** | **77** | **26** | **€44,463.76** |

Total pending net = €57,017.66 (103 rows) = €44,463.76 past-due tranche + €12,553.90 not-yet-due tranche (48.52 one_time + 12,313.38 recurring_monthly + 192.00 recurring_yearly). The not-yet-due tranche is legitimate: 13 of the "future-dated" rows (2026-08-28 through 2026-09-02) were pre-spawned by `ensure_recurring_expenses()`'s 7-day lookahead window (`e.end_date <= current_date + interval '7 days'`, `20260707000000_expenses_autopay.sql:26`) — e.g. the CURSOR row starting 2026-09-02 was created 2026-08-26 (6 days early), confirmed by `created_at` vs `start_date`. These are not anomalies.

Root cause of the 77-row past-due tranche: **89 of the 135 total expense rows (66%) were created in a single bulk-import session on 2026-08-03** (`created_at::date` histogram: 89 rows on 2026-08-03 alone, with `created_at` timestamps spanning 05:27–06:32 UTC, vs. 1-8 rows/day on every other day). Separately, `paid_at` timestamps on the *same* rows show two distinct reconciliation passes that same day: one tailing the import itself (06:10–06:40 UTC, overlapping the tail of the import window) and a second, later batch at 14:35 UTC — i.e. staff went back at least twice that day to mark some of the just-imported rows paid (also `paid_at` 2026-08-04/05 for a few more). e.g. `DIMITRIS TZOUVARAS`, `MARIOS`, `PAVLOS`, `GOOGLE ADS`, `ΜΕΤΑ ΑΔΣ`, `brevo`, `anthropic`, `CURSOR` were all imported (`created_at`) and paid (`paid_at`) within these windows. But 103 rows were left untouched.

The three oldest pending rows (`start_date < current_date - 60`) are the chain-head rows of the SUPABASE, Local Viking, and `ΕΝΟΙΚΙΟ ΜΑΓΑΖΙ` (shop rent) recurring chains — a single row each representing an ~11-month arrears/backfill period (2025-08-01/07 → 2026-07-07), `autopay=false`, still `pending`. Refutation check per the brief ("might be a genuinely unpaid bill"): a business does not go 11+ months without paying rent or without Supabase cutting off the account for non-payment — the far more plausible explanation is these were already paid in real life and simply never reconciled in the CRM. Reinforcing this: the *later* period of the same `ΕΝΟΙΚΙΟ ΜΑΓΑΖΙ` chain (2026-08-07→09-07) **is** marked paid (`paid_at` 2026-08-04), while the head and the middle period are not — i.e. staff paid/reconciled the newest bill as it came due but never went back to close out the historical backlog.

**€ distortion, quantified both ways (per Task 1's invariants):**
- **Via `accounting_pl_summary_v` (the real P&L, `status='paid'` only):** total expense net recognized = €25,721.40 (32 rows) out of €82,739.06 true total (135 rows) — the P&L captures only **31.1%** of incurred expenses and is silently missing **€57,017.66 (68.9%)**, of which **€44,463.76 is already past its own due date**.
- **Via `accounting_ledger_v` read directly without a `status='paid'` filter** (the failure mode Task 1's E1 warned about): apparent cash-out would be €82,739.06 instead of the real €25,721.40 — a **3.2x overstatement** of actual expense cash flow.

**Refutation attempt:** Considered "intended design — pending means committed-but-uncollected and the business tracks it that way on purpose." Rejected: there is no UI, doc, or migration comment framing "pending forever" as intentional; the existence of the mark-paid button/RPC and the fact 32 rows *were* successfully marked paid (some for the exact same vendors that have other still-pending rows, e.g. `CURSOR`, `CLAUDE`, `COSMOTE` appear in both `paid` and `pending` states) shows the workflow is meant to be used continuously, not left in "pending forever" by design.

**Verdict: NEEDS-OWNER, leaning CONFIRMED as data-entry/reconciliation gap (not a workflow or intended-design gap).** The mark-paid and autopay mechanisms both work correctly. The 103-row backlog is best explained as an incomplete reconciliation following the 2026-08-03 bulk import: 32 rows got cleaned up in the following days, 103 did not, and 77 of those 103 are now past their own due dates while remaining invisible to the real P&L. Owner should decide: (a) bulk-mark the genuinely-already-paid historical rows as paid, or (b) confirm any of them are truly still owed and chase payment — either way, the current P&L understates true 2026 costs by roughly two-thirds until this is done.

---

## E11 — [EXPENSES] Recurring generator produces contiguous, non-duplicated periods with a flat (not linked-list) chain structure

**Claim:** `ensure_recurring_expenses()` correctly renews recurring chains without gaps or duplicate periods, and `parent_expense_id` behaves as documented.

**Evidence:**
```sql
select vendor, start_date, count(*) from public.expenses
 where billing_type like 'recurring%' group by 1,2 having count(*) > 1;   -- 0 rows (no duplicate periods)

select a.vendor, a.end_date, min(b.start_date)
from public.expenses a join public.expenses b on ... having min(b.start_date) > a.end_date;  -- 0 rows (no gaps)
```
23 distinct vendor/billing_type recurring chains checked, 0 duplicates, 0 gaps.

`parent_expense_id` chain structure verified against the live CLAUDE chain (3 rows): the head row (`id=a617...`, no parent) and both of its renewal periods (`id=61dc...` and `id=42ed...`) **both** carry `parent_expense_id = a617...` (the head), not a linked list pointing to the immediately-preceding period. This matches the generator's insert (`coalesce(r.parent_expense_id, r.id)`, `20260601000004_ensure_recurring_expenses.sql:36` / `20260707000000_expenses_autopay.sql:48`) — every spawned row always points to the **original chain root**, flattening the chain regardless of how many periods have already been spawned. The renewal-detection subquery (`ensure_recurring_expenses.sql:16-20`) groups by this same `coalesce(parent_expense_id, id)` key, so it correctly finds "the chain's current tip" using this flat structure.

The generator does not filter on `status` when selecting the row to renew from (`ensure_recurring_expenses.sql:12-21` has no `status` predicate) — confirmed correct behavior, not a bug: chains continue renewing whether their current tip is `pending` or `paid` (e.g. the paid COSMOTE/CURSOR chains still spawned further pending periods).

**Refutation attempt:** Checked whether any chain skips a period type/status the way the revenue-side generator was found to (per the brief's reference to `ensure_recurring_payments` traps) — `recurring_status_dist` shows only `pending`/`paid` ever appear among recurring expense rows (as expected, `expenses.status` CHECK only permits those two), no evidence of skipped or stuck statuses.

**Verdict: CONFIRMED — clean.** No duplicate periods, no gaps, chain linkage behaves as a flat root-pointer (documented here since nothing in the repo states this explicitly), and status is correctly irrelevant to renewal eligibility.

---

## E12 — [EXPENSES] Price-drift trap confirmed live: a manual amount correction to one period does not propagate to already-spawned future periods

**Claim:** Because `ensure_recurring_expenses()` copies `amount_net` forward from whatever the chain's current tip happens to be *at the moment the cron runs* (`r.amount_net`, `20260601000004_ensure_recurring_expenses.sql:34` / `20260707000000_expenses_autopay.sql:46`), a later manual correction to one period's amount (via `ExpenseEditForm`) does not retroactively fix, and is not itself picked up by, any period that was already spawned before the correction — the revenue-side "price-drift" trap (A7) has a direct expense-side analogue.

**Evidence:** Full SUPABASE `recurring_monthly` chain, in order:
| id | amount_net | start_date | end_date | created_at | updated_at |
|---|---|---|---|---|---|
| `d21658b5…` (head) | €216.00 | 2025-08-07 | 2026-07-07 | 2026-07-07 06:24:59 | 2026-07-07 06:24:59 (never edited) |
| `f3e5cd37…` | **€228.00** | 2026-07-07 | 2026-08-07 | 2026-07-08 02:05:00 (cron) | **2026-08-03 06:01:35** (edited later) |
| `449f98fc…` | €216.00 | 2026-08-07 | 2026-09-07 | 2026-07-31 02:05:00 (cron) | 2026-07-31 02:05:00 (never edited) |

Reconstruction: the head has never been touched (216 at creation, 216 now). When the cron spawned the second period on 2026-07-08, it must have copied 216 from the head (the only value the head has ever had) — yet that row now shows 228. Its `updated_at` (2026-08-03 06:01:35, during the same bulk-import/reconciliation session as E10) proves it was manually edited *after* being spawned, presumably to match the real July Supabase invoice (which can vary with usage-based add-ons). The third period was spawned on 2026-07-31 — **before** that 2026-08-03 edit — so it copied the still-unedited value (216) from the second period, not the corrected 228. The net effect: the manual correction is a one-off fix trapped on a single row; every subsequent period keeps renewing from whatever the tip's amount was at spawn time, so the corrected 228 never re-enters the chain, and if a *future* correction is needed it will have to be applied to each new period by hand, indefinitely.

**Refutation attempt:** Checked whether this could instead be an intentional one-time price bump that was later intentionally reverted for the third period — implausible, since the reversion (228→216) never happened; rather the *edit itself* landed on the already-spawned period after the fact, and the next period was generated independently beforehand. Also checked all 23 other recurring chains for the same `count(distinct amount_net) > 1` pattern — only SUPABASE shows drift; every other chain has a single consistent `amount_net` across all its periods, so this is not (yet) a widespread problem, just a demonstrated live occurrence of the mechanism.

**Verdict: CONFIRMED.** The trap is real and has already fired once in live data. Not a data-integrity error in the strict sense (no CHECK/FK is violated) but a reporting-accuracy risk: whoever edits a recurring expense's price to correct a bill should be aware it does not "stick" for future renewals — matches the equivalent revenue-side finding referenced in the brief.

---

## E13 — [EXPENSES] Deleting a recurring chain's head row can fracture the chain and cause the generator to spawn a duplicate period (latent risk, not yet observed live)

**Claim:** Because every period in a chain points `parent_expense_id` directly at the chain head (E11) via an `on delete set null` FK (`20260601000002_expenses.sql:18`, `parent_expense_id uuid references public.expenses(id) on delete set null`), and the renewal-detection key is `coalesce(parent_expense_id, id)` (`ensure_recurring_expenses.sql:16-20`), deleting the head row simultaneously nulls out `parent_expense_id` on **every** period in the chain (not just the head's direct child), splintering one shared chain-key into N independent single-row chain-keys (each row's own `id`). A period that is no longer the true chronological tip can then appear "open" (no row satisfies its now-orphaned chain-key with a later `start_date`), and the generator will spawn a new row starting exactly where a still-existing later period already starts — a duplicate period under a different (new, head-less) lineage.

**Evidence:** Confirmed by direct code/schema reading:
- FK: `supabase/migrations/20260601000002_expenses.sql:18` — `on delete set null` (not `restrict`/`cascade`), so a head delete does not fail and does not cascade-delete children, it silently orphans them.
- Renewal key: `supabase/migrations/20260601000004_ensure_recurring_expenses.sql:16-20` / `20260707000000_expenses_autopay.sql:29-30` — `coalesce(e2.parent_expense_id, e2.id) = coalesce(e.parent_expense_id, e.id)`. After a head delete, every former child's `parent_expense_id` is `null`, so this key becomes each row's own `id` — a chain that used to have N periods becomes N independent chains-of-one in the eyes of the generator.
- Delete path has no guard: `src/features/accounting_report/hooks/useDeleteExpense.ts:8-9` is a plain `supabase.from('expenses').delete().eq('id', id)` — no check for "is this a chain head with live children," no confirmation beyond the generic delete-confirm dialog in `ExpenseDetailDialog.tsx:93-98`.
- Live check: `select ... where parent_expense_id is not null and not exists (select 1 from expenses p where p.id = e.parent_expense_id)` returns **0 rows** — no chain head has actually been deleted in production, so this has not manifested yet.

**Refutation attempt:** Considered whether the "not exists" check's date comparison (`e2.start_date >= e.end_date`) would still correctly exclude the fragmented row because some *other* still-existing row coincidentally satisfies it — no: after fragmentation each row's chain-key is unique to itself, so no other row can ever match it regardless of dates; the fragmented row will always look like an open tip once its own `end_date` falls inside the 7-day lookahead window.

**Verdict: NEEDS-OWNER (latent design risk, confirmed by code analysis, not observed in live data).** No live duplicate has occurred because no head has been deleted, but nothing in the code prevents it, and the failure mode (silent duplicate expense periods, each independently payable) would double-count real cost if it ever happened. Recommend either blocking deletion of a row that has children, or switching the FK to `on delete cascade`/`restrict`, or having the generator re-key off `min(id) over (partition by vendor, billing_type, ...)` instead of the deletable `parent_expense_id`.

---

## E14 — [EXPENSES] `vat_amount`/`amount_gross` are generated columns — mismatch checks are structurally impossible to fail

**Claim:** These two fields cannot silently diverge from `amount_net`/`vat_rate` because they are computed by Postgres, not written by application code.

**Evidence:**
```sql
select column_name, is_generated, generation_expression
from information_schema.columns
where table_schema='public' and table_name='expenses' and column_name in ('vat_amount','amount_gross');
```
Both `GENERATED ALWAYS` (`STORED`): `amount_gross = round(amount_net + amount_net*vat_rate/100, 2)`, `vat_amount = round(amount_net*vat_rate/100, 2)` — matches the original DDL (`20260601000002_expenses.sql:8-9`). Live mismatch counts (`amount_gross <> round(...)`, `vat_amount <> round(...)`) are both **0/135**, as structurally guaranteed.

**Refutation attempt:** N/A — a generated column cannot be independently written to, so there is no code path (UI, RPC, direct SQL, import script) that could produce a mismatch short of Postgres itself misbehaving.

**Verdict: CONFIRMED — not applicable / structurally clean.** Per the brief's own guidance, this closes Step 3's arithmetic-integrity question immediately: whatever is wrong with the expense side of the P&L (see Task 1 E5: 100% of expenses carry `vat_rate=0`), it is not because `vat_amount`/`amount_gross` were computed incorrectly from whatever `vat_rate` was actually stored.

---

## E15 — [EXPENSES] Field-integrity sweep is otherwise clean, except zero receipts on file for any of the 135 expenses

**Claim:** Beyond the generated-column and category-orphan checks (already covered by E14 and Task 1's E4), the remaining Step 3 checks (negative/zero amounts, `end_date < start_date`, future-dated rows, paid-row completeness) are clean.

**Evidence:**
- `amount_net < 0` or `= 0`: 0 and 0 (also DB-enforced: `amount_net numeric(12,2) not null check (amount_net >= 0)`, `20260601000002_expenses.sql:6`, so `=0` is allowed but `<0` is impossible at the DB level regardless).
- `end_date < start_date`: 0 rows (also DB-enforced: `constraint expenses_end_after_start check (end_date is null or end_date >= start_date)`, line 24).
- `status='paid' and (paid_at is null or payment_method is null)`: 0 and 0 (also DB-enforced: `expenses_paid_requires_paid_at`, `expenses_paid_requires_method`, lines 22-23) — these are guaranteed by schema, not just observed.
- Future-dated rows (`start_date > current_date`): 13 rows, 2026-08-28 through 2026-09-02 — all explained by E10 as legitimate 7-day-lookahead pre-spawns of recurring chains (e.g. `CURSOR`'s 2026-09-02 row was `created_at` 2026-08-26, 6 days ahead of its own start), not data errors.
- **`receipt_path`: 0 of 135 rows have any value set (100% null).** The upload feature exists and works (`useUploadReceipt.ts`, wired into `ExpenseDetailDialog.tsx:181-192`), but no expense in production has ever had a receipt attached.

**Refutation attempt:** For the receipt gap — checked whether this could be explained by the storage bucket being emptied out-of-band while `receipt_path` remained set (a false "clean" signal in the other direction) — not applicable here since the count is 0, i.e. no rows even claim to have a receipt; there's nothing to reconcile against storage (also explicitly out of scope per the brief). Considered whether receipts are tracked elsewhere (e.g. attached to the vendor/contact record instead) — no such linkage exists in the schema.

**Verdict: CONFIRMED — clean on all counts except receipts.** The 100% null `receipt_path` is consistent with E10's finding that most rows arrived via a bulk import that bypassed the UI entirely (no upload step in a bulk import), and is a documentation-trail/compliance gap worth flagging to the owner alongside the VAT=0 finding (Task 1 E5) — not a P&L-arithmetic bug, but a real bookkeeping-hygiene gap for anyone who might eventually need to substantiate these expenses.

---

## E16 — [VIEWS] Independent recompute of the P&L matches `accounting_pl_summary_v` and `accounting_ledger_v` exactly — zero diff

**Claim:** Recomputing month-by-month P&L directly from `deal_payments`/`expenses` (status='paid' only, `event_date = coalesce(paid_at::date, start_date)`, month = `to_char(date_trunc('month', event_date), 'YYYY-MM')` — Task 1's invariants, not the views) reproduces `accounting_pl_summary_v` and a month-grouped `status='paid'` query over `accounting_ledger_v` to the cent.

**Evidence (live, 2026-08-27):** Independent recompute, income side (`deal_payments`, `status='paid'`):
| month | n | net | vat | gross |
|---|---|---|---|---|
| 2026-06 | 368 | 100150.67 | 19556.80 | 119707.46 |
| 2026-07 | 301 | 71239.72 | 14439.28 | 85679.00 |
| 2026-08 | 226 | 52200.77 | 10221.38 | 62422.15 |

Expense side (`expenses`, `status='paid'`):
| month | n | net | vat | gross |
|---|---|---|---|---|
| 2026-07 | 4 | 193.80 | 0.00 | 193.80 |
| 2026-08 | 28 | 25527.60 | 0.00 | 25527.60 |

`accounting_pl_summary_v` for the same 3 periods returns `total_income_net/vat/gross` and `total_expense_net/vat/gross` identical to the table above for every field, every month (e.g. 2026-08: `total_income_net=52200.77`, `total_expense_net=25527.60`, `net_profit_net=26673.17` = 52200.77−25527.60 exactly). A separate month-grouped query directly over `accounting_ledger_v where status='paid'` (bypassing `accounting_pl_summary_v` entirely, to test the view-of-a-view independently) also matches to the cent, same row counts. `vat_recomputed_from_rate` (`sum(round(amount_net*vat_rate/100,2))`, computed independently of the stored `vat_amount` generated column) also matches `sum(vat_amount)` exactly in every case — no divergence between the two ways of deriving VAT.

**Refutation attempt:** Re-ran the recompute against `accounting_ledger_v` (one layer removed from `accounting_pl_summary_v`) specifically to catch a bug that might exist in `accounting_pl_summary_v`'s own `GROUP BY`/`CASE` logic but happen to cancel out against a matching bug in my recompute — both cross-checks (view vs. independent SQL, and view vs. view-one-layer-down) agree, so a shared blind spot is very unlikely. Also checked for any period `accounting_pl_summary_v` reports that my recompute does *not* (i.e. the view surfacing a paid amount from a row my query missed) — none; every period in `accounting_pl_summary_v` with non-zero income/expense sums is accounted for in the recompute, and all zero-only periods correspond to months where only pending/overdue/cancelled rows exist (correctly contributing 0).

**Verdict: CONFIRMED.** The math is right. `independent-monthly.json` (this task's required deliverable) contains the full recomputed series for Tasks 4/5 to diff frontend numbers against.

---

## E17 — [VIEWS] Timezone month-boundary risk (Task 1 Invariant 4) is real in mechanism but has caused zero live misattributions; `paid_at` is written two different ways by design

**Claim:** `paid_at::date` truncates in the session's UTC timezone, not Athens local time, so a payment/expense settled within ~2-3h of UTC midnight could be attributed to the wrong calendar day (and, at a month boundary, the wrong month) relative to Athens wall-clock time. Quantify how many rows/€ this has actually moved.

**Evidence (live, 2026-08-27):**
- Day-level check, paid rows only: `count(*) where (paid_at::date) <> ((paid_at at time zone 'Europe/Athens')::date)` = **0** for both `deal_payments` (895 paid rows) and `expenses` (32 paid rows).
- Month-level check, **every row regardless of status** (not just paid — to also cover any latent risk for pending/overdue rows that do carry a `paid_at`): `date_trunc('month', paid_at::date) <> date_trunc('month', (paid_at at time zone 'Europe/Athens')::date)` = **0 rows** in both tables, all statuses.
- Root cause of the zero: `deal_payments.paid_at` hour-of-day distribution (UTC) for all 895 paid rows is **06:00–15:00 UTC only** (25/191/87/68/93/84/121/113/94/19 rows across hours 6–15) — i.e. staff mark payments paid during Greek business hours (08:00–18:00 Athens), nowhere near the 21:00–02:00 UTC risk window. Confirmed also: 0 non-paid rows in either table carry a stale non-null `paid_at` (no status was ever reverted after being paid-stamped), and cancelled rows (95) have `paid_at` null 100% of the time.
- **How `paid_at` gets written** (code/migration read, not assumed): two distinct mechanisms exist, both **real-time-correct by construction**:
  1. Manual/UI paths — `useMarkExpensePaid.ts:15` (`paid_at: new Date().toISOString()`), `useCreateExpense.ts:38` (same, when created-and-marked-paid), `PaymentsPanel.tsx:109` and `JobsBillingPanel.tsx:563` (deal_payments, same pattern), and the `accounting_prepay_months()` RPC (`20260716220000_accounting_prepay_months.sql:73`, `values (..., 'paid', now(), ...)`) — all stamp the actual wall-clock instant via `now()`/`new Date()`.
  2. `settle_autopay_expenses()` (`supabase/migrations/20260707000000_expenses_autopay.sql:67` and the inline settle in `set_expense_autopay()` at line ~135) — **deliberately** sets `paid_at = start_date::timestamptz` (midnight UTC of the period's start date), with an explicit inline comment `-- attribute to the period month`. This is a documented design choice, not a bug: it guarantees autopay-settled expenses land in the month the *period* covers rather than the month the nightly cron happens to run, and since it always stamps exact midnight UTC, it can never itself land in the risk window (midnight UTC = 02:00–03:00 Athens, same calendar day). Live: 12 of 32 paid expenses have exactly-midnight-UTC `paid_at` (`paid_at = date_trunc('day', paid_at)`, all with `paid_by is null` = "System"-settled per the code comment) — the other 20 are real-time UI-marked.

**Refutation attempt:** Checked whether the 0-diff result could be an artifact of Postgres's `at time zone` operator not actually loading the Athens tz rules (e.g. silently falling back to a fixed offset that happens to agree with UTC truncation) — no: `current_setting('TimeZone')` confirms `UTC` for the session, and `at time zone 'Europe/Athens'` is a documented, IANA-backed conversion in Postgres (handles the EET/EEST DST transition automatically); there is no fallback-to-UTC failure mode for a valid tz name. Also checked whether the "0 rows" result might just mean too few *paid* rows exist yet for the risk window to have been hit statistically — re-ran the check across **every row regardless of status** (2036 event_date-bearing rows combined) to widen the sample; still 0.

**Verdict: CONFIRMED (mechanism) / REFUTED (live impact so far).** The UTC-truncation risk described in Task 1's Invariant 4 is real and structurally present in the view (`coalesce(paid_at::date, ...)`), but it has caused **zero** actual month-misattributions to date, because (a) all manual `paid_at` writes happen during Athens business hours, far from the UTC-midnight boundary, and (b) the one code path that could theoretically hit the boundary (`settle_autopay_expenses`) deliberately stamps exact midnight UTC by design rather than the real settlement instant, which is a safer choice, not a riskier one. This remains a latent risk worth a permanent fix (e.g. compute `paid_at at time zone 'Europe/Athens'` explicitly instead of relying on session TimeZone) but is **not currently distorting any reported month**.

---

## E18 — [VIEWS] 13 pending `deal_payments` rows have both `paid_at` and `start_date` NULL — invisible to any month-grouped ledger/report query

**Claim:** `accounting_ledger_v.event_date`/`period` is `coalesce(paid_at::date, start_date)`; if a row has neither set, its `period` is `NULL` and it silently disappears from any query that groups or filters by `period`/month (including `accounting_pl_summary_v`, which still emits a `period IS NULL` group row, but with all-zero sums since these rows are `status='pending'` not `'paid'`).

**Evidence (live, 2026-08-27):** `select ... from accounting_ledger_v where period is null` returns exactly 13 rows, all `direction='in'`, `status='pending'`, `source_table='deal_payments'`, totaling **€8,250.80 net**. Underlying rows confirmed via `deal_payments`: all 13 have `paid_at IS NULL and start_date IS NULL`, `created_at` between 2026-06-22 and 2026-08-06 (12 of the 13 created within one hour-long window on 2026-06-22, 13:19–15:07 UTC, suggesting a batch creation event, not independent one-offs). `start_date date` (`supabase/migrations/20260503000010_deal_payments.sql:16`) has no `NOT NULL` constraint, so this is schema-legal, not a CHECK violation. `accounting_pl_summary_v` does emit one `period = NULL` row live, and every one of its 8 sum columns is `0` for that row — consistent with these 13 rows all being `pending` (correctly contributing nothing to the paid-only P&L), not a P&L-arithmetic error.

**Refutation attempt:** Checked whether `expenses` has the same failure mode — `select ... from expenses where coalesce(paid_at::date, start_date) is null` returns **0 rows** (expenses' `start_date` has no such gap live). Checked whether these 13 rows are otherwise-orphaned/dead deals (e.g. the parent deal itself deleted or archived) that wouldn't matter in practice — not checked exhaustively (out of this task's scope, which is math/attribution, not deal lifecycle), but the amounts are non-trivial (up to €2,000 on one row) and the `deal_id`s resolve (the ledger join `deal_payments dp join deals d on d.id = dp.deal_id` requires a live `deals` row to appear in the ledger at all, and all 13 do appear — with `period=null` — so the parent deals exist).

**Verdict: NEEDS-OWNER.** Not a P&L-math bug (these rows correctly contribute €0 to `accounting_pl_summary_v` since they're `pending`), but a **reporting-completeness gap**: any month-by-month "pending/expected income" or aging view built on `accounting_ledger_v.period` (as opposed to `accounting_pl_summary_v`, which only cares about paid rows) will silently drop €8,250.80 of real pending receivables with no month bucket to fall into. This is the income-side, NULL-attribution-date analogue of E10 (expense-side, paid-status-never-reached) — different mechanism, same effect (money the business is owed/owing that a month-grouped report cannot show). Recommend either backfilling `start_date` for these 13 rows or adding a `NOT NULL` constraint (with a required-at-creation UI field) to prevent new ones.

---

## E19 — [VIEWS] Status-semantics rule is symmetric (paid-only, both sides) but the underlying completion-rate asymmetry (E10) still skews reported profit upward

**Claim (brief Step 3):** Is the income-paid/expense-paid rule coherent, or does it asymmetrically favor showing more income than expense (or vice versa)?

**Evidence (live, 2026-08-27):** The rule itself, read from the view body (Invariant 2 / E2), is exactly symmetric: `accounting_pl_summary_v` gates **every** aggregate — both directions — on `status = 'paid'`, full stop. `cancelled` and `overdue` deal_payments (only valid on the income side; `expenses` has no such statuses per its CHECK constraint) are excluded from the P&L exactly like `pending` expenses are — none of the three non-`paid` statuses on either side contributes anything. So there is no asymmetric special-casing in the rule (e.g. no "income counts when overdue too" carve-out).

But the **completion rate underneath** the symmetric rule differs sharply by side, live:
- **Income:** of the €271,567.50 net that is either `paid`, `pending`, or `overdue` (excluding the 95 `cancelled` rows, €23,072.04, which the sibling revenue audit already established as legitimately dead money) — **82.3%** (€223,591.16) is `paid` and recognized; the remaining 17.7% (€47,976.34) is `pending`+`overdue` and not yet recognized.
- **Expense:** of the €82,739.06 net that is either `paid` or `pending` — only **31.1%** (€25,721.40) is `paid` and recognized (E10); the remaining 68.9% (€57,017.66) is `pending`, mostly (€44,463.76) already past its own due date, and not recognized.

**Refutation attempt:** Considered whether the income side's higher completion rate is itself an artifact of a shorter observation window (income rows span 2026-01 to 2029-03 vs. expenses 2025-08 to 2026-09) that would resolve itself over time — checked whether `pending`+`overdue` income skews toward far-future rows that simply aren't due yet: `deal_payments` pending min_date is 2026-08-27 (today) and overdue max_date is 2026-08-26 (yesterday) per Task 1's baseline, i.e. income's uncollected tranche is mostly current/near-term, not a long unpriced backlog the way expenses' 77-row past-due tranche is (E10). This reinforces rather than refutes the asymmetry: income collection is being actively worked close to real-time, expense reconciliation is not.

**Verdict: CONFIRMED — the rule is coherent/symmetric; the data is not.** Because both sides apply the identical "count only `paid`" filter, `accounting_pl_summary_v.net_profit_*` is not *structurally* wrong the way an asymmetric rule (e.g. income counted on `pending` too) would be. But because staff reconcile income far more consistently than expenses in practice (82% vs 31% completion), the symmetric rule's real-world effect is a P&L that **systematically overstates net profit** for as long as the expense-side backlog (E10) persists — not because the math or the rule is wrong, but because one side of a symmetric measurement is fed much more completely than the other. This is the same conclusion E10 already reached from the expense side alone; this finding confirms it by comparing directly against the income side's much higher completion rate, and confirms the *rule itself* is not the culprit.

---

## E20 — [VIEWS] VAT basis is net/gross-consistent, no mixing; generated-column VAT math on both sides of the ledger is structurally airtight (one apparent mismatch traced to a flawed check, not a real bug)

**Claim (brief Step 4):** `accounting_pl_summary_v` doesn't mix net/gross bases, and the known VAT anomalies (Cyprus/UAE 0% rows, the 19 wrong-VAT `paid` rows already flagged owner-gated in the sibling revenue audit) flow through visibly rather than being silently hidden or double-counted.

**Evidence (live, 2026-08-27):**
- `net_profit_net = total_income_net − total_expense_net` and `net_profit_gross = total_income_gross − total_expense_gross`, each built from same-basis inputs only (confirmed directly from the view's SQL text, Task 1 E8) — no cross-basis subtraction anywhere.
- Residual check `total_income_gross − total_income_net − total_income_vat` and the expense equivalent, across all 25 live periods: zero everywhere except one sub-cent artifact in 2026-06 (`−0.008`, on €119,707.46 of gross income across 368 rows) — immaterial (< 1 cent) and explained below, not a basis-mixing bug.
- **`deal_payments.vat_amount`/`amount_gross` are `GENERATED ALWAYS ... STORED`** (`generation_expression`: `round((amount_net + amount_net*vat_rate/100), 2)` and `round((amount_net*vat_rate/100), 2)` respectively) — structurally guaranteed self-consistent, exactly like `expenses` (Task 1 E14). Live check against the *actual* generated formula: `amount_gross <> round(amount_net + amount_net*vat_rate/100, 2)` → **0/895** paid rows. `vat_amount <> round(amount_net*vat_rate/100, 2)` → **0/895**.
- Cyprus/UAE 0%-VAT and the 19 already-flagged wrong-VAT rows are not hidden: `select vat_rate, count(*), sum(amount_net) from deal_payments where status='paid' group by vat_rate` shows exactly two live values among paid income rows — `0.00` (158 rows, €39,351.84 net) and `24.00` (737 rows, €184,239.32 net), summing to all 895 paid rows — both visible and correctly contributing `vat_amount=0` (not some other silently-defaulted value) to the aggregate.

**Refutation attempt (this is where the sub-cent residual and one apparent mismatch came from — recorded for transparency):** An initial naive check, `amount_gross <> round(amount_net + vat_amount, 2)` (re-deriving gross from the *already-rounded* `vat_amount` column instead of the raw formula), flagged 1 "mismatched" row (`amount_net=346.7780, vat_rate=24, vat_amount=83.23, amount_gross=430.00`, but `round(346.778+83.23,2)=430.01`). Investigated: this is **not a bug** — it's a double-rounding artifact of my own check, not of the schema. The generated column rounds the *sum of the raw (unrounded) net+vat* once (`430.00`), while `vat_amount` is independently rounded from raw VAT alone (`83.23`) — adding the two *already-rounded* numbers back together does not always reproduce the same rounding as rounding the raw sum directly. Re-checked against the column's real `generation_expression` (not a re-derivation) and got 0/895 mismatches, confirmed above. The same double-rounding mechanic, aggregated across 368 income rows, is almost certainly the source of 2026-06's −0.008 residual in `accounting_pl_summary_v` (summing independently-rounded `vat_amount`/`amount_gross` columns doesn't exactly cancel at the aggregate level) — sub-cent, immaterial, and not a net/gross-mixing bug.

**Verdict: CONFIRMED — no net/gross mixing, VAT math is structurally correct on both sides of the ledger; the expense-side VAT content itself remains meaningless (100% `vat_rate=0`, Task 1 E5, NEEDS-OWNER, unchanged by this task) but that is a data-entry question, not a view/arithmetic one.**

---

## E21 — [VIEWS] View correctness does not imply data trustworthiness — cite F46/B2, no re-derivation

**Claim (brief Step 5):** Even though this task confirms the ledger/P&L views compute the right numbers from whatever rows exist (E16, E20), that says nothing about whether the underlying rows themselves can be trusted — the mutation/deletion exposure documented elsewhere (B2) means the inputs to this otherwise-correct math are not tamper-evident.

**Evidence:** Per the brief's explicit instruction, this is a citation, not a re-derivation: B2 (sibling 2026-08-26 payment-system audit) already established that `deal_payments`/related billing rows are mutable/deletable outside of an audit trail, and F46 covers the corresponding mutation-tracking gap. This task's own E13 (expense-side) independently found the same class of risk on the expense side: a chain-head `expenses` delete (`on delete set null`, no guard in `useDeleteExpense.ts`) can fracture a recurring chain and cause a duplicate period — not yet observed live, but structurally possible.

**Verdict: NEEDS-OWNER (unchanged from B2/F46).** The views are arithmetically correct (E16, E20) and the math genuinely reflects whatever is in `deal_payments`/`expenses` at query time — but "correct math over mutable/deletable rows with no audit trail" is a materially weaker guarantee than "correct math over an append-only ledger." A correct P&L computed today could show a different number tomorrow with no record of what changed or why, independent of any new transaction. This is out of this task's scope to fix or further quantify (B2 already owns it); flagging here only so a reader of this task's CONFIRMED verdicts (E16, E20) does not mistake "the math is right" for "the numbers can't have been altered."

---

## E22 — [FRONTEND] usePLSummary's always-visible YTD summary silently drops every paid expense for the year, TODAY, because it has no `.order()` and the ledger's 1000-row cap lands mid-scan on the `expenses` arm

**Claim:** `usePLSummary` (`src/features/accounting_report/hooks/usePLSummary.ts:37-41`) and `useLedger` (`src/features/accounting_report/hooks/useLedger.ts:24-29`) both issue a plain `supabase.from('accounting_ledger_v').select(...)` with only `.gte('event_date', ...).lte('event_date', ...)` — **neither calls `.range()` or `.limit()`**, so both are subject to PostgREST/supabase-js's default 1000-row response cap, silently (HTTP 200, no error, no `Prefer: count=exact` requested so the app never even sees a truncation signal). `ReportPage.tsx:34-35` computes `ytdSummary = usePLSummary(rangeForPreset('this_year'), ...)` **unconditionally on every page load**, independent of whatever preset the user has selected — it is a permanent fixture of the page, always visible in the `kpi.ytd` strip at the bottom of `ReportHeader.tsx:170-188`.

**Evidence (live, 2026-08-27):**
```sql
select count(*) from public.accounting_ledger_v where event_date >= '2026-01-01' and event_date <= '2026-12-31';
-- 1284  (> 1000: the YTD range is ALREADY over the cap, today)
```
`usePLSummary` has **no `.order()` call at all** — the row order returned is whatever Postgres's query plan naturally produces, not a stable/intentional order. Confirmed live via `EXPLAIN`:
```
Append
  ->  Subquery Scan on "*SELECT* 1"   -- deal_payments (direction='in') arm
        ->  Nested Loop ... Seq Scan on deal_payments dp
  ->  Subquery Scan on "*SELECT* 2"   -- expenses (direction='out') arm
        ->  Nested Loop ... Seq Scan on expenses e
```
The planner executes the `deal_payments` arm of the `UNION ALL` **first, in full**, before touching the `expenses` arm. Reproducing the exact 1000-row truncation an unordered `LIMIT 1000` would apply (`row_number() over ()` with no `ORDER BY`, matching what a client with no explicit order receives):
| kept (rn≤1000) | direction | status | n | net |
|---|---|---|---|---|
| true | in | cancelled | 82 | €20,380.41 |
| true | in | overdue | 96 | €24,266.24 |
| true | in | paid | 805 | €203,373.92 |
| true | in | pending | 17 | €3,949.35 |
| **false (dropped)** | in | cancelled | 13 | €2,691.63 |
| **false (dropped)** | in | overdue | 18 | €4,192.20 |
| **false (dropped)** | in | paid | 90 | €20,217.24 |
| **false (dropped)** | in | pending | 31 | €6,777.43 |
| **false (dropped)** | **out** | **paid** | **32** | **€25,721.40** |
| **false (dropped)** | **out** | **pending** | **100** | **€54,937.66** |

Every single `direction='out'` (expense) row for the year — **all 32 paid + all 100 pending, 100% of the expense side** — falls past row 1000 and is silently never returned, because the `expenses` arm of the `UNION ALL` is only reached after the `deal_payments` arm's 1152 rows have already exhausted the cap. On top of that, 90 of the 895 paid-income rows (€20,217.24) are also dropped from the same truncation.

**Quantified live impact on the YTD summary shown today:**
- Displayed (truncated): `totalIncomeNet ≈ €203,373.92`, `totalExpenseNet = €0.00` (per E16/independent-monthly.json, true YTD paid income for 2026 = €223,591.16 across Jun+Jul+Aug alone, and true YTD paid expense = €25,721.40), `netProfitNet ≈ €203,373.92`.
- True (per E16, recomputed independently and cross-checked against `accounting_pl_summary_v`): `totalIncomeNet = €223,591.16`, `totalExpenseNet = €25,721.40`, `netProfitNet = €197,869.76`.
- **Net effect: the YTD net-profit figure shown on every single visit to the Report page today is overstated by ≈€5,504.16, entirely because the expense side of the YTD summary silently reads as zero.**

If a user instead explicitly selects the `this_year` **preset** (not just the always-on YTD strip), `useLedger(this_year)` is *also* subject to the same 1284-row/1000-cap problem, but with a different, deterministic drop pattern because it *does* call `.order('event_date', { ascending: false })`: the dropped 284 rows are the **284 oldest events in the range**, `event_date` between 2026-01-23 and 2026-06-22 (confirmed live via `row_number() over (order by event_date desc)`, `rn>1000`). This means selecting "This year" on the Report page silently drops roughly the first 5 months of the year's income/expense breakdown, transaction drawer, and CSV/PDF export (both of which are fed directly from `useLedger.data` via `incomeRows`/`expenseRows` in `ReportPage.tsx:40-52` → `ExportMenu.tsx:16-18,35-40`) — while `usePLSummary(this_year)` (the KPI tiles for that same selected range) would show the *other*, non-deterministic drop pattern above. The two would visibly disagree with each other for the same selected range.

**Refutation attempt:** Checked whether PostgREST might be configured with a higher `db-max-rows` on this project (which would make the whole finding moot) — the brief's own framing and the live row-count arithmetic (1284 > round number 1000, and the observed drop lands exactly on a 1000/284 split matching `row_number() <= 1000`) is consistent with the standard Supabase default of 1000 and is treated as an established platform default per this audit's Task 1 framing; independently confirming the exact server-side `db-max-rows` value was out of reach from the Management API (which executes as `postgres` and bypasses PostgREST entirely, so it cannot itself demonstrate REST-layer truncation — only the row-count math and query-plan ordering, which are the load-bearing parts of this finding, could be verified directly). Checked whether `usePLSummary`'s lack of `.order()` might still coincidentally return a stable, income-first order deliberately (e.g., a view-level default sort) — no: `accounting_ledger_v`'s definition (E7) has no `ORDER BY` in the view body either, so nothing upstream imposes order; the `Seq Scan`-then-`Seq Scan` plan is simply what today's planner/statistics happen to produce, and is not guaranteed stable across ANALYZE/VACUUM cycles — meaning the specific "expenses always lose" pattern could theoretically shift, but the underlying defect (no `.order()`, no row-count check, no pagination) is stable and the ordering being non-deterministic is itself worse, not better, since it means unpredictable months could give a different silently-wrong answer.

**Verdict: CONFIRMED — live, active data-loss bug, not a theoretical risk.** `usePLSummary`/`useLedger` never call `.range()`/`.limit()`, never check whether the returned row count hit the cap (no `count: 'exact'` request, no `data.length === 1000` guard), and the YTD range used unconditionally on every Report-page load has already crossed the 1000-row cap live today (1284 rows). The concrete, current, quantified consequence is that the YTD KPI strip shown to the owner right now overstates YTD net profit by ~€5,504 by making 100% of this year's paid expenses invisible. No test in `usePLSummary.test.tsx` or `useLedger.test.tsx` exercises row counts anywhere near 1000, so this gap was never caught by the test suite either.

---

## E23 — [FRONTEND] Dashboard's leads hooks have the identical uncapped-fetch defect, and it fires on the page's own DEFAULT view (not just an edge-case preset)

**Claim:** `useDashboardLeads` (`src/features/dashboard/hooks/useDashboardData.ts:15-31`) issues `supabase.from('leads').select(...).eq('archived', false).gte('created_at', ...).lte('created_at', ...)` with **no `.order()`, `.range()`, or `.limit()`** — the same defect class as E22, on a much larger table (6,641 live leads) and hit by the Dashboard's own default preset, not just a manually-chosen wide range.

**Evidence (live, 2026-08-27):** `DashboardPage.tsx:227` sets `useState<Preset>('last_6_months')` as the initial/default preset — i.e. this is what every user sees on first navigating to `/dashboard`, no click required. `rangeFor('last_6_months')` (`DashboardPage.tsx:73-75`) computes `2026-03-01 → 2026-08-27` for today's date. Live count for that exact range:
```sql
select count(*) from public.leads where archived=false and created_at >= '2026-03-01T00:00:00Z' and created_at <= '2026-08-27T23:59:59Z';
-- 3365   (> 1000: the default dashboard view is already over the cap, today)
```
Every other non-`this_month` preset is worse: `last_month` = 1,177 rows, `this_year` = 4,675 rows, `last_12_months` = 6,188 rows — only `this_month` (161 rows) and a sufficiently narrow custom range stay under the cap. Because `leads` has no supporting index for this query (`EXPLAIN` shows a plain `Seq Scan on leads` with the `archived`/`created_at` filter applied post-scan, no `Sort` node), the physical row order returned is **not** correlated with `created_at` — confirmed by comparing the date range of the "kept" vs. "dropped" halves of an unordered `row_number() over ()` split on the `this_year` set: both halves span nearly the *identical* full date range (`kept`: 2026-01-01→08-27; `dropped`: 2026-01-01→08-27), meaning the 1000 rows a user actually sees are an essentially arbitrary cross-section of the whole period, not "the most recent 1000" or "the first 1000 chronologically."

This also skews the **relative** proportions in the `dashboard.leads_by_source` table, not just the total count — the truncation drops sources unevenly:
| source | true total (this_year) | kept (of 1000) | % kept |
|---|---|---|---|
| import | 2,973 | 747 | 25.1% |
| meta | 1,069 | 191 | 17.9% |
| manual | 110 | 13 | 11.8% |
| franchise | 523 | 49 | 9.4% |

So the "Leads by source" breakdown shown on the dashboard doesn't just undercount every source proportionally — `franchise` is disproportionately suppressed (9.4% survival vs. `import`'s 25.1%), which would visibly distort the *shape* of the source mix an owner reads off the chart, not merely its scale.

**Refutation attempt:** Considered whether the Dashboard's headline "Leads received" tile might be intentionally scoped small enough to avoid this (e.g., if `last_6_months` were actually a short window) — no, `last_6_months` spans 6 calendar months by construction (`DashboardPage.tsx:73-75`, `months = preset === 'last_6_months' ? 5 : 11`) and this project receives ~500-1400 leads/month (per the by-month table: Jun 1444, Jul 1177), so any window ≥ 2 months is at meaningful risk and ≥ 3 months is already virtually guaranteed to exceed 1000 given current lead volume. Also checked `useDashboardDeals()` (`useDashboardData.ts:46-60`) for the same defect — it has no `.order()`/`.range()`/date filter at all (fetches all 609 non-archived deals unconditionally, then filters client-side by the selected date range) — currently safe (609 < 1000) but with zero pagination guard, so it is a **latent, not-yet-triggered instance of the identical defect** that will silently break once total active deals cross 1000. `useMonthlyPL` (reads the pre-aggregated `accounting_pl_summary_v`, grouped by `period`, ~25 rows total) and `useRecurringCollected` (768 rows for `this_year`, still under the cap today but the largest range tested here, worth monitoring) were checked and are not currently exposed, though `useRecurringCollected` also has no `.order()`/`.range()` guard and would fail the same way once its row count crosses 1000.

**Verdict: CONFIRMED — live, active data-loss bug on the Dashboard's own default view.** This is the same defect as E22 (no pagination, no row-count check, no explicit order) recurring across a second, independently-written set of hooks, and it is arguably more severe here because it hits the page's default state rather than a specific preset the user has to opt into, and the undercount is far larger in relative terms (up to 84% of leads missing on `last_12_months`, 72% missing even on the *default* `last_6_months` view) than on the Report page.

---

## E24 — [FRONTEND] Step 4 numeric cross-check: usePLSummary's exact filter+aggregation matches `independent-monthly.json` to the cent for all 3 sample months (no diff, for ranges under the row cap)

**Claim:** For calendar-month ranges that stay under the 1000-row cap (E22/E23 do not apply), `usePLSummary`'s client-side aggregation (`direction='in' AND status='paid'` for income, `direction='out' AND status='paid'` for expense by default, summed with `Number()` coercion) reproduces the independent recompute in `independent-monthly.json` exactly.

**Evidence (live, 2026-08-27):** Replicated `usePLSummary`'s exact query (`event_date >= from AND event_date <= to`, calendar-month bounds identical to `rangeForPreset('this_month'/'last_month')`'s `Date.UTC(y, m, 1)` / `Date.UTC(y, m+1, 0)` math) and its exact in-JS filter/sum logic, in SQL, for the three non-zero months:
| month | usePLSummary replica income_net/vat/gross | independent-monthly.json | diff | usePLSummary replica expense_net/vat/gross | independent-monthly.json | diff | rows fetched (well under 1000) |
|---|---|---|---|---|---|---|---|
| 2026-06 | 100150.67 / 19556.80 / 119707.46 | 100150.67 / 19556.80 / 119707.46 | **0** | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 | **0** | 415 |
| 2026-07 | 71239.72 / 14439.28 / 85679.00 | 71239.72 / 14439.28 / 85679.00 | **0** | 193.80 / 0.00 / 193.80 | 193.80 / 0.00 / 193.80 | **0** | 452 |
| 2026-08 | 52200.77 / 10221.38 / 62422.15 | 52200.77 / 10221.38 / 62422.15 | **0** | 25527.60 / 0.00 / 25527.60 | 25527.60 / 0.00 / 25527.60 | **0** | 362 |

Zero diff on every field, every month, both sides. This holds because a calendar-month `event_date` range (`YYYY-MM-01` to `YYYY-MM-lastday`) is exactly equivalent to `period = 'YYYY-MM'` (the view's own month-bucketing), so `usePLSummary`'s per-range approach and `accounting_pl_summary_v`'s per-period `GROUP BY` necessarily select the identical row set whenever the range is a whole calendar month and stays under the row cap.

**Refutation attempt:** Deliberately re-checked the two lowest-row-count months first (June: 415 total ledger rows fetched, well clear of 1000) specifically to rule out a coincidental match that only happens to work near the cap boundary — all three sample months (362-452 total rows fetched, including non-paid statuses) are comfortably clear of any truncation risk, so this result is a genuine confirmation of the aggregation logic itself, not an artifact of E22's truncation happening to cancel out.

**Verdict: CONFIRMED.** `usePLSummary`'s math, `Number()` coercion, and status filter are correct and match the independent baseline exactly — for any range that does not trigger E22's row cap. This isolates E22 as a pure fetch/pagination defect, not an aggregation-logic defect: the arithmetic the hook performs on the rows it receives is right; the bug is entirely in which rows it receives.

---

## E25 — [FRONTEND] Month-filtering is UTC-consistent between ReportPage/DashboardPage and the DB (Step 2), with one real semantic mismatch: ExpensesPage's month filter uses `start_date`, not the ledger's `paid_at`-first attribution

**Claim (brief Step 2):** Check whether the frontend's month-boundary math agrees with the DB's UTC-based `event_date`/`period` attribution (Invariant 3/4), and whether every "month filter" in the UI means the same thing.

**Evidence:**
- `formatRange.ts:10-15,21-41` (`rangeForPreset`, used by `ReportPage`) builds all date boundaries via `Date.UTC(y, m, ...)` and formats with `getUTCFullYear()/getUTCMonth()/getUTCDate()` — fully UTC, no local-timezone `Date` methods anywhere in the file. This matches the DB session's confirmed `UTC` timezone (Task 1 Invariant 4) exactly, so `usePLSummary`/`useLedger`'s `event_date` range filters land on the same calendar-day boundaries Postgres would compute for the same dates.
- `DashboardPage.tsx:57-76` (`isoDay`, `rangeFor`) is likewise fully UTC (`toISOString().slice(0,10)`, `getUTCFullYear()/getUTCMonth()`) — no local-timezone drift there either.
- `monthFilter.ts:13-19` (`monthRange`, used only by `ExpensesPage`'s month dropdown) is also UTC-consistent internally (`Date.UTC(y, m, 0)` for last-day-of-month), so no timezone bug exists in any of the three date-boundary utilities.
- **However**, `useExpenses.ts:63-64` filters the raw `expenses` table by `start_date` (`.gte('start_date', from).lte('start_date', to)`) when a month is picked on the Expenses page — **not** by `coalesce(paid_at::date, start_date)`, the attribution rule every other reporting surface (`accounting_ledger_v`, `accounting_pl_summary_v`, `usePLSummary`, `useLedger`) uses. Live: **14 of 135 expenses** have `paid_at` in a different calendar month than `start_date` (all from the 2026-08-03 bulk-reconciliation session documented in E10/E12 — e.g. `CURSOR`/`brevo`/`anthropic`/`MARIOS`/`DIMITRIS TZOUVARAS` rows with `start_date` in July but `paid_at` on 2026-08-01/03).

**Refutation attempt:** Considered whether this is actually correct/intended, since `ExpensesPage` is framed as a raw transaction *list* (not a P&L view) — filtering "which expenses are due/started in month X" by `start_date` is a defensible, different (and arguably more useful for an ops/AP view) question than "which expenses were recognized as cash-out in month X." That's a legitimate design choice, not automatically a bug. But it does mean a user who filters ExpensesPage to `month=2026-08` expecting "the expenses reflected in August's P&L" will **not** see those 14 July-`start_date`/August-`paid_at` rows there, while the Report page's ledger/P&L (correctly, per Invariant 3) attributes their money to August — the two pages would visibly disagree about "what happened in August" for those 14 rows, with no in-UI explanation of why. This is a real cross-page consistency gap, not a math bug in either page individually.

**Verdict: CONFIRMED (UTC math is consistent everywhere) / NEEDS-OWNER (ExpensesPage month filter uses a different, undocumented attribution rule than every other reporting surface).** Recommend either labeling the Expenses page's month filter explicitly as "started in" (to disambiguate from the Report page's "recognized in"), or adding a second/alternate filter mode keyed off `paid_at` for users trying to reconcile the two pages' numbers for the same month.

---

## E26 — [FRONTEND] Step 3 permission gates: `/accounting/report` and `/accounting/expenses` are admin-only in the UI, but the underlying `deal_payments` table's RLS grants direct read access to income data to 20 non-admin accounts

**Claim (brief Step 3):** List role→visibility for the Report/Expenses pages, and check whether income data is reachable by non-admin roles the owner doesn't expect (the old audit's A8).

**Evidence:**
- **UI route gates** (`src/app/router.tsx:274-304`): `/accounting/*` (the whole board) is wrapped in `RequireGroup(groups=['accounting'])` (`RequireGroup.tsx`: admin OR any of the listed group codes), but `report` and `expenses` are two of the children **individually re-wrapped in `AdminGuard`** (`AdminGuard.tsx`: `isAdmin` only, ignores `groupCodes` entirely) — i.e. these two specific pages require full admin, a *stricter* gate than the rest of the `accounting` board (`onboarding`, `clients`, `recurring`, `docs`, `alerts`, `assistant` only require `accounting` group membership). So in the React app itself, only admins can open the Report or Expenses pages — no leak at the route level.
- **DB-level RLS** tells a different story for the underlying data those pages read. `expenses` table RLS (`expenses_all` policy): `qual = current_user_is_admin()` for **all** commands including `SELECT` — admin-only at the DB layer too, consistent with the UI gate. But `deal_payments` table RLS (`deal_payments_select` policy): `qual = current_user_is_admin() OR current_user_can('sales','view') OR current_user_can('clients','view') OR current_user_can('accounting_onboarding','view')` — **any authenticated user holding `sales`.`view`, `clients`.`view`, or `accounting_onboarding`.`view` permission can `SELECT` the entire `deal_payments` table directly**, regardless of admin status. Since `accounting_ledger_v`/`accounting_pl_summary_v` run with `security_invoker=true` (E7/E8), a non-admin user with one of those three permissions who queries `deal_payments` directly (or the ledger view directly — the `deal_payments` arm of the `UNION ALL` succeeds for them even though the `expenses` arm silently returns nothing) via the Supabase JS client from browser devtools — trivially reachable by anyone with valid session credentials, entirely bypassing the React router/AdminGuard — gets full read access to every payment: amount, status, `paid_at`, client linkage, for every deal, past and present.
- Live headcount (2026-08-27): **20 distinct non-admin accounts** currently hold `sales`.view and/or `clients`.view and/or `accounting_onboarding`.view = true (via `user_effective_permissions`, which resolves both direct user-level and group-level grants), e.g. `akotzampasakis@itdev.gr`, `azazas@itdev.gr`, `cpostantzian@itdev.gr`, `dgiannakakis@itdev.gr`, `dtzouvaras@itdev.gr`, `ekitsakis@itdev.gr`, `elena@itdev.gr`, `emarketaki@itdev.gr`, `pefstathiadis@itdev.gr`, `pgiannakopoulos@itdev.gr`, `stavroula@itdev.gr`, `stelios@itdev.gr`, `testsales@itdev.gr`, `tvogiatzi@itdev.gr`, `vdimitrov@itdev.gr`, `agaleou@itdev.gr` and 4 more — the large majority of these are `clients`.view (a very commonly-granted permission), not just `sales`.view, widening the exposed population well beyond "the sales team."

**Refutation attempt:** Checked whether `clients`.view / `sales`.view is a narrow, rarely-granted permission that wouldn't matter in practice — the opposite: 16 of the 20 flagged accounts hold `clients`.view specifically, which appears to be a broadly-granted, ordinary-staff permission (not an accounting-adjacent one), meaning the practical reach of this gap extends well past "people who work near billing." Checked whether this is already fully covered by the sibling 2026-08-26 payment-system audit's A8/B2 findings (which this task was told to defer to, per E21) — could not confirm the exact prior wording of A8 from within this task's scope, so this is recorded here as a fresh, dated (2026-08-27), live-verified instance of the same class of issue for this specific reporting-audit's record, rather than assumed identical to A8 without re-reading it.

**Verdict: NEEDS-OWNER.** The Report/Expenses **pages** are correctly admin-gated in the UI, and `expenses` data is correctly admin-gated at the DB layer too. But `deal_payments` (all deal-level income/payment history) is reachable by 20 live non-admin accounts at the API/DB layer today, independent of the UI's AdminGuard — anyone in that list who knows how to open browser devtools and call the Supabase client directly can read the same income data the Report page shows an admin, without ever needing the admin flag. Owner should decide whether `sales`.view/`clients`.view is meant to imply "can see every client's full payment history" (if so, this is working as designed and merely under-documented) or whether `deal_payments_select` should be narrowed (e.g. to an aggregated/masked view, or scoped by `scope='own'`/`'group'` the way `group_permissions.scope` already supports elsewhere in the schema) to actually match the Report page's admin-only intent.

---

## E27 — [FRONTEND] Report/Expenses export paths inherit E22's row-cap defect for wide ranges; dashboard's P&L trend chart does not (reads the pre-aggregated view)

**Claim:** Note, per the brief, which downstream consumers are exposed to E22/E23's truncation vs. which are protected by reading an already-aggregated server-side view.

**Evidence:**
- `ExportMenu.tsx:16-18,34-40` builds both the CSV (`ledgerRowsToCSV`, `exportCSV.ts` — Task 5 territory, not re-audited here) and the PDF (`downloadPDF`, `exportPDF.ts` — explicitly out of scope for this task per the brief) directly from `incomeRows`/`expenseRows`, which are `useMemo`-filtered slices of `ledger.data` (`ReportPage.tsx:40-52`) — i.e. **both exports are fed by `useLedger`**, and therefore silently reproduce the ordered-drop failure mode from E22 whenever the selected range (e.g. `this_year`, or a wide custom range) exceeds the 1000-row cap. A user exporting a YTD or multi-month CSV/PDF today, for a range comparable to the live `this_year` range (1284 rows), would get a file missing the 284 oldest transactions in that range with no warning in the file or the UI.
- By contrast, `DashboardPage.tsx`'s revenue/expense/profit trend chart (`useMonthlyPL`, `useDashboardData.ts:70-84`) reads `accounting_pl_summary_v` **already grouped by `period`** server-side (≈25 total period-rows in the view, regardless of how many underlying `deal_payments`/`expenses` rows exist) — this query can never approach the 1000-row cap at current or realistically foreseeable data volumes, so the Dashboard's P&L numbers are **not** exposed to E22/E23's defect. `useDashboardDeals`/`useDashboardLeads`/`useRecurringCollected` (E23) remain exposed since they read raw per-row tables.

**Verdict: CONFIRMED.** This is not a new bug beyond E22/E23 — it is a scope note establishing that the CSV/PDF export surfaces (owned by Task 5) inherit whichever hook feeds them, and that the Dashboard's headline trend chart is structurally immune to this class of defect because it consumes a pre-aggregated view rather than raw ledger rows. Task 5 should treat `useLedger`'s row-cap exposure (E22) as a precondition affecting export correctness, not re-derive it independently.

---

## E28 — [PDF] The accounting PDF renders Greek text with jsPDF's unembedded default font — every other PDF generator in the codebase deliberately avoids jsPDF for exactly this reason

**Claim:** `src/features/accounting_report/utils/exportPDF.ts` prints Greek text (client/vendor names, and potentially Greek `service_type`/category values) through jsPDF's built-in standard font with no embedded Unicode font, which will render garbled/missing glyphs — in contrast to the codebase's own house pattern for every other business-document PDF (contracts, offers, proformas), which renders HTML through headless Chromium specifically to get correct web-font text rendering, including Greek.

**Evidence:**
- `exportPDF.ts` (entire file, 54 lines) calls `new jsPDF({ unit: 'mm', format: 'a4' })` (line 17) and then only ever calls `doc.setFontSize()` / `doc.text()` (lines 19-51) — there is no `doc.setFont()` with a custom family, no `doc.addFont()`, no `doc.addFileToVFS()` anywhere in the file. `grep -rn "addFont\|addFileToVFS\|setFont(" src api` across the whole repo returns **zero matches**, and `find ... -iname "*.ttf"` under `src`/`public` returns **zero files**. jsPDF ships 4 built-in "standard" fonts (helvetica, times, courier, symbol/zapfdingbats) that use WinAnsi/Adobe-Standard encoding — a Latin-1-class character set with no Greek code points. Passing a Greek string (e.g. a client or vendor name) to `doc.text()` without first embedding a custom TTF via `addFont`/`addFileToVFS` is a well-documented jsPDF limitation: unsupported glyphs render as blank boxes/missing characters, not garbled Latin transliteration.
- Real production data feeds Greek strings straight into the row this file prints: `counterparty` for expense rows is `e.vendor` (`supabase/migrations/20260717120000_revert_ledger_collection_month.sql:48`), and the sibling Task 1 finding (E10) cites live vendor values `ΜΕΤΑ ΑΔΣ` and `ΕΝΟΙΚΙΟ ΜΑΓΑΖΙ` (both Greek) actually stored in `expenses.vendor`. For income rows, `counterparty` is `c.name` (line 32 of the same view) — the client's business name, overwhelmingly likely to contain Greek characters for a Greek CRM's client base. `exportPDF.ts:35,46` prints `r.counterparty` directly into `doc.text(...)` with no transliteration/sanitization step.
- Contrast — the actual house pattern: `grep -rln "jspdf" src/features/contracts` (the location the brief expected) returns **nothing**; jsPDF is used in exactly one file in the whole repo, `exportPDF.ts` itself (`grep -rln "jspdf\|jsPDF" src` → one hit). The real contract/offer/proforma PDF generators live in `api/contract-pdf.ts`, `api/offer-pdf.ts`, `api/proforma-pdf.ts` and all follow the identical pattern: render an HTML template server-side (`api/_contract-pdf-template.ts:132`, `<!doctype html><html lang="el"><head><meta charset="utf-8"/>`, line 135 loads `https://fonts.googleapis.com/css2?family=Inter:...` and line 139 sets `font-family: 'Inter', 'Helvetica Neue', Arial, sans-serif`), then screenshot it to PDF via `puppeteer-core` + `@sparticuz/chromium` (`api/contract-pdf.ts:121-153`, explicitly `await document.fonts.ready` before measuring, per the inline comment "Inter's metrics differ from the fallback"). The `lang="el"` attribute and explicit UTF-8 charset show this pattern was built with Greek rendering as a first-class concern; Google's Inter font has full Greek script coverage. `exportPDF.ts` is architecturally nothing like this — it is the only PDF surface in the codebase built with the client-side jsPDF library instead of the server-side HTML/Chromium pattern, and the only one with zero font-embedding code.

**Refutation attempt:** Considered whether jsPDF v4 (`package.json:35`, `"jspdf": "^4.2.1"`) ships an updated default font with wider Unicode coverage that would make this a non-issue — checked: jsPDF's 4 built-in "standard" fonts are PDF core fonts (a PDF-spec-level concept, not a jsPDF version-specific choice) and have never supported non-WinAnsi glyphs in any jsPDF major version; embedding a custom Unicode TTF via `addFont` has always been required for Greek/Cyrillic/CJK text regardless of version. Considered whether `category_key` (English enum keys like `software`, `salaries`) and numeric/date fields are the only text actually printed, making the Greek risk theoretical — refuted by the `counterparty` field, which is the one column guaranteed to carry real-world Greek business names on both income and expense rows, and which is printed on every single row of both tables (lines 35, 46).

**Verdict: CONFIRMED.** The accounting PDF has no mechanism to render Greek text correctly, unlike every other PDF-producing surface in this codebase. Any Greek client name, vendor name, or service_type value in the exported rows will render with missing/incorrect glyphs.

---

## E29 — [PDF] exportPDF.ts silently truncates each table to the first 40 rows via `.slice(0, 40)` — a hard-coded limit, independent of and easier to trigger than E22/E27's 1000-row ledger cap

**Claim:** Even for date ranges nowhere near Task 4's 1000-row `accounting_ledger_v` cap (E22/E27), `exportPDF.ts` itself drops all but the first 40 income rows and first 40 expense rows it is handed, with zero indication anywhere in the generated file (no "N more rows not shown", no page count, no truncation flag) or in the calling UI that anything was cut.

**Evidence:**
```ts
// exportPDF.ts:33         for (const r of input.incomeRows.slice(0, 40)) {
// exportPDF.ts:44         for (const r of input.expenseRows.slice(0, 40)) {
```
Both loops iterate `.slice(0, 40)` of the full arrays passed in via `PDFInput` — the full `incomeRows`/`expenseRows` length is never read, never compared to 40, and never surfaced. `independent-monthly.json` (this audit's own baseline) shows real single-month paid-income row counts of 368 (2026-06), 301 (2026-07), and 226 (2026-08) — every one of these, if exported as a single month via the ReportPage's `this_month`/`last_month` presets, would have 88-93% of its income rows silently dropped from the PDF with the remaining 40 rows determined solely by `useLedger`'s `.order('event_date', { ascending: false })` (`useLedger.ts:28`) — i.e. only the 40 most recent transactions in the range ever appear, regardless of how many total rows exist.

**Refutation attempt:** Considered whether this is a deliberate, documented "summary PDF, see the CSV for full detail" design choice — found no comment, UI copy, or translation string (`t('export.pdf')` in `ExportMenu.tsx` is just a menu-item label, no caveat text) framing the 40-row cap as intentional; nothing in the file explains the choice of 40, and no "showing 40 of N" text is ever rendered even though the exact total (`input.incomeRows.length`) is trivially available at the point the loop starts. Considered whether typical ranges (e.g. `this_month` early in a month) would usually stay under 40 rows, making this rarely triggered — refuted directly by the live row counts above, which show routine months already 5-9x over the cap.

**Verdict: CONFIRMED.** This is a PDF-specific truncation defect, distinct from and compounding E22/E27's upstream 1000-row ledger cap: even a perfectly-fetched, complete `incomeRows`/`expenseRows` array (well under 1000 total ledger rows) is still cut to 40 rows per side inside `exportPDF.ts` itself, with no user-visible warning.

---

## E30 — [PDF] REFUTED: pending/cancelled/overdue rows do not leak into the PDF — ReportPage pre-filters to paid (or opted-in pending expenses) before handing rows to the export menu

**Claim to test (per the brief):** Because `accounting_ledger_v` carries every status unfiltered (Invariant 1) and `useLedger` (`useLedger.ts:22-29`) fetches with `.select('*')` and no status predicate, the PDF's income/expense row tables might include pending/overdue/cancelled rows as if they were realized transactions, misrepresenting uncollected/unpaid money as actual cash flow.

**Evidence:** `ReportPage.tsx:40-52` computes the exact arrays passed to `ExportMenu` → `downloadPDF`:
```ts
const incomeRows = useMemo(
  () => (ledger.data ?? []).filter((r) => r.direction === 'in' && r.status === 'paid'),
  [ledger.data],
);
const expenseRows = useMemo(
  () =>
    (ledger.data ?? []).filter(
      (r) =>
        r.direction === 'out' &&
        (r.status === 'paid' || (includePendingExpenses && r.status === 'pending')),
    ),
  [ledger.data, includePendingExpenses],
);
```
Income rows are filtered to `status === 'paid'` **only** — `pending`, `overdue`, and `cancelled` deal_payments never reach `incomeRows`, hence never reach the PDF, regardless of any toggle. Expense rows are `paid`, or `pending` only when the user has explicitly flipped the page's `includePendingExpenses` toggle on (default `false`, `ReportPage.tsx:26`) — `expenses.status` has no `overdue`/`cancelled` value at the DB level anyway (Task 1 Invariant 5). `ExportMenu.tsx:40` passes these already-filtered `incomeRows`/`expenseRows` straight through to `downloadPDF` with no further filtering or re-fetching inside `exportPDF.ts` itself (confirmed by the full file read — it only ever reads `input.incomeRows`/`input.expenseRows` as given). The PDF's summary numbers (`input.summary`) come from `usePLSummary`, which independently applies the identical paid-only (income) / paid-or-opted-in-pending (expense) rule (`usePLSummary.ts:66-78`).

**Refutation attempt:** Checked whether the *toggle itself* could be considered "leakage" — i.e., is showing pending expenses in the PDF when the user explicitly asks for them a defect? No: this is an explicit, labeled, opt-in feature (`includePendingExpenses`), not a silent leak; the PDF's own summary numbers and row filtering both honor the same flag consistently, so a PDF exported with the toggle on is internally self-consistent (its total matches its rows), just not "paid-only P&L" by the user's own choice. Checked `deal_payments`-side overdue/cancelled specifically, since those are the two extra statuses that don't exist for expenses — confirmed the `r.status === 'paid'` filter on `incomeRows` has no toggle or override path anywhere that could admit them.

**Verdict: REFUTED.** The specific worry the brief asked Task 5 to check — pending/cancelled/overdue rows silently leaking into the PDF as if realized — does not hold. `ReportPage.tsx`'s pre-filtering is correct and consistent between the row tables and the summary totals. (This does not contradict E22/E29: those are row-*count* truncation bugs on an already-correctly-filtered set, not a status-filtering bug.)

---

## E31 — [PDF] The summary section prints gross-basis totals only — no VAT summary and no net-basis profit line are ever shown, despite the data being available

**Claim:** The owner's stated end goal includes "profit net-basis + VAT summary." The PDF's summary block only ever prints three gross-basis numbers and omits VAT and net-basis profit entirely, even though `PLSummary` (the exact object passed in) already carries every field needed.

**Evidence:**
```ts
// exportPDF.ts:26-29
doc.setFontSize(12);
doc.text(`Income (gross):  EUR ${fmt(input.summary.totalIncomeGross)}`, 14, y); y += 6;
doc.text(`Expense (gross): EUR ${fmt(input.summary.totalExpenseGross)}`, 14, y); y += 6;
doc.text(`Net profit:       EUR ${fmt(input.summary.netProfitGross)}`, 14, y); y += 10;
```
`PLSummary` (`usePLSummary.ts:5-14`) has 8 fields: `totalIncomeNet`, `totalIncomeVat`, `totalIncomeGross`, `totalExpenseNet`, `totalExpenseVat`, `totalExpenseGross`, `netProfitNet`, `netProfitGross`. `exportPDF.ts` reads exactly 3 of the 8 — `totalIncomeGross`, `totalExpenseGross`, `netProfitGross` — and never touches `totalIncomeNet`, `totalIncomeVat`, `totalExpenseNet`, `totalExpenseVat`, or `netProfitNet`. Per-row, only `r.amount_gross` is printed (lines 35, 46) — `r.amount_net`/`r.vat_amount` (both present on `LedgerRow`, `useLedger.ts:8-9`) are never read either. So there is no VAT figure (income VAT, expense VAT, or a VAT summary line) anywhere in the PDF, and the one profit figure shown is gross, not net.

**Refutation attempt:** Considered whether "gross" already functionally equals "net + VAT collected/paid" so showing gross-only is not a meaningful loss — rejected: the owner's requirement explicitly separates "profit net-basis" from "VAT summary" as two distinct things to see, and neither is derivable from the single `netProfitGross` figure without also knowing the VAT split, which is never printed. Also, per Task 1 E5 (expense `vat_rate` is 100% zero live), `totalExpenseVat` would currently print as `€0.00` even if it were included, which is itself informative context the PDF omits — a reader of the current PDF has no way to see that expense VAT tracking is broken from the export alone.

**Verdict: CONFIRMED.** The PDF cannot currently answer "what was our net profit" or "what was the VAT position" — only "what was gross income minus gross expense" — despite both being one field-read away.

---

## E32 — [PDF] No monthly-subtotal or year-total structure exists — the PDF is a flat single-range dump matching whatever preset happens to be selected on screen

**Claim:** The owner's end goal includes "monthly subtotals" and "year totals" in the exported report. `exportPDF.ts` has no grouping/subtotal logic at all — it prints one summary block for the entire selected range and one flat, ungrouped row list per direction.

**Evidence:** The entire generation logic (`exportPDF.ts:16-54`) is: print one title, one `rangeLabel` line, one 3-line summary block, then two flat loops over `incomeRows`/`expenseRows` in whatever order they arrive (`useLedger`'s single `.order('event_date', { ascending: false })`, `useLedger.ts:28` — reverse-chronological, not grouped by month). There is no `groupBy`/`reduce` by `r.period` (the `LedgerRow.period` field, e.g. `'2026-08'`, already exists on every row — `useLedger.ts:7`) anywhere in the file, no per-month subtotal line, and no separate year-total section distinct from whatever range-total the page's current preset happens to compute. `PDFInput` (`exportPDF.ts:5-10`) takes exactly one `summary: PLSummary` — a single aggregate for the whole range, not an array of per-period summaries.
- Practical effect for "monthly subtotals": achievable today only by manually re-running the export once per month (selecting each month as `range` on `ReportPage` and clicking "PDF" each time) — the tool itself performs no monthly rollup.
- Practical effect for "year totals": achievable only by selecting the `this_year` preset, which (a) still produces a single flat row list, not a monthly breakdown, and (b) is itself subject to E22/E27's 1000-row ledger cap (2026's YTD range is already at 1284 rows live) and E29's 40-row-per-side PDF truncation on top of that — so a "year total" PDF today would show a materially wrong total-and-rows combination twice over.

**Refutation attempt:** Considered whether `rangeLabel` (free text, e.g. `"2026-08-01 → 2026-08-31"`) combined with running the export once per month is a reasonable substitute for built-in subtotals — it technically produces the same end data across N files, but requires N manual exports, N filenames, and manual reassembly by the owner; it is not "a report with monthly subtotals," it's N single-month reports the owner would have to combine by hand. This does not change the verdict that the feature itself is absent from the tool.

**Verdict: CONFIRMED.** Monthly subtotals and year totals are absent from the PDF's structure; both would require either (a) the underlying `LedgerRow.period` field to be used for grouping (not currently done) or (b) a separate multi-period aggregation query, neither of which exists in `exportPDF.ts` or its callers today.

---

## E33 — [PDF] Income rows carry a client name but no deal identifier anywhere in the data pipeline that feeds the PDF; expense rows fully satisfy vendor+category — a schema-level gap, not exportPDF-specific

**Claim:** The owner's end goal is "all income lines... with client-deal[,] all expenses... with vendor-category." The expense side is fully met; the income side is only half met — no deal name, deal ID, or any deal-level reference is exposed anywhere between `accounting_ledger_v` and the PDF, only the client's name.

**Evidence:** `accounting_ledger_v`'s income arm (`supabase/migrations/20260717120000_revert_ledger_collection_month.sql:24-38`) selects `c.name as counterparty` (the joined `clients` row) and `dp.service_type as category_key`, from `deal_payments dp join deals d on d.id = dp.deal_id join clients c on c.id = d.client_id` — **`d.id`, `d.title`, or any other `deals` column is never selected**, even though the view already joins the `deals` table (only to reach `client_id`). `LedgerRow` (`useLedger.ts:5-18`), the TypeScript type for every row `exportPDF.ts` receives, has no `deal_id`/`deal_name` field at all — the closest thing is `source_id` (`dp.id`, the payment row's own ID, not the deal's). `exportPDF.ts:35,46` prints `r.category_key ?? '-'` and `r.counterparty ?? '-'` — for an income row this renders as `<service_type>  <client name>`, with no way for a reader of the PDF to tell which of a client's possibly-multiple deals a given payment belongs to.
- Expense side, by contrast, fully satisfies its half of the requirement: `category_key = cat.key` (the expense category, e.g. `software`, `salaries`) and `counterparty = e.vendor` (the vendor name) — exactly "vendor/category" as the owner described it, present on every expense row.

**Refutation attempt:** Considered whether `dp.service_type` (the income `category_key`) could be read as a de facto "deal type" substitute for a deal reference — no: `service_type` describes the kind of billable service (e.g. web-dev/SEO/hosting), which is a property of the *payment line*, not an identifier for *which deal* generated it; two different deals with the same client and same `service_type` would be indistinguishable in the PDF. Confirmed this is upstream of `exportPDF.ts` (the view itself never selects a deal reference) rather than something `exportPDF.ts` or `useLedger.ts` chose to drop — so fixing it requires a ledger-view change, not just an export-code change.

**Verdict: CONFIRMED (income side) / not applicable (expense side, already correct).** "All income lines w/ client-deal" is only half-satisfiable today: client name is present, deal identity is not, anywhere in the pipeline — this is a ledger-view-level gap (shared with the CSV export and the on-screen Income Breakdown, not unique to the PDF), and would need a view change (e.g. also selecting `d.title`/`d.id`) to fix.

---

## E34 — [PDF] exportPDF.ts inherits E22/E27's 1000-row `accounting_ledger_v` cap for wide ranges (cite, not re-derive)

**Claim:** Per the brief's explicit instruction to check whether the PDF export inherits Task 4's E22 finding: it does, exactly as already established by Task 4's own E27, which named `exportPDF.ts` directly.

**Evidence:** Per E27 (`ExportMenu.tsx:16-18,34-40`): both CSV and PDF exports are built directly from `incomeRows`/`expenseRows`, which are `useMemo`-filtered slices of `ledger.data` (`ReportPage.tsx:40-52`), i.e. both exports are fed by `useLedger` (`useLedger.ts:22-29`) and its live 1000-row cap exposure (E22: 2026 YTD range already at 1284 ledger rows, dropping the 284 oldest events in the range once `.order('event_date', { ascending: false })` is applied). No new evidence was gathered in this task beyond confirming, via the full read of `exportPDF.ts` and its one callsite (`ExportMenu.tsx:40`), that nothing between `useLedger` and the PDF's row loop re-fetches, paginates, or checks the returned row count — `downloadPDF`'s `PDFInput.incomeRows`/`expenseRows` are exactly what `ReportPage.tsx` computed from `ledger.data`, unmodified except for the status filter (E30) and jsPDF's own additional 40-row truncation (E29).

**Refutation attempt:** N/A — this is a citation of an already-CONFIRMED finding (E27), scoped here only to record that Task 5's independent file-by-file read of `exportPDF.ts`/`ExportMenu.tsx` corroborates it rather than finding any mitigation (e.g. no `.range()` call, no row-count guard, no truncation banner was added anywhere in the export path).

**Verdict: CONFIRMED (via E27, corroborated).** A wide-range PDF export today is exposed to two independent, stacking truncations: E22/E27's upstream 1000-row ledger cap (silently drops the oldest rows in the selected range once the range exceeds 1000 total ledger rows) and E29's downstream 40-row-per-side cap inside `exportPDF.ts` itself (drops all but the 40 most recent rows of whatever `useLedger` did return). Either one alone would already make "all income/all expenses" false for a busy month or a YTD/custom wide range; together, a wide-range PDF export can be showing as little as 40 of well over a thousand real rows with no on-screen or in-file indication of either cut.

---

