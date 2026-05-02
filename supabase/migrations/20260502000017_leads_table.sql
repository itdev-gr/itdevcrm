-- =============================================================================
-- Leads pipeline migration: leads table + RLS + triggers
-- =============================================================================
create table public.leads (
  id uuid primary key default gen_random_uuid(),

  -- Source
  source text not null check (source in ('meta', 'manual', 'import')),
  source_data jsonb,

  -- Card display
  title text not null,

  -- Contact + company info (filled in over time)
  contact_first_name text,
  contact_last_name text,
  email text,
  phone text,
  company_name text,
  industry text,
  country text,
  address text,
  vat_number text,
  notes text,

  -- Estimated values (become deals.* after conversion)
  estimated_one_time_value numeric(12,2) not null default 0,
  estimated_monthly_value numeric(12,2) not null default 0,
  services_planned jsonb not null default '[]'::jsonb,
  expected_close_date date,

  -- Pipeline
  stage_id uuid references public.pipeline_stages(id),
  owner_user_id uuid references public.profiles(user_id),

  -- Conversion (filled when lead reaches `won` and convert_lead_to_client succeeds)
  converted_at timestamptz,
  converted_client_id uuid references public.clients(id) on delete set null,
  converted_deal_id uuid references public.deals(id) on delete set null,

  -- Soft delete + meta
  archived boolean not null default false,
  archived_at timestamptz,
  archived_by uuid references public.profiles(user_id),
  archived_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(user_id)
);

create index leads_stage on public.leads (stage_id) where archived = false and converted_at is null;
create index leads_owner on public.leads (owner_user_id) where archived = false;
create index leads_source on public.leads (source);
create index leads_converted on public.leads (converted_at desc) where converted_at is not null;

create trigger leads_set_updated_at
  before update on public.leads
  for each row execute function public.set_updated_at();

create trigger leads_activity
  after insert or update or delete on public.leads
  for each row execute function public.log_activity('id');

alter table public.leads enable row level security;

create policy leads_select
  on public.leads for select
  to authenticated
  using (
    public.current_user_is_admin()
    or public.current_user_can('sales', 'view')
    or owner_user_id = auth.uid()
  );

create policy leads_insert
  on public.leads for insert
  to authenticated
  with check (
    public.current_user_is_admin()
    or public.current_user_can('sales', 'create')
  );

create policy leads_update
  on public.leads for update
  to authenticated
  using (
    public.current_user_is_admin()
    or public.current_user_can('sales', 'edit')
    or (converted_at is null and public.current_user_can('sales', 'move_stage'))
  )
  with check (
    public.current_user_is_admin()
    or public.current_user_can('sales', 'edit')
    or public.current_user_can('sales', 'move_stage')
  );

create policy leads_delete
  on public.leads for delete
  to authenticated
  using (public.current_user_is_admin());
