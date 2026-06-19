-- Records the real "Invoiced Date" from the legacy ClickUp CRM on each deal, so accounting
-- knows the true start date when manually re-creating jobs. Display-only + an anchor we set
-- onto actual_close_date during the re-baseline migration. Nullable; backfilled from ClickUp's
-- "Invoiced Date" custom field. Adding the column alone changes no behavior.
alter table public.deals add column if not exists invoiced_date date;
comment on column public.deals.invoiced_date is
  'Legacy ClickUp "Invoiced Date" — the real date the deal was first invoiced / started. Shown read-only to accounting; used as the won-date anchor during the 2026-06-19 re-baseline.';

-- ROLLBACK:
-- alter table public.deals drop column if exists invoiced_date;
