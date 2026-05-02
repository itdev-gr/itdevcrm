-- =============================================================================
-- Phase 5 migration: monthly_invoices + monthly_invoice_items + client_blocks
-- =============================================================================

-- ---------------------------------------------------------------------------
-- monthly_invoices  (one row per client per period; consolidated)
-- ---------------------------------------------------------------------------
create table public.monthly_invoices (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  period text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),  -- 'YYYY-MM'
  due_date date not null,
  subtotal numeric(12,2) not null default 0,
  tax_rate numeric(5,2) default 0,
  tax_amount numeric(12,2) default 0,
  total_amount numeric(12,2) not null default 0,
  amount_paid numeric(12,2) not null default 0,
  status text not null default 'pending' check (status in ('pending', 'partial', 'paid', 'overdue')),
  payment_method text,
  paid_at timestamptz,
  notes text,
  archived boolean not null default false,
  archived_at timestamptz,
  archived_by uuid references public.profiles(user_id),
  archived_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, period)
);

create index monthly_invoices_status on public.monthly_invoices (status) where archived = false;
create index monthly_invoices_period on public.monthly_invoices (period desc);
create index monthly_invoices_client on public.monthly_invoices (client_id, period desc);

create trigger monthly_invoices_set_updated_at
  before update on public.monthly_invoices
  for each row execute function public.set_updated_at();

create trigger monthly_invoices_activity
  after insert or update or delete on public.monthly_invoices
  for each row execute function public.log_activity('id');

alter table public.monthly_invoices enable row level security;

create policy monthly_invoices_select
  on public.monthly_invoices for select
  to authenticated
  using (
    public.current_user_is_admin()
    or public.current_user_can('accounting_recurring', 'view')
    or public.current_user_can('clients', 'view')
  );

create policy monthly_invoices_mutate
  on public.monthly_invoices for all
  to authenticated
  using (
    public.current_user_is_admin()
    or public.current_user_can('accounting_recurring', 'edit')
  )
  with check (
    public.current_user_is_admin()
    or public.current_user_can('accounting_recurring', 'edit')
  );

-- ---------------------------------------------------------------------------
-- monthly_invoice_items  (per-job line item)
-- ---------------------------------------------------------------------------
create table public.monthly_invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.monthly_invoices(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete set null,
  service_type text,
  amount numeric(12,2) not null,
  description text,
  created_at timestamptz not null default now()
);

create index monthly_invoice_items_invoice on public.monthly_invoice_items (invoice_id);

alter table public.monthly_invoice_items enable row level security;

create policy monthly_invoice_items_select
  on public.monthly_invoice_items for select
  to authenticated
  using (
    public.current_user_is_admin()
    or public.current_user_can('accounting_recurring', 'view')
    or public.current_user_can('clients', 'view')
  );

create policy monthly_invoice_items_mutate
  on public.monthly_invoice_items for all
  to authenticated
  using (
    public.current_user_is_admin()
    or public.current_user_can('accounting_recurring', 'edit')
  )
  with check (
    public.current_user_is_admin()
    or public.current_user_can('accounting_recurring', 'edit')
  );

-- ---------------------------------------------------------------------------
-- client_blocks
-- One active row per client at a time, enforced by partial unique index.
-- ---------------------------------------------------------------------------
create table public.client_blocks (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  blocked_at timestamptz not null default now(),
  blocked_by uuid references public.profiles(user_id),
  reason text not null,
  unblocked_at timestamptz,
  unblocked_by uuid references public.profiles(user_id),
  created_at timestamptz not null default now()
);

create unique index client_blocks_active_unique
  on public.client_blocks (client_id)
  where unblocked_at is null;

create index client_blocks_client on public.client_blocks (client_id, blocked_at desc);

create trigger client_blocks_activity
  after insert or update or delete on public.client_blocks
  for each row execute function public.log_activity('id');

alter table public.client_blocks enable row level security;

create policy client_blocks_select
  on public.client_blocks for select
  to authenticated
  using (
    public.current_user_is_admin()
    or public.current_user_can('clients', 'view')
    or public.current_user_can('accounting_recurring', 'view')
    or public.current_user_can('web_seo', 'view')
    or public.current_user_can('local_seo', 'view')
    or public.current_user_can('web_dev', 'view')
    or public.current_user_can('social_media', 'view')
  );

-- INSERT/UPDATE only via RPCs (block_client / unblock_client). No direct mutate policy.
-- service_role from RPC bypasses RLS.
