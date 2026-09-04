-- supabase/tests/end_archive_restore_billing_pause.sql
-- Run with: supabase test db  (transactional; rolls back)
--
-- Final-review I2: unarchive_job used to clear only the archive stamp,
-- leaving billing_active=false and blocked_reason=NULL. Neither
-- JobBillingPauseCard nor JobsBillingPanel's `showResume` will render the
-- Resume billing control unless blocked_reason='billing_paused' — the exact
-- state job_pause_billing produces — so a restored job could never bill
-- again despite looking live on the (interactive) Closed lane. This guards
-- that end_and_archive_job -> unarchive_job leaves the job in that resumable
-- state, and that job_resume_billing then succeeds on it.
--
-- Final-fix re-review NEW-1/NEW-2 (2026-09-04): the first fix stamped the
-- pause state UNCONDITIONALLY, which (a) would falsely mark a legacy
-- accounting_archive row that never stopped billing as "paused" while it
-- kept billing silently, and (b) stamped the cascaded ai_seo child too, even
-- though job_resume_billing can never unflag it (it unflags by the PARENT's
-- deal_id+service_type, and the child's service_type differs), permanently
-- locking its monthly checklist. Scenario 1 below covers the still-correct
-- "job that was actually billing-stopped by End" case; scenario 2 covers the
-- NEW-1 regression (a legacy still-billing row must come back unstamped);
-- the child assertions cover NEW-2 (never stamped, regardless of scenario).
begin;
select plan(9);

do $$
declare v_admin uuid;
begin
  select user_id into v_admin from public.profiles
   where is_admin and not archived limit 1;
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

-- ---- Scenario 1: End -> archive -> restore (the normal path) --------------
-- end_and_archive_job always sets billing_active=false before archiving, so
-- the parent's OLD billing_active at restore time is false -> it IS stamped
-- (this is the resumable state the restore dialog promises). The cascaded
-- ai_seo child must come back plain, never stamped (NEW-2).
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
-- so the existing Resume billing control (and RPC) apply — because End had
-- genuinely stopped its billing before archiving.
select is((select archived::text from public.jobs where id = current_setting('t.parent')::uuid),
          'false', 'S1 parent restore clears the archive stamp');
select is((select billing_active::text from public.jobs where id = current_setting('t.parent')::uuid),
          'false', 'S1 parent restore does NOT auto-resume billing');
select is((select blocked_reason from public.jobs where id = current_setting('t.parent')::uuid),
          'billing_paused',
          'S1 parent restore leaves blocked_reason=billing_paused so Resume billing can render');
select is((select is_blocked::text from public.jobs where id = current_setting('t.parent')::uuid),
          'true', 'S1 parent restore marks is_blocked so the pause state is consistent');

-- Cascaded child: NEVER stamped (NEW-2) — job_resume_billing can only ever
-- unflag by the parent's deal_id+service_type, which the child (ai_seo)
-- never matches, so a stamped child would be permanently blocked.
select is((select blocked_reason from public.jobs where id = current_setting('t.child')::uuid),
          null, 'S1 cascaded child restore is NOT stamped billing_paused (NEW-2)');
select is((select is_blocked::text from public.jobs where id = current_setting('t.child')::uuid),
          'false', 'S1 cascaded child restore leaves is_blocked=false (NEW-2)');

-- The whole point: Resume billing (the control the restore dialog tells the
-- admin to use) must actually work on the restored parent.
do $$
begin
  perform set_config('t.resume', public.job_resume_billing(current_setting('t.parent')::uuid)::text, true);
end $$;
select is((current_setting('t.resume')::jsonb ->> 'ok'), 'true',
          'S1 job_resume_billing succeeds on the restored parent — the dialog copy is now true');

-- ---- Scenario 2 (NEW-1 regression): a legacy accounting_archive row that
-- never stopped billing must come back unstamped, not falsely "paused".
-- The now-deleted stub Archive button set only archived/archived_at/
-- archived_reason and never touched billing_active, so real rows exist with
-- archived=true and billing_active=true. Simulate that directly (not via
-- end_and_archive_job, which always flips billing_active itself).
do $$
declare v_deal uuid; v_client uuid; v_job uuid; v_stage uuid;
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
                           status, stage_id, onboarded_at, started_at, code, billing_active,
                           archived, archived_at, archived_reason)
    values (v_deal, v_client, 'local_seo', 'recurring_monthly', 250, 24,
            'active', v_stage, now() - interval '40 days', now(),
            (select code from public.deals where id = v_deal)||'-LEGACYARCHIVE',
            true,  -- still billing, exactly like the old stub Archive button left it
            true, now() - interval '10 days', 'accounting_archive')
    returning id into v_job;

  perform public.unarchive_job(v_job);
  perform set_config('t.legacy', v_job::text, true);
end $$;

select is((select billing_active::text from public.jobs where id = current_setting('t.legacy')::uuid),
          'true', 'S2 legacy still-billing row keeps billing_active=true through restore');
select is((select is_blocked::text from public.jobs where id = current_setting('t.legacy')::uuid),
          'false', 'S2 legacy still-billing row is NOT stamped is_blocked (NEW-1)');

select * from finish();
rollback;
