-- Belt-and-braces: block accounting_stage_id changes when payment_method
-- isn't set. The frontend already alerts; this stops anyone who bypasses
-- the UI (raw RPC, REST, etc.) from advancing a deal without picking
-- cash / online first.

create or replace function public.guard_payment_method_before_stage_move()
returns trigger
language plpgsql as $$
begin
  if new.accounting_stage_id is distinct from old.accounting_stage_id
     and new.payment_method is null then
    raise exception 'payment_method_required'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists deals_payment_method_required on public.deals;
create trigger deals_payment_method_required
  before update on public.deals
  for each row
  execute function public.guard_payment_method_before_stage_move();

-- complete_accounting also reaches this trigger via the UPDATE inside it,
-- so paid-in-full transitions are covered by the same guard.
