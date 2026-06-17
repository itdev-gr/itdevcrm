-- A payment becomes an invoice header; its line items live here, one per job.
-- "Separate" billing = one line per payment (default). "Together" = several jobs'
-- lines on one payment header (one due date, one total, one invoice, one mark-paid).
create table if not exists public.deal_payment_lines (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.deal_payments(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete set null,
  label text,
  amount_net numeric(12,2) not null default 0 check (amount_net >= 0),
  vat_rate numeric(5,2) not null default 24.00 check (vat_rate >= 0 and vat_rate <= 100),
  vat_amount numeric(12,2) generated always as (round(amount_net * vat_rate / 100, 2)) stored,
  amount_gross numeric(12,2) generated always as (round(amount_net + amount_net * vat_rate / 100, 2)) stored,
  created_at timestamptz not null default now()
);

create index if not exists deal_payment_lines_payment_idx on public.deal_payment_lines (payment_id);
create index if not exists deal_payment_lines_job_idx on public.deal_payment_lines (job_id);

alter table public.deal_payment_lines enable row level security;

create policy deal_payment_lines_select on public.deal_payment_lines
  for select to authenticated using (
    public.current_user_is_admin()
    or public.current_user_can('sales', 'view')
    or public.current_user_can('clients', 'view')
    or public.current_user_can('accounting_onboarding', 'view')
  );

create policy deal_payment_lines_write on public.deal_payment_lines
  for all to authenticated using (
    public.current_user_is_admin() or public.current_user_can('accounting_onboarding', 'edit')
  ) with check (
    public.current_user_is_admin() or public.current_user_can('accounting_onboarding', 'edit')
  );

alter publication supabase_realtime add table public.deal_payment_lines;

-- ROLLBACK:
-- alter publication supabase_realtime drop table public.deal_payment_lines;
-- drop table if exists public.deal_payment_lines cascade;
