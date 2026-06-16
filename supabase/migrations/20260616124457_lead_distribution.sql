-- Round-robin distribution of unassigned leads to the Sales team.
-- Default OFF; only ever sets owner_user_id on leads that have none.

create table if not exists public.lead_distribution_state (
  id boolean primary key default true,
  auto_enabled boolean not null default false,
  last_assigned_user_id uuid references public.profiles(user_id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint lead_distribution_state_singleton check (id = true)
);

insert into public.lead_distribution_state (id, auto_enabled)
  values (true, false) on conflict (id) do nothing;

alter table public.lead_distribution_state enable row level security;

create policy lead_distribution_state_read on public.lead_distribution_state
  for select to authenticated using (true);
create policy lead_distribution_state_update on public.lead_distribution_state
  for update to authenticated
  using (public.current_user_is_admin()) with check (public.current_user_is_admin());

-- Ordered array of the Sales rotation pool (active, non-archived sales-group members).
create or replace function public.sales_pool_ids()
returns uuid[] language sql security definer set search_path = public stable as $$
  select array_agg(p.user_id order by p.full_name nulls last, p.user_id)
  from public.profiles p
  join public.user_groups ug on ug.user_id = p.user_id
  join public.groups g on g.id = ug.group_id
  where p.is_active = true and p.archived = false and g.code = 'sales';
$$;

-- Next assignee after last_assigned_user_id (wraps; starts at first if none/left pool).
create or replace function public.pick_next_sales_assignee()
returns uuid language plpgsql security definer set search_path = public as $$
declare
  pool uuid[];
  last_id uuid;
  idx int;
  next_id uuid;
begin
  pool := public.sales_pool_ids();
  if pool is null or array_length(pool, 1) is null then return null; end if;
  select last_assigned_user_id into last_id from public.lead_distribution_state where id = true;
  idx := array_position(pool, last_id);
  if idx is null then
    next_id := pool[1];
  else
    next_id := pool[(idx % array_length(pool, 1)) + 1];
  end if;
  update public.lead_distribution_state
    set last_assigned_user_id = next_id, updated_at = now() where id = true;
  return next_id;
end $$;

-- BEFORE INSERT: only assigns when toggle is on AND lead has no owner.
create or replace function public.leads_auto_distribute()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  enabled boolean;
  assignee uuid;
begin
  if NEW.owner_user_id is not null then return NEW; end if;
  select auto_enabled into enabled from public.lead_distribution_state where id = true;
  if coalesce(enabled, false) then
    assignee := public.pick_next_sales_assignee();
    if assignee is not null then NEW.owner_user_id := assignee; end if;
  end if;
  return NEW;
end $$;

drop trigger if exists leads_auto_distribute_trg on public.leads;
create trigger leads_auto_distribute_trg
  before insert on public.leads
  for each row execute function public.leads_auto_distribute();

-- Manual: round-robin every active unassigned lead. Admin only. Returns count.
create or replace function public.distribute_unassigned_leads()
returns int language plpgsql security definer set search_path = public as $$
declare
  r record;
  assignee uuid;
  n int := 0;
begin
  if not public.current_user_is_admin() then
    raise exception 'permission_denied';
  end if;
  for r in
    select id from public.leads
    where owner_user_id is null and archived = false and converted_at is null
    order by code
  loop
    assignee := public.pick_next_sales_assignee();
    exit when assignee is null;          -- empty pool
    update public.leads set owner_user_id = assignee where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;

grant execute on function public.distribute_unassigned_leads() to authenticated;

-- ROLLBACK:
-- drop trigger if exists leads_auto_distribute_trg on public.leads;
-- drop function if exists public.leads_auto_distribute();
-- drop function if exists public.distribute_unassigned_leads();
-- drop function if exists public.pick_next_sales_assignee();
-- drop function if exists public.sales_pool_ids();
-- drop table if exists public.lead_distribution_state;
