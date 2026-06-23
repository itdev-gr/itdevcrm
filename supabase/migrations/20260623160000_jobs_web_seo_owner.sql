-- 20260623160000_jobs_web_seo_owner.sql
-- =============================================================================
-- Force every web_seo job to be owned by pefstathiadis@itdev.gr, mirroring the
-- local_seo -> dtzouvaras rule (jobs_local_seo_owner): a BEFORE INSERT trigger
-- that sets the owner on every new web_seo job, plus a one-time backfill of the
-- existing web_seo jobs (all 29 currently unassigned).
-- pefstathiadis@itdev.gr = 19aa9170-bd62-4319-8118-668c11e93c98
-- =============================================================================

create or replace function public.jobs_web_seo_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.service_type = 'web_seo' then
    new.owner_user_id := '19aa9170-bd62-4319-8118-668c11e93c98';
  end if;
  return new;
end $$;

drop trigger if exists jobs_web_seo_owner on public.jobs;
create trigger jobs_web_seo_owner
  before insert on public.jobs
  for each row execute function public.jobs_web_seo_owner();

-- one-time backfill of existing web_seo jobs
update public.jobs
   set owner_user_id = '19aa9170-bd62-4319-8118-668c11e93c98'
 where service_type = 'web_seo'
   and owner_user_id is distinct from '19aa9170-bd62-4319-8118-668c11e93c98';

-- ---------------------------------------------------------------------------
-- Rollback:
--   drop trigger if exists jobs_web_seo_owner on public.jobs;
--   drop function if exists public.jobs_web_seo_owner();
--   -- existing web_seo jobs were all unassigned before this migration:
--   update public.jobs set owner_user_id = null where service_type = 'web_seo';
-- ---------------------------------------------------------------------------
