-- Fix the SEO onboarding dedupe: a successfully-sent email's email_log row is updated
-- by the Resend delivery webhook from 'sent' -> 'delivered' (or 'bounced'/'complained'),
-- so checking only status='sent' let an already-delivered email look un-sent and re-send.
-- Now any non-failed dispatch (sent/delivered/bounced/complained) counts as "already sent".
-- (Especially important since 20260626000002 lets the trigger re-fire on move-into-new_project.)

create or replace function public.jobs_seo_onboarding_email()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_setting_key text;
  v_template_key text;
  v_email text;
  v_dedupe text;
  v_stage_code text;
begin
  if new.service_type = 'web_seo' then
    v_setting_key := 'webseo_gsc';
    v_template_key := 'webseo_gsc_access';
  elsif new.service_type = 'local_seo' then
    v_setting_key := 'localseo_gbp';
    v_template_key := 'localseo_gbp_access';
  else
    return new;
  end if;

  select code into v_stage_code from public.pipeline_stages where id = new.stage_id;
  if v_stage_code is distinct from 'new_project' then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.stage_id is not distinct from new.stage_id then
    return new;
  end if;

  if not public.email_automation_enabled(v_setting_key) then
    return new;
  end if;

  select email into v_email from public.clients where id = new.client_id;
  if v_email is null or trim(v_email) = '' then
    return new;
  end if;

  v_dedupe := v_setting_key || ':' || new.deal_id::text;
  if exists (select 1 from public.email_log
              where dedupe_key = v_dedupe
                and status in ('sent','delivered','bounced','complained'))
     or exists (select 1 from public.email_outbox
                 where dedupe_key = v_dedupe and status in ('pending','sending')) then
    return new;
  end if;

  insert into public.email_outbox (identity, to_email, template_key, data, dedupe_key)
  values ('accounting', v_email, v_template_key, '{}'::jsonb, v_dedupe);

  return new;
end $$;

-- ROLLBACK: re-apply 20260626000002 (dedupe checks only status='sent').
