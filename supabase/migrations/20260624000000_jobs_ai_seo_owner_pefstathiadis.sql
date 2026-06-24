-- 20260624000000_jobs_ai_seo_owner_pefstathiadis.sql
-- =============================================================================
-- AI SEO jobs (service_type='ai_seo') have no kanban of their own — they live
-- on the web_seo board (see 20260509000005_fold_ai_seo_into_web_seo). So they
-- should follow the same owner rule as web_seo jobs: pefstathiadis@itdev.gr.
--
-- This broadens the existing jobs_web_seo_owner trigger (added in 5ec95ce /
-- 20260623160000) to also force the owner on ai_seo inserts, plus a one-time
-- backfill of the 52 existing ai_seo jobs (all currently unassigned).
--
-- The local_seo trigger (jobs_local_seo_owner) only matches service_type
-- 'local_seo', NOT 'ai_seo', so there is no conflict on insert.
-- pefstathiadis@itdev.gr = 19aa9170-bd62-4319-8118-668c11e93c98
-- =============================================================================

create or replace function public.jobs_web_seo_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- ai_seo jobs live on the web_seo board, so they share the web_seo owner.
  if new.service_type in ('web_seo', 'ai_seo') then
    new.owner_user_id := '19aa9170-bd62-4319-8118-668c11e93c98';
  end if;
  return new;
end $$;

-- trigger itself is unchanged (still jobs_web_seo_owner on jobs), recreate to be safe
drop trigger if exists jobs_web_seo_owner on public.jobs;
create trigger jobs_web_seo_owner
  before insert on public.jobs
  for each row execute function public.jobs_web_seo_owner();

-- one-time backfill of existing ai_seo jobs
update public.jobs
   set owner_user_id = '19aa9170-bd62-4319-8118-668c11e93c98'
 where service_type = 'ai_seo'
   and owner_user_id is distinct from '19aa9170-bd62-4319-8118-668c11e93c98';

-- ---------------------------------------------------------------------------
-- Rollback (restore the web_seo-only rule from 20260623160000):
--   create or replace function public.jobs_web_seo_owner()
--   returns trigger language plpgsql security definer set search_path = public as $$
--   begin
--     if new.service_type = 'web_seo' then
--       new.owner_user_id := '19aa9170-bd62-4319-8118-668c11e93c98';
--     end if;
--     return new;
--   end $$;
--   -- the 52 ai_seo jobs were all unassigned before this migration:
--   update public.jobs set owner_user_id = null where service_type = 'ai_seo';
-- ---------------------------------------------------------------------------
