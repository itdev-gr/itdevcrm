-- =============================================================================
-- SECURITY HARDENING — close the over-broad default grants found in the
-- 2026-06-28 codebase audit. All REVERSIBLE (re-GRANT to roll back), no data loss.
--   C1: leftover backup tables are SELECT-able by anon (RLS off) -> revoke + RLS.
--   H1: ~20 SECURITY DEFINER trigger/cron helpers are EXECUTE-able by anon/PUBLIC
--       with no auth guard -> revoke from public/anon/authenticated. (Cron runs as
--       postgres, triggers run as table owner, so role grants are irrelevant to them.)
--       The app calls NONE of these directly (verified vs every .rpc() call site);
--       ensure_job_monthly_task_period IS app-called and is deliberately EXCLUDED.
--   M4: user_effective_permissions SECURITY DEFINER view is anon-readable -> revoke anon.
-- =============================================================================

-- ── C1: backup / one-off staging tables -> revoke API access + enable RLS ────
do $$
declare r record;
begin
  for r in
    select tablename from pg_tables
     where schemaname = 'public'
       and (tablename ~* 'backup|resweep'
            or tablename in ('deal_payments_hosting_yearly_20260622',
                             'deal_payments_service_backfill_20260622',
                             'deal_payments_service_fix_20260622'))
  loop
    execute format('revoke all on public.%I from anon, authenticated', r.tablename);
    execute format('alter table public.%I enable row level security', r.tablename);
  end loop;
end $$;

-- ── H1: revoke EXECUTE on internal trigger/cron helper functions ─────────────
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = any (array[
         'enqueue_lead_email','enqueue_payment_reminders','process_email_sequences',
         'mark_overdue_payments','reconcile_block_lifecycle','move_overdue_deals_to_on_hold',
         'release_jobs_for_deal','release_deal_jobs','release_billing_jobs_for_deal',
         'block_deal_jobs','ensure_recurring_payments','ensure_recurring_payments_v2',
         'seed_deal_payments','generate_payments_for_deal','seed_deal_jobs_and_payments',
         'distribute_unassigned_leads','pick_next_sales_assignee','apply_intake_merge',
         'ensure_recurring_expenses','run_monthly_task_reset'])
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;

-- ── M4: stop anon from reading the effective-permissions matrix ──────────────
revoke all on public.user_effective_permissions from anon;

-- =============================================================================
-- CHANGES / REVERT
--   Revoked anon/authenticated table grants + enabled RLS on backup tables;
--   revoked execute on 20 internal helper functions; revoked anon on the perms view.
--
-- ROLLBACK (restore prior state):
--   -- backup tables: re-grant + disable RLS
--   do $$ declare r record; begin
--     for r in select tablename from pg_tables where schemaname='public'
--       and (tablename ~* 'backup|resweep'
--            or tablename in ('deal_payments_hosting_yearly_20260622',
--                             'deal_payments_service_backfill_20260622',
--                             'deal_payments_service_fix_20260622')) loop
--       execute format('alter table public.%I disable row level security', r.tablename);
--       execute format('grant select on public.%I to anon, authenticated', r.tablename);
--     end loop; end $$;
--   -- functions: re-grant execute to public
--   do $$ declare r record; begin
--     for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--       where n.nspname='public' and p.proname = any(array['enqueue_lead_email','enqueue_payment_reminders',
--         'process_email_sequences','mark_overdue_payments','reconcile_block_lifecycle','move_overdue_deals_to_on_hold',
--         'release_jobs_for_deal','release_deal_jobs','release_billing_jobs_for_deal','block_deal_jobs',
--         'ensure_recurring_payments','ensure_recurring_payments_v2','seed_deal_payments','generate_payments_for_deal',
--         'seed_deal_jobs_and_payments','distribute_unassigned_leads','pick_next_sales_assignee','apply_intake_merge',
--         'ensure_recurring_expenses','run_monthly_task_reset']) loop
--       execute format('grant execute on function %s to public', r.sig); end loop; end $$;
--   grant all on public.user_effective_permissions to anon;
-- =============================================================================
