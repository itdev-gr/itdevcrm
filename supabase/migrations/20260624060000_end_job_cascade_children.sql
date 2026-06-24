-- 20260624060000_end_job_cascade_children.sql
-- Ending a job also ends its AI SEO work-card children (each moved to its own
-- board's close lane). Based on the body in 20260622230000_end_job_close_by_stage_board.sql.
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

  -- cascade to AI SEO work-card children (each on its own board's close lane)
  update public.jobs c set
    billing_active = false,
    status = case when c.status in ('cancelled','completed') then c.status else 'completed' end,
    completed_at = coalesce(c.completed_at, now()),
    stage_id = coalesce(
      (select id from public.pipeline_stages ps
        where ps.board = c.service_type and ps.code = 'closed' and ps.archived = false limit 1),
      c.stage_id),
    updated_at = now()
   where c.parent_job_id = p_job_id;

  return jsonb_build_object('ok', true, 'job_id', p_job_id);
end;
$$;

-- ROLLBACK: re-apply the end_job body from 20260622230000_end_job_close_by_stage_board.sql.
