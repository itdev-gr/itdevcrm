-- =============================================================================
-- Add website column to leads (lead form needs it; clients table already has it)
-- =============================================================================
alter table public.leads add column if not exists website text;
