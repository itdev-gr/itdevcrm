-- SEO access emails (webseo_gsc_access / localseo_gbp_access) fired for unpaid
-- deals: create_custom_job inserts SEO jobs (incl. AI SEO children) directly at
-- the boards' first stage ('new_project'), and the jobs_seo_onboarding_email
-- trigger keyed only on "row is at new_project" — no payment check (e.g. deal
-- 005230 got both access emails 5 min before its payment was marked paid).
-- Separately, the trigger's dedupe missed email_log rows upgraded to
-- 'delivered', so repeat firings re-sent (deal 005557 got 3 copies).
--
-- Fix: (1) send only when the deal has at least one PAID payment — the
-- reconciler's first-Fully-Paid move and manual drags after payment keep
-- working; unpaid inserts/drags/bulk moves no longer email. (2) dedupe now
-- also blocks on log 'delivered' and outbox 'sent'.
-- The manual ✉ resend button (send-email edge fn, no dedupe key) is unaffected.

create or replace function public.jobs_seo_onboarding_email()
returns trigger
language plpgsql security definer set search_path = public as $function$
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

  select code into v_stage_code from public.pipeline_stages where id = new.stage_id;
  if v_stage_code is distinct from 'new_project' then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.stage_id is not distinct from new.stage_id then
    return new;
  end if;

  -- Pay gate: access emails only after the deal's first paid payment.
  if not exists (
    select 1 from public.deal_payments p
     where p.deal_id = new.deal_id
       and p.paid_at is not null
  ) then
    return new;
  end if;

  if not public.email_automation_enabled(v_setting_key) then
    return new;
  end if;

  select email, name into v_email, v_name from public.clients where id = new.client_id;
  if v_email is null or trim(v_email) = '' then
    return new;
  end if;

  select code into v_code from public.deals where id = new.deal_id;

  v_dedupe := v_setting_key || ':' || new.deal_id::text;
  if exists (select 1 from public.email_log
              where dedupe_key = v_dedupe and status in ('sent','delivered'))
     or exists (select 1 from public.email_outbox
                 where dedupe_key = v_dedupe and status in ('pending','sending','sent')) then
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
end $function$;

-- ROLLBACK: restore the prior body (no pay gate; dedupe = log 'sent' +
-- outbox 'pending'/'sending' only) — read the live body via
-- pg_get_functiondef before reverting per the drift rule; prior body is
-- also captured in .superpowers/sdd/pre-fix-jobs_seo_onboarding_email.sql
