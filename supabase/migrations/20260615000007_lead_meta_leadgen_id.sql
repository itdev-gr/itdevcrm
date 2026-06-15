-- OPTIONAL performance index for Meta lead-ad dedup.
-- The /api/meta-lead webhook already works without this — it dedups on the Meta
-- lead id stored in source_data->>'leadgen_id'. This index just makes that
-- lookup fast once lead volume grows. Safe to apply at any time; non-breaking.
create index if not exists leads_meta_leadgen_idx
  on public.leads ((source_data ->> 'leadgen_id'))
  where source = 'meta';

-- ROLLBACK:
--   drop index if exists public.leads_meta_leadgen_idx;
