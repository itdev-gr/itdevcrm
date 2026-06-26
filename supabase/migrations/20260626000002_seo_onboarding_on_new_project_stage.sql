-- Tie the SEO onboarding email (GSC for web_seo / GBP for local_seo, incl. AI SEO
-- children) to the board's "New project" column instead of firing on ANY job insert.
--
-- Rationale: the existing client book + the AI SEO split place jobs across many working
-- stages (done/blogs/metadata/active/...). The access-request onboarding email should
-- only go out for genuinely-new work, i.e. when a job LANDS in the `new_project` column.
-- Now fires on INSERT into new_project OR when a job is MOVED into new_project. Dedupe
-- (one email per deal per service type) still prevents repeats.

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

  select email into v_email from public.clients where id = new.client_id;
  if v_email is null or trim(v_email) = '' then
    return new;
  end if;

  -- One onboarding email per deal per service type (covers an AI SEO child and a
  -- standalone job on the same deal without double-sending).
  v_dedupe := v_setting_key || ':' || new.deal_id::text;
  if exists (select 1 from public.email_log where dedupe_key = v_dedupe and status = 'sent')
     or exists (select 1 from public.email_outbox where dedupe_key = v_dedupe and status in ('pending','sending')) then
    return new;
  end if;

  insert into public.email_outbox (identity, to_email, template_key, data, dedupe_key)
  values ('accounting', v_email, v_template_key, '{}'::jsonb, v_dedupe);

  return new;
end $$;

drop trigger if exists jobs_seo_onboarding_email on public.jobs;
create trigger jobs_seo_onboarding_email
  after insert or update of stage_id on public.jobs
  for each row execute function public.jobs_seo_onboarding_email();

-- ROLLBACK: restore the insert-only / any-stage version from 20260624080000
--   (drop the stage gate + the `tg_op='UPDATE'` guard, and recreate the trigger as
--    `after insert on public.jobs`).
