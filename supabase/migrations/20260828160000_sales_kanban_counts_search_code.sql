-- 2026-08-28: Sales kanban search could not find a lead by its code.
-- Typing "006250" (the code printed on every card) into the board's search
-- box showed nothing: neither the browser's PostgREST or= clause
-- (src/features/sales/salesKanbanColumns.ts) nor this counts RPC matched
-- leads.code. The browser side is fixed in the same commit series; this
-- migration brings the column totals in line so headers and columns agree.
--
-- Column list MUST mirror KANBAN_SEARCH_COLUMNS in
-- src/features/sales/salesKanbanColumns.ts:
--   title, company_name, contact_first_name, contact_last_name, email, phone,
--   code, business_profile_name, vat_number
--
-- Base body: 20260826120000_under_development_board.sql (4-arg, p_board).
-- Same signature → no PostgREST overload ambiguity, no types:gen needed.
-- LIVE DRIFT CHECK 2026-08-28 (md5(pg_get_functiondef)), APPLIED same day
-- (via Management API query endpoint — Supabase MCP unavailable in that session):
--   sales_kanban_counts    pre  1ff94f2748faf73e3d09204a3cd8f897 (= 20260826120000, 4-arg)
--                          post 76400b0cde2d018969ed1992dc4a0c0a
--   verified: sales_kanban_counts(null,null,'006250','sales') -> not_interested total 1

create or replace function public.sales_kanban_counts(
  p_owner uuid default null,
  p_source text default null,
  p_search text default null,
  p_board text default 'sales'
) returns table (stage_id uuid, total bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select l.stage_id, count(*)::bigint as total
  from public.leads l
  join public.pipeline_stages ps on ps.id = l.stage_id
  where not l.archived
    and ps.board = coalesce(p_board, 'sales')
    and (p_owner is null or l.owner_user_id = p_owner)
    and (p_source is null or l.source = p_source)
    and (
      p_search is null or p_search = ''
      or l.title ilike '%' || p_search || '%'
      or l.company_name ilike '%' || p_search || '%'
      or l.contact_first_name ilike '%' || p_search || '%'
      or l.contact_last_name ilike '%' || p_search || '%'
      or l.email ilike '%' || p_search || '%'
      or l.phone ilike '%' || p_search || '%'
      or l.code ilike '%' || p_search || '%'
      or l.business_profile_name ilike '%' || p_search || '%'
      or l.vat_number ilike '%' || p_search || '%'
    )
  group by l.stage_id;
$$;

grant execute on function public.sales_kanban_counts(uuid, text, text, text) to authenticated;

-- ROLLBACK:
-- Re-run section "2. Board-aware kanban counts" of
-- 20260826120000_under_development_board.sql (same signature, without the
-- code / business_profile_name / vat_number predicates).
