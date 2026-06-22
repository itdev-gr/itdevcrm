-- When accounting ends a job, it should move to the "Closed" lane on its own department
-- board automatically. end_job marked the job completed but never changed its stage. Add the
-- stage move (to the board's 'closed' stage, if it has one — ai_seo has none, so it's left).
-- Plus a one-time backfill of already-ended jobs stuck in working lanes.

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
  select service_type into v_board from public.jobs where id = p_job_id;
  if not found then return jsonb_build_object('ok', false, 'errors', array['job_not_found']); end if;

  select id into v_closed
    from public.pipeline_stages
   where board = v_board and code = 'closed' and archived = false
   limit 1;

  update public.jobs set
    billing_active = false,
    status = case when status in ('cancelled','completed') then status else 'completed' end,
    completed_at = coalesce(completed_at, now()),
    stage_id = coalesce(v_closed, stage_id),   -- move to Closed lane if the board has one
    updated_at = now()
   where id = p_job_id;

  return jsonb_build_object('ok', true, 'job_id', p_job_id);
end;
$$;

-- One-time backfill: ended jobs stuck in a working lane → their board's Closed lane.
-- Leaves jobs already in a terminal lane (closed/live/done) untouched. Reversible via backup.
create table if not exists public.jobs_endjob_stage_backup_20260622 (
  id uuid, old_stage_id uuid, backed_up_at timestamptz default now()
);
insert into public.jobs_endjob_stage_backup_20260622 (id, old_stage_id)
select j.id, j.stage_id
from public.jobs j
join public.pipeline_stages ps on ps.board = j.service_type and ps.code = 'closed' and ps.archived = false
where j.archived = false and j.status in ('completed','cancelled')
  and not exists (select 1 from public.pipeline_stages cur where cur.id = j.stage_id and cur.code in ('closed','live','done'));

update public.jobs j
   set stage_id = ps.id, updated_at = now()
  from public.pipeline_stages ps
 where ps.board = j.service_type and ps.code = 'closed' and ps.archived = false
   and j.archived = false and j.status in ('completed','cancelled')
   and not exists (select 1 from public.pipeline_stages cur where cur.id = j.stage_id and cur.code in ('closed','live','done'));
