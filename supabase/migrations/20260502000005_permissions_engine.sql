-- =============================================================================
-- Phase 2 migration: permissions engine — view + functions
-- =============================================================================

-- user_effective_permissions view
create or replace view public.user_effective_permissions as
with all_group_perms as (
  select
    ug.user_id,
    gp.board,
    gp.action,
    bool_or(gp.allowed) as group_any_allowed,
    max(case gp.scope when 'all' then 3 when 'group' then 2 when 'own' then 1 end)
      filter (where gp.allowed) as group_scope_rank
  from public.user_groups ug
  join public.group_permissions gp on gp.group_id = ug.group_id
  group by ug.user_id, gp.board, gp.action
),
combined as (
  select
    coalesce(up.user_id, agp.user_id) as user_id,
    coalesce(up.board, agp.board) as board,
    coalesce(up.action, agp.action) as action,
    case when up.user_id is not null then up.allowed else coalesce(agp.group_any_allowed, false) end as allowed,
    case
      when up.user_id is not null then up.scope
      when agp.group_scope_rank = 3 then 'all'
      when agp.group_scope_rank = 2 then 'group'
      when agp.group_scope_rank = 1 then 'own'
      else null
    end as scope
  from all_group_perms agp
  full outer join public.user_permissions up
    on up.user_id = agp.user_id
   and up.board = agp.board
   and up.action = agp.action
)
select user_id, board, action, allowed, scope from combined
where allowed = true;

-- current_user_can(board, action) -> bool
create or replace function public.current_user_can(target_board text, target_action text)
returns boolean
language sql stable security definer set search_path = public as $$
  select
    public.current_user_is_admin() or exists (
      select 1
      from public.user_effective_permissions
      where user_id = auth.uid()
        and board = target_board
        and action = target_action
        and allowed = true
    );
$$;

-- current_user_scope(board, action) -> text
create or replace function public.current_user_scope(target_board text, target_action text)
returns text
language sql stable security definer set search_path = public as $$
  select case
    when public.current_user_is_admin() then 'all'
    else (
      select scope
      from public.user_effective_permissions
      where user_id = auth.uid()
        and board = target_board
        and action = target_action
        and allowed = true
      order by case scope when 'all' then 3 when 'group' then 2 when 'own' then 1 end desc
      limit 1
    )
  end;
$$;

grant select on public.user_effective_permissions to authenticated;
grant execute on function public.current_user_can(text, text) to authenticated;
grant execute on function public.current_user_scope(text, text) to authenticated;
