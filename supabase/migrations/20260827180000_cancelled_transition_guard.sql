-- =============================================================================
-- Task 3 (financial-correctness program): a cancelled payment cannot be
-- revived to paid with one click. job_pause_billing() (20260702100000) sets
-- rows TO cancelled when billing is paused; nothing in the codebase flips
-- cancelled -> paid programmatically (verified in the audit) — only the
-- PaymentsPanel one-click toggle could do it accidentally. This trigger
-- forces a deliberate two-step: cancelled -> pending -> paid.
--
-- Spec: .superpowers/sdd/2026-08-27-financial-correctness-program/task-3-brief.md
--
-- Coexists with deal_payments_paid_needs_date_trg (Task 2, 20260827170000):
-- different trigger name, both BEFORE UPDATE on the same table — fine.
-- =============================================================================

create or replace function public.deal_payments_block_cancel_revive()
returns trigger language plpgsql as $$
begin
  if old.status = 'cancelled' and new.status = 'paid' then
    raise exception 'cancelled payment cannot become paid directly — restore it to pending first';
  end if;
  return new;
end $$;

drop trigger if exists deal_payments_cancel_revive_trg on public.deal_payments;
create trigger deal_payments_cancel_revive_trg before update on public.deal_payments
  for each row execute function public.deal_payments_block_cancel_revive();

-- ROLLBACK:
-- drop trigger if exists deal_payments_cancel_revive_trg on public.deal_payments;
-- drop function if exists public.deal_payments_block_cancel_revive();
