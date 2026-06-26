-- One-time: (a) unblock any job currently blocked while in a Done stage; (b) move every job
-- of an already-Closed deal that isn't in 'closed' to its board's 'closed' lane. Existing jobs
-- only — never create. Back up job state first.
create table if not exists public.lifecycle_cleanup_jobs_backup_20260626 as
  select id as job_id, deal_id, stage_id, is_blocked, blocked_reason, status, completed_at, now() as backed_up_at
    from public.jobs where not archived;

-- (a) unblock blocked Done jobs
update public.jobs j set is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null
  from public.pipeline_stages s
 where s.id=j.stage_id and s.code='done' and j.is_blocked and not j.archived;

-- (b) closed deals -> all jobs to board's 'closed'
update public.jobs j
   set status='completed', completed_at=coalesce(j.completed_at, now()),
       is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null,
       stage_id = coalesce((select cs.id from public.pipeline_stages cs
                             where cs.board=cur.board and cs.code='closed' and not cs.archived limit 1), j.stage_id)
  from public.deals d
  join public.pipeline_stages dps on dps.id=d.accounting_stage_id,
       public.pipeline_stages cur
 where j.deal_id=d.id and not d.archived and dps.code='closed'
   and not j.archived and cur.id=j.stage_id and cur.code <> 'closed';

-- ROLLBACK: update jobs j set stage_id=b.stage_id, is_blocked=b.is_blocked, blocked_reason=b.blocked_reason,
--   status=b.status, completed_at=b.completed_at from lifecycle_cleanup_jobs_backup_20260626 b where j.id=b.job_id;
