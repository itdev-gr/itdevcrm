-- Local SEO "Closed → Disconnect" reminder (owner request 2026-08-28).
-- When a Local SEO job reaches the Closed lane the team must remove the agency's
-- access from the client's Google Business Profile. These two columns record
-- that it was done (who/when) so the kanban card + job page can flip the red
-- "Disconnect" indicator to green "Disconnected". Lives on jobs (not jobs.details)
-- because JobInfoPanel autosaves the whole details object and would wipe it.
-- Additive + nullable; safe on production.
alter table public.jobs add column if not exists disconnected_at timestamptz;
alter table public.jobs add column if not exists disconnected_by uuid references auth.users(id) on delete set null;

comment on column public.jobs.disconnected_at is
  'Local SEO: when the team removed our access from the client''s GBP after the job closed. NULL = not yet.';
comment on column public.jobs.disconnected_by is
  'Local SEO: auth.users id of the staff member who pressed Disconnect.';

-- ROLLBACK:
-- alter table public.jobs
--   drop column if exists disconnected_by,
--   drop column if exists disconnected_at;
