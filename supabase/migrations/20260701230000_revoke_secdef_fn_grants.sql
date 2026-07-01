-- ============================================================================
-- P1 security remediation (2026-07-01)
-- Context: docs/superpowers/reports/2026-07-02-full-project-bug-sweep.md §3
--   107 SECURITY DEFINER functions in `public` were executable by `anon`
--   (internet-reachable via POST /rest/v1/rpc/<fn> with the public anon key)
--   because the default ACL grants anon/authenticated on every new function.
-- This migration:
--   §1 revokes PUBLIC/anon/authenticated EXECUTE on every secdef function
--      that anon can currently execute, and grants service_role;
--   §2 re-grants authenticated on the 49 functions the frontend calls or
--      RLS policies reference;
--   §3 hardens default privileges so future postgres-created objects in
--      `public` are closed to anon (and functions to PUBLIC) by default.
-- Deliberately untouched: functions already fixed after the 2026-06-28 audit
-- (their anon EXECUTE is already false, so the §1 predicate skips them).
-- ============================================================================

-- §1 — close the regressed surface -----------------------------------------
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as fn
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and has_function_privilege('anon', p.oid, 'EXECUTE')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.fn);
    execute format('grant execute on function %s to service_role', r.fn);
  end loop;
end $$;

-- §2 — re-grant authenticated on UI-called RPCs + RLS helper functions (49)
grant execute on function public.accounting_create_deal(uuid,jsonb,text,numeric,numeric,text,text) to authenticated;
grant execute on function public.accounting_mark_paid_in_full(uuid) to authenticated;
grant execute on function public.assignable_owners() to authenticated;
grant execute on function public.block_client(uuid,text) to authenticated;
grant execute on function public.block_job(uuid,text) to authenticated;
grant execute on function public.bulk_merge_intake(integer) to authenticated;
grant execute on function public.bulk_merge_intake_preview() to authenticated;
grant execute on function public.bulk_release_intake(integer) to authenticated;
grant execute on function public.bulk_release_intake_preview() to authenticated;
grant execute on function public.close_deal(uuid,jsonb) to authenticated;
grant execute on function public.complete_accounting(uuid) to authenticated;
grant execute on function public.convert_lead_to_client(uuid) to authenticated;
grant execute on function public.create_announcement(text,text,text,boolean,uuid[],timestamp with time zone) to authenticated;
grant execute on function public.create_custom_job(uuid,text,text,text,text,numeric,numeric,numeric,boolean,text,jsonb,boolean) to authenticated;
grant execute on function public.current_user_can(text,text) to authenticated;
grant execute on function public.current_user_in_group(text) to authenticated;
grant execute on function public.current_user_is_admin() to authenticated;
grant execute on function public.current_user_scope(text,text) to authenticated;
grant execute on function public.delete_announcement(uuid) to authenticated;
grant execute on function public.delete_jobs(uuid[]) to authenticated;
grant execute on function public.delete_leads(uuid[]) to authenticated;
grant execute on function public.discard_lead_intake(uuid) to authenticated;
grant execute on function public.dismiss_announcement(uuid) to authenticated;
grant execute on function public.email_failure_rows() to authenticated;
grant execute on function public.email_outbox_cancel(uuid) to authenticated;
grant execute on function public.email_outbox_retry(uuid) to authenticated;
grant execute on function public.email_pipeline_health() to authenticated;
grant execute on function public.email_queue_rows() to authenticated;
grant execute on function public.end_job(uuid) to authenticated;
grant execute on function public.ensure_job_monthly_task_period(uuid) to authenticated;
grant execute on function public.find_contact_by_phone(text) to authenticated;
grant execute on function public.find_lead_duplicates(text,text) to authenticated;
grant execute on function public.get_my_announcements() to authenticated;
grant execute on function public.import_leads_to_intake(jsonb) to authenticated;
grant execute on function public.is_task_party(uuid,uuid) to authenticated;
grant execute on function public.job_billing_ref_count(uuid) to authenticated;
grant execute on function public.lead_cold_ids(uuid[]) to authenticated;
grant execute on function public.lead_dead_end_ids(uuid[]) to authenticated;
grant execute on function public.lock_deal(uuid) to authenticated;
grant execute on function public.mentionable_users() to authenticated;
grant execute on function public.merge_lead_intake(uuid,uuid) to authenticated;
grant execute on function public.my_google_status() to authenticated;
grant execute on function public.reengage_lead_intake(uuid,uuid) to authenticated;
grant execute on function public.release_lead_intake(uuid,boolean) to authenticated;
grant execute on function public.set_announcement_active(uuid,boolean) to authenticated;
grant execute on function public.set_job_monthly_task(uuid,text,boolean) to authenticated;
grant execute on function public.unblock_client(uuid) to authenticated;
grant execute on function public.unblock_job(uuid) to authenticated;
grant execute on function public.update_job_billing(uuid,text,text,numeric,numeric,text,uuid,boolean,text,jsonb) to authenticated;

-- §3 — default-privileges hardening (postgres-created objects in `public`)
alter default privileges for role postgres in schema public revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon;
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;

-- ============================================================================
-- ROLLBACK (verbatim — restores the pre-migration state)
-- ============================================================================
-- §3 revert:
--   alter default privileges for role postgres in schema public grant execute on functions to anon;
--   alter default privileges for role postgres in schema public grant all on tables to anon;
--   alter default privileges for role postgres in schema public grant all on sequences to anon;
--   -- (PUBLIC had no default-ACL entry before either; the §3 PUBLIC revoke was belt-and-braces.)
--
-- §1/§2 revert: re-grant anon + authenticated on the exact 107 functions
-- (service_role grants and the 49 authenticated grants of §2 match pre-state
--  and need no revert). Pre-state ACL on each was
--  {postgres=X, anon=X, authenticated=X, service_role=X}.
--
--   do $rollback$
--   declare fn text;
--   begin
--     foreach fn in array array[
--       -- 49 UI/RLS (anon re-grant only; authenticated already granted by §2)
--       'accounting_create_deal(uuid,jsonb,text,numeric,numeric,text,text)',
--       'accounting_mark_paid_in_full(uuid)','assignable_owners()',
--       'block_client(uuid,text)','block_job(uuid,text)',
--       'bulk_merge_intake(integer)','bulk_merge_intake_preview()',
--       'bulk_release_intake(integer)','bulk_release_intake_preview()',
--       'close_deal(uuid,jsonb)','complete_accounting(uuid)',
--       'convert_lead_to_client(uuid)',
--       'create_announcement(text,text,text,boolean,uuid[],timestamp with time zone)',
--       'create_custom_job(uuid,text,text,text,text,numeric,numeric,numeric,boolean,text,jsonb,boolean)',
--       'current_user_can(text,text)','current_user_in_group(text)',
--       'current_user_is_admin()','current_user_scope(text,text)',
--       'delete_announcement(uuid)','delete_jobs(uuid[])','delete_leads(uuid[])',
--       'discard_lead_intake(uuid)','dismiss_announcement(uuid)',
--       'email_failure_rows()','email_outbox_cancel(uuid)','email_outbox_retry(uuid)',
--       'email_pipeline_health()','email_queue_rows()','end_job(uuid)',
--       'ensure_job_monthly_task_period(uuid)','find_contact_by_phone(text)',
--       'find_lead_duplicates(text,text)','get_my_announcements()',
--       'import_leads_to_intake(jsonb)','is_task_party(uuid,uuid)',
--       'job_billing_ref_count(uuid)','lead_cold_ids(uuid[])','lead_dead_end_ids(uuid[])',
--       'lock_deal(uuid)','mentionable_users()','merge_lead_intake(uuid,uuid)',
--       'my_google_status()','reengage_lead_intake(uuid,uuid)',
--       'release_lead_intake(uuid,boolean)','set_announcement_active(uuid,boolean)',
--       'set_job_monthly_task(uuid,text,boolean)','unblock_client(uuid)',
--       'unblock_job(uuid)',
--       'update_job_billing(uuid,text,text,numeric,numeric,text,uuid,boolean,text,jsonb)',
--       -- 46 trigger functions
--       'assigned_tasks_notify_assignee()','assigned_tasks_notify_creator()',
--       'assigned_tasks_notify_started()','assigned_tasks_populate_source()',
--       'assigned_tasks_stamp_resolved()','deal_payment_lines_recompute_job_dates()',
--       'deal_payment_lines_recompute_on_delete()','deal_payments_created_at_immutable()',
--       'deal_payments_default_service_keys()','deal_payments_move_to_awaiting()',
--       'deal_payments_no_duplicate_period()','deal_payments_recompute_job_dates()',
--       'deal_payments_recompute_on_delete()','deal_payments_release_from_on_hold()',
--       'deal_payments_seed_after_insert()','deals_close_jobs_on_close()',
--       'deals_enqueue_won_welcome()','deals_hold_jobs_on_stage_change()',
--       'deals_release_jobs_on_partial_payment()','deals_sync_client_status_on_stage_change()',
--       'email_log_set_client_id()','email_notify_new_job()','email_notify_new_task()',
--       'email_outbox_pulse()','enforce_no_stage_move_when_blocked()',
--       'fanout_mention_notifications()','handle_new_auth_user()',
--       'jobs_backfill_payment_service_type()','jobs_local_seo_owner()',
--       'jobs_seed_local_profile_url()','jobs_seed_web_website()',
--       'jobs_seo_onboarding_email()','jobs_web_seo_owner()',
--       'lead_intake_auto_merge()','lead_intake_auto_release()',
--       'leads_auto_distribute()','leads_email_automations()',
--       'leads_enforce_stage_restriction()','leads_sync_stage_on_scheduled_for()',
--       'log_activity()','log_email_activity()','offers_after_insert_set_offer_sent()',
--       'sync_deal_pricing_from_jobs()','task_comments_notify_other_party()',
--       'user_tasks_notify_creator()','user_tasks_notify_started()',
--       -- 12 internal helpers
--       'apply_intake_reengage_merge(uuid,lead_intake)','email_automation_enabled(text)',
--       'is_client_blocked(uuid)','lead_email_payload(leads)','lead_is_dead_end(uuid)',
--       'recompute_deal_job_period_dates(uuid)','recompute_job_period_dates(uuid)',
--       'reconcile_payment_integrity()','reconcile_seo_onboarding_emails()',
--       'sales_pool_ids()','seo_onboarding_pending_jobs()','team_lead_for_group(text)'
--     ]
--     loop
--       execute format('grant execute on function public.%s to anon, authenticated', fn);
--     end loop;
--   end $rollback$;
-- ============================================================================
