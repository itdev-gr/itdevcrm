-- 2026-07-03: Fix 403 reading integrity_alert_dismissals from the Alerts page.
-- 20260703010000 did `revoke all ... from authenticated` then added the `iad_read`
-- RLS policy, but an RLS policy is inert without a base table-level grant — so the
-- `authenticated` role (PostgREST) had zero privileges and the Ignored-tab
-- `.from('integrity_alert_dismissals').select()` returned 403. Grant SELECT; the
-- `iad_read` policy still restricts visible rows to admins + the accounting group.
-- (Inserts/deletes stay owner-only via the security-definer dismiss/undismiss RPCs.)
grant select on public.integrity_alert_dismissals to authenticated;

-- ROLLBACK: revoke select on public.integrity_alert_dismissals from authenticated;
