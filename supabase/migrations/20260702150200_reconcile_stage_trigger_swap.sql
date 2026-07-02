-- Instant feedback: any deal_payments change reconciles that deal's stage via the single
-- rule; and retire the two event-movers that fought the accountant. Done in one migration
-- so there is never a moment with two conflicting mover-sets.
create or replace function public.deal_payments_reconcile_stage()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public.reconcile_deal_stage(coalesce(new.deal_id, old.deal_id));
  return coalesce(new, old);
end $$;

drop trigger if exists deal_payments_reconcile_stage on public.deal_payments;
create trigger deal_payments_reconcile_stage
  after insert or update or delete on public.deal_payments
  for each row execute function public.deal_payments_reconcile_stage();

-- retire the two event-movers (functions kept for revert)
drop trigger if exists deal_payments_move_to_awaiting on public.deal_payments;
drop trigger if exists deal_payments_release_from_on_hold on public.deal_payments;

-- ============================================================================
-- REVERT:
--   drop trigger if exists deal_payments_reconcile_stage on public.deal_payments;
--   drop function if exists public.deal_payments_reconcile_stage();
--   create trigger deal_payments_move_to_awaiting after insert on public.deal_payments
--     for each row execute function public.deal_payments_move_to_awaiting();
--   create trigger deal_payments_release_from_on_hold after update on public.deal_payments
--     for each row execute function public.deal_payments_release_from_on_hold();
-- ============================================================================
