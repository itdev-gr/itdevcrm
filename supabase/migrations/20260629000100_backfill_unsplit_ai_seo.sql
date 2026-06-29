-- 20260629000100_backfill_unsplit_ai_seo.sql
-- Data repair: split any non-archived ai_seo job that was never converted into the
-- 3-row trio (billing record + web child + local child). The 2026-06-24 backfill
-- (20260624070000) only touched ON-board ai_seo jobs (stage_id IS NOT NULL); the
-- single OFF-board jobs emitted by release_billing_jobs_for_deal at deal-insert
-- were missed, and the release path won't re-split an existing ai_seo job.
--
-- Today this is exactly one deal: 001089 (job a8e02f2c-4f03-48a6-aba4-e1759702ee8a,
-- billing_only=false, off-board, no children). Written generically + idempotently
-- (the parent-has-children guard) so it also sweeps any straggler and is safe to
-- re-run. Mirrors 20260625000000_fix_004977_ai_seo_split.sql.

-- 1. Snapshot for rollback (the parents we are about to repair).
create table if not exists public.jobs_unsplit_aiseo_backup_20260629 as
select id, deal_id, stage_id, owner_user_id, billing_only, billing_active
from public.jobs jb
where jb.service_type = 'ai_seo' and not jb.archived
  and not exists (select 1 from public.jobs c where c.parent_job_id = jb.id);

-- 2. For each un-split ai_seo job: create web + local children, then convert the
--    original into the off-board billing record.
do $$
declare
  j record;
  v_web_stage uuid; v_web_group uuid; v_local_stage uuid; v_local_group uuid;
begin
  select id into v_web_group   from public.groups where code='web_seo';
  select id into v_local_group from public.groups where code='local_seo';
  select id into v_web_stage   from public.pipeline_stages where board='web_seo'   and archived=false order by position limit 1;
  select id into v_local_stage from public.pipeline_stages where board='local_seo' and archived=false order by position limit 1;

  for j in
    select * from public.jobs jb
    where jb.service_type = 'ai_seo' and not jb.archived
      and not exists (select 1 from public.jobs c where c.parent_job_id = jb.id)
  loop
    -- web child (pefstathiadis via jobs_web_seo_owner; code -> <deal>-AISEOWEB via set_job_code)
    insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate,
        title, is_custom, billing_only, billing_active, status, stage_id, assigned_group_id,
        parent_job_id, is_blocked, started_at)
      values (j.deal_id, j.client_id, 'web_seo', j.billing_type, 0, coalesce(j.vat_rate,24),
        'AI SEO — Web', true, false, false, j.status, v_web_stage, v_web_group,
        j.id, false, coalesce(j.started_at, now()));

    -- local child (dtzouvaras via jobs_local_seo_owner; code -> <deal>-AISEOLOC via set_job_code)
    insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate,
        title, is_custom, billing_only, billing_active, status, stage_id, assigned_group_id,
        parent_job_id, is_blocked, started_at)
      values (j.deal_id, j.client_id, 'local_seo', j.billing_type, 0, coalesce(j.vat_rate,24),
        'AI SEO — Local', true, false, false, j.status, v_local_stage, v_local_group,
        j.id, false, coalesce(j.started_at, now()));

    -- convert the original into the off-board billing record (unowned)
    update public.jobs set billing_only = true, billing_active = true, stage_id = null,
        owner_user_id = null, updated_at = now()
      where id = j.id;
  end loop;
end $$;

-- ROLLBACK:
--   delete from public.jobs where parent_job_id in (select id from public.jobs_unsplit_aiseo_backup_20260629);
--   update public.jobs j set stage_id=b.stage_id, owner_user_id=b.owner_user_id,
--       billing_only=b.billing_only, billing_active=b.billing_active
--     from public.jobs_unsplit_aiseo_backup_20260629 b where j.id=b.id;
--   drop table if exists public.jobs_unsplit_aiseo_backup_20260629;
