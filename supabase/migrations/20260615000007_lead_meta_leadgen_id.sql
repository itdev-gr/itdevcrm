-- Dedup key for Meta lead-ad ingestion: the Facebook leadgen id. A partial
-- unique index lets the webhook be safely retried without duplicating a lead.
alter table public.leads add column meta_leadgen_id text;
create unique index leads_meta_leadgen_id_uniq
  on public.leads (meta_leadgen_id) where meta_leadgen_id is not null;

-- ROLLBACK:
--   drop index if exists public.leads_meta_leadgen_id_uniq;
--   alter table public.leads drop column if exists meta_leadgen_id;
