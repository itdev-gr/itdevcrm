-- Expenses Autopay: stable recurring expenses (rent, subscriptions) that are
-- charged automatically get marked paid by the system on each period's start
-- date, instead of requiring a manual "mark paid" every month.
-- Spec: docs/superpowers/specs/2026-07-07-expenses-autopay-design.md

-- 1) Chain-level flag ---------------------------------------------------------
alter table public.expenses
  add column if not exists autopay boolean not null default false;

-- 2) Spawner: copy autopay + payment_method onto the renewed row --------------
-- (unchanged apart from the two extra columns in the INSERT)
create or replace function public.ensure_recurring_expenses()
returns int
language plpgsql security definer set search_path = public as $$
declare
  r record;
  next_start date;
  next_end date;
  created int := 0;
begin
  for r in
    select e.*
      from public.expenses e
     where e.billing_type in ('recurring_monthly','recurring_yearly')
       and e.end_date is not null
       and e.end_date <= current_date + interval '7 days'
       and not exists (
         select 1 from public.expenses e2
          where coalesce(e2.parent_expense_id, e2.id)
              = coalesce(e.parent_expense_id, e.id)
            and e2.start_date >= e.end_date
       )
  loop
    next_start := r.end_date;
    if r.billing_type = 'recurring_monthly' then
      next_end := next_start + interval '1 month';
    else
      next_end := next_start + interval '1 year';
    end if;

    insert into public.expenses
      (category_id, vendor, billing_type, amount_net, vat_rate,
       start_date, end_date, status, notes, parent_expense_id, created_by,
       payment_method, autopay)
      values
      (r.category_id, r.vendor, r.billing_type, r.amount_net, r.vat_rate,
       next_start, next_end, 'pending', r.notes,
       coalesce(r.parent_expense_id, r.id), r.created_by,
       r.payment_method, r.autopay);

    created := created + 1;
  end loop;
  return created;
end $$;

grant execute on function public.ensure_recurring_expenses() to authenticated;

-- 3) Nightly settle: flip due autopay rows pending -> paid --------------------
create or replace function public.settle_autopay_expenses()
returns int
language plpgsql security definer set search_path = public as $$
declare
  settled int;
begin
  update public.expenses
     set status = 'paid',
         paid_at = start_date::timestamptz,  -- attribute to the period month
         paid_by = null                      -- shows as "System" in activity
   where autopay
     and status = 'pending'
     and start_date <= current_date
     and payment_method is not null;         -- CHECK requires one on paid rows
  get diagnostics settled = row_count;
  return settled;
end $$;

revoke all on function public.settle_autopay_expenses() from public, anon, authenticated;

-- 4) Toggle RPC: stamp the chain; on enable, settle its due rows now ----------
create or replace function public.set_expense_autopay(
  p_expense_id uuid,
  p_enabled boolean,
  p_payment_method text default null
)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_chain uuid;
  v_billing text;
  v_tip_method text;
  settled int := 0;
begin
  if not public.current_user_is_admin() then
    raise exception 'admin only';
  end if;

  select coalesce(e.parent_expense_id, e.id), e.billing_type
    into v_chain, v_billing
    from public.expenses e
   where e.id = p_expense_id;
  if v_chain is null then
    raise exception 'expense not found';
  end if;
  if v_billing = 'one_time' then
    raise exception 'autopay is only available on recurring expenses';
  end if;

  update public.expenses e
     set autopay = p_enabled
   where coalesce(e.parent_expense_id, e.id) = v_chain;

  if p_enabled then
    -- Fill missing payment methods; never overwrite an existing one.
    if nullif(trim(coalesce(p_payment_method, '')), '') is not null then
      update public.expenses e
         set payment_method = trim(p_payment_method)
       where coalesce(e.parent_expense_id, e.id) = v_chain
         and e.payment_method is null;
    end if;

    -- The chain tip is what the spawner copies from — it must have a method.
    select e.payment_method
      into v_tip_method
      from public.expenses e
     where coalesce(e.parent_expense_id, e.id) = v_chain
     order by e.start_date desc, e.created_at desc
     limit 1;
    if v_tip_method is null then
      raise exception 'payment method required to enable autopay';
    end if;

    -- Settle this chain's already-due pending rows immediately.
    update public.expenses e
       set status = 'paid',
           paid_at = e.start_date::timestamptz,
           paid_by = null
     where coalesce(e.parent_expense_id, e.id) = v_chain
       and e.autopay
       and e.status = 'pending'
       and e.start_date <= current_date
       and e.payment_method is not null;
    get diagnostics settled = row_count;
  end if;

  return settled;
end $$;

revoke all on function public.set_expense_autopay(uuid, boolean, text) from public, anon;
grant execute on function public.set_expense_autopay(uuid, boolean, text) to authenticated;

-- 5) Cron: spawn first, then settle (wrapper keeps one clear entry point) -----
create or replace function public.run_daily_expenses()
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.ensure_recurring_expenses();
  perform public.settle_autopay_expenses();
end $$;

revoke all on function public.run_daily_expenses() from public, anon, authenticated;

select cron.unschedule('daily_ensure_recurring_expenses')
 where exists (select 1 from cron.job where jobname = 'daily_ensure_recurring_expenses');

select cron.schedule(
  'daily_ensure_recurring_expenses',
  '5 2 * * *',
  $$ select public.run_daily_expenses(); $$
);

-- ROLLBACK:
-- select cron.unschedule('daily_ensure_recurring_expenses')
--   where exists (select 1 from cron.job where jobname = 'daily_ensure_recurring_expenses');
-- select cron.schedule('daily_ensure_recurring_expenses', '5 2 * * *',
--   $$ select public.ensure_recurring_expenses(); $$);
-- drop function if exists public.run_daily_expenses();
-- drop function if exists public.set_expense_autopay(uuid, boolean, text);
-- drop function if exists public.settle_autopay_expenses();
-- (restore ensure_recurring_expenses body from
--  supabase/migrations/20260601000004_ensure_recurring_expenses.sql)
-- alter table public.expenses drop column if exists autopay;
