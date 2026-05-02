-- =============================================================================
-- Drop unused recurring-billing infra (external invoicer handles this).
-- client_blocks STAYS — block-client is still our mechanism to halt tech work.
-- =============================================================================

-- Stop the daily cron job first (if pg_cron is installed and the job exists)
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('daily_mark_overdue_invoices');
  end if;
exception when others then
  -- if already unscheduled, ignore
  null;
end $$;

-- Drop RPCs
drop function if exists public.generate_monthly_invoices(text);
drop function if exists public.mark_overdue_invoices();

-- Drop tables (FK from items to invoices is `on delete cascade`)
drop table if exists public.monthly_invoice_items;
drop table if exists public.monthly_invoices;
