-- =============================================================================
-- 2026-08-27: job_email_statuses(p_job_id) — client-facing automated emails
-- relevant to one job, for the Emails box on JobDetailPage (same UI as the
-- deal/lead boxes). email_log has no job_id, so association is reconstructed:
--   (a) dedupe_key contains the job id (webdev_form_auto / followup / nudge)
--   (b) dedupe_key contains the deal id, template limited to the job's service
--       templates + shared client templates (won_welcome, pay_*)
--   (c) legacy payment reminders keyed by deal_payments.id
--   (d) lead-path welcome (auto_won_welcome:<lead_id> via converted_deal_id)
--   (e) manual SEO resends (no dedupe_key) matched by service template +
--       client_id / recipient email (seo_access_sent_map precedent)
-- identity='internal' rows are always excluded.
-- =============================================================================

create function public.job_email_statuses(p_job_id uuid)
returns table (
  id uuid, to_email text, template_key text, status text, identity text,
  delivered_at timestamptz, bounced_at timestamptz, error text,
  created_at timestamptz, dedupe_key text
)
language plpgsql security definer set search_path = public stable as $$
declare
  v_deal_id uuid;
  v_client_id uuid;
  v_service text;
  v_service_templates text[];
  v_shared_templates text[] := array[
    'won_welcome', 'payment_due_soon', 'payment_overdue',
    'payment_final_notice', 'payment_reminder'];
  v_pay_patterns text[];
  v_lead_patterns text[];
  v_emails text[];
begin
  select j.deal_id, j.client_id, j.service_type
    into v_deal_id, v_client_id, v_service
    from public.jobs j where j.id = p_job_id;
  if not found then return; end if;

  v_service_templates := case v_service
    when 'web_seo'   then array['webseo_gsc_access', 'webseo_gsc_followup']
    when 'local_seo' then array['localseo_gbp_access', 'localseo_gbp_followup']
    -- ai_seo is the billing parent of web_seo + local_seo children
    when 'ai_seo'    then array['webseo_gsc_access', 'webseo_gsc_followup',
                                'localseo_gbp_access', 'localseo_gbp_followup']
    when 'web_dev'   then array['webdev_client_form', 'webdev_form_followup',
                                'webdev_waiting_nudge']
    else array[]::text[] end;

  select coalesce(array_agg('%' || dp.id::text || '%'), array[]::text[])
    into v_pay_patterns
    from public.deal_payments dp where dp.deal_id = v_deal_id;

  select coalesce(array_agg('%' || l.id::text || '%'), array[]::text[])
    into v_lead_patterns
    from public.leads l where l.converted_deal_id = v_deal_id;

  select coalesce(array_agg(distinct lower(t.e)), array[]::text[])
    into v_emails
    from (
      select c.email as e from public.clients c
       where c.id = v_client_id
      union all
      select ac->>'email'
        from public.clients c
        cross join lateral jsonb_array_elements(
          case when jsonb_typeof(c.additional_contacts) = 'array'
               then c.additional_contacts else '[]'::jsonb end) ac
       where c.id = v_client_id
    ) t where t.e is not null;

  return query
  select el.id, el.to_email, el.template_key, el.status, el.identity,
         el.delivered_at, el.bounced_at, el.error, el.created_at, el.dedupe_key
    from public.email_log el
   where el.identity <> 'internal'
     and (
       el.dedupe_key like '%' || p_job_id::text || '%'
       or (el.dedupe_key like '%' || v_deal_id::text || '%'
           and el.template_key = any (v_service_templates || v_shared_templates))
       or (el.template_key = any (v_shared_templates)
           and el.dedupe_key like any (v_pay_patterns))
       or (el.template_key = 'won_welcome'
           and el.dedupe_key like any (v_lead_patterns))
       or (el.dedupe_key is null
           and el.template_key = any (v_service_templates)
           and (el.client_id = v_client_id
                or lower(el.to_email) = any (v_emails)))
     )
   order by el.created_at desc
   limit 100;
end $$;

revoke all on function public.job_email_statuses(uuid) from public;
grant execute on function public.job_email_statuses(uuid) to authenticated;

-- ROLLBACK: drop function if exists public.job_email_statuses(uuid);
