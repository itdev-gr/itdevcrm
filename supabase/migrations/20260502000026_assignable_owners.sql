-- =============================================================================
-- assignable_owners(): security-definer RPC returning sales-group members + admins
-- so non-admin users can populate the lead-owner dropdown without bypassing
-- profiles RLS (which restricts authenticated users to their own row).
-- =============================================================================
create or replace function public.assignable_owners()
returns table(user_id uuid, full_name text, email text, is_admin boolean)
language sql security definer set search_path = public stable as $$
  select p.user_id, p.full_name, p.email, p.is_admin
  from public.profiles p
  where p.is_active = true and p.archived = false
    and (
      p.is_admin = true
      or exists (
        select 1 from public.user_groups ug
        join public.groups g on g.id = ug.group_id
        where ug.user_id = p.user_id and g.code = 'sales'
      )
    )
  order by p.full_name;
$$;

grant execute on function public.assignable_owners() to authenticated;
