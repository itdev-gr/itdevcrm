# Income/expense reporting (hardened 2026-08-27)

Fixes from `docs/system-analysis/2026-08-27-expenses-reporting-audit.md` —
the goal is that reported numbers can never silently truncate again.

## The rules

1. **Summaries are computed in the database, never in the browser.**
   `usePLSummary` calls `pl_summary_for_range(p_from, p_to, p_include_pending_expenses)`
   (migration `20260827150000`) — an SQL aggregate cannot be row-capped. The
   rule it encodes: income counts `paid` rows only, always; expenses count
   `paid` plus (opt-in) `pending`. Verified cent-exact against
   `accounting_pl_summary_v` per month at deploy.
2. **Row lists are drained with `fetchAllPages`** (`src/lib/fetchAllPages.ts`):
   every reporting/dashboard hook that materializes rows client-side
   (`useLedger`, `useMRR`, `useContractedMRR`, `useDashboardLeads`,
   `useDashboardDeals`) pages through PostgREST's 1000-row cap with a
   deterministic order + tiebreaker. **Never add an unranged `.select()` to a
   reporting surface** — route it through `fetchAllPages` or an RPC.
3. **`accounting_ledger_v`** carries `deal_id` + `deal_code` (appended columns,
   income arm) so exports can show deal identity. `security_invoker=true` must
   be restated on every future `create or replace view` of it.
4. **Expenses month filter** matches the ledger's attribution: paid rows by
   `paid_at`, unpaid by `start_date` (one `.or()` filter in `useExpenses`).
5. **Expense chains are guarded in the database**: duplicate recurring periods
   (vendor+billing+start) are silently skipped on insert
   (`expenses_skip_duplicate_period`); editing `amount_net`/`vat_rate` on a
   recurring row propagates to the chain's FUTURE pending periods
   (`expenses_propagate_amount_forward`).

## The PDF

`api/report-pdf.ts` + `api/_report-pdf-template.ts` — same Chromium+webfont
pattern as contract/offer/proforma PDFs (raw jsPDF cannot render Greek; the
old `exportPDF.ts` was deleted and `jspdf` removed from deps). Properties:

- **Explicit admin gate** (`profiles.is_admin`), deliberately NOT inherited
  from RLS: `deal_payments` RLS is readable by non-admin roles, so RLS
  inheritance would produce a silently half-empty document (income populated,
  expenses denied) instead of a 403.
- Complete paged data fetch server-side; cent-safe integer accumulation.
- Sections: per-month income lines (date, client, deal code · service,
  status, net/VAT/gross) and expense lines (vendor, category), monthly
  subtotals, period totals, net-basis profit + VAT summary.
- Streams back as a download; financials are never written to storage.
- Trigger: Report page → Εξαγωγή → Λήψη PDF (honors the pending-expenses
  toggle via `includePending`).

## Known data caveats the code cannot fix (owner decisions, section C of the audit)

103 pending expenses (€57k, mostly the 2026-08-03 bulk import) are invisible
to the paid-only P&L until reconciled; all expenses carry `vat_rate=0`; 13
dateless pending payment rows are invisible to month grouping.
