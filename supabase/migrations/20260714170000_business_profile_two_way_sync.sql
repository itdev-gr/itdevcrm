-- Business Profile two-way sync: deal <-> local_seo job (name + url).
-- Before: deal-side edits after job creation were dropped (name: fill-only
-- guard; url: no late sync existed) and job Info-tab edits never reached the
-- deal — accounting and the local team each saw only their own copy.
-- New rule: when a deal has EXACTLY ONE active local_seo job (not archived,
-- status='active'), deal and job mirror each other: a changed NON-EMPTY value
-- overwrites the other side. With 2+ active local_seo jobs (multi-business
-- deals) overwrite is ambiguous: deal->job falls back to fill-empty-only and
-- job->deal is skipped. Clearing a value never propagates.
-- Every synced UPDATE carries an is-distinct guard, so echoes terminate.
-- Plan: docs/superpowers/plans/2026-07-14-business-profile-two-way-sync.md
-- Forward-only. Rollback at bottom.

-- 1) deal -> job: NAME. Replaces the 2026-07-03 fill-only body.
create or replace function public.deals_sync_business_profile_name()
returns trigger language plpgsql security definer set search_path = public as $function$
declare v_name text; v_active int;
begin
  v_name := nullif(trim(coalesce(new.business_profile_name,'')), '');
  if v_name is not null
     and new.business_profile_name is distinct from old.business_profile_name then
    select count(*) into v_active from public.jobs
     where deal_id = new.id and service_type = 'local_seo'
       and not archived and status = 'active';
    update public.jobs j
       set details = coalesce(j.details, '{}'::jsonb)
                     || jsonb_build_object('business_profile', v_name)
     where j.deal_id = new.id
       and j.service_type = 'local_seo'
       and not j.archived
       and j.status = 'active'
       and nullif(trim(coalesce(j.details->>'business_profile','')), '') is distinct from v_name
       and (v_active = 1
            or nullif(trim(coalesce(j.details->>'business_profile','')), '') is null);
  end if;
  return new;
end $function$;

drop trigger if exists deals_sync_business_profile_name on public.deals;
create trigger deals_sync_business_profile_name
  after update of business_profile_name on public.deals
  for each row execute function public.deals_sync_business_profile_name();

-- 2) deal -> job: URL. New — no late-sync existed for the url at all.
create or replace function public.deals_sync_business_profile_url()
returns trigger language plpgsql security definer set search_path = public as $function$
declare v_url text; v_active int;
begin
  v_url := nullif(trim(coalesce(new.business_profile_url,'')), '');
  if v_url is not null
     and new.business_profile_url is distinct from old.business_profile_url then
    select count(*) into v_active from public.jobs
     where deal_id = new.id and service_type = 'local_seo'
       and not archived and status = 'active';
    update public.jobs j
       set details = coalesce(j.details, '{}'::jsonb)
                     || jsonb_build_object('profile_url', v_url)
     where j.deal_id = new.id
       and j.service_type = 'local_seo'
       and not j.archived
       and j.status = 'active'
       and nullif(trim(coalesce(j.details->>'profile_url','')), '') is distinct from v_url
       and (v_active = 1
            or nullif(trim(coalesce(j.details->>'profile_url','')), '') is null);
  end if;
  return new;
end $function$;

drop trigger if exists deals_sync_business_profile_url on public.deals;
create trigger deals_sync_business_profile_url
  after update of business_profile_url on public.deals
  for each row execute function public.deals_sync_business_profile_url();

-- 3) job -> deal reverse sync (new). Fires on INSERT too: a job inserted with
-- pre-filled values (e.g. recurring spawn copying details) backfills a blank
-- deal. Only when this job is the deal's sole active local_seo job.
create or replace function public.jobs_sync_business_profile_to_deal()
returns trigger language plpgsql security definer set search_path = public as $function$
declare
  v_name text; v_url text; v_old_name text; v_old_url text; v_active int;
begin
  if new.service_type <> 'local_seo' or new.deal_id is null
     or new.archived or new.status <> 'active' then
    return new;
  end if;
  v_name := nullif(trim(coalesce(new.details->>'business_profile','')), '');
  v_url  := nullif(trim(coalesce(new.details->>'profile_url','')), '');
  if tg_op = 'UPDATE' then
    v_old_name := nullif(trim(coalesce(old.details->>'business_profile','')), '');
    v_old_url  := nullif(trim(coalesce(old.details->>'profile_url','')), '');
  end if;
  if (v_name is not null and v_name is distinct from v_old_name)
     or (v_url is not null and v_url is distinct from v_old_url) then
    select count(*) into v_active from public.jobs
     where deal_id = new.deal_id and service_type = 'local_seo'
       and not archived and status = 'active';
    if v_active = 1 then
      update public.deals d
         set business_profile_name = case
               when v_name is not null and v_name is distinct from v_old_name
               then v_name else d.business_profile_name end,
             business_profile_url = case
               when v_url is not null and v_url is distinct from v_old_url
               then v_url else d.business_profile_url end
       where d.id = new.deal_id
         and (   (v_name is not null and v_name is distinct from v_old_name
                  and nullif(trim(coalesce(d.business_profile_name,'')),'') is distinct from v_name)
              or (v_url is not null and v_url is distinct from v_old_url
                  and nullif(trim(coalesce(d.business_profile_url,'')),'') is distinct from v_url));
    end if;
  end if;
  return new;
end $function$;

drop trigger if exists jobs_sync_business_profile_to_deal on public.jobs;
create trigger jobs_sync_business_profile_to_deal
  after insert or update of details on public.jobs
  for each row execute function public.jobs_sync_business_profile_to_deal();

-- ROLLBACK (manual):
--   drop trigger if exists jobs_sync_business_profile_to_deal on public.jobs;
--   drop function if exists public.jobs_sync_business_profile_to_deal();
--   drop trigger if exists deals_sync_business_profile_url on public.deals;
--   drop function if exists public.deals_sync_business_profile_url();
--   -- then restore the fill-only name-sync body + trigger from
--   -- supabase/migrations/20260703120000_business_profile_name.sql:115-134.
