-- =============================================================================
-- Phase 6 — Monthly task reset.
-- run_monthly_task_reset() walks every active recurring job whose
-- monthly_tasks_period is null or stale, archives the prior period's checklist
-- to activity_log (kind='monthly_tasks_archived'), and reseeds from the
-- service_monthly_task_templates row for that service. Idempotent.
--
-- The cron runs daily at 02:15 UTC. On the 1st of each month the loop matches
-- every job. On other days it only catches jobs newly switched to recurring
-- mid-month (whose period is still null) — a no-op for everyone else.
-- =============================================================================

create or replace function public.run_monthly_task_reset()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current text := to_char(now(), 'YYYY-MM');
  r record;
  v_seeded jsonb;
begin
  for r in
    select j.id, j.service_type, j.monthly_tasks, j.monthly_tasks_period,
           t.tasks as template_tasks
      from public.jobs j
      left join public.service_monthly_task_templates t
        on t.service_type = j.service_type
     where j.archived = false
       and j.status = 'active'
       and j.billing_type = 'recurring_monthly'
       and (j.monthly_tasks_period is null or j.monthly_tasks_period <> v_current)
  loop
    if r.monthly_tasks_period is not null then
      insert into public.activity_log (entity_type, entity_id, user_id, action, changes)
      values (
        'jobs', r.id, null, 'update',
        jsonb_build_object(
          'kind', 'monthly_tasks_archived',
          'period', r.monthly_tasks_period,
          'tasks', r.monthly_tasks
        )
      );
    end if;

    v_seeded := coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'code', t->>'code',
          'completed', false,
          'completed_at', null,
          'completed_by', null
        )
      )
      from jsonb_array_elements(coalesce(r.template_tasks, '[]'::jsonb)) t
    ), '[]'::jsonb);

    update public.jobs
       set monthly_tasks = v_seeded,
           monthly_tasks_period = v_current
     where id = r.id;
  end loop;
end $$;

grant execute on function public.run_monthly_task_reset() to authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'monthly_task_reset_daily') then
      perform cron.unschedule('monthly_task_reset_daily');
    end if;

    perform cron.schedule(
      'monthly_task_reset_daily',
      '15 2 * * *',
      $cron$ select public.run_monthly_task_reset(); $cron$
    );
  end if;
exception when others then
  null;
end $$;
