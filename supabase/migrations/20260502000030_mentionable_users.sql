-- =============================================================================
-- mentionable_users(): security-definer RPC returning every active profile
-- so non-admin users can power @-mention autocomplete in comments without
-- bypassing the row-level profiles RLS (which only lets users read self+admin).
-- =============================================================================
create or replace function public.mentionable_users()
returns table(user_id uuid, full_name text, email text, is_admin boolean, group_codes text[])
language sql security definer set search_path = public stable as $$
  select
    p.user_id,
    p.full_name,
    p.email,
    p.is_admin,
    coalesce(
      (select array_agg(g.code order by g.position)
        from public.user_groups ug
        join public.groups g on g.id = ug.group_id
        where ug.user_id = p.user_id),
      array[]::text[]
    ) as group_codes
  from public.profiles p
  where p.is_active = true and p.archived = false
  order by p.full_name;
$$;

grant execute on function public.mentionable_users() to authenticated;
