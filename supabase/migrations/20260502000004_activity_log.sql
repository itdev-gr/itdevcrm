-- =============================================================================
-- Phase 2 migration: activity_log + generic trigger
-- =============================================================================

create table public.activity_log (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  user_id uuid references public.profiles(user_id),
  action text not null check (action in ('insert', 'update', 'delete')),
  changes jsonb,
  created_at timestamptz not null default now()
);

create index activity_log_entity on public.activity_log (entity_type, entity_id);
create index activity_log_created_at on public.activity_log (created_at desc);

alter table public.activity_log enable row level security;

create policy activity_log_select_admin
  on public.activity_log for select
  to authenticated
  using (public.current_user_is_admin());

-- INSERTs only via the trigger; no client INSERT policy.

-- -----------------------------------------------------------------------------
-- Generic trigger function
-- -----------------------------------------------------------------------------
create or replace function public.log_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  entity_id_value uuid;
  changes_json jsonb;
begin
  if tg_op = 'DELETE' then
    entity_id_value := (row_to_json(old)::jsonb ->> coalesce(tg_argv[0], 'id'))::uuid;
    changes_json := row_to_json(old)::jsonb;
  elsif tg_op = 'INSERT' then
    entity_id_value := (row_to_json(new)::jsonb ->> coalesce(tg_argv[0], 'id'))::uuid;
    changes_json := row_to_json(new)::jsonb;
  else
    entity_id_value := (row_to_json(new)::jsonb ->> coalesce(tg_argv[0], 'id'))::uuid;
    changes_json := jsonb_build_object('old', row_to_json(old)::jsonb, 'new', row_to_json(new)::jsonb);
  end if;

  insert into public.activity_log (entity_type, entity_id, user_id, action, changes)
  values (tg_table_name, entity_id_value, auth.uid(), lower(tg_op), changes_json);

  return coalesce(new, old);
end $$;

-- Apply to permission + stage tables
create trigger group_permissions_activity
  after insert or update or delete on public.group_permissions
  for each row execute function public.log_activity('id');

create trigger user_permissions_activity
  after insert or update or delete on public.user_permissions
  for each row execute function public.log_activity('id');

create trigger field_permissions_activity
  after insert or update or delete on public.field_permissions
  for each row execute function public.log_activity('id');

create trigger pipeline_stages_activity
  after insert or update or delete on public.pipeline_stages
  for each row execute function public.log_activity('id');
