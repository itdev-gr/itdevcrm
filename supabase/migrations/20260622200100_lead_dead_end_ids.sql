-- Bug #2: batched dead-end lookup for the merge picker. Returns the subset of the
-- given lead ids whose sales-board stage is dead_end / not_interested — the same
-- predicate lead_is_dead_end() uses (20260622100000), but for many ids at once.
create or replace function public.lead_dead_end_ids(p_ids uuid[])
returns table (id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select l.id
  from public.leads l
  join public.pipeline_stages ps on ps.id = l.stage_id
  where l.id = any(p_ids)
    and ps.board = 'sales'
    and ps.code in ('dead_end', 'not_interested');
$$;

grant execute on function public.lead_dead_end_ids(uuid[]) to authenticated, service_role;

-- ROLLBACK:
--   drop function if exists public.lead_dead_end_ids(uuid[]);
