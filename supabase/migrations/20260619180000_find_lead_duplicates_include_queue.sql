-- Now that EVERY incoming lead is held in lead_intake (not inserted into `leads`
-- until released), two submissions of the same person would both sit in the queue
-- unflagged — find_lead_duplicates only saw `leads` + deal-clients. Add a third
-- branch so a new lead is also flagged when its email/phone matches another
-- **pending** intake row (match_type 'queued'). The webhook calls this BEFORE
-- inserting the new row, so there is no self-match.

create or replace function public.find_lead_duplicates(p_email text, p_phone text)
returns table (
  match_type text,     -- 'lead' | 'deal_client' | 'queued'
  record_id uuid,
  display_name text,
  context text,
  matched_field text
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
         case when n.email is not null and lower(trim(l.email)) = n.email then 'email' else 'phone' end
  from public.leads l
  left join public.pipeline_stages ps on ps.id = l.stage_id
  cross join norm n
  where (n.email is not null and lower(trim(l.email)) = n.email)
     or (n.phone is not null and l.phone_normalized = n.phone)

  union all

  select 'deal_client'::text, c.id,
         coalesce(c.name, c.email, 'client'),
         (select string_agg(d.code, ', ') from public.deals d where d.client_id = c.id),
         case when n.email is not null and lower(trim(c.email)) = n.email then 'email' else 'phone' end
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
         case when n.email is not null and lower(trim(q.email)) = n.email then 'email' else 'phone' end
  from public.lead_intake q
  cross join norm n
  where q.status = 'pending'
    and ((n.email is not null and lower(trim(q.email)) = n.email)
      or (n.phone is not null and q.phone_normalized = n.phone));
$$;

grant execute on function public.find_lead_duplicates(text, text) to authenticated, service_role;

-- ROLLBACK: re-apply the two-branch body from 20260619160000_lead_intake.sql.
