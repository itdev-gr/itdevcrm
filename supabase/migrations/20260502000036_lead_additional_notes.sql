-- =============================================================================
-- Add a second free-text field on leads. "Lead info" stays mapped to the
-- existing `notes` column; "Notes" renders the new `additional_notes` so
-- sales can keep them separate (Lead info = source/context, Notes = running
-- observations).
-- =============================================================================
alter table public.leads add column if not exists additional_notes text;
