-- Per-deal payment schedule. One row per scheduled installment / period.
-- - Seeded automatically from services_planned at deal insert.
-- - Recurring rows (monthly / yearly) auto-extend via ensure_recurring_payments
--   when their end_date is within 7 days and no successor exists.
-- - Accounting can split, edit, or delete rows manually (e.g. one-time website
--   contract billed in two installments).

create table if not exists public.deal_payments (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  service_type text,
  service_index int,
  billing_type text not null check (billing_type in ('one_time','recurring_monthly','recurring_yearly')),
  label text,
  amount numeric(12,2) not null default 0,
  start_date date,
  end_date date,
  status text not null default 'pending' check (status in ('pending','paid')),
  invoice_number text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists deal_payments_deal on public.deal_payments (deal_id);
create index if not exists deal_payments_recurring_renewal on public.deal_payments (deal_id, service_index, end_date)
  where billing_type in ('recurring_monthly','recurring_yearly');

create or replace function public.deal_payments_set_updated_at()
returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists deal_payments_updated_at on public.deal_payments;
create trigger deal_payments_updated_at
  before update on public.deal_payments
  for each row execute function public.deal_payments_set_updated_at();

alter table public.deal_payments enable row level security;

create policy deal_payments_select on public.deal_payments
  for select to authenticated
  using (
    public.current_user_is_admin()
    or public.current_user_can('sales', 'view')
    or public.current_user_can('clients', 'view')
    or public.current_user_can('accounting_onboarding', 'view')
  );

create policy deal_payments_mutate on public.deal_payments
  for all to authenticated
  using (
    public.current_user_is_admin()
    or public.current_user_can('accounting_onboarding', 'edit')
  )
  with check (
    public.current_user_is_admin()
    or public.current_user_can('accounting_onboarding', 'edit')
  );

-- Seed payments from services_planned. Idempotent: only inserts if the deal
-- has no payments yet. Used both by the after-insert trigger and explicit
-- backfill calls.
create or replace function public.seed_deal_payments(target_deal_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  d record;
  svc jsonb;
  idx int := 0;
  s_start date;
  s_end date;
  amt numeric(12,2);
  bt text;
  st text;
begin
  select * into d from public.deals where id = target_deal_id;
  if d is null then return; end if;

  -- Already seeded — skip.
  if exists (select 1 from public.deal_payments where deal_id = d.id) then
    return;
  end if;

  if d.services_planned is null or jsonb_typeof(d.services_planned) <> 'array' then
    return;
  end if;

  s_start := coalesce(d.actual_close_date, current_date);

  for svc in select * from jsonb_array_elements(d.services_planned)
  loop
    bt := coalesce(svc->>'billing_type', 'one_time');
    st := svc->>'service_type';
    if bt = 'one_time' then
      amt := coalesce(nullif(svc->>'one_time_amount','')::numeric, 0);
      s_end := s_start;
    elsif bt = 'recurring_monthly' then
      amt := coalesce(nullif(svc->>'monthly_amount','')::numeric, 0);
      s_end := s_start + interval '1 month';
    elsif bt = 'recurring_yearly' then
      amt := coalesce(nullif(svc->>'monthly_amount','')::numeric, 0);
      s_end := s_start + interval '1 year';
    else
      amt := 0; s_end := s_start;
    end if;

    insert into public.deal_payments (deal_id, service_type, service_index, billing_type, amount, start_date, end_date)
      values (d.id, st, idx, bt, amt, s_start, s_end);

    idx := idx + 1;
  end loop;
end $$;

grant execute on function public.seed_deal_payments(uuid) to authenticated;

create or replace function public.deal_payments_seed_after_insert()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.seed_deal_payments(new.id);
  return new;
end $$;

drop trigger if exists deals_seed_payments on public.deals;
create trigger deals_seed_payments
  after insert on public.deals
  for each row execute function public.deal_payments_seed_after_insert();

-- Backfill any existing deals (e.g. the Thermaikos demo deal) so they show up
-- in the new Payment tab without re-creating.
do $$
declare
  r record;
begin
  for r in select id from public.deals where archived = false loop
    perform public.seed_deal_payments(r.id);
  end loop;
end $$;

-- Auto-renew recurring payments. Run from the kanban/page on mount; we look
-- at every recurring payment whose end_date falls within the next 7 days, and
-- if no successor exists for that (deal, service_index), we create the next
-- period. Idempotent.
create or replace function public.ensure_recurring_payments()
returns int
language plpgsql security definer set search_path = public as $$
declare
  r record;
  next_start date;
  next_end date;
  created int := 0;
begin
  for r in
    select dp.*
      from public.deal_payments dp
      join public.deals d on d.id = dp.deal_id
     where dp.billing_type in ('recurring_monthly','recurring_yearly')
       and dp.end_date is not null
       and dp.end_date <= current_date + interval '7 days'
       and d.archived = false
       and not exists (
         select 1 from public.deal_payments dp2
          where dp2.deal_id = dp.deal_id
            and dp2.service_index = dp.service_index
            and dp2.start_date >= dp.end_date
       )
  loop
    next_start := r.end_date;
    if r.billing_type = 'recurring_monthly' then
      next_end := next_start + interval '1 month';
    else
      next_end := next_start + interval '1 year';
    end if;

    insert into public.deal_payments
      (deal_id, service_type, service_index, billing_type, amount, start_date, end_date)
      values (r.deal_id, r.service_type, r.service_index, r.billing_type, r.amount, next_start, next_end);

    created := created + 1;
  end loop;
  return created;
end $$;

grant execute on function public.ensure_recurring_payments() to authenticated;
