-- Admin "shuffle leads" for the sales kanban: re-distribute every lead in a
-- chosen stage across the active sales pool (never back to the same rep) and
-- reset them to New Lead. The distribution math runs client-side (unit tested);
-- these two RPCs expose the pool and apply the precomputed result atomically.

-- 1. Pool accessor for the client-side planner. Admin only. Same pool the
--    auto-distribution trigger uses (active sales group, minus excluded reps).
create or replace function public.lead_shuffle_pool()
returns uuid[] language plpgsql security definer set search_path = public stable as $$
begin
  if not public.current_user_is_admin() then
    raise exception 'permission_denied';
  end if;
  return public.sales_pool_ids();
end $$;

revoke all on function public.lead_shuffle_pool() from public, anon;
grant execute on function public.lead_shuffle_pool() to authenticated;

-- 2. Apply a precomputed assignment. Admin only, atomic. Each lead is moved to
--    New Lead and reassigned, but ONLY if it is still in the chosen stage
--    (guards against a lead moving between fetch and apply). Returns the number
--    of leads actually updated. The leads_activity trigger logs each change,
--    attributed to the calling admin via auth.uid().
create or replace function public.apply_lead_shuffle(
  p_stage_code text,
  p_assignments jsonb
)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_from_stage uuid;
  v_new_lead_stage uuid;
  v_count int := 0;
  r record;
begin
  if not public.current_user_is_admin() then
    raise exception 'permission_denied';
  end if;

  if p_stage_code not in
       ('new_lead','no_answer','working_on_it','offer_sent','scheduled','hot') then
    raise exception 'stage_not_shufflable';
  end if;

  select id into v_from_stage
    from public.pipeline_stages where board = 'sales' and code = p_stage_code;
  if v_from_stage is null then
    raise exception 'unknown_stage';
  end if;

  select id into v_new_lead_stage
    from public.pipeline_stages where board = 'sales' and code = 'new_lead';

  for r in
    select (e->>'lead_id')::uuid as lead_id,
           (e->>'owner_user_id')::uuid as owner_user_id
      from jsonb_array_elements(coalesce(p_assignments, '[]'::jsonb)) e
  loop
    update public.leads
       set owner_user_id = r.owner_user_id,
           stage_id = v_new_lead_stage
     where id = r.lead_id
       and stage_id = v_from_stage
       and archived = false
       and converted_at is null;
    if found then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end $$;

revoke all on function public.apply_lead_shuffle(text, jsonb) from public, anon;
grant execute on function public.apply_lead_shuffle(text, jsonb) to authenticated;

-- ROLLBACK:
-- drop function if exists public.apply_lead_shuffle(text, jsonb);
-- drop function if exists public.lead_shuffle_pool();
