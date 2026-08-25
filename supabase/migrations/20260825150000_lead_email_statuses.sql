-- =============================================================================
-- 2026-08-25: lead_email_statuses — the lead-page twin of deal_email_statuses
-- (20260709140000): every automated email sent for a lead, with delivery
-- status, for the "Emails (N)" box on the lead detail page.
--
-- email_log has no lead_id (and client_id is null for non-client leads), so
-- matching goes through dedupe keys:
--   * direct-keyed templates carry the lead UUID inside the key
--     (lead_welcome:<id>, scheduled_*:<id>:..., auto_won_welcome:<id>,
--      won_next_steps:<id>) → "dedupe_key contains the lead UUID";
--   * sequence emails (noanswer/offer/reengage) are keyed
--     seq:<lead_sequence_runs.id>:<step_id> → join through the lead's runs.
-- SECURITY DEFINER because email_log RLS is admin-only.
--
-- No function redefinitions in this migration (the function is new), so no
-- pg_get_functiondef md5 pre/post capture is required.
-- =============================================================================

drop function if exists public.lead_email_statuses(uuid);
create function public.lead_email_statuses(p_lead_id uuid)
returns table (
  id uuid, to_email text, template_key text, status text,
  delivered_at timestamptz, bounced_at timestamptz, error text,
  created_at timestamptz, dedupe_key text
)
language sql security definer set search_path = public stable as $$
  select el.id, el.to_email, el.template_key, el.status, el.delivered_at,
         el.bounced_at, el.error, el.created_at, el.dedupe_key
    from public.email_log el
   where el.dedupe_key like '%' || p_lead_id::text || '%'
      or exists (select 1 from public.lead_sequence_runs r
                  where r.lead_id = p_lead_id
                    and el.dedupe_key like 'seq:' || r.id::text || ':%')
   order by el.created_at desc;
$$;

revoke all on function public.lead_email_statuses(uuid) from public;
grant execute on function public.lead_email_statuses(uuid) to authenticated;

-- ROLLBACK:
--   drop function if exists public.lead_email_statuses(uuid);
