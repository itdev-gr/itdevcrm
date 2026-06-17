-- Jobs become the billing unit: title/description/price/cadence/active flag live on the job.
-- All additive + nullable; safe on production. Old amount columns (monthly_amount/one_time_amount)
-- are retained for fallback and deprecated after cutover.
alter table public.jobs add column if not exists title text;
alter table public.jobs add column if not exists description text;
alter table public.jobs add column if not exists is_custom boolean not null default false;
alter table public.jobs add column if not exists amount_net numeric(12,2);
alter table public.jobs add column if not exists vat_rate numeric(5,2) not null default 24.00;
alter table public.jobs add column if not exists billing_active boolean not null default true;
alter table public.jobs add column if not exists billing_only boolean not null default false;
alter table public.jobs add column if not exists billing_group_id uuid;

create index if not exists jobs_billing_group_idx
  on public.jobs (billing_group_id) where billing_group_id is not null;

-- ROLLBACK:
-- drop index if exists jobs_billing_group_idx;
-- alter table public.jobs
--   drop column if exists billing_group_id,
--   drop column if exists billing_only,
--   drop column if exists billing_active,
--   drop column if exists vat_rate,
--   drop column if exists amount_net,
--   drop column if exists is_custom,
--   drop column if exists description,
--   drop column if exists title;
