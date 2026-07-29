-- Franchise leads carry investment budget + region as first-class fields
-- (spec docs/superpowers/specs/2026-07-29-franchise-import-completion-design.md).
-- Plain nullable columns: row-level RLS policies are unaffected.
alter table public.leads
  add column if not exists budget text,
  add column if not exists region text;
