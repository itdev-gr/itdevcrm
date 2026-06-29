-- 20260629130000_web_seo_website_seed.sql
-- Spec: docs/superpowers/specs/2026-06-29-web-seo-website-info-design.md
--
-- Seed the client's website (clients.website, set from the deal's Company section)
-- into a web_seo job's Info tab (jobs.details.website) on creation, and backfill
-- existing web_seo jobs. Mirrors jobs_seed_local_profile_url (local_seo profile_url).
-- Scope: service_type='web_seo' only (covers standalone web_seo + AI SEO's web child).

-- 1. Auto-seed trigger (BEFORE INSERT) -----------------------------------------
create or replace function public.jobs_seed_web_website()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_url text;
begin
  if new.service_type = 'web_seo'
     and new.client_id is not null
     and nullif(trim(coalesce(new.details->>'website','')), '') is null then
    select nullif(trim(coalesce(website,'')), '') into v_url from public.clients where id = new.client_id;
    if v_url is not null then
      new.details := coalesce(new.details, '{}'::jsonb) || jsonb_build_object('website', v_url);
    end if;
  end if;
  return new;
end $$;

drop trigger if exists jobs_seed_web_website on public.jobs;
create trigger jobs_seed_web_website
  before insert on public.jobs
  for each row execute function public.jobs_seed_web_website();

-- 2. One-time backfill (+ backup) ---------------------------------------------
create table if not exists public.jobs_website_backfill_backup_20260629 as
  select j.id as job_id, j.details as prev_details, now() as backed_up_at
    from public.jobs j join public.clients c on c.id = j.client_id
   where j.service_type = 'web_seo' and not j.archived
     and nullif(trim(coalesce(j.details->>'website','')), '') is null
     and nullif(trim(coalesce(c.website,'')), '') is not null;

update public.jobs j
   set details = coalesce(j.details, '{}'::jsonb) || jsonb_build_object('website', nullif(trim(c.website), ''))
  from public.clients c
 where c.id = j.client_id and j.service_type = 'web_seo' and not j.archived
   and nullif(trim(coalesce(j.details->>'website','')), '') is null
   and nullif(trim(coalesce(c.website,'')), '') is not null;

-- ROLLBACK:
--   drop trigger if exists jobs_seed_web_website on public.jobs;
--   drop function if exists public.jobs_seed_web_website();
--   -- backfill is additive (a JSONB key); prior details in jobs_website_backfill_backup_20260629
