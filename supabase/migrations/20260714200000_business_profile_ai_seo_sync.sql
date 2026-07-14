-- Business Profile sync: extend deal <-> job mirror to ai_seo parent jobs.
-- ai_seo cards/Info tabs expose business_profile + profile_url but were never
-- auto-populated (triggers targeted local_seo only). Now sync targets are
-- service_type in ('local_seo','ai_seo'), and the mirror gate changes from
-- "exactly 1 active local_seo job" to "exactly 1 business GROUP", where a
-- group is coalesce(parent_job_id, id): an AI SEO parent + its local_seo
-- child are ONE business and both mirror the deal. 2+ groups (multi-business
-- deals) keep fill-empty-only deal->job and no job->deal, as before.
-- Function names keep their historical *_local_* names.
-- Plan: docs/superpowers/plans/2026-07-14-business-profile-ai-seo-sync.md
-- Forward-only. Rollback at bottom.

-- 1) seed at job INSERT (name) — now also ai_seo
create or replace function public.jobs_seed_local_business_profile()
returns trigger language plpgsql security definer set search_path = public as $function$
declare v_name text;
begin
  if new.service_type in ('local_seo','ai_seo')
     and new.deal_id is not null
     and nullif(trim(coalesce(new.details->>'business_profile','')), '') is null then
    select nullif(trim(coalesce(business_profile_name,'')), '')
      into v_name from public.deals where id = new.deal_id;
    if v_name is not null then
      new.details := coalesce(new.details, '{}'::jsonb) || jsonb_build_object('business_profile', v_name);
    end if;
  end if;
  return new;
end $function$;

-- 2) seed at job INSERT (url) — now also ai_seo
create or replace function public.jobs_seed_local_profile_url()
returns trigger language plpgsql security definer set search_path = public as $function$
declare v_url text;
begin
  if new.service_type in ('local_seo','ai_seo')
     and new.deal_id is not null
     and nullif(trim(coalesce(new.details->>'profile_url','')), '') is null then
    select nullif(trim(coalesce(business_profile_url,'')), '')
      into v_url from public.deals where id = new.deal_id;
    if v_url is not null then
      new.details := coalesce(new.details, '{}'::jsonb) || jsonb_build_object('profile_url', v_url);
    end if;
  end if;
  return new;
end $function$;

-- 3) deal -> job: NAME (group-gated, local_seo + ai_seo)
create or replace function public.deals_sync_business_profile_name()
returns trigger language plpgsql security definer set search_path = public as $function$
declare v_name text; v_groups int;
begin
  v_name := nullif(trim(coalesce(new.business_profile_name,'')), '');
  if v_name is not null
     and new.business_profile_name is distinct from old.business_profile_name then
    select count(distinct coalesce(parent_job_id, id)) into v_groups from public.jobs
     where deal_id = new.id and service_type in ('local_seo','ai_seo')
       and not archived and status = 'active';
    update public.jobs j
       set details = coalesce(j.details, '{}'::jsonb)
                     || jsonb_build_object('business_profile', v_name)
     where j.deal_id = new.id
       and j.service_type in ('local_seo','ai_seo')
       and not j.archived
       and j.status = 'active'
       and nullif(trim(coalesce(j.details->>'business_profile','')), '') is distinct from v_name
       and (v_groups = 1
            or nullif(trim(coalesce(j.details->>'business_profile','')), '') is null);
  end if;
  return new;
end $function$;

-- 4) deal -> job: URL (group-gated, local_seo + ai_seo)
create or replace function public.deals_sync_business_profile_url()
returns trigger language plpgsql security definer set search_path = public as $function$
declare v_url text; v_groups int;
begin
  v_url := nullif(trim(coalesce(new.business_profile_url,'')), '');
  if v_url is not null
     and new.business_profile_url is distinct from old.business_profile_url then
    select count(distinct coalesce(parent_job_id, id)) into v_groups from public.jobs
     where deal_id = new.id and service_type in ('local_seo','ai_seo')
       and not archived and status = 'active';
    update public.jobs j
       set details = coalesce(j.details, '{}'::jsonb)
                     || jsonb_build_object('profile_url', v_url)
     where j.deal_id = new.id
       and j.service_type in ('local_seo','ai_seo')
       and not j.archived
       and j.status = 'active'
       and nullif(trim(coalesce(j.details->>'profile_url','')), '') is distinct from v_url
       and (v_groups = 1
            or nullif(trim(coalesce(j.details->>'profile_url','')), '') is null);
  end if;
  return new;
end $function$;

-- 5) job -> deal reverse (group-gated, local_seo + ai_seo)
create or replace function public.jobs_sync_business_profile_to_deal()
returns trigger language plpgsql security definer set search_path = public as $function$
declare
  v_name text; v_url text; v_old_name text; v_old_url text; v_groups int;
begin
  if new.service_type not in ('local_seo','ai_seo') or new.deal_id is null
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
    select count(distinct coalesce(parent_job_id, id)) into v_groups from public.jobs
     where deal_id = new.deal_id and service_type in ('local_seo','ai_seo')
       and not archived and status = 'active';
    if v_groups = 1 then
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

-- ROLLBACK (manual): re-apply the five function bodies from
--   supabase/migrations/20260714170000_business_profile_two_way_sync.sql (sync fns)
--   supabase/migrations/20260703120000_business_profile_name.sql (name seed)
--   supabase/migrations/20260626120000_business_profile_url.sql (url seed)
-- Triggers are unchanged by this migration (same names, same events).
