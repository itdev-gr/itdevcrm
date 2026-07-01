-- =========================================================================
-- F1 fix (docs/superpowers/reports/2026-07-02-full-live-sweep.md §8.1):
-- email_notify_new_job has been silently disabled since the 2026-06-24
-- department-toggle migration: 'internal_new_job' was unmapped in
-- email_setting_department (→ fell back to the OFF `global` switch) AND had
-- no email_automation_settings row (→ coalesce false). Result: the "new job
-- created → email the assigned team" emails never sent.
-- Fix: map internal_new_job to the technical department (the recipients ARE
-- the technical teams) and add its enabled settings row. The row shows up
-- automatically as a toggle in Settings → Email automations (One-shots).
-- =========================================================================

create or replace function public.email_setting_department(setting_key text)
returns text language sql immutable set search_path = public as $function$
  select case setting_key
    when 'lead_welcome'       then 'sales'
    when 'scheduled_confirm'  then 'sales'
    when 'scheduled_reminder' then 'sales'
    when 'scheduled_noshow'   then 'sales'
    when 'won_next_steps'     then 'sales'
    when 'won_welcome'        then 'accounting'
    when 'webseo_gsc'         then 'technical'
    when 'localseo_gbp'       then 'technical'
    when 'internal_new_job'   then 'technical'
    else null
  end;
$function$;

insert into public.email_automation_settings (key, enabled, description)
values ('internal_new_job', true,
        'Internal: email the assigned team when a new job is created')
on conflict (key) do update
  set enabled = excluded.enabled, description = excluded.description;

-- =========================================================================
-- ROLLBACK (verbatim):
--   delete from public.email_automation_settings where key = 'internal_new_job';
--   create or replace function public.email_setting_department(setting_key text)
--   returns text language sql immutable set search_path = public as $function$
--     select case setting_key
--       when 'lead_welcome'       then 'sales'
--       when 'scheduled_confirm'  then 'sales'
--       when 'scheduled_reminder' then 'sales'
--       when 'scheduled_noshow'   then 'sales'
--       when 'won_next_steps'     then 'sales'
--       when 'won_welcome'        then 'accounting'
--       when 'webseo_gsc'         then 'technical'
--       when 'localseo_gbp'       then 'technical'
--       else null
--     end;
--   $function$;
-- =========================================================================
