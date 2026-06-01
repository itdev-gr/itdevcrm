create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.expense_categories(id) on delete restrict,
  vendor text,
  billing_type text not null check (billing_type in ('one_time','recurring_monthly','recurring_yearly')),
  amount_net numeric(12,2) not null check (amount_net >= 0),
  vat_rate numeric(5,2) not null default 24.00 check (vat_rate >= 0 and vat_rate <= 100),
  vat_amount numeric(12,2) generated always as (round(amount_net * vat_rate / 100, 2)) stored,
  amount_gross numeric(12,2) generated always as (round(amount_net + amount_net * vat_rate / 100, 2)) stored,
  start_date date not null,
  end_date date,
  status text not null default 'pending' check (status in ('pending','paid')),
  payment_method text,
  paid_at timestamptz,
  paid_by uuid references public.profiles(user_id),
  notes text,
  receipt_path text,
  parent_expense_id uuid references public.expenses(id) on delete set null,
  created_by uuid references public.profiles(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint expenses_paid_requires_paid_at check (status <> 'paid' or paid_at is not null),
  constraint expenses_paid_requires_method check (status <> 'paid' or payment_method is not null),
  constraint expenses_end_after_start check (end_date is null or end_date >= start_date)
);

create index expenses_status_start on public.expenses (status, start_date desc);
create index expenses_category_start on public.expenses (category_id, start_date desc);
create index expenses_recurring_renewal on public.expenses (billing_type, end_date)
  where billing_type in ('recurring_monthly','recurring_yearly');
create index expenses_vendor on public.expenses (vendor);
create index expenses_parent on public.expenses (parent_expense_id);

create trigger expenses_set_updated_at
  before update on public.expenses
  for each row execute function public.set_updated_at();

create trigger expenses_activity
  after insert or update or delete on public.expenses
  for each row execute function public.log_activity('id');

alter table public.expenses enable row level security;

create policy expenses_all on public.expenses
  for all to authenticated
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

-- ROLLBACK:
-- drop table if exists public.expenses cascade;
