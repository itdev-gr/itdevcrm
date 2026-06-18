-- Sales kanban performance: a count-per-sales-stage RPC (so the board can show
-- true totals without loading every lead), a generated total-value column +
-- ordering indexes (so "top N per stage" is server-side and cheap), used by
-- src/features/sales/hooks/useSalesKanbanColumns.ts.

-- Generated total value so the board can ORDER BY it (value_high / value_low).
alter table public.leads
  add column if not exists estimated_total_value numeric
  generated always as (
    coalesce(estimated_one_time_value, 0) + coalesce(estimated_monthly_value, 0)
  ) stored;

-- Indexes backing the capped per-stage ordered fetch.
create index if not exists leads_stage_created_idx on public.leads (stage_id, created_at desc) where not archived;
create index if not exists leads_stage_updated_idx on public.leads (stage_id, updated_at desc) where not archived;
create index if not exists leads_stage_value_idx   on public.leads (stage_id, estimated_total_value desc) where not archived;

-- SECURITY INVOKER => RLS on leads applies => a sales rep only counts their own
-- leads automatically; admins count all. p_search mirrors the board search box.
create or replace function public.sales_kanban_counts(
  p_owner uuid default null,
  p_source text default null,
  p_search text default null
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
    and ps.board = 'sales'
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
    )
  group by l.stage_id;
$$;

grant execute on function public.sales_kanban_counts(uuid, text, text) to authenticated;

-- ROLLBACK:
-- drop function if exists public.sales_kanban_counts(uuid, text, text);
-- drop index if exists public.leads_stage_value_idx;
-- drop index if exists public.leads_stage_updated_idx;
-- drop index if exists public.leads_stage_created_idx;
-- alter table public.leads drop column if exists estimated_total_value;
