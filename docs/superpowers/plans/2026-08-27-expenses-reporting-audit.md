# Expenses & Income/Expense Reporting Full Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A complete, evidence-backed audit of the expenses pipeline and every income/expense reporting surface (ledger view, P&L view, Report/Expenses pages, dashboard, the existing PDF export) — every bug found and verified, ending in an owner-facing report that says exactly what must be fixed before the end goal: a trustworthy downloadable PDF with all income, expenses and profit.

**Architecture:** Read-only audit, same machinery as the 2026-08-26 payment audit: each task probes one layer with exact SQL against prod plus a code read of the governing view/hook/component, records findings in a shared findings file with mandatory refutation attempts, and a synthesis task merges everything into `docs/system-analysis/2026-08-27-expenses-reporting-audit.md`. The report's final section is the concrete spec for the full-financials PDF (what exists in `exportPDF.ts` today, what it must become, and which fixes gate it).

**Tech Stack:** Node scratchpad scripts → Supabase Management API `POST /v1/projects/xujlrclyzxrvxszepquy/database/query` (token `scratchpad/sbp.token`, `User-Agent: supabase-cli/2.30.4`); repo: `supabase/migrations/`, `src/features/accounting_report/` (ReportPage, ExpensesPage, hooks/useLedger, hooks/usePLSummary, utils/exportPDF.ts), `src/features/dashboard/hooks/useDashboardData.ts`; jspdf ^4.2.1 already a dependency (contracts PDF is the house pattern).

## Global Constraints

- **READ-ONLY on prod.** Every query is a SELECT. No writes of any kind regardless of findings; fixes are a follow-up plan.
- Management API statement timeout ~8s — date-bound anything touching email_log/activity_log; expenses (135 rows) and deal_payments (~1.2k) are small, full scans fine.
- Findings accumulate in `<sdd-workspace>/audit-findings.md` as `## E<N>` blocks (E1, E2, …): claim, evidence (query + live numbers, dated), refutation attempt, verdict CONFIRMED / REFUTED / NEEDS-OWNER. E-numbers, not F-numbers — the payment audit owns F1–F48.
- **Do not re-derive the 2026-08-26 payment audit.** Its report (`docs/system-analysis/2026-08-26-payment-system-audit.md`) and evidence (`...-audit-findings.md`, F1–F48) already settled the revenue side: income source of truth is `deal_payments`; `accounting_ledger_v`/`accounting_pl_summary_v` are plain views (F46 — cannot drift, but underlying rows are mutable/deletable = B2); cancelled is a legitimate status the revenue side must exclude; the A0 VAT fix landed 2026-08-26 (migration 20260826150000). Cross-reference; only re-measure where this audit's scope genuinely overlaps (month attribution — old A8 — was never re-measured and belongs HERE).
- Live facts at planning time (2026-08-27): `expenses` has **135 rows, 2025-08-01→2026-09-02, €82,739.06 net — only 32 paid; 103 pending** (71 one_time pending €39,940.28, 31 recurring_monthly pending €16,885.38, 1 recurring_yearly pending). Whether "pending" expenses count in the P&L is the single most consequential question of this audit. Cron `daily_ensure_recurring_expenses` runs 02:05 UTC.
- Every number in findings carries its measurement date. Every CONFIRMED bug names the function/file that causes it.

---

### Task 1: Inventory + drift check of the expense/reporting layer

**Files:**
- Create: `scratchpad/eaudit-01-inventory.mjs`
- Read: `supabase/migrations/20260601000006_accounting_ledger_view.sql`, `20260717120000_revert_ledger_collection_month.sql`, `20260803130000_ledger_security_invoker_and_realtime.sql`, `20260707000000_expenses_autopay.sql`, the migration defining `ensure_recurring_expenses` (locate: `grep -riln "ensure_recurring_expenses" supabase/migrations | sort`), `docs/tech/accounting/billing-model.md` (ledger section)

**Interfaces:**
- Produces: `<sdd-workspace>/audit-findings.md` (created, `# Findings` header, E-blocks from E1), `<sdd-workspace>/audit-baseline.json` (view definitions, expense stats, cron health, md5s of `ensure_recurring_expenses` + both view defs).

- [ ] **Step 1: Pull the live definitions.**

```sql
select viewname, definition from pg_views
 where schemaname = 'public' and viewname in ('accounting_ledger_v','accounting_pl_summary_v');
select md5(pg_get_functiondef(p.oid)) from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname='public' and p.proname='ensure_recurring_expenses';
```

Compare each against its latest repo migration (case-insensitive grep — the payment audit hit a case-sensitivity trap). Record MATCHES-REPO / DRIFTED per object.

- [ ] **Step 2: Answer the load-bearing question from the view text itself:** which `expenses.status` values and which `deal_payments.status` values does the ledger include, on which date column is each row attributed to a month, and in which timezone does that date land? Write the answers as explicit invariants in the findings file — every later task tests against them.

- [ ] **Step 3: Baseline snapshot** (to `audit-baseline.json`): expenses by status/billing_type/category with sums; `expense_categories` list + orphaned `category_id`s; cron health last 7 runs of `daily_ensure_recurring_expenses`; count + date range of ledger rows by direction/status.

- [ ] **Step 4: Record doc-vs-live contradictions** as E-blocks (e.g. if `billing-model.md`'s ledger section describes statuses or month attribution differently from the live view). No commit (workspace artifacts only).

---

### Task 2: Expenses pipeline audit — does every expense flow correctly?

**Files:**
- Create: `scratchpad/eaudit-02-expenses.mjs`
- Read: the `ensure_recurring_expenses` migration body; `src/features/accounting_report/ExpensesPage.tsx` (how expenses are created/marked paid); `20260707000000_expenses_autopay.sql`

**Interfaces:**
- Consumes: Task 1's invariants (which statuses the ledger counts).
- Produces: E-blocks tagged `[EXPENSES]`.

- [ ] **Step 1: The 103 pending question.** Classify every pending expense:

```sql
select billing_type,
       count(*) filter (where end_date < current_date) as past_due,
       count(*) filter (where end_date >= current_date or end_date is null) as current_or_future,
       min(start_date)::text as oldest_start,
       sum(amount_net) filter (where end_date < current_date)::numeric(12,2) as past_due_net
from public.expenses where status = 'pending' group by 1;
select vendor, billing_type, amount_net::text, start_date::text, end_date::text, autopay, parent_expense_id is not null as is_child
from public.expenses where status = 'pending' and start_date < current_date - 60
order by start_date limit 40;
```

Then determine the intended workflow from ExpensesPage.tsx (is there a mark-paid button? does autopay auto-mark anything paid — read the autopay migration): is "pending forever" a data-entry gap (staff never mark paid), a workflow gap (nothing to mark them paid), or intended (pending = committed expense counted anyway)? The verdict depends on Task 1's invariant: if the ledger counts pending expenses, stale pendings inflate costs; if it counts only paid, 103 unpaid rows mean the P&L is missing most real expenses. Either way quantify the € distortion.

- [ ] **Step 2: Recurring expense generator.** Read the live body; test its behavior mirrors `ensure_recurring_payments`'s known traps (all previously found on the revenue side — check each on the expense side):

```sql
-- chains and their heads
select vendor, billing_type, count(*) as periods, max(end_date)::text as chain_end,
       count(*) filter (where status='pending') as pending_periods
from public.expenses where billing_type like 'recurring%' group by 1,2 order by 1;
-- duplicate periods (same vendor+start)
select vendor, start_date, count(*) from public.expenses
 where billing_type like 'recurring%' group by 1,2 having count(*) > 1;
-- gaps: consecutive periods that don't touch
select a.vendor, a.end_date::text as prev_end, min(b.start_date)::text as next_start
from public.expenses a join public.expenses b
  on b.vendor = a.vendor and b.billing_type = a.billing_type and b.start_date > a.start_date
where a.billing_type like 'recurring%'
group by a.id, a.vendor, a.end_date
having min(b.start_date) > a.end_date;
```

Also: does the generator copy `amount_net` forward (price-drift trap = revenue A7), does it skip some status, does it stop when a parent is deleted, and what does `parent_expense_id` actually chain (verify with a real chain's rows)?

- [ ] **Step 3: Field integrity.** `vat_amount`/`amount_gross`: generated columns or manually written? (information_schema `is_generated`). If manual: count rows where `amount_gross <> round(amount_net * (1 + vat_rate/100), 2)` and where `vat_amount` disagrees — every mismatch is a wrong number in the P&L. Also: negative/zero amounts, `end_date < start_date`, orphan `category_id`, `receipt_path`s pointing at nothing (storage check is out of scope — just count nulls vs set), future-dated rows (the 2026-09-02 row — legitimate prepaid?).

- [ ] **Step 4: Verdicts with refutation attempts** (e.g., a stale pending might be a genuinely unpaid bill — check `autopay` and vendor patterns before calling it rot).

---

### Task 3: Ledger & P&L views — is the math right?

**Files:**
- Create: `scratchpad/eaudit-03-views.mjs`
- Read: the live view definitions captured in Task 1; `supabase/migrations/20260717120000_revert_ledger_collection_month.sql` (why collection-month attribution was reverted — the header explains the chosen attribution rule)

**Interfaces:**
- Consumes: Task 1 invariants.
- Produces: E-blocks tagged `[VIEWS]`, plus `<sdd-workspace>/independent-monthly.json` — an independently recomputed month-by-month P&L that Tasks 4 and 5 compare frontend numbers against.

- [ ] **Step 1: Recompute the P&L independently, month by month,** straight from `deal_payments` + `expenses` using ONLY Task 1's stated invariants (statuses + date column + timezone), NOT the view:

```sql
-- income side (adapt status/date column to Task 1's invariants)
select to_char(date_trunc('month', <attribution_date>), 'YYYY-MM') as month,
       sum(amount_net)::numeric(12,2) as net, sum(amount_net * vat_rate/100)::numeric(12,2) as vat
from public.deal_payments where status = '<counted status(es)>' group by 1 order by 1;
-- expense side, same shape from public.expenses
```

Then pull the same months from `accounting_ledger_v` / `accounting_pl_summary_v` and diff. **Any non-zero diff is a finding** — trace it to the exact rows.

- [ ] **Step 2: Timezone / month-boundary check (old A8, never re-measured — this audit owns it).** Count rows whose attribution date lands in a different month under UTC vs Europe/Athens (`date_trunc('month', d) <> date_trunc('month', d at time zone 'Europe/Athens')` — adapt to the actual column type: if it's a `date`, check instead how the writing code derives it from timestamps). Quantify: how many € move months if the boundary is wrong, worst month.

- [ ] **Step 3: Status semantics.** Does the ledger exclude `cancelled` payments (93 exist)? Does it include `overdue` (113) as income? Are pending expenses counted symmetrically with pending income? Asymmetry (e.g. income only when paid, expenses also when pending) makes "profit" structurally wrong — state the exact rule and verdict whether it's coherent.

- [ ] **Step 4: VAT basis.** Net vs gross consistency: profit should be net-basis (VAT is pass-through). Verify `accounting_pl_summary_v` doesn't mix (e.g. income net vs expense gross). Check the Cyprus/UAE 0% rows and the 19 known wrong-VAT paid rows (A0, still owner-gated) flow through visibly.

- [ ] **Step 5: Verdicts.** Also record (no re-derivation — cite F46/B2) that view correctness ≠ data trustworthiness: the mutation/deletion exposure underneath is already B2.

---

### Task 4: Frontend reporting surfaces — Report page, Expenses page, dashboard

**Files:**
- Create: `scratchpad/eaudit-04-frontend.md` (this task is mostly code reading; scripts only for cross-checks)
- Read: `src/features/accounting_report/ReportPage.tsx`, `ExpensesPage.tsx`, `components/` (all files), `hooks/useLedger.ts`, `hooks/usePLSummary.ts` (+ their tests), `utils/` (all files), `src/features/dashboard/hooks/useDashboardData.ts`, `src/app/router.tsx:280-300` (route gates)

**Interfaces:**
- Consumes: `independent-monthly.json` from Task 3.
- Produces: E-blocks tagged `[FRONTEND]`.

- [ ] **Step 1: usePLSummary correctness.** The hook re-aggregates ledger rows client-side ("replicate accounting_pl_summary_v's aggregation"). Verify: (a) it fetches ALL rows (supabase-js default caps at 1000 — with how many ledger rows live? if >1000 the summary silently undercounts — compute the live row count); (b) Number() coercion handles null; (c) its status filtering matches the view's. Same for useLedger: pagination, filters, ordering.

- [ ] **Step 2: Month filtering in the UI.** How do ReportPage/dashboard build month boundaries — `new Date()` local time, UTC strings, or date-only? Does the client month match the view's month attribution (Task 3 Step 2)? A client/server mismatch double-shows or hides boundary rows.

- [ ] **Step 3: Permission gates.** Who can open /report and /expenses (router + any in-component gates)? The old audit's A8 flagged frontend permission gaps — is income data reachable by non-admin roles the owner doesn't expect? List role→visibility.

- [ ] **Step 4: Numeric cross-check.** For 2-3 sample months, compare what usePLSummary/useLedger WOULD compute (replicate their exact filter+aggregation in SQL) against `independent-monthly.json`. Diff = finding.

- [ ] **Step 5: Verdicts.**

---

### Task 5: The existing PDF export — what it prints today

**Files:**
- Create: `scratchpad/eaudit-05-pdf.md`
- Read: `src/features/accounting_report/utils/exportPDF.ts` (entire file) + every callsite (`grep -rn "exportPDF" src`), the contracts PDF generator for the house style (`grep -rln "jspdf" src/features/contracts` and read the main generator file found)

**Interfaces:**
- Consumes: Task 4's findings on the hooks feeding it; `independent-monthly.json`.
- Produces: E-blocks tagged `[PDF]` + a factual capability map: what the current PDF contains, what data feeds it, what's missing vs the owner's end goal ("όλα τα έσοδα, έξοδα, πόσα έχουμε βγάλει και όλα τα info").

- [ ] **Step 1: Read exportPDF.ts + callsites.** Record: trigger (which button/page), scope (month? range? all-time?), sections (income lines? expense lines? totals? VAT? profit?), data source (same hooks as the page → inherits every Task 4 bug), formatting (Greek text rendering in jspdf needs a Unicode font — does it embed one, or does Greek come out as garbage/latinized?), filename, and whether pending/cancelled rows leak in.
- [ ] **Step 2: Gap analysis vs the end goal.** Table: owner requirement → present today yes/no → blocked by which E-finding. Requirements: all income (per payment, with client/deal), all expenses (per expense, with vendor/category), monthly subtotals, year totals, net profit (net basis + VAT summary), period selection, Greek text correct, admin-gated.
- [ ] **Step 3: Verdicts** — each PDF defect is an E-block like any other.

---

### Task 6: Synthesis — the report the owner reads

**Files:**
- Create: `docs/system-analysis/2026-08-27-expenses-reporting-audit.md`
- Consume: `<sdd-workspace>/audit-findings.md` (all E-blocks), `audit-baseline.json`, `independent-monthly.json`, the 2026-08-26 payment audit for cross-references

**Interfaces:**
- Produces: the final deliverable; nothing downstream.

- [ ] **Step 1: Write the report:** (1) confirmed bugs ranked by how much they distort the reported numbers (€ first), each with what happens / root cause (file or view) / dated evidence / one-line fix direction; (2) the independently recomputed month-by-month P&L table with a "trustworthy today: yes/no per month" column; (3) owner decisions (policy, not bugs — e.g. should pending expenses count, what to do with 103 pendings); (4) **the PDF roadmap**: exact spec for the full-financials PDF (sections, data source, period selection, Greek font via the contracts-PDF pattern, admin gate), with an explicit ordered list "fix these E-numbers first, then build" — the build itself is the follow-up plan, not this one.
- [ ] **Step 2: Self-review** against this plan: every task's E-blocks represented; no REFUTED item presented as a bug; every € figure dated; the PDF section answers the owner's end goal concretely.
- [ ] **Step 3: Commit the report** (report file only):

```bash
git add docs/system-analysis/2026-08-27-expenses-reporting-audit.md
git commit -m "docs(accounting): 2026-08-27 expenses & reporting audit report"
```

Then archive the findings file next to it (`docs/system-analysis/2026-08-27-expenses-reporting-audit-findings.md`, second commit), update the `payment-fix-backlog` memory with a pointer, and present the top findings + the PDF roadmap to the owner in Greek.
