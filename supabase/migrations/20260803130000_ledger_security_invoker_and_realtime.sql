-- Audit 2026-08-03 (docs/superpowers/plans/2026-08-03-income-expenses-audit.md), two proven defects:
--
-- 1) accounting_ledger_v / accounting_pl_summary_v run as OWNER: the 2026-07-17
--    revert (20260717120000) recreated the ledger view without security_invoker,
--    and the P&L view never had it. Verified live 2026-08-03: the sales role
--    (testsales) reads the FULL ledger (1022 rows incl. all expenses) and the
--    monthly P&L through the views, while direct `expenses` access is correctly
--    denied. Invoker views close the leak; the Report/Expenses pages are
--    admin-routed, and admins pass the underlying RLS, so no UI regression.
--
-- 2) `expenses` was never added to the supabase_realtime publication, so
--    useExpensesRealtime has been dead since 2026-06 (verified live: expense
--    events do not arrive; deal_payments events do).
--
-- NOT included (owner decisions pending): tightening deal_payments SELECT RLS
-- (sales currently reads all 931 rows directly) and filtering archived deals
-- out of the ledger view.

alter view public.accounting_ledger_v set (security_invoker = true);
alter view public.accounting_pl_summary_v set (security_invoker = true);

alter publication supabase_realtime add table public.expenses;

-- ROLLBACK:
-- alter view public.accounting_ledger_v set (security_invoker = false);
-- alter view public.accounting_pl_summary_v set (security_invoker = false);
-- alter publication supabase_realtime drop table public.expenses;
