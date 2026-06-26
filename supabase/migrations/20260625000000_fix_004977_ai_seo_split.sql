-- 20260625000000_fix_004977_ai_seo_split.sql
-- One-job repair: deal 004977 (SPRINGSelatirio.gr) has a single old-style ai_seo
-- job (818353cb…2763) that was never converted into the 3-row split. It was
-- created 2026-06-23 as an OFF-BOARD billing job (stage_id IS NULL), so the
-- 2026-06-24 backfill skipped it (that migration only touched ai_seo jobs with
-- stage_id IS NOT NULL) and the release path won't re-split an existing ai_seo
-- job. Result: no web_seo / local_seo children → Web & Local SEO teams see nothing.
--
-- This mirrors 20260624070000_backfill_ai_seo_three_row.sql for this one job, but
-- because the parent is off-board the children start at each board's FIRST stage
-- (same as release_jobs_for_deal does for a fresh AI SEO release).

-- 1. Snapshot for rollback.
create table if not exists public.jobs_aiseo_004977_fix_backup_20260625 as
select id, stage_id, owner_user_id, billing_only
from public.jobs
where id = '818353cb-40bf-47fd-884a-9081414c2763';

-- 2. Create web + local children, then convert the parent to the billing record.
do $$
declare
  v_parent_id uuid := '818353cb-40bf-47fd-884a-9081414c2763';
  j record;
  v_web_stage uuid; v_web_group uuid;
  v_local_stage uuid; v_local_group uuid;
begin
  select * into j from public.jobs where id = v_parent_id;
  if j.id is null then raise notice 'parent not found, skipping'; return; end if;

  -- Idempotency guard: do nothing if already split.
  if exists (select 1 from public.jobs c where c.parent_job_id = v_parent_id) then
    raise notice 'already split, skipping';
    return;
  end if;

  select id into v_web_group   from public.groups where code='web_seo';
  select id into v_local_group from public.groups where code='local_seo';
  select id into v_web_stage   from public.pipeline_stages where board='web_seo'   and archived=false order by position limit 1;
  select id into v_local_stage from public.pipeline_stages where board='local_seo' and archived=false order by position limit 1;

  -- web child (pefstathiadis via trigger; code -> 004977-AISEOWEB via set_job_code)
  insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate,
      title, is_custom, billing_only, billing_active, status, stage_id, assigned_group_id,
      parent_job_id, is_blocked, started_at)
    values (j.deal_id, j.client_id, 'web_seo', j.billing_type, 0, coalesce(j.vat_rate,24),
      'AI SEO — Web', true, false, false, j.status, v_web_stage, v_web_group,
      v_parent_id, false, coalesce(j.started_at, now()));

  -- local child (dtzouvaras via trigger; code -> 004977-AISEOLOC via set_job_code)
  insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate,
      title, is_custom, billing_only, billing_active, status, stage_id, assigned_group_id,
      parent_job_id, is_blocked, started_at)
    values (j.deal_id, j.client_id, 'local_seo', j.billing_type, 0, coalesce(j.vat_rate,24),
      'AI SEO — Local', true, false, false, j.status, v_local_stage, v_local_group,
      v_parent_id, false, coalesce(j.started_at, now()));

  -- convert the original into the billing record (off-board, unowned)
  update public.jobs set billing_only = true, stage_id = null, owner_user_id = null, updated_at = now()
    where id = v_parent_id;
end $$;

-- ROLLBACK:
--   delete from public.jobs where parent_job_id = '818353cb-40bf-47fd-884a-9081414c2763';
--   update public.jobs j set stage_id = b.stage_id, owner_user_id = b.owner_user_id, billing_only = b.billing_only
--     from public.jobs_aiseo_004977_fix_backup_20260625 b where j.id = b.id;
--   drop table if exists public.jobs_aiseo_004977_fix_backup_20260625;
