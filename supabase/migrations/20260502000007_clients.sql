-- =============================================================================
-- Phase 3 migration: clients
-- =============================================================================

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_first_name text,
  contact_last_name text,
  email text,
  phone text,
  website text,
  industry text,
  country text,
  region text,
  city text,
  address text,
  postcode text,
  vat_number text,
  lead_source text,
  assigned_owner_id uuid references public.profiles(user_id),
  archived boolean not null default false,
  archived_at timestamptz,
  archived_by uuid references public.profiles(user_id),
  archived_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index clients_assigned_owner on public.clients (assigned_owner_id) where archived = false;
create index clients_name on public.clients (lower(name));

create trigger clients_set_updated_at
  before update on public.clients
  for each row execute function public.set_updated_at();

create trigger clients_activity
  after insert or update or delete on public.clients
  for each row execute function public.log_activity('id');

alter table public.clients enable row level security;

create policy clients_select
  on public.clients for select
  to authenticated
  using (
    public.current_user_is_admin()
    or public.current_user_can('clients', 'view')
  );

create policy clients_insert
  on public.clients for insert
  to authenticated
  with check (
    public.current_user_is_admin()
    or public.current_user_can('clients', 'create')
    or public.current_user_can('sales', 'create')
  );

create policy clients_update
  on public.clients for update
  to authenticated
  using (
    public.current_user_is_admin()
    or public.current_user_can('clients', 'edit')
    or public.current_user_can('sales', 'edit')
  )
  with check (
    public.current_user_is_admin()
    or public.current_user_can('clients', 'edit')
    or public.current_user_can('sales', 'edit')
  );

create policy clients_delete
  on public.clients for delete
  to authenticated
  using (
    public.current_user_is_admin()
    or public.current_user_can('clients', 'delete')
  );
