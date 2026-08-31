-- =============================================================================
-- 2026-08-31: global_search hides LEADS from accounting users entirely
-- (owner request: «στο γενικό search του accounting να μην βλέπουν leads
-- καθόλου»). Business rule ON TOP of the RLS mirror: a non-admin member of
-- the `accounting` group who is NOT also in `sales` gets zero lead rows —
-- previously the own-leads branch (owner_user_id = uid) could still surface
-- leads they happened to own. Admins and sales members are unaffected.
-- Also covers the accounting AI assistant's search_entity tool, which calls
-- this same RPC.
--
-- Redefines global_search (last: 20260623000000_global_search_perf.sql —
-- verified no later redefinitions). Byte-identical except the v_hide_leads
-- flag and the one-line leads-branch condition. Pre/post
-- md5(pg_get_functiondef) recorded in the deploy output.
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
  -- Business rule (2026-08-31): accounting-only users see NO leads in search,
  -- not even their own. Admins and accounting+sales dual members keep them.
  v_hide_leads   boolean;
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
  v_hide_leads  := (not v_is_admin)
                   and public.current_user_in_group('accounting')
                   and not public.current_user_in_group('sales');

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
      and not v_hide_leads
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

revoke execute on function public.global_search(text, int) from public, anon;
grant execute on function public.global_search(text, int) to authenticated;

-- ROLLBACK: re-apply the 20260623000000_global_search_perf.sql definition
-- (identical minus v_hide_leads and the leads-branch condition).
