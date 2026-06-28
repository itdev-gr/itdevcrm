-- =============================================================================
-- Audit PERF: add covering indexes for unindexed foreign keys (39 flagged) and
-- pin search_path on the 15 functions flagged function_search_path_mutable.
-- Both additive / low-risk. CREATE INDEX IF NOT EXISTS is idempotent.
-- =============================================================================

-- ── Covering indexes for every single-column FK lacking a leading-column index ──
do $$
declare r record; idx_name text;
begin
  for r in
    select c.conrelid::regclass as tbl,
           (select attname from pg_attribute where attrelid = c.conrelid and attnum = c.conkey[1]) as col
      from pg_constraint c
     where c.contype = 'f'
       and c.connamespace = 'public'::regnamespace
       and array_length(c.conkey, 1) = 1
       and not exists (
         select 1 from pg_index i
          where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1]
       )
  loop
    idx_name := 'idx_' || replace(r.tbl::text, 'public.', '') || '_' || r.col;
    execute format('create index if not exists %I on %s (%I)', left(idx_name, 63), r.tbl, r.col);
  end loop;
end $$;

-- ── Pin search_path on the flagged functions ────────────────────────────────
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = any (array[
         'set_updated_at','generate_lead_code','guard_payment_method_before_stage_move',
         'deal_payments_set_updated_at','offers_set_number','contracts_set_number',
         'leads_set_default_stage','generate_job_code','set_job_code','job_service_abbr',
         'format_intake_merge_block','build_lead_info_block','email_setting_department',
         'target_accounting_stage','deal_next_due'])
  loop
    execute format('alter function %s set search_path = public', r.sig);
  end loop;
end $$;

-- =============================================================================
-- CHANGES / REVERT
--   + covering indexes idx_<table>_<col> on unindexed FKs; + search_path=public on 15 fns.
-- ROLLBACK: drop the idx_* indexes created here; `alter function ... reset search_path` on the 15.
-- =============================================================================
