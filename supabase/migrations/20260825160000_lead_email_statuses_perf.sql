-- =============================================================================
-- 2026-08-25: performance fix for lead_email_statuses (created earlier today
-- in 20260825150000). The original correlated EXISTS ran a LIKE over ALL
-- lead_sequence_runs for EVERY email_log row (8.6k x 6.2k comparisons — ~20s
-- for sequence-heavy leads, found during the post-ship correctness audit).
-- Rewrite: collect the lead's few run prefixes ONCE into an array, then a
-- single pass over email_log with `like any(...)`. Same results, milliseconds.
--
-- Redefines a function authored the same day (20260825150000).
-- LIVE DRIFT CHECK 2026-08-25 (md5(pg_get_functiondef)):
--   lead_email_statuses  0dbaf942804ec42488857410965bdbd9  = 20260825150000
-- APPLIED to prod 2026-08-25, post-change md5(pg_get_functiondef):
--   lead_email_statuses  d9639f04e7df297592ee8e72082a68da
-- =============================================================================

create or replace function public.lead_email_statuses(p_lead_id uuid)
returns table (
  id uuid, to_email text, template_key text, status text,
  delivered_at timestamptz, bounced_at timestamptz, error text,
  created_at timestamptz, dedupe_key text
)
language plpgsql security definer set search_path = public stable as $$
declare
  v_patterns text[];
begin
  -- The lead's own UUID (direct-keyed templates) + one prefix per sequence run.
  select array_agg(p) into v_patterns from (
    select '%' || p_lead_id::text || '%' as p
    union all
    select 'seq:' || r.id::text || ':%' from public.lead_sequence_runs r
     where r.lead_id = p_lead_id
  ) t;

  return query
  select el.id, el.to_email, el.template_key, el.status, el.delivered_at,
         el.bounced_at, el.error, el.created_at, el.dedupe_key
    from public.email_log el
   where el.dedupe_key like any (v_patterns)
   order by el.created_at desc;
end $$;

revoke all on function public.lead_email_statuses(uuid) from public;
grant execute on function public.lead_email_statuses(uuid) to authenticated;

-- ROLLBACK: restore the SQL-language body from 20260825150000.
