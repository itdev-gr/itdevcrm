-- 2026-06-30: SEO-onboarding emails (webseo_gsc_access / localseo_gbp_access)
-- were shipping with a broken subject — the templates use "{{code}} - …" but
-- the trigger inserted an empty data payload ('{}'::jsonb), so {{code}}
-- interpolated to '' and recipients got " - Πρόσβαση…" (the nikkas1@ incident).
-- 51 emails already went out with the bad subject — can't be retroactively
-- fixed; this migration prevents new ones. Mirrors deals_enqueue_won_welcome
-- which already passes {code, name}.
--
-- A parallel render-side safety net (cleanSubject in send-email/templates.ts +
-- redeploy) handles any future enqueuer that forgets the same field.

create or replace function public.jobs_seo_onboarding_email()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_setting_key text;
  v_template_key text;
  v_email text;
  v_dedupe text;
  v_stage_code text;
  v_code text;
  v_name text;
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

  -- Only when the job is in the board's "New project" column (both SEO boards use code 'new_project').
  select code into v_stage_code from public.pipeline_stages where id = new.stage_id;
  if v_stage_code is distinct from 'new_project' then
    return new;
  end if;

  -- On UPDATE, only when it just moved INTO new_project (don't re-fire on edits of a job already there).
  if tg_op = 'UPDATE' and old.stage_id is not distinct from new.stage_id then
    return new;
  end if;

  -- Master/department + per-automation gate.
  if not public.email_automation_enabled(v_setting_key) then
    return new;
  end if;

  select email, name into v_email, v_name from public.clients where id = new.client_id;
  if v_email is null or trim(v_email) = '' then
    return new;
  end if;

  -- Deal code feeds the "{{code}} - …" subject prefix on every client-facing template.
  select code into v_code from public.deals where id = new.deal_id;

  -- One onboarding email per deal per service type (covers an AI SEO child and a
  -- standalone job on the same deal without double-sending).
  v_dedupe := v_setting_key || ':' || new.deal_id::text;
  if exists (select 1 from public.email_log where dedupe_key = v_dedupe and status = 'sent')
     or exists (select 1 from public.email_outbox where dedupe_key = v_dedupe and status in ('pending','sending')) then
    return new;
  end if;

  insert into public.email_outbox (identity, to_email, template_key, data, dedupe_key)
  values ('accounting', v_email, v_template_key,
          jsonb_build_object(
            'code', coalesce(v_code, ''),
            'name', coalesce(v_name, '')
          ),
          v_dedupe);

  return new;
end $$;

-- Trigger definition unchanged — `drop trigger` + `create trigger` would be a
-- no-op since `create or replace function` swaps the body in place.

-- ROLLBACK: restore the empty-data version from 20260626000002:
--   create or replace function public.jobs_seo_onboarding_email() ... values (
--     'accounting', v_email, v_template_key, '{}'::jsonb, v_dedupe);
