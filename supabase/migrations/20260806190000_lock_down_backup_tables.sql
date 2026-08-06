-- =============================================================================
-- Lock down the one-off backup tables left in `public` (2026-08-06)
--
-- APPLIED to prod 2026-08-06. Before -> after, over the 78 backup tables:
--   RLS disabled                    20 -> 0
--   SELECT-able by `authenticated`  15 -> 0
--   SELECT-able by `anon`            0 -> 0
--   tables present                  78 -> 78   (nothing dropped)
--
-- Verified after applying:
--   * backup rows still readable to the owner / service_role (spot-checked
--     jobs_aiseo_convert_backup_20260806: 10 rows) — the audit trail is intact,
--     RLS is not FORCEd so the table owner still bypasses it;
--   * no real table touched: 56 of 58 non-backup tables still granted to
--     `authenticated`, and the two that are not (seo_onboarding_config,
--     task_summary_outbox) do not match this migration's name pattern and were
--     already server-side-only with RLS on and zero policies;
--   * 0 non-backup tables without RLS, unchanged;
--   * public.jobs still answers normally (680 live rows).
--
-- Side benefit: the next `npm run types:gen` will drop the 67 backup-table
-- entries from src/types/supabase.ts, since they are no longer exposed to the
-- API. Nothing references those types (`grep -rn "_backup" src api` is empty
-- outside the generated file), so that shrink is safe.
--
-- WHY. A full scan on 2026-08-06 found 78 of the 136 tables in `public` are
-- one-off `*_backup_*` / `*_<date>` snapshots taken during data repairs — 14 MB,
-- ~127k rows. 20 of them have RLS DISABLED, and 10 of those are SELECT-able by
-- the `authenticated` role. Because they live in `public`, PostgREST publishes
-- them at /rest/v1/<table>, so ANY logged-in user can read them straight over
-- the API — bypassing every RLS policy and permission gate that guards the real
-- tables they were copied from.
--
-- The 10 currently readable (read live 2026-08-06):
--   comments_reparent_backup_20260709          deals_aiseo_convert_backup_20260806
--   deal_000403_service_change_backup_20260804 email_dept_mkif_retag_backup_20260710
--   deal_payments_domain_expiry_backup_20260805 email_outbox_stagelock_backup_20260702
--   email_templates_dropped_backup_20260702    jobs_aiseo_convert_backup_20260806
--   jobs_onboarded_backfill_backup_20260702    jobs_web_dev_info_backfill_backup_20260715
--
-- Between them these carry full deal rows (client ids, amounts, sales notes),
-- job rows, comment bodies and email content.
--
-- The cause is `create table <backup> as select ...`, which does NOT inherit RLS
-- and leaves the default grants in place. The other 58 backups already have RLS
-- on, so this restores the majority behaviour rather than inventing a new rule.
-- (Two of the ten were created by this session's own repairs and have the same
-- defect — same cause.)
--
-- ZERO FUNCTIONALITY IMPACT. Verified before writing: `grep -rn "_backup" src api`
-- returns nothing outside the generated `src/types/supabase.ts`. No frontend
-- query, no Vercel function and no other database object reads any backup table.
-- Enabling RLS with NO policies denies all access to `anon` and `authenticated`
-- while leaving `service_role` and SECURITY DEFINER functions untouched, so the
-- rows stay fully available for audit and rollback exactly as today.
--
-- Deliberately NOT dropping anything. These are the rollback trail for past data
-- repairs; the point here is to stop them being readable over the API, not to
-- lose them.
--
-- Written to match whatever is actually present at run time rather than a
-- hard-coded list, so it stays correct if more snapshots appear before it runs.
-- =============================================================================

-- Counted live 2026-08-06 immediately before applying: 78 backup tables, 20 with
-- RLS off, 15 still holding a SELECT grant for `authenticated`, 0 for `anon`.
-- The 15 is wider than the 20-with-RLS-off set: five already have RLS on (so
-- they deny in practice) but kept the grant from `create table as`. Both are
-- swept here — enable RLS wherever it is off, and drop the grants everywhere.
do $$
declare
  r record;
  n_rls int := 0;
  n_rev int := 0;
begin
  for r in
    select c.oid::regclass as tbl, c.relrowsecurity as has_rls
      from pg_class c
      join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public'
       and c.relkind = 'r'
       and (c.relname ~ '_backup_[0-9]{8}$'
         or c.relname ~ '_backup$'
         or c.relname ~ '_[0-9]{8}$')
  loop
    if not r.has_rls then
      execute format('alter table %s enable row level security', r.tbl);
      n_rls := n_rls + 1;
    end if;
    execute format('revoke all on table %s from anon, authenticated', r.tbl);
    n_rev := n_rev + 1;
  end loop;
  raise notice 'enabled RLS on % table(s), revoked grants on %', n_rls, n_rev;
end $$;

-- Verification (expect 0 rows):
--   select c.relname
--     from pg_class c join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public' and c.relkind = 'r'
--      and (c.relname ~ '_backup_[0-9]{8}$' or c.relname ~ '_backup$' or c.relname ~ '_[0-9]{8}$')
--      and (not c.relrowsecurity
--        or has_table_privilege('authenticated', c.oid, 'SELECT')
--        or has_table_privilege('anon', c.oid, 'SELECT'));
--
-- ROLLBACK (only if something unexpectedly needs to read one):
--   alter table public.<name> disable row level security;
--   grant select on public.<name> to authenticated;
