-- 20260624070000_backfill_ai_seo_three_row.sql
-- Convert every existing on-board ai_seo job into the 3-row shape:
--   the job becomes the billing record (billing_only, off-board, unowned);
--   a web_seo child inherits its current stage; a local_seo child starts at the
--   mapped Local stage. Skips jobs already converted (those with children).

-- 1. Snapshot for rollback.
create table if not exists public.jobs_ai_seo_split_backup_20260624 as
select id, stage_id, owner_user_id, billing_only
from public.jobs
where service_type = 'ai_seo' and not archived and stage_id is not null;

-- 2. Create web + local children, then convert the parent. Loop for stage mapping.
do $$
declare j record; v_local_stage uuid; v_local_code text; v_web_group uuid; v_local_group uuid;
begin
  select id into v_web_group from public.groups where code='web_seo';
  select id into v_local_group from public.groups where code='local_seo';
  for j in
    select jb.* from public.jobs jb
    where jb.service_type = 'ai_seo' and not jb.archived and jb.stage_id is not null
      and not exists (select 1 from public.jobs c where c.parent_job_id = jb.id)
  loop
    -- map the parent's web stage code to a local stage code (mirror of kanbanGrouping)
    select case ws.code
      when 'new_project' then 'new_project'
      when 'no_response' then 'called_no_response'
      when 'renewal' then 'renewal'
      when 'stuck' then 'suspended'
      when 'done' then 'done'
      else 'optimize' end
    into v_local_code
    from public.pipeline_stages ws where ws.id = j.stage_id;

    select id into v_local_stage from public.pipeline_stages
      where board='local_seo' and code = coalesce(v_local_code, 'optimize') and archived=false limit 1;
    if v_local_stage is null then
      select id into v_local_stage from public.pipeline_stages
        where board='local_seo' and archived=false order by position limit 1;
    end if;

    -- ② web child (inherits the parent's current web stage; pefstathiadis via trigger)
    insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate,
        title, is_custom, billing_only, billing_active, status, stage_id, assigned_group_id,
        parent_job_id, is_blocked, blocked_reason, blocked_at, started_at, code)
      values (j.deal_id, j.client_id, 'web_seo', j.billing_type, 0, coalesce(j.vat_rate,24),
        'AI SEO — Web', true, false, false, j.status, j.stage_id, v_web_group,
        j.id, j.is_blocked, j.blocked_reason, j.blocked_at, j.started_at, j.code);

    -- ③ local child (mapped local stage; dtzouvaras via trigger)
    insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate,
        title, is_custom, billing_only, billing_active, status, stage_id, assigned_group_id,
        parent_job_id, is_blocked, blocked_reason, blocked_at, started_at, code)
      values (j.deal_id, j.client_id, 'local_seo', j.billing_type, 0, coalesce(j.vat_rate,24),
        'AI SEO — Local', true, false, false, j.status, v_local_stage, v_local_group,
        j.id, j.is_blocked, j.blocked_reason, j.blocked_at, j.started_at, j.code);

    -- ① convert the original into the billing record (off-board, unowned)
    update public.jobs set billing_only = true, stage_id = null, owner_user_id = null, updated_at = now()
      where id = j.id;
  end loop;
end $$;

-- ROLLBACK:
--   delete from public.jobs where parent_job_id in (select id from public.jobs_ai_seo_split_backup_20260624);
--   update public.jobs j set stage_id = b.stage_id, owner_user_id = b.owner_user_id, billing_only = b.billing_only
--     from public.jobs_ai_seo_split_backup_20260624 b where j.id = b.id;
--   drop table if exists public.jobs_ai_seo_split_backup_20260624;
