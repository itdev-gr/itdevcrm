-- =============================================================================
-- Per-job unique codes: <deal_code>-<SERVICE>[-N]  (e.g. 000013-WEBSEO,
-- second web_seo job on the same deal -> 000013-WEBSEO-2). Replaces the old
-- behaviour where every job inherited the deal code (non-unique). Also makes
-- jobs searchable by code via global_search.
-- =============================================================================

-- 1. Service-type -> short uppercase abbreviation.
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
    else upper(regexp_replace(coalesce(st, 'JOB'), '[^a-zA-Z0-9]', '', 'g'))
  end;
$$;

-- 2. Generate a unique job code; add -2/-3/... when the deal already has a job
--    of the same service. Scans existing jobs (incl. same-transaction rows).
create or replace function public.generate_job_code(p_deal_id uuid, p_service_type text)
returns text language plpgsql as $$
declare
  v_deal_code text;
  v_base text;
  v_code text;
  n int := 2;
begin
  select code into v_deal_code from public.deals where id = p_deal_id;
  v_base := coalesce(nullif(trim(coalesce(v_deal_code, '')), ''), 'JOB')
            || '-' || public.job_service_abbr(p_service_type);
  if not exists (select 1 from public.jobs where code = v_base) then
    return v_base;
  end if;
  loop
    v_code := v_base || '-' || n;
    exit when not exists (select 1 from public.jobs where code = v_code);
    n := n + 1;
  end loop;
  return v_code;
end;
$$;

-- 3. Trigger: every new job gets a generated unique code (overrides whatever the
--    creating RPC passed, so all job-creation paths stay consistent).
create or replace function public.set_job_code() returns trigger
language plpgsql as $$
begin
  new.code := public.generate_job_code(new.deal_id, new.service_type);
  return new;
end;
$$;

drop trigger if exists jobs_set_code on public.jobs;
create trigger jobs_set_code
  before insert on public.jobs
  for each row execute function public.set_job_code();

-- 4. Backfill existing jobs. Partition by the *coalesced deal code* so that two
--    deals with no code (-> 'JOB') still get globally-unique strings.
with ranked as (
  select j.id,
         coalesce(nullif(trim(coalesce(d.code, '')), ''), 'JOB') as deal_code,
         j.service_type,
         row_number() over (
           partition by coalesce(nullif(trim(coalesce(d.code, '')), ''), 'JOB'), j.service_type
           order by j.created_at, j.id
         ) as rn
  from public.jobs j
  join public.deals d on d.id = j.deal_id
)
update public.jobs j
set code = r.deal_code || '-' || public.job_service_abbr(r.service_type)
           || case when r.rn = 1 then '' else '-' || r.rn end
from ranked r
where j.id = r.id;

-- 5. Enforce uniqueness now that codes are distinct.
drop index if exists public.jobs_code;
create unique index jobs_code_unique on public.jobs (code) where code is not null;

-- 6. Extend global_search with a jobs branch (full re-create; identical to
--    20260503000002 plus the jobs union).
create or replace function public.global_search(q text, max_rows int default 20)
returns table (
  entity_type text, entity_id uuid, code text, label text, sublabel text, rank int
)
language sql stable security invoker as $$
  with norm as (select lower(trim(q)) as qn),
  hits as (
    select 'lead'::text as entity_type, l.id as entity_id, l.code,
      coalesce(nullif(trim(coalesce(l.contact_first_name,'')||' '||coalesce(l.contact_last_name,'')),''),
               l.company_name, l.title) as label,
      coalesce(l.company_name, l.email, l.phone, l.industry) as sublabel,
      case when l.code = (select qn from norm) then 0 else 2 end as rank,
      l.updated_at as updated_at
    from public.leads l, norm
    where l.archived = false and (
      l.code ilike '%'||norm.qn||'%'
      or lower(coalesce(l.title,'')) like '%'||norm.qn||'%'
      or lower(coalesce(l.contact_first_name,'')) like '%'||norm.qn||'%'
      or lower(coalesce(l.contact_last_name,'')) like '%'||norm.qn||'%'
      or lower(coalesce(l.email,'')) like '%'||norm.qn||'%'
      or lower(coalesce(l.phone,'')) like '%'||norm.qn||'%'
      or lower(coalesce(l.company_name,'')) like '%'||norm.qn||'%'
      or lower(coalesce(l.industry,'')) like '%'||norm.qn||'%'
      or lower(coalesce(l.country,'')) like '%'||norm.qn||'%'
      or lower(coalesce(l.address,'')) like '%'||norm.qn||'%'
      or lower(coalesce(l.vat_number,'')) like '%'||norm.qn||'%'
      or lower(coalesce(l.notes,'')) like '%'||norm.qn||'%'
      or lower(coalesce(l.additional_notes,'')) like '%'||norm.qn||'%'
      or lower(coalesce(l.website,'')) like '%'||norm.qn||'%')

    union all

    select 'client'::text, c.id, c.code,
      coalesce(c.name, c.email, c.phone) as label,
      coalesce(c.industry, c.email, c.phone) as sublabel,
      case when c.code = (select qn from norm) then 0 else 1 end as rank,
      c.updated_at
    from public.clients c, norm
    where c.archived = false and (
      coalesce(c.code,'') ilike '%'||norm.qn||'%'
      or lower(coalesce(c.name,'')) like '%'||norm.qn||'%'
      or lower(coalesce(c.contact_first_name,'')) like '%'||norm.qn||'%'
      or lower(coalesce(c.contact_last_name,'')) like '%'||norm.qn||'%'
      or lower(coalesce(c.email,'')) like '%'||norm.qn||'%'
      or lower(coalesce(c.phone,'')) like '%'||norm.qn||'%'
      or lower(coalesce(c.industry,'')) like '%'||norm.qn||'%'
      or lower(coalesce(c.country,'')) like '%'||norm.qn||'%'
      or lower(coalesce(c.address,'')) like '%'||norm.qn||'%'
      or lower(coalesce(c.vat_number,'')) like '%'||norm.qn||'%'
      or lower(coalesce(c.website,'')) like '%'||norm.qn||'%')

    union all

    select 'deal'::text, d.id, d.code, d.title,
      coalesce(d.description,'') as sublabel,
      case when d.code = (select qn from norm) then 0 else 1 end as rank,
      d.updated_at
    from public.deals d, norm
    where d.archived = false and (
      coalesce(d.code,'') ilike '%'||norm.qn||'%'
      or lower(coalesce(d.title,'')) like '%'||norm.qn||'%'
      or lower(coalesce(d.description,'')) like '%'||norm.qn||'%')

    union all

    -- Jobs (new)
    select 'job'::text, j.id, j.code,
      coalesce(jc.name, j.title) as label,
      coalesce(j.service_type,'')
        || case when jd.code is not null then ' · ' || jd.code else '' end as sublabel,
      case when j.code = (select qn from norm) then 0 else 1 end as rank,
      j.updated_at
    from public.jobs j
    left join public.clients jc on jc.id = j.client_id
    left join public.deals jd on jd.id = j.deal_id, norm
    where j.archived = false and (
      coalesce(j.code,'') ilike '%'||norm.qn||'%'
      or lower(coalesce(j.title,'')) like '%'||norm.qn||'%'
      or lower(coalesce(j.service_type,'')) like '%'||norm.qn||'%')
  )
  select entity_type, entity_id, code, label, sublabel, rank
  from hits
  order by rank asc, updated_at desc
  limit max_rows;
$$;

grant execute on function public.global_search(text, int) to authenticated;

-- ROLLBACK (manual):
--   drop trigger if exists jobs_set_code on public.jobs;
--   drop function if exists public.set_job_code();
--   drop function if exists public.generate_job_code(uuid, text);
--   drop function if exists public.job_service_abbr(text);
--   drop index if exists public.jobs_code_unique;
--   create index if not exists jobs_code on public.jobs (code) where code is not null;
--   update public.jobs j set code = d.code from public.deals d where d.id = j.deal_id;
--   -- re-apply 20260503000002_global_search.sql to drop the jobs branch.
