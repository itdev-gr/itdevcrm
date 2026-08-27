-- =============================================================================
-- Task 4 (financial-correctness program): period locks — closed months are
-- physically frozen. Once an admin locks 'YYYY-MM', no PAID row in
-- deal_payments or expenses whose reporting month falls in that period can
-- have its money-relevant fields changed or be deleted, at the database
-- level (RLS/UI bypass does not matter — the trigger enforces it on every
-- UPDATE/DELETE, including ones issued directly via SQL or the service role
-- key... actually SECURITY DEFINER functions run as their owner and normal
-- triggers still fire for them since triggers are not RLS; only a
-- superuser/table-owner doing a raw `ALTER TABLE ... DISABLE TRIGGER` could
-- bypass this, which is not a thing the app does).
--
-- Spec: .superpowers/sdd/2026-08-27-financial-correctness-program/task-4-brief.md
--
-- Design choice (flagged issue in the brief): the brief's guard SQL
-- references `new.service_type`, which exists on deal_payments but NOT on
-- expenses. Implemented as ONE function (money_period_lock_guard) with a
-- `tg_table_name` branch, rather than two thin wrappers — plpgsql resolves
-- `old`/`new` field access at execution time (they are RECORD, not a fixed
-- row type), so the deal_payments-only branch referencing
-- old/new.service_type never gets evaluated when the trigger fires on
-- expenses, and vice versa for the expenses-only branch referencing
-- old/new.vendor / old/new.category_id. One function reads cleaner than two
-- near-duplicate wrappers and keeps the "money-relevant fields" list next to
-- itself instead of split across two definitions that could drift apart.
--
-- Money-relevant (frozen) fields once a paid row's period is locked:
--   deal_payments: amount_net, vat_rate, status, paid_at, start_date, service_type
--   expenses:      amount_net, vat_rate, status, paid_at, start_date, vendor, category_id
--     (service_type has no expenses equivalent; vendor + category_id are the
--      closest "what/who this money was for" fields on that table, called
--      out explicitly by the brief as the substitute guard.)
-- Harmless (still editable) fields on a locked paid row: notes, receipt_path,
-- autopay, payment_method, invoice_number, label, end_date, paid_by, etc.
--
-- Period attribution matches accounting_ledger_v: paid_at's date if set,
-- else start_date (both tables use the same convention post-Task 1/2).
--
-- Coexists with: deal_payments_cancel_revive_trg (Task 3, 20260827180000),
-- deal_payments_paid_needs_date_trg (Task 2, 20260827170000),
-- expenses_paid_needs_date_trg (Task 2) — different trigger names, all
-- BEFORE UPDATE on the same tables, no conflict. This trigger neither reads
-- nor writes any field those triggers touch beyond old/new comparisons.
-- =============================================================================

create table public.accounting_period_locks (
  period    text primary key check (period ~ '^\d{4}-\d{2}$'),
  locked_at timestamptz not null default now(),
  locked_by uuid references public.profiles(user_id) on delete set null
);

alter table public.accounting_period_locks enable row level security;

-- Admins manage + read the table directly (for the management list in the
-- UI). Non-admins never touch it directly — RLS blocks them outright; the
-- lock/unlock RPCs below re-check admin status themselves as a defense in
-- depth measure (SECURITY DEFINER bypasses RLS for its own writes).
create policy period_locks_admin_all on public.accounting_period_locks
  for all to authenticated
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

create or replace function public.money_period_lock_guard()
returns trigger language plpgsql as $$
declare
  v_period       text;
  v_money_changed boolean;
begin
  -- The row's reporting month (same attribution as accounting_ledger_v).
  v_period := to_char(coalesce(old.paid_at::date, old.start_date), 'YYYY-MM');

  if old.status = 'paid'
     and exists (select 1 from public.accounting_period_locks l where l.period = v_period) then
    if tg_op = 'DELETE' then
      raise exception 'period % is locked — paid rows cannot be deleted (unlock the month first)', v_period;
    end if;

    if tg_table_name = 'deal_payments' then
      v_money_changed :=
        new.amount_net is distinct from old.amount_net
        or new.vat_rate is distinct from old.vat_rate
        or new.status is distinct from old.status
        or new.paid_at is distinct from old.paid_at
        or new.start_date is distinct from old.start_date
        or new.service_type is distinct from old.service_type;
    else -- public.expenses: no service_type column; guard vendor + category_id instead.
      v_money_changed :=
        new.amount_net is distinct from old.amount_net
        or new.vat_rate is distinct from old.vat_rate
        or new.status is distinct from old.status
        or new.paid_at is distinct from old.paid_at
        or new.start_date is distinct from old.start_date
        or new.vendor is distinct from old.vendor
        or new.category_id is distinct from old.category_id;
    end if;

    if v_money_changed then
      raise exception 'period % is locked — unlock the month before editing paid rows', v_period;
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists deal_payments_period_lock_trg on public.deal_payments;
create trigger deal_payments_period_lock_trg before update or delete on public.deal_payments
  for each row execute function public.money_period_lock_guard();

drop trigger if exists expenses_period_lock_trg on public.expenses;
create trigger expenses_period_lock_trg before update or delete on public.expenses
  for each row execute function public.money_period_lock_guard();

create or replace function public.lock_accounting_period(p_period text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.current_user_is_admin() then
    raise exception 'admin only';
  end if;
  if p_period !~ '^\d{4}-\d{2}$' then
    raise exception 'invalid period % — expected YYYY-MM', p_period;
  end if;

  insert into public.accounting_period_locks (period, locked_by)
    values (p_period, auth.uid())
    on conflict (period) do nothing;
end $$;

create or replace function public.unlock_accounting_period(p_period text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.current_user_is_admin() then
    raise exception 'admin only';
  end if;
  if p_period !~ '^\d{4}-\d{2}$' then
    raise exception 'invalid period % — expected YYYY-MM', p_period;
  end if;

  delete from public.accounting_period_locks where period = p_period;
end $$;

grant execute on function public.lock_accounting_period(text) to authenticated;
grant execute on function public.unlock_accounting_period(text) to authenticated;

-- ROLLBACK:
-- grant/revoke is dropped implicitly with the functions.
-- drop function if exists public.unlock_accounting_period(text);
-- drop function if exists public.lock_accounting_period(text);
-- drop trigger if exists expenses_period_lock_trg on public.expenses;
-- drop trigger if exists deal_payments_period_lock_trg on public.deal_payments;
-- drop function if exists public.money_period_lock_guard();
-- drop policy if exists period_locks_admin_all on public.accounting_period_locks;
-- drop table if exists public.accounting_period_locks;
