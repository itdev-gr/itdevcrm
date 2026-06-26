-- Same fix for Web SEO (incl. AI SEO web children): Done/Closed jobs for clients paid in the
-- last ~3 days -> Renewal. (At apply time this matched 0 rows — no web SEO was Done/Closed for
-- those clients — but kept for symmetry + idempotent re-runs.) Target 'renewal' so no email fires.
create table if not exists public.webseo_renewal_backup_20260626 as
  select j.id as job_id, j.deal_id, j.stage_id as prev_stage_id, j.is_blocked as prev_blocked, now() as backed_up_at
    from public.jobs j
    join public.deals d on d.id = j.deal_id and not d.archived
    join public.pipeline_stages s on s.id = j.stage_id
   where j.service_type = 'web_seo' and not j.archived and s.code in ('done','closed')
     and exists (select 1 from public.deal_payments dp where dp.deal_id = d.id and dp.status = 'paid'
                  and coalesce(dp.paid_at, dp.updated_at) >= now() - interval '3 days');

update public.jobs j
   set stage_id = (select id from public.pipeline_stages where board='web_seo' and code='renewal' and not archived limit 1),
       is_blocked = false, blocked_reason = null, blocked_at = null, blocked_by = null
  from public.webseo_renewal_backup_20260626 b
 where j.id = b.job_id;

-- ROLLBACK: update jobs j set stage_id=b.prev_stage_id, is_blocked=b.prev_blocked
--   from webseo_renewal_backup_20260626 b where j.id=b.job_id;
