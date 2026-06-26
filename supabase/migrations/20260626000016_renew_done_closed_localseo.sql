-- Move Local SEO jobs that are Done/Closed (for the 17 clients paid in the last ~3 days,
-- reported to the user) to Renewal. Backup prior stage first. Target is 'renewal' (not
-- new_project) so no onboarding email fires.
create table if not exists public.localseo_renewal_backup_20260626 as
  select j.id as job_id, j.deal_id, j.stage_id as prev_stage_id, j.is_blocked as prev_blocked, now() as backed_up_at
    from public.jobs j
    join public.deals d on d.id = j.deal_id
    join public.pipeline_stages s on s.id = j.stage_id
   where j.service_type = 'local_seo' and not j.archived and s.code in ('done','closed')
     and d.code in ('000040','000053','000066','000070','000159','000233','000245','000257',
                    '000270','000303','000473','000501','005036',
                    '000416','005093','005094','005096');

update public.jobs j
   set stage_id = (select id from public.pipeline_stages where board='local_seo' and code='renewal' and not archived limit 1),
       is_blocked = false, blocked_reason = null, blocked_at = null, blocked_by = null
  from public.localseo_renewal_backup_20260626 b
 where j.id = b.job_id;

-- ROLLBACK: update jobs j set stage_id=b.prev_stage_id, is_blocked=b.prev_blocked
--   from localseo_renewal_backup_20260626 b where j.id=b.job_id;
