-- =============================================================================
-- Don't auto-move a deal off the "New" accounting column when its first
-- payment rows get inserted by seed_deal_payments. New deals are supposed
-- to sit in the New column until accounting moves them manually.
--
-- Trigger keeps moving on subsequent payment inserts (renewals, manual adds)
-- as long as the deal is no longer in the New column.
-- =============================================================================

create or replace function public.deal_payments_move_to_awaiting()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  awaiting_id uuid;
  d record;
  current_stage_code text;
begin
  if new.billing_type = 'recurring_test_2min' then
    return new;
  end if;

  select id into awaiting_id
    from public.pipeline_stages
   where board = 'accounting_onboarding' and code = 'awaiting_payment'
   limit 1;
  if awaiting_id is null then
    return new;
  end if;

  select id, accounting_stage_id, accounting_completed_at
    into d
    from public.deals
   where id = new.deal_id
   limit 1;
  if d is null then
    return new;
  end if;

  if d.accounting_completed_at is not null then
    return new;
  end if;
  if d.accounting_stage_id is null then
    return new;
  end if;
  if d.accounting_stage_id = awaiting_id then
    return new;
  end if;

  select code into current_stage_code
    from public.pipeline_stages
   where id = d.accounting_stage_id;

  -- Brand-new deals stay in the New column. Accounting moves them out manually.
  if current_stage_code = 'new' then
    return new;
  end if;

  -- Don't drag a deal back from a terminal stage (paid_in_full / done).
  if exists (
    select 1 from public.pipeline_stages ps
     where ps.id = d.accounting_stage_id and ps.is_terminal = true
  ) then
    return new;
  end if;

  update public.deals
     set accounting_stage_id = awaiting_id
   where id = new.deal_id;

  return new;
end $$;
