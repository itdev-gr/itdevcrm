-- =============================================================================
-- job_pause_billing / job_resume_billing: return the `ok` key the UI requires.
--
-- BUG (audit 2026-08-04, docs/system-analysis/2026-08-04-accounting-full-audit.md
-- section A1): both RPCs returned only their payload keys —
--   pause  -> {'jobs_flagged', 'payments_cancelled'}
--   resume -> {'jobs_unflagged', 'new_payment_id', 'next_start', 'next_end'}
-- while src/features/jobs/hooks/useJobBillingPause.ts does, for both:
--   if (!result.ok) throw new Error((result.errors ?? ['unknown_error']).join(', '));
--
-- So EVERY SUCCESSFUL pause and resume threw `unknown_error` in the UI. Because
-- the mutation threw, `onSuccess` never ran, no query key was invalidated, and
-- the screen kept showing billing as ACTIVE — while the database had already
-- flagged the whole (deal, service_type) chain `billing_paused`, set
-- billing_active = false, and cancelled the chain's unpaid recurring rows.
--
-- The operator sees a failure, the data says otherwise. This is the mechanism
-- behind the "billing stopped silently" class of incident: at audit time 40
-- non-archived jobs sat at blocked_reason='billing_paused', 233 non-archived
-- recurring jobs had billing_active=false, and 56 payment rows were 'cancelled'.
-- Every one of those was produced by a flow that told the operator it failed.
--
-- FIX: add 'ok', true to the success return of each function. Nothing else
-- changes. The early `raise exception` paths (not_allowed, job_not_found,
-- already_paused, not_billing_active, not_paused) are deliberately untouched —
-- a raised Postgres error already arrives at the hook as `error` and is thrown
-- with its own message, which is the correct behaviour. Only the SUCCESS path
-- was broken.
--
-- The sibling RPCs in 20260617000011_job_billing_rpcs.sql already return
-- jsonb_build_object('ok', true, …); this brings the pause pair into line with
-- that house contract rather than inventing a new one.
--
-- Pre-change live md5(pg_get_functiondef), read from prod 2026-08-04:
--   job_pause_billing   f4d46444901682f6df42623c337a2e36
--   job_resume_billing  a47828ef182dc09a149bf66cd481ef05
-- Both matched the newest repo emission, 20260702100000_job_billing_pause.sql.
--
-- APPLIED to prod 2026-08-06. Post-change md5(pg_get_functiondef):
--   job_pause_billing   438e514d78f74bb57ebf8e804c47138e
--   job_resume_billing  ce4bd67836a2bf3f78ffdc3000005eda
-- Privileges re-read after applying and unchanged:
--   both = postgres=X | authenticated=X | service_role=X
-- Verified end to end against the live functions inside a rolled-back
-- transaction, before and after. Before: pause returned
--   {"jobs_flagged":1,"payments_cancelled":1}            -- no ok -> UI threw
-- After:
--   {"ok":true,"jobs_flagged":1,"payments_cancelled":1}
-- and resume likewise gained ok:true while still returning new_payment_id,
-- next_start and next_end. billing_active went false on pause and true on
-- resume in both runs, so the payload change did not disturb the work itself.
--
-- ROLLBACK:
--   re-apply supabase/migrations/20260702100000_job_billing_pause.sql
--   (restores the pre-change bodies, md5s above).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.job_pause_billing(p_job_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_job record; v_cancelled int; v_flagged int;
begin
  if not (
    exists (select 1 from public.profiles p
             where p.user_id = auth.uid() and p.is_admin and not p.archived)
    or exists (select 1 from public.profiles p
                 join public.user_groups ug on ug.user_id = p.user_id
                 join public.groups g on g.id = ug.group_id
                where p.user_id = auth.uid() and not p.archived and g.code = 'accounting')
  ) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  select j.* into v_job from public.jobs j where j.id = p_job_id and not j.archived;
  if v_job is null then raise exception 'job_not_found'; end if;
  if v_job.blocked_reason = 'billing_paused' then raise exception 'already_paused'; end if;
  if not v_job.billing_active then raise exception 'not_billing_active'; end if;

  -- Flag every non-archived job of this (deal, service_type) chain.
  update public.jobs j
     set is_blocked = true, blocked_reason = 'billing_paused',
         blocked_at = now(), blocked_by = auth.uid(),
         billing_active = false
   where j.deal_id = v_job.deal_id and j.service_type = v_job.service_type
     and not j.archived;
  get diagnostics v_flagged = row_count;

  -- Excuse the chain's unpaid RECURRING rows (audit-preserving).
  update public.deal_payments dp
     set status = 'cancelled'
   where dp.deal_id = v_job.deal_id
     and dp.service_type = v_job.service_type
     and dp.billing_type in ('recurring_monthly','recurring_yearly')
     and dp.status in ('pending','overdue');
  get diagnostics v_cancelled = row_count;

  -- 2026-08-06: 'ok' added — useJobBillingPause throws unknown_error without it.
  return jsonb_build_object('ok', true,
                            'jobs_flagged', v_flagged,
                            'payments_cancelled', v_cancelled);
end $function$;

CREATE OR REPLACE FUNCTION public.job_resume_billing(p_job_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_job record; v_src record; v_new_id uuid; v_next_end date; v_unflagged int;
begin
  if not (
    exists (select 1 from public.profiles p
             where p.user_id = auth.uid() and p.is_admin and not p.archived)
    or exists (select 1 from public.profiles p
                 join public.user_groups ug on ug.user_id = p.user_id
                 join public.groups g on g.id = ug.group_id
                where p.user_id = auth.uid() and not p.archived and g.code = 'accounting')
  ) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  select j.* into v_job from public.jobs j where j.id = p_job_id and not j.archived;
  if v_job is null then raise exception 'job_not_found'; end if;
  if v_job.blocked_reason is distinct from 'billing_paused' then raise exception 'not_paused'; end if;

  update public.jobs j
     set is_blocked = false, blocked_reason = null, blocked_at = null, blocked_by = null,
         billing_active = true
   where j.deal_id = v_job.deal_id and j.service_type = v_job.service_type
     and not j.archived and j.blocked_reason = 'billing_paused';
  get diagnostics v_unflagged = row_count;

  -- Fresh period starting TODAY (excused semantics — no back-billing).
  -- Copy pricing from the chain's latest row (any status).
  select dp.* into v_src from public.deal_payments dp
   where dp.deal_id = v_job.deal_id and dp.service_type = v_job.service_type
     and dp.billing_type in ('recurring_monthly','recurring_yearly')
   order by dp.created_at desc limit 1;

  -- NB: `v_src is not null` would be TRUE only if EVERY field were non-null
  -- (record semantics) — nullable cols like label/paid_at made the insert
  -- silently skip. FOUND is the correct row-was-selected test.
  if found then
    v_next_end := case when v_src.billing_type = 'recurring_yearly'
                       then (current_date + interval '1 year')::date
                       else (current_date + interval '1 month')::date end;
    insert into public.deal_payments
      (deal_id, service_type, service_index, billing_type, amount_net, vat_rate, start_date, end_date, status)
      values (v_job.deal_id, v_src.service_type, v_src.service_index, v_src.billing_type,
              v_src.amount_net, v_src.vat_rate, current_date, v_next_end, 'pending')
      returning id into v_new_id;
  end if;

  -- 2026-08-06: 'ok' added — useJobBillingPause throws unknown_error without it.
  return jsonb_build_object('ok', true,
                            'jobs_unflagged', v_unflagged,
                            'new_payment_id', v_new_id,
                            'next_start', current_date,
                            'next_end', v_next_end);
end $function$;

-- Privileges restated exactly as 20260702100000 set them, and as prod carries
-- them today (authenticated + service_role). CREATE OR REPLACE preserves these
-- anyway; they are here so the file is self-contained on a fresh replay.
revoke all on function public.job_pause_billing(uuid)  from public, anon;
revoke all on function public.job_resume_billing(uuid) from public, anon;
grant execute on function public.job_pause_billing(uuid)  to authenticated, service_role;
grant execute on function public.job_resume_billing(uuid) to authenticated, service_role;
