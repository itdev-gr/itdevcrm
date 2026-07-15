-- 20260715130000_web_dev_info_seed.sql
-- Spec: docs/superpowers/specs/2026-07-15-webdev-website-industry-info-design.md
-- Plan: docs/superpowers/plans/2026-07-15-webdev-website-industry-info.md
--
-- Seed the client's website + industry (clients.website / clients.industry, set
-- from the deal's Company section) into a web_dev job's Info tab
-- (jobs.details.website / jobs.details.industry) on creation, and backfill
-- existing web_dev jobs. Mirrors jobs_seed_web_website (web_seo). Scope:
-- service_type='web_dev' only. Fill-empty only (never overwrites a value).

-- 1. Auto-seed trigger (BEFORE INSERT) -----------------------------------------
create or replace function public.jobs_seed_web_dev_info()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_url text; v_ind text;
begin
  if new.service_type = 'web_dev' and new.client_id is not null then
    select nullif(trim(coalesce(website,'')), ''),
           nullif(trim(coalesce(industry,'')), '')
      into v_url, v_ind
      from public.clients where id = new.client_id;

    if v_url is not null
       and nullif(trim(coalesce(new.details->>'website','')), '') is null then
      new.details := coalesce(new.details, '{}'::jsonb) || jsonb_build_object('website', v_url);
    end if;

    if v_ind is not null
       and nullif(trim(coalesce(new.details->>'industry','')), '') is null then
      new.details := coalesce(new.details, '{}'::jsonb) || jsonb_build_object('industry', v_ind);
    end if;
  end if;
  return new;
end $$;

drop trigger if exists jobs_seed_web_dev_info on public.jobs;
create trigger jobs_seed_web_dev_info
  before insert on public.jobs
  for each row execute function public.jobs_seed_web_dev_info();

-- 2. One-time backfill (+ backup) ---------------------------------------------
create table if not exists public.jobs_web_dev_info_backfill_backup_20260715 as
  select j.id as job_id, j.details as prev_details, now() as backed_up_at
    from public.jobs j join public.clients c on c.id = j.client_id
   where j.service_type = 'web_dev' and not j.archived
     and ( (nullif(trim(coalesce(j.details->>'website','')), '') is null
            and nullif(trim(coalesce(c.website,'')), '') is not null)
        or (nullif(trim(coalesce(j.details->>'industry','')), '') is null
            and nullif(trim(coalesce(c.industry,'')), '') is not null) );

update public.jobs j
   set details = coalesce(j.details, '{}'::jsonb)
                 || jsonb_build_object('website', nullif(trim(c.website), ''))
  from public.clients c
 where c.id = j.client_id and j.service_type = 'web_dev' and not j.archived
   and nullif(trim(coalesce(j.details->>'website','')), '') is null
   and nullif(trim(coalesce(c.website,'')), '') is not null;

update public.jobs j
   set details = coalesce(j.details, '{}'::jsonb)
                 || jsonb_build_object('industry', nullif(trim(c.industry), ''))
  from public.clients c
 where c.id = j.client_id and j.service_type = 'web_dev' and not j.archived
   and nullif(trim(coalesce(j.details->>'industry','')), '') is null
   and nullif(trim(coalesce(c.industry,'')), '') is not null;

-- ROLLBACK:
--   drop trigger if exists jobs_seed_web_dev_info on public.jobs;
--   drop function if exists public.jobs_seed_web_dev_info();
--   -- backfill is additive (JSONB keys); prior details are preserved in
--   -- public.jobs_web_dev_info_backfill_backup_20260715
