-- =============================================================================
-- Phase 6 — RPCs for monthly task panel.
-- ensure_job_monthly_task_period: idempotent seeder, called whenever the panel
-- is opened. Safe no-op when the period already matches.
-- set_job_monthly_task: toggles a single checklist item; enforces
-- service_type 'edit' permission and refuses on blocked jobs.
-- =============================================================================

create or replace function public.ensure_job_monthly_task_period(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_service text;
  v_period text;
  v_current text := to_char(now(), 'YYYY-MM');
  v_template jsonb;
  v_tasks jsonb;
begin
  select service_type, monthly_tasks_period
    into v_service, v_period
    from public.jobs
   where id = p_job_id;

  if v_service is null then
    raise exception 'job not found';
  end if;
  if v_period = v_current then
    return;
  end if;

  select tasks into v_template
    from public.service_monthly_task_templates
   where service_type = v_service;
  if v_template is null then
    v_template := '[]'::jsonb;
  end if;

  v_tasks := coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'code', t->>'code',
        'completed', false,
        'completed_at', null,
        'completed_by', null
      )
    )
    from jsonb_array_elements(v_template) t
  ), '[]'::jsonb);

  update public.jobs
     set monthly_tasks = v_tasks,
         monthly_tasks_period = v_current
   where id = p_job_id;
end $$;

grant execute on function public.ensure_job_monthly_task_period(uuid) to authenticated;

-- ---------------------------------------------------------------------------

create or replace function public.set_job_monthly_task(
  p_job_id uuid,
  p_code text,
  p_completed boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_service text;
  v_blocked boolean;
  v_can boolean;
begin
  perform public.ensure_job_monthly_task_period(p_job_id);

  select service_type, is_blocked
    into v_service, v_blocked
    from public.jobs
   where id = p_job_id;

  if v_service is null then
    raise exception 'job not found';
  end if;
  if v_blocked then
    raise exception 'job is blocked';
  end if;

  v_can := public.current_user_is_admin()
        or public.current_user_can(v_service, 'edit');
  if not v_can then
    raise exception 'forbidden';
  end if;

  update public.jobs
     set monthly_tasks = (
       select coalesce(jsonb_agg(
         case
           when (t->>'code') = p_code then
             jsonb_set(
               jsonb_set(
                 jsonb_set(t,
                   '{completed}', to_jsonb(p_completed)),
                 '{completed_at}',
                   case when p_completed then to_jsonb(now()) else 'null'::jsonb end),
               '{completed_by}',
                 case when p_completed then to_jsonb(auth.uid()) else 'null'::jsonb end)
           else t
         end
       ), '[]'::jsonb)
       from jsonb_array_elements(monthly_tasks) t
     )
   where id = p_job_id;
end $$;

grant execute on function public.set_job_monthly_task(uuid, text, boolean) to authenticated;
