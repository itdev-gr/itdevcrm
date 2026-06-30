-- Finish the trigger swap that 20260626000011_release_duedate_and_awaiting_guard.sql missed.
--
-- That migration declared a new public.deal_payments_release_from_on_hold() function with
-- the intended behavior:
--   - scope: on_hold OR partial_payment (was on_hold OR awaiting_payment in the prior trigger)
--   - guard: payment_method IS NOT NULL (so we don't trip guard_payment_method_before_stage_move)
--   - date basis: start_date <= current_date (uniform across billing_type)
--
-- But the migration only created the function — it never created a trigger that calls it.
-- The trigger left active on prod since 20260623150000 is `deal_payments_settle_to_paid_in_full`,
-- which calls the OLD `deal_payments_settle_to_paid_in_full()` function with the prior scope
-- (on_hold OR awaiting_payment), no payment_method guard, and a billing_type-split date check.
--
-- Net effect for the last few days: partial_payment deals never auto-released on final payment;
-- awaiting_payment deals still auto-jumped to paid_in_full on the last row paid; no
-- payment_method guard ran.
--
-- This migration finishes the swap.

-- 1) Drop the stale trigger that was running with the wrong scope.
drop trigger if exists deal_payments_settle_to_paid_in_full on public.deal_payments;

-- 2) Drop the now-unused function (its body has been superseded by deal_payments_release_from_on_hold).
drop function if exists public.deal_payments_settle_to_paid_in_full();

-- 3) Wire the already-defined release_from_on_hold function (from 20260626000011) to a trigger.
drop trigger if exists deal_payments_release_from_on_hold on public.deal_payments;
create trigger deal_payments_release_from_on_hold
  after update on public.deal_payments
  for each row execute function public.deal_payments_release_from_on_hold();

-- =============================================================================
-- VERIFICATION (run after apply)
--
--   -- exactly one of these two trigger names should now exist on deal_payments,
--   -- and it should be deal_payments_release_from_on_hold:
--   select tgname, tgenabled
--     from pg_trigger
--    where tgrelid = 'public.deal_payments'::regclass
--      and tgname in ('deal_payments_release_from_on_hold','deal_payments_settle_to_paid_in_full');
--
--   -- the function the trigger calls should be deal_payments_release_from_on_hold:
--   select t.tgname, p.proname
--     from pg_trigger t
--     join pg_proc p on p.oid = t.tgfoid
--    where t.tgrelid = 'public.deal_payments'::regclass
--      and t.tgname = 'deal_payments_release_from_on_hold';
--
--   -- the stale settle function should be gone:
--   select 1 from pg_proc where proname = 'deal_payments_settle_to_paid_in_full';
-- =============================================================================
-- CHANGES / REVERT
--   - DROP trigger deal_payments_settle_to_paid_in_full on public.deal_payments
--   - DROP function public.deal_payments_settle_to_paid_in_full()
--   - CREATE trigger deal_payments_release_from_on_hold on public.deal_payments
--     (after update, for each row, executes public.deal_payments_release_from_on_hold)
--
-- ROLLBACK:
--   drop trigger if exists deal_payments_release_from_on_hold on public.deal_payments;
--   -- Restore the settle function + trigger by re-applying the body block from
--   -- 20260623150000_recurring_due_date_lifecycle.sql lines 163-224 (function +
--   -- `create trigger deal_payments_settle_to_paid_in_full after update on
--   -- public.deal_payments for each row execute function
--   -- public.deal_payments_settle_to_paid_in_full();`).
-- =============================================================================
