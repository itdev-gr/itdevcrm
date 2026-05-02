-- =============================================================================
-- Phase 3 migration: deals + jobs (jobs is skeleton; full lifecycle in Phase 6)
-- =============================================================================

create table public.deals (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  title text not null,
  description text,
  expected_close_date date,
  actual_close_date date,
  probability int check (probability between 0 and 100),
  lead_source text,
  stage_id uuid not null references public.pipeline_stages(id),
  owner_user_id uuid references public.profiles(user_id),
  currency text not null default 'EUR',
  one_time_value numeric(12,2) default 0,
  recurring_monthly_value numeric(12,2) default 0,
  locked_at timestamptz,
  locked_by uuid references public.profiles(user_id),
  accounting_completed_at timestamptz,
  accounting_completed_by uuid references public.profiles(user_id),
  archived boolean not null default false,
  archived_at timestamptz,
  archived_by uuid references public.profiles(user_id),
  archived_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index deals_client on public.deals (client_id);
create index deals_stage on public.deals (stage_id) where archived = false;
create index deals_owner on public.deals (owner_user_id) where archived = false;

create trigger deals_set_updated_at
  before update on public.deals
  for each row execute function public.set_updated_at();

create trigger deals_activity
  after insert or update or delete on public.deals
  for each row execute function public.log_activity('id');

alter table public.deals enable row level security;

create policy deals_select
  on public.deals for select
  to authenticated
  using (
    public.current_user_is_admin()
    or public.current_user_can('sales', 'view')
    or public.current_user_can('clients', 'view')
  );

create policy deals_insert
  on public.deals for insert
  to authenticated
  with check (
    public.current_user_is_admin()
    or public.current_user_can('sales', 'create')
  );

create policy deals_update
  on public.deals for update
  to authenticated
  using (
    public.current_user_is_admin()
    or public.current_user_can('sales', 'edit')
    or (locked_at is null and public.current_user_can('sales', 'move_stage'))
  )
  with check (
    public.current_user_is_admin()
    or public.current_user_can('sales', 'edit')
    or public.current_user_can('sales', 'move_stage')
  );

create policy deals_delete
  on public.deals for delete
  to authenticated
  using (
    public.current_user_is_admin()
    or public.current_user_can('sales', 'delete')
  );

-- ---------------------------------------------------------------------------
-- jobs (skeleton — Phase 6 builds the technical kanbans)
-- ---------------------------------------------------------------------------
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  service_type text not null check (service_type in ('web_seo', 'local_seo', 'web_dev', 'social_media')),
  billing_type text not null check (billing_type in ('one_time', 'recurring_monthly')),
  one_time_amount numeric(12,2),
  monthly_amount numeric(12,2),
  setup_fee numeric(12,2),
  recurring_start_date date,
  stage_id uuid references public.pipeline_stages(id),
  owner_user_id uuid references public.profiles(user_id),
  assigned_group_id uuid references public.groups(id),
  status text not null default 'active' check (status in ('active', 'paused', 'cancelled', 'completed')),
  monthly_tasks jsonb not null default '[]'::jsonb,
  monthly_tasks_period text,
  started_at timestamptz,
  completed_at timestamptz,
  archived boolean not null default false,
  archived_at timestamptz,
  archived_by uuid references public.profiles(user_id),
  archived_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index jobs_deal on public.jobs (deal_id);
create index jobs_client on public.jobs (client_id);
create index jobs_service on public.jobs (service_type) where archived = false;
create index jobs_assigned_group on public.jobs (assigned_group_id) where archived = false;

create trigger jobs_set_updated_at
  before update on public.jobs
  for each row execute function public.set_updated_at();

create trigger jobs_activity
  after insert or update or delete on public.jobs
  for each row execute function public.log_activity('id');

alter table public.jobs enable row level security;

create policy jobs_select
  on public.jobs for select
  to authenticated
  using (
    public.current_user_is_admin()
    or public.current_user_can(jobs.service_type, 'view')
    or public.current_user_can('accounting_recurring', 'view')
    or public.current_user_can('accounting_onboarding', 'view')
  );

create policy jobs_mutate_admin_or_service
  on public.jobs for all
  to authenticated
  using (
    public.current_user_is_admin()
    or public.current_user_can(jobs.service_type, 'edit')
  )
  with check (
    public.current_user_is_admin()
    or public.current_user_can(jobs.service_type, 'edit')
  );
