-- =============================================================================
-- global_search(q, max_rows): cross-entity search across leads, clients, deals.
-- security invoker so the existing RLS policies on each table naturally filter
-- to only what the calling user can see — admins get everything, sales see
-- their scope, accounting see theirs, etc.
-- =============================================================================
create or replace function public.global_search(q text, max_rows int default 20)
returns table (
  entity_type text,
  entity_id uuid,
  code text,
  label text,
  sublabel text,
  rank int
)
language sql stable security invoker as $$
  with norm as (select lower(trim(q)) as qn),
  hits as (
    -- Leads
    select
      'lead'::text as entity_type,
      l.id as entity_id,
      l.code,
      coalesce(
        nullif(trim(coalesce(l.contact_first_name, '') || ' ' || coalesce(l.contact_last_name, '')), ''),
        l.company_name,
        l.title
      ) as label,
      coalesce(l.company_name, l.email, l.phone, l.industry) as sublabel,
      case when l.code = (select qn from norm) then 0 else 2 end as rank,
      l.updated_at as updated_at
    from public.leads l, norm
    where l.archived = false
      and (
        l.code ilike '%' || norm.qn || '%'
        or lower(coalesce(l.title, '')) like '%' || norm.qn || '%'
        or lower(coalesce(l.contact_first_name, '')) like '%' || norm.qn || '%'
        or lower(coalesce(l.contact_last_name, '')) like '%' || norm.qn || '%'
        or lower(coalesce(l.email, '')) like '%' || norm.qn || '%'
        or lower(coalesce(l.phone, '')) like '%' || norm.qn || '%'
        or lower(coalesce(l.company_name, '')) like '%' || norm.qn || '%'
        or lower(coalesce(l.industry, '')) like '%' || norm.qn || '%'
        or lower(coalesce(l.country, '')) like '%' || norm.qn || '%'
        or lower(coalesce(l.address, '')) like '%' || norm.qn || '%'
        or lower(coalesce(l.vat_number, '')) like '%' || norm.qn || '%'
        or lower(coalesce(l.notes, '')) like '%' || norm.qn || '%'
        or lower(coalesce(l.additional_notes, '')) like '%' || norm.qn || '%'
        or lower(coalesce(l.website, '')) like '%' || norm.qn || '%'
      )

    union all

    -- Clients
    select
      'client'::text,
      c.id,
      c.code,
      coalesce(c.name, c.email, c.phone) as label,
      coalesce(c.industry, c.email, c.phone) as sublabel,
      case when c.code = (select qn from norm) then 0 else 1 end as rank,
      c.updated_at
    from public.clients c, norm
    where c.archived = false
      and (
        coalesce(c.code, '') ilike '%' || norm.qn || '%'
        or lower(coalesce(c.name, '')) like '%' || norm.qn || '%'
        or lower(coalesce(c.contact_first_name, '')) like '%' || norm.qn || '%'
        or lower(coalesce(c.contact_last_name, '')) like '%' || norm.qn || '%'
        or lower(coalesce(c.email, '')) like '%' || norm.qn || '%'
        or lower(coalesce(c.phone, '')) like '%' || norm.qn || '%'
        or lower(coalesce(c.industry, '')) like '%' || norm.qn || '%'
        or lower(coalesce(c.country, '')) like '%' || norm.qn || '%'
        or lower(coalesce(c.address, '')) like '%' || norm.qn || '%'
        or lower(coalesce(c.vat_number, '')) like '%' || norm.qn || '%'
        or lower(coalesce(c.website, '')) like '%' || norm.qn || '%'
      )

    union all

    -- Deals
    select
      'deal'::text,
      d.id,
      d.code,
      d.title,
      coalesce(d.description, '') as sublabel,
      case when d.code = (select qn from norm) then 0 else 1 end as rank,
      d.updated_at
    from public.deals d, norm
    where d.archived = false
      and (
        coalesce(d.code, '') ilike '%' || norm.qn || '%'
        or lower(coalesce(d.title, '')) like '%' || norm.qn || '%'
        or lower(coalesce(d.description, '')) like '%' || norm.qn || '%'
      )
  )
  select entity_type, entity_id, code, label, sublabel, rank
  from hits
  order by rank asc, updated_at desc
  limit max_rows;
$$;

grant execute on function public.global_search(text, int) to authenticated;
