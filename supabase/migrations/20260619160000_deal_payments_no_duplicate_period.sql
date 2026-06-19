-- Prevent duplicate recurring payment PERIODS from ANY source.
--
-- The recurring cron is now idempotent + lock-serialized (20260619150000), but the
-- ClickUp reseed inserts duplicate periods DIRECTLY (plain INSERTs that bypass the
-- cron), so the cron fix alone can't stop them. This adds a BEFORE INSERT trigger
-- that silently drops an incoming recurring_* row whose
-- (deal_id, service_index, billing_type, start_date, end_date) already exists —
-- returning NULL aborts just that row WITHOUT raising, so the active reseed is never
-- broken (its duplicate inserts simply no-op). Runs after
-- deal_payments_default_service_keys (alphabetical order) so service_index is set first.

-- ── dedup any existing duplicate periods (keep earliest pending/un-invoiced) ──
delete from public.deal_payment_lines
 where payment_id in (
   select id from (
     select id, row_number() over (partition by deal_id, billing_type, service_index, start_date, end_date
                                    order by created_at, id) rn
     from public.deal_payments where billing_type in ('recurring_monthly','recurring_yearly')
   ) x where rn > 1
     and (select status from public.deal_payments p where p.id=x.id)='pending'
     and (select invoice_number from public.deal_payments p where p.id=x.id) is null
 );
delete from public.deal_payments
 where id in (
   select id from (
     select id, status, invoice_number,
       row_number() over (partition by deal_id, billing_type, service_index, start_date, end_date
                          order by created_at, id) rn
     from public.deal_payments where billing_type in ('recurring_monthly','recurring_yearly')
   ) x where rn > 1 and status='pending' and invoice_number is null
 );

-- ── guard ─────────────────────────────────────────────────────────────────────
create or replace function public.deal_payments_no_duplicate_period()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.billing_type in ('recurring_monthly','recurring_yearly')
     and exists (
       select 1 from public.deal_payments dp
        where dp.deal_id = new.deal_id
          and dp.billing_type = new.billing_type
          and dp.service_index is not distinct from new.service_index
          and dp.start_date = new.start_date
          and dp.end_date is not distinct from new.end_date
     ) then
    return null;  -- identical recurring period already exists: drop silently
  end if;
  return new;
end $function$;

drop trigger if exists deal_payments_no_duplicate_period on public.deal_payments;
create trigger deal_payments_no_duplicate_period
  before insert on public.deal_payments
  for each row execute function public.deal_payments_no_duplicate_period();

-- CHANGES / REVERT:
--   drop trigger if exists deal_payments_no_duplicate_period on public.deal_payments;
--   drop function if exists public.deal_payments_no_duplicate_period();
