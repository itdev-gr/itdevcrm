-- AI SEO jobs have no board of their own (service_type='ai_seo' has no 'closed' stage) — they
-- live on the web_seo / local_seo boards. So end_job must close a job on the board of its
-- CURRENT stage, not its service_type. Redefine end_job accordingly (fallback to service_type
-- when a job has no stage). Then move the two stuck AI SEO jobs to Closed (1 web, 1 local).

create or replace function public.end_job(p_job_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_board text;
  v_closed uuid;
begin
  if not (current_user_is_admin() or current_user_can('accounting_onboarding','edit')) then
    return jsonb_build_object('ok', false, 'errors', array['permission_denied']);
  end if;
  -- board = the board the job is currently displayed on (its stage), else its service_type
  select coalesce(ps.board, j.service_type) into v_board
    from public.jobs j left join public.pipeline_stages ps on ps.id = j.stage_id
   where j.id = p_job_id;
  if not found then return jsonb_build_object('ok', false, 'errors', array['job_not_found']); end if;

  select id into v_closed
    from public.pipeline_stages
   where board = v_board and code = 'closed' and archived = false
   limit 1;

  update public.jobs set
    billing_active = false,
    status = case when status in ('cancelled','completed') then status else 'completed' end,
    completed_at = coalesce(completed_at, now()),
    stage_id = coalesce(v_closed, stage_id),
    updated_at = now()
   where id = p_job_id;

  return jsonb_build_object('ok', true, 'job_id', p_job_id);
end;
$$;

-- Back up + move the two completed AI SEO jobs to Closed (one web_seo, one local_seo).
insert into public.jobs_endjob_stage_backup_20260622 (id, old_stage_id)
select id, stage_id from public.jobs where code in ('000516-AISEO', '000516-AISEO-2');

update public.jobs
   set stage_id = (select id from public.pipeline_stages where board = 'web_seo' and code = 'closed' and archived = false limit 1),
       updated_at = now()
 where code = '000516-AISEO';

update public.jobs
   set stage_id = (select id from public.pipeline_stages where board = 'local_seo' and code = 'closed' and archived = false limit 1),
       updated_at = now()
 where code = '000516-AISEO-2';
