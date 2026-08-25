-- =============================================================================
-- 2026-08-25: lead_email_statuses also returns `identity`, so the lead Emails
-- box can render owner-Gmail sends (identity 'personal') as green "sent" —
-- Gmail gives no delivered/bounced signal, so 'sent' is terminal there.
--
-- Redefines lead_email_statuses (last: 20260825160000 perf rewrite — return
-- type changes, so drop+recreate). md5 pre/post captured in deploy output:
-- LIVE DRIFT CHECK 2026-08-25: pre-md5 recorded at deploy (= 20260825160000).
-- =============================================================================

drop function if exists public.lead_email_statuses(uuid);
create function public.lead_email_statuses(p_lead_id uuid)
returns table (
  id uuid, to_email text, template_key text, status text, identity text,
  delivered_at timestamptz, bounced_at timestamptz, error text,
  created_at timestamptz, dedupe_key text
)
language plpgsql security definer set search_path = public stable as $$
declare
  v_patterns text[];
begin
  select array_agg(p) into v_patterns from (
    select '%' || p_lead_id::text || '%' as p
    union all
    select 'seq:' || r.id::text || ':%' from public.lead_sequence_runs r
     where r.lead_id = p_lead_id
  ) t;

  return query
  select el.id, el.to_email, el.template_key, el.status, el.identity,
         el.delivered_at, el.bounced_at, el.error, el.created_at, el.dedupe_key
    from public.email_log el
   where el.dedupe_key like any (v_patterns)
   order by el.created_at desc;
end $$;

revoke all on function public.lead_email_statuses(uuid) from public;
grant execute on function public.lead_email_statuses(uuid) to authenticated;

-- ROLLBACK: restore the 20260825160000 version (without identity).
