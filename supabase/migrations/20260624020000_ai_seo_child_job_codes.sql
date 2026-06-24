-- 20260624020000_ai_seo_child_job_codes.sql
-- A web_seo/local_seo job that is a CHILD of an ai_seo billing record gets a
-- parentage-aware abbreviation so the code reads as AI SEO work
-- (<deal>-AISEOWEB / <deal>-AISEOLOC) instead of plain WEBSEO/LOCALSEO.
create or replace function public.set_job_code() returns trigger
language plpgsql as $$
declare
  v_parent_service text;
  v_service_for_code text;
begin
  v_service_for_code := new.service_type;
  if new.parent_job_id is not null then
    select service_type into v_parent_service from public.jobs where id = new.parent_job_id;
    if v_parent_service = 'ai_seo' then
      v_service_for_code := case new.service_type
        when 'web_seo'   then 'aiseo_web'
        when 'local_seo' then 'aiseo_local'
        else new.service_type end;
    end if;
  end if;
  new.code := public.generate_job_code(new.deal_id, v_service_for_code);
  return new;
end;
$$;

create or replace function public.job_service_abbr(st text) returns text
language sql immutable as $$
  select case st
    when 'web_seo'      then 'WEBSEO'
    when 'local_seo'    then 'LOCALSEO'
    when 'web_dev'      then 'WEBDEV'
    when 'social_media' then 'SOCIAL'
    when 'hosting'      then 'HOSTING'
    when 'ads'          then 'ADS'
    when 'ai_seo'       then 'AISEO'
    when 'aiseo_web'    then 'AISEOWEB'
    when 'aiseo_local'  then 'AISEOLOC'
    else upper(regexp_replace(coalesce(st, 'JOB'), '[^a-zA-Z0-9]', '', 'g'))
  end;
$$;

-- ROLLBACK: re-apply the bodies from 20260618130000_job_unique_codes.sql
--   (set_job_code without the parent branch; job_service_abbr without aiseo_web/aiseo_local).
