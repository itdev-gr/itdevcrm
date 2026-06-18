-- One-time cleanup: the deals already in accounting "Closed" have ~100 jobs still
-- sitting in active kanban lanes (web_seo "stuck", social "active", etc.). Mark
-- them done and move each to its board's close lane:
--   web_seo / local_seo -> done ; web_dev / social_media / ads / hosting -> closed.
-- (Depends on 20260618000006 having created the new "closed" lanes.)
with closed_deals as (
  select d.id
  from public.deals d
  join public.pipeline_stages acs on acs.id = d.accounting_stage_id
  where acs.code = 'closed' and not d.archived
),
targets as (
  select j.id as job_id, tgt.id as target_stage_id
  from public.jobs j
  join closed_deals cd on cd.id = j.deal_id
  join public.pipeline_stages cur on cur.id = j.stage_id
  join lateral (
    select ts.id
    from public.pipeline_stages ts
    where ts.board = cur.board
      and ts.is_terminal
      and ts.code = case when cur.board in ('web_seo','local_seo') then 'done' else 'closed' end
    limit 1
  ) tgt on true
  where not j.archived and not cur.is_terminal   -- only the active-lane jobs
)
update public.jobs j
   set status = 'completed',
       completed_at = coalesce(j.completed_at, now()),
       stage_id = t.target_stage_id,
       is_blocked = false, blocked_reason = null, blocked_at = null, blocked_by = null
  from targets t
 where j.id = t.job_id;

-- ROLLBACK: none — irreversible data cleanup (original stages not retained).
