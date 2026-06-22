-- Allow temporarily excluding a sales rep from the round-robin lead pool (keeps all
-- their existing leads + access; they just stop receiving NEW ones). Reversible: set the
-- flag back to false to re-include. Affects both auto-distribute-on-insert and the manual
-- "Distribute Unassigned" action (both go through sales_pool_ids).
alter table public.profiles
  add column if not exists exclude_from_lead_distribution boolean not null default false;

create or replace function public.sales_pool_ids()
returns uuid[]
language sql stable security definer set search_path = 'public'
as $$
  select array_agg(p.user_id order by p.full_name nulls last, p.user_id)
  from public.profiles p
  join public.user_groups ug on ug.user_id = p.user_id
  join public.groups g on g.id = ug.group_id
  where p.is_active = true and p.archived = false and g.code = 'sales'
    and coalesce(p.exclude_from_lead_distribution, false) = false;
$$;
