-- =============================================================================
-- global_search performance fix: stop the RLS policy functions from being
-- re-evaluated per-row across the whole table set.
--
-- PROBLEM
--   The previous global_search was `security invoker`, so Postgres injected each
--   table's RLS USING predicate -- which calls current_user_is_admin() /
--   current_user_can() (the latter queries the user_effective_permissions VIEW) --
--   into every table scan. Because the search uses leading-wildcard ILIKE
--   (no index can help), the scan touches EVERY non-archived row, so those
--   functions ran ~5,000+ times per call. For broad-visibility users (admins and
--   sales `view_all` managers) a single call took ~1.9s warm and, under page-load
--   contention / cold cache, exceeded the 8s `statement_timeout`, returning 500
--   (PostgREST). It self-recovered once load eased -- i.e. intermittent 500s for
--   every privileged user. (Observed in prod 2026-06-23.)
--
-- FIX
--   Make global_search `security definer` and compute the caller's access ONCE
--   into local variables (is_admin, the set of view/edit boards, sales view_all),
--   then filter each table with those cached booleans + cheap column comparisons
--   (owner_user_id = uid, service_type = any(boards)). No per-row function calls.
--
--   The visibility below is an EXACT mirror of the SELECT-applicable RLS policies
--   on each table as of this migration:
--     leads_select   : is_admin OR can(sales,view_all) OR owner = uid
--     clients_select : is_admin OR can(clients,view)
--     deals_select   : is_admin OR can(accounting_onboarding,view)
--                              OR can(accounting_recurring,view)
--                              OR ((can(sales,view) OR can(clients,view))
--                                  AND (owner = uid OR won_by = uid))
--     jobs           : is_admin OR can(service_type,view)
--                              OR can(accounting_recurring,view)
--                              OR can(accounting_onboarding,view)
--                              OR can(service_type,edit)   -- jobs_mutate_admin_or_service (FOR ALL)
--   where can(board,action) := is_admin OR (board,action) is allowed in
--   user_effective_permissions for the caller.
--
--   IMPORTANT: if those RLS policies change, this function must be updated to
--   match (it is the one place that duplicates them, traded for a ~15x speedup).
-- =============================================================================

create or replace function public.global_search(q text, max_rows int default 20)
returns table (
  entity_type text, entity_id uuid, code text, label text, sublabel text, rank int
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid          uuid    := auth.uid();
  v_is_admin     boolean := public.current_user_is_admin();
  v_view_boards  text[];
  v_edit_boards  text[];
  v_view_all     boolean;
  -- precomputed, table-level visibility (constant for this call)
  v_leads_all    boolean;
  v_clients_all  boolean;
  v_deals_all    boolean;
  v_deals_own    boolean;  -- may see own/won deals (needs the owner/won row check)
  v_jobs_all     boolean;
  qn             text    := lower(trim(coalesce(q, '')));
begin
  -- Mirror the frontend's 2-char minimum; also avoids a pointless full scan on
  -- empty/1-char input (where '%%' would match every row).
  if length(qn) < 2 then
    return;
  end if;

  select coalesce(array_agg(board) filter (where action = 'view'), '{}'::text[]),
         coalesce(array_agg(board) filter (where action = 'edit'), '{}'::text[])
    into v_view_boards, v_edit_boards
  from public.user_effective_permissions
  where user_id = v_uid and allowed = true;

  v_view_all := v_is_admin or exists (
    select 1 from public.user_effective_permissions
    where user_id = v_uid and board = 'sales' and action = 'view_all' and allowed = true
  );

  v_leads_all   := v_is_admin or v_view_all;
  v_clients_all := v_is_admin or ('clients' = any(v_view_boards));
  v_deals_all   := v_is_admin
                   or ('accounting_onboarding' = any(v_view_boards))
                   or ('accounting_recurring'  = any(v_view_boards));
  v_deals_own   := ('sales' = any(v_view_boards)) or ('clients' = any(v_view_boards));
  v_jobs_all    := v_is_admin
                   or ('accounting_recurring'  = any(v_view_boards))
                   or ('accounting_onboarding' = any(v_view_boards));

  return query
  with hits as (
    -- Leads
    select 'lead'::text as entity_type, l.id as entity_id, l.code,
      coalesce(nullif(trim(coalesce(l.contact_first_name,'')||' '||coalesce(l.contact_last_name,'')),''),
               l.company_name, l.title) as label,
      coalesce(l.company_name, l.email, l.phone, l.industry) as sublabel,
      case when l.code = qn then 0 else 2 end as rank,
      l.updated_at as updated_at
    from public.leads l
    where l.archived = false
      and (v_leads_all or l.owner_user_id = v_uid)
      and (
        l.code ilike '%'||qn||'%'
        or lower(coalesce(l.title,'')) like '%'||qn||'%'
        or lower(coalesce(l.contact_first_name,'')) like '%'||qn||'%'
        or lower(coalesce(l.contact_last_name,'')) like '%'||qn||'%'
        or lower(coalesce(l.email,'')) like '%'||qn||'%'
        or lower(coalesce(l.phone,'')) like '%'||qn||'%'
        or lower(coalesce(l.company_name,'')) like '%'||qn||'%'
        or lower(coalesce(l.industry,'')) like '%'||qn||'%'
        or lower(coalesce(l.country,'')) like '%'||qn||'%'
        or lower(coalesce(l.address,'')) like '%'||qn||'%'
        or lower(coalesce(l.vat_number,'')) like '%'||qn||'%'
        or lower(coalesce(l.notes,'')) like '%'||qn||'%'
        or lower(coalesce(l.additional_notes,'')) like '%'||qn||'%'
        or lower(coalesce(l.website,'')) like '%'||qn||'%')

    union all

    -- Clients
    select 'client'::text, c.id, c.code,
      coalesce(c.name, c.email, c.phone) as label,
      coalesce(c.industry, c.email, c.phone) as sublabel,
      case when c.code = qn then 0 else 1 end as rank,
      c.updated_at
    from public.clients c
    where c.archived = false
      and v_clients_all
      and (
        coalesce(c.code,'') ilike '%'||qn||'%'
        or lower(coalesce(c.name,'')) like '%'||qn||'%'
        or lower(coalesce(c.contact_first_name,'')) like '%'||qn||'%'
        or lower(coalesce(c.contact_last_name,'')) like '%'||qn||'%'
        or lower(coalesce(c.email,'')) like '%'||qn||'%'
        or lower(coalesce(c.phone,'')) like '%'||qn||'%'
        or lower(coalesce(c.industry,'')) like '%'||qn||'%'
        or lower(coalesce(c.country,'')) like '%'||qn||'%'
        or lower(coalesce(c.address,'')) like '%'||qn||'%'
        or lower(coalesce(c.vat_number,'')) like '%'||qn||'%'
        or lower(coalesce(c.website,'')) like '%'||qn||'%')

    union all

    -- Deals
    select 'deal'::text, d.id, d.code, d.title,
      coalesce(d.description,'') as sublabel,
      case when d.code = qn then 0 else 1 end as rank,
      d.updated_at
    from public.deals d
    where d.archived = false
      and (v_deals_all
           or (v_deals_own and (d.owner_user_id = v_uid or d.won_by_user_id = v_uid)))
      and (
        coalesce(d.code,'') ilike '%'||qn||'%'
        or lower(coalesce(d.title,'')) like '%'||qn||'%'
        or lower(coalesce(d.description,'')) like '%'||qn||'%')

    union all

    -- Jobs
    select 'job'::text, j.id, j.code,
      coalesce(jc.name, j.title) as label,
      coalesce(j.service_type,'')
        || case when jd.code is not null then ' · ' || jd.code else '' end as sublabel,
      case when j.code = qn then 0 else 1 end as rank,
      j.updated_at
    from public.jobs j
    left join public.clients jc on jc.id = j.client_id
    left join public.deals jd on jd.id = j.deal_id
    where j.archived = false
      and (v_jobs_all
           or j.service_type = any(v_view_boards)
           or j.service_type = any(v_edit_boards))
      and (
        coalesce(j.code,'') ilike '%'||qn||'%'
        or lower(coalesce(j.title,'')) like '%'||qn||'%'
        or lower(coalesce(j.service_type,'')) like '%'||qn||'%')
  )
  select h.entity_type, h.entity_id, h.code, h.label, h.sublabel, h.rank
  from hits h
  order by h.rank asc, h.updated_at desc
  limit max_rows;
end;
$$;

-- Least privilege: this is now SECURITY DEFINER (bypasses RLS), so restrict it
-- to signed-in users only. (anon already gets zero rows since auth.uid() is null
-- and every visibility flag is false, but don't expose it on the public API.)
revoke execute on function public.global_search(text, int) from public, anon;
grant execute on function public.global_search(text, int) to authenticated;

-- ROLLBACK (manual): re-apply 20260618130000_job_unique_codes.sql section 6,
-- which recreates global_search as `security sql / security invoker` with the
-- jobs branch (the slow-but-RLS-native version this migration replaces).
