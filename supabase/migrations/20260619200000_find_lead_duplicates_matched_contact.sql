-- Enrich find_lead_duplicates: also return the matched record's email + phone so the
-- review queue can show the duplicate it found (not just its name). Adds matched_email
-- and matched_phone to every branch. Stored matches on new intake rows pick these up
-- automatically (webhook + import_leads_to_intake pass the function output through).

-- Return type changes (added columns) require dropping first. Callers (webhook,
-- import_leads_to_intake) resolve the function by name at call time, so this is safe.
drop function if exists public.find_lead_duplicates(text, text);

create function public.find_lead_duplicates(p_email text, p_phone text)
returns table (
  match_type text,     -- 'lead' | 'deal_client' | 'queued'
  record_id uuid,
  display_name text,
  context text,
  matched_field text,  -- 'email' | 'phone'
  matched_email text,
  matched_phone text
)
language sql
stable
security definer
set search_path = public
as $$
  with norm as (
    select
      nullif(lower(trim(coalesce(p_email,''))), '') as email,
      case
        when length(regexp_replace(coalesce(p_phone,''), '[^0-9]', '', 'g')) >= 10
          then right(regexp_replace(coalesce(p_phone,''), '[^0-9]', '', 'g'), 10)
        else null
      end as phone
  )
  select 'lead'::text, l.id,
         coalesce(
           nullif(trim(coalesce(l.contact_first_name,'') || ' ' || coalesce(l.contact_last_name,'')), ''),
           l.company_name, l.email, 'lead'),
         coalesce(ps.display_names->>'en', ps.code),
         case when n.email is not null and lower(trim(l.email)) = n.email then 'email' else 'phone' end,
         l.email, l.phone
  from public.leads l
  left join public.pipeline_stages ps on ps.id = l.stage_id
  cross join norm n
  where (n.email is not null and lower(trim(l.email)) = n.email)
     or (n.phone is not null and l.phone_normalized = n.phone)

  union all

  select 'deal_client'::text, c.id,
         coalesce(c.name, c.email, 'client'),
         (select string_agg(d.code, ', ') from public.deals d where d.client_id = c.id),
         case when n.email is not null and lower(trim(c.email)) = n.email then 'email' else 'phone' end,
         c.email, c.phone
  from public.clients c
  cross join norm n
  where exists (select 1 from public.deals d where d.client_id = c.id)
    and ((n.email is not null and lower(trim(c.email)) = n.email)
      or (n.phone is not null and c.phone_normalized = n.phone))

  union all

  select 'queued'::text, q.id,
         coalesce(
           nullif(trim(coalesce(q.contact_first_name,'') || ' ' || coalesce(q.contact_last_name,'')), ''),
           q.company_name, q.email, 'lead'),
         'in review queue',
         case when n.email is not null and lower(trim(q.email)) = n.email then 'email' else 'phone' end,
         q.email, q.phone
  from public.lead_intake q
  cross join norm n
  where q.status = 'pending'
    and ((n.email is not null and lower(trim(q.email)) = n.email)
      or (n.phone is not null and q.phone_normalized = n.phone));
$$;

grant execute on function public.find_lead_duplicates(text, text) to authenticated, service_role;

-- ROLLBACK: re-apply the body from 20260619180000 (without matched_email/matched_phone).
