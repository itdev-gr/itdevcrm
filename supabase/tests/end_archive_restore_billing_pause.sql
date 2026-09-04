-- supabase/tests/end_archive_restore_billing_pause.sql
-- Run with: supabase test db  (transactional; rolls back)
--
-- Final-review I2: unarchive_job used to clear only the archive stamp,
-- leaving billing_active=false and blocked_reason=NULL. Neither
-- JobBillingPauseCard nor JobsBillingPanel's `showResume` will render the
-- Resume billing control unless blocked_reason='billing_paused' — the exact
-- state job_pause_billing produces — so a restored job could never bill
-- again despite looking live on the (interactive) Closed lane. This guards
-- that end_and_archive_job -> unarchive_job leaves the job (and its cascaded
-- ai_seo child) in that resumable state, and that job_resume_billing then
-- succeeds on it.
begin;
select plan(6);

do $$
declare v_admin uuid;
begin
  select user_id into v_admin from public.profiles
   where is_admin and not archived limit 1;
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

do $$
declare v_deal uuid; v_client uuid; v_parent uuid; v_child uuid; v_stage uuid;
begin
  select d.id, d.client_id into v_deal, v_client
    from public.deals d
   where d.code is not null and not d.archived and d.client_id is not null
     and not exists (select 1 from public.jobs j
                      where j.deal_id = d.id and j.service_type = 'local_seo')
   limit 1;

  select id into v_stage from public.pipeline_stages
   where board = 'local_seo' and code = 'active' and not archived limit 1;

  insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate,
                           status, stage_id, onboarded_at, archived, started_at, code, billing_active)
    values (v_deal, v_client, 'local_seo', 'recurring_monthly', 250, 24,
            'active', v_stage, now() - interval '40 days', false, now(),
            (select code from public.deals where id = v_deal)||'-RESTORETEST', true)
    returning id into v_parent;

  -- Cascade child, same shape end_and_archive_job's own cascade update assumes.
  insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, vat_rate,
                           status, onboarded_at, archived, started_at, billing_active, parent_job_id)
    values (v_deal, v_client, 'ai_seo', 'recurring_monthly', 100, 24,
            'active', now() - interval '40 days', false, now(), true, v_parent)
    returning id into v_child;

  perform public.end_and_archive_job(v_parent);
  perform public.unarchive_job(v_parent);

  perform set_config('t.parent', v_parent::text, true);
  perform set_config('t.child', v_child::text, true);
end $$;

-- Parent: archive stamp cleared, but left in the exact job_pause_billing state
-- so the existing Resume billing control (and RPC) apply.
select is((select archived::text from public.jobs where id = current_setting('t.parent')::uuid),
          'false', 'parent restore clears the archive stamp');
select is((select billing_active::text from public.jobs where id = current_setting('t.parent')::uuid),
          'false', 'parent restore does NOT auto-resume billing');
select is((select blocked_reason from public.jobs where id = current_setting('t.parent')::uuid),
          'billing_paused',
          'parent restore leaves blocked_reason=billing_paused so Resume billing can render');
select is((select is_blocked::text from public.jobs where id = current_setting('t.parent')::uuid),
          'true', 'parent restore marks is_blocked so the pause state is consistent');

-- Cascaded child gets the identical treatment.
select is((select blocked_reason from public.jobs where id = current_setting('t.child')::uuid),
          'billing_paused', 'cascaded child restore also lands in the resumable pause state');

-- The whole point: Resume billing (the control the restore dialog tells the
-- admin to use) must actually work on the restored job.
do $$
begin
  perform set_config('t.resume', public.job_resume_billing(current_setting('t.parent')::uuid)::text, true);
end $$;
select is((current_setting('t.resume')::jsonb ->> 'ok'), 'true',
          'job_resume_billing succeeds on the restored job — the dialog copy is now true');

select * from finish();
rollback;
