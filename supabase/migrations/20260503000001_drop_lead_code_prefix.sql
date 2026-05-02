-- =============================================================================
-- Drop the "L-" prefix from lead codes; codes are now plain zero-padded
-- 6-digit numbers (000001, 000002, ...). Strips the prefix from every
-- existing row in leads / clients / deals / jobs so the change is consistent
-- across the pipeline.
-- =============================================================================
create or replace function public.generate_lead_code() returns text
language sql as $$
  select lpad(nextval('public.lead_code_seq')::text, 6, '0');
$$;

-- Backfill: strip "L-" from any pre-existing codes.
update public.leads   set code = substring(code from 3) where code like 'L-%';
update public.clients set code = substring(code from 3) where code like 'L-%';
update public.deals   set code = substring(code from 3) where code like 'L-%';
update public.jobs    set code = substring(code from 3) where code like 'L-%';
