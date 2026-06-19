-- Local SEO jobs are owned by dtzouvaras@itdev.gr.
--   1) one-time backfill: assign every existing local_seo job to him
--   2) trigger: force the owner on every newly-created local_seo job
-- User id b73d8761-cbae-4ac8-a239-878d1f2151d8 = dtzouvaras@itdev.gr.
-- Forced on INSERT only; the owner can still be changed later via a normal edit.

create or replace function public.jobs_local_seo_owner()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.service_type = 'local_seo' then
    new.owner_user_id := 'b73d8761-cbae-4ac8-a239-878d1f2151d8';
  end if;
  return new;
end;
$$;

drop trigger if exists jobs_local_seo_owner on public.jobs;
create trigger jobs_local_seo_owner
  before insert on public.jobs
  for each row execute function public.jobs_local_seo_owner();

-- One-time backfill of existing local_seo jobs.
update public.jobs
  set owner_user_id = 'b73d8761-cbae-4ac8-a239-878d1f2151d8'
where service_type = 'local_seo'
  and owner_user_id is distinct from 'b73d8761-cbae-4ac8-a239-878d1f2151d8';

-- ROLLBACK (run to fully revert this migration):
--   drop trigger if exists jobs_local_seo_owner on public.jobs;
--   drop function if exists public.jobs_local_seo_owner();
--   -- (the one-time owner backfill is data and is not auto-reverted)
