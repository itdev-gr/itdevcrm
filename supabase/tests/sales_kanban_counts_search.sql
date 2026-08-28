-- supabase/tests/sales_kanban_counts_search.sql
-- Run with: supabase test db  (transactional; rolls back)
-- The kanban column totals must find a lead by its code / business profile /
-- VAT — the same columns the browser's searchOrClause() matches
-- (src/features/sales/salesKanbanColumns.ts KANBAN_SEARCH_COLUMNS).
begin;
select plan(6);

do $$
declare v_stage uuid;
begin
  select id into v_stage from public.pipeline_stages
   where board = 'sales' and code = 'new_lead' limit 1;
  perform set_config('t.stage', v_stage::text, true);

  -- Capture pre-insert totals so the assertions below tolerate pre-existing
  -- leads that happen to match these search terms (delta, not absolute count).
  perform set_config('t.before_code', coalesce((
    select total from public.sales_kanban_counts(null, null, 'TSRCH1', 'sales')
     where stage_id = v_stage), 0::bigint)::text, true);
  perform set_config('t.before_partial', coalesce((
    select total from public.sales_kanban_counts(null, null, 'srch', 'sales')
     where stage_id = v_stage), 0::bigint)::text, true);
  perform set_config('t.before_profile', coalesce((
    select total from public.sales_kanban_counts(null, null, 'Zebra', 'sales')
     where stage_id = v_stage), 0::bigint)::text, true);
  perform set_config('t.before_vat', coalesce((
    select total from public.sales_kanban_counts(null, null, 'EL999888777', 'sales')
     where stage_id = v_stage), 0::bigint)::text, true);

  insert into public.leads (title, source, stage_id, code, business_profile_name, vat_number)
  values ('TEST search by code', 'manual', v_stage, 'TSRCH1', 'Test Profile Zebra', 'EL999888777');
end $$;

select is(
  (select coalesce((select total from public.sales_kanban_counts(null, null, 'TSRCH1', 'sales')
    where stage_id = current_setting('t.stage')::uuid), 0::bigint)),
  current_setting('t.before_code')::bigint + 1, 'search by full lead code counts the lead');

select is(
  (select coalesce((select total from public.sales_kanban_counts(null, null, 'srch', 'sales')
    where stage_id = current_setting('t.stage')::uuid), 0::bigint)),
  current_setting('t.before_partial')::bigint + 1, 'search by partial, case-insensitive code counts the lead');

select is(
  (select coalesce((select total from public.sales_kanban_counts(null, null, 'Zebra', 'sales')
    where stage_id = current_setting('t.stage')::uuid), 0::bigint)),
  current_setting('t.before_profile')::bigint + 1, 'search by business_profile_name counts the lead');

select is(
  (select coalesce((select total from public.sales_kanban_counts(null, null, 'EL999888777', 'sales')
    where stage_id = current_setting('t.stage')::uuid), 0::bigint)),
  current_setting('t.before_vat')::bigint + 1, 'search by vat_number counts the lead');

select is(
  (select coalesce((select total from public.sales_kanban_counts(null, null, 'NOPE-ZZZ-404', 'sales')
    where stage_id = current_setting('t.stage')::uuid), 0::bigint)),
  0::bigint, 'a term matching nothing counts nothing');

select is(
  (select coalesce((select total from public.sales_kanban_counts(null, null, 'TSRCH1', 'under_development')
    where stage_id = current_setting('t.stage')::uuid), 0::bigint)),
  0::bigint, 'the under_development board is unaffected by a sales-stage match');

select * from finish();
rollback;
