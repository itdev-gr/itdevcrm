-- =============================================================================
-- Task 2 (financial-correctness program): paid rows require a REAL payment
-- date. A row can never become status='paid' without paid_at set, and never
-- with paid_at in the future (allowing a 1-day grace for timezone slop).
--
-- Spec: .superpowers/sdd/2026-08-27-financial-correctness-program/task-2-brief.md
--
-- Autopay-guard audit (why the `> current_date + 1` threshold needs NO
-- relaxation, despite settling rows "due within 7 days"):
--   - ensure_recurring_expenses() (20260707000000) spawns new rows up to 7
--     days ahead of their start_date, but those rows are inserted 'pending'
--     — untouched by this trigger until they are later marked paid.
--   - settle_autopay_expenses() and set_expense_autopay()'s immediate-settle
--     path (both in 20260707000000) only flip pending -> paid rows where
--     `start_date <= current_date`, and they set paid_at = start_date. So the
--     paid_at they write is, by construction, never later than today — the
--     "due within 7 days" window governs when a row is SPAWNED (pending),
--     not when it is SETTLED (paid). No conflict with the guard below.
--   - accounting_prepay_months() (20260716220000, redefined 20260716250000)
--     inserts paid rows with paid_at = now() — always "today", passes.
--   - seed_deal_payments inserts pending rows only — unaffected.
-- Chosen option: keep the trigger exactly as specified, do not special-case
-- autopay or add a pg_trigger_depth() exemption — it isn't needed.
-- =============================================================================

create or replace function public.money_paid_needs_date()
returns trigger language plpgsql as $$
begin
  if new.status = 'paid' then
    if new.paid_at is null then
      raise exception 'paid rows require paid_at (the real payment date)';
    end if;
    if new.paid_at::date > current_date + 1 then
      raise exception 'paid_at cannot be in the future';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists deal_payments_paid_needs_date_trg on public.deal_payments;
create trigger deal_payments_paid_needs_date_trg
  before insert or update on public.deal_payments
  for each row execute function public.money_paid_needs_date();

drop trigger if exists expenses_paid_needs_date_trg on public.expenses;
create trigger expenses_paid_needs_date_trg
  before insert or update on public.expenses
  for each row execute function public.money_paid_needs_date();

-- ROLLBACK:
-- drop trigger if exists deal_payments_paid_needs_date_trg on public.deal_payments;
-- drop trigger if exists expenses_paid_needs_date_trg on public.expenses;
-- drop function if exists public.money_paid_needs_date();
