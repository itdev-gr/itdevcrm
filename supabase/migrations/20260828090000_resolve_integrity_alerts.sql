-- =============================================================================
-- Task 6 of the 2026-08-27 financial-correctness program (adapted scope):
-- give the 04:00 cron's `data_integrity_alerts` findings a resolve action.
--
-- Reality check done before writing this migration (the task brief's original
-- premise — "no UI anywhere for these" — was right, but its assumed missing
-- RLS policy was NOT): `reconcile_payment_integrity()` (20260701010000) already
-- persists its two checks (duplicate_period, flip_out_of_paid_in_full) into
-- `public.data_integrity_alerts`, and that migration ALSO already created
-- `data_integrity_alerts_admin_read` (SELECT, admin-only via profiles.is_admin)
-- and `data_integrity_alerts_admin_write` (UPDATE, same guard). Verified live
-- 2026-08-28 via `select policyname, roles, cmd, qual from pg_policies where
-- tablename = 'data_integrity_alerts'` — both policies present, unchanged,
-- `roles = {public}` (filtered by the USING clause, same idiom as every other
-- admin-gated policy in this schema). So: no RLS change needed here — the
-- table was already invisible to non-admins and already visible to admins;
-- it just had no RPC an authenticated admin could call to resolve a row, and
-- no frontend reading it. This migration adds only the two RPCs; the frontend
-- (src/features/accounting/alerts/AlertsPage.tsx + hooks/useCronAlerts.ts +
-- hooks/useResolveCronAlert.ts) is wired up in the same commit.
--
-- Live snapshot immediately before writing this migration (2026-08-28):
-- 348 open rows, all `kind = 'flip_out_of_paid_in_full'` (oldest detected_at
-- 2026-07-01, `duplicate_period` currently has 0 open rows). The group-resolve
-- RPC below is deliberately NOT invoked against that backlog by this task —
-- see task-6-report.md — it is the owner's broom.
--
-- Idiom: SECURITY DEFINER, first line re-checks admin (mirrors
-- lock_accounting_period/unlock_accounting_period, 20260827190000), sets
-- resolved_at = now(), resolved_by = auth.uid() where resolved_at is null.
--
-- ROLLBACK:
--   revoke execute on function public.resolve_integrity_alerts_kind(text) from authenticated;
--   revoke execute on function public.resolve_integrity_alert(uuid) from authenticated;
--   drop function if exists public.resolve_integrity_alerts_kind(text);
--   drop function if exists public.resolve_integrity_alert(uuid);
-- =============================================================================

create or replace function public.resolve_integrity_alert(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.current_user_is_admin() then
    raise exception 'admin only';
  end if;

  update public.data_integrity_alerts
     set resolved_at = now(), resolved_by = auth.uid()
   where id = p_id
     and resolved_at is null;
end $$;

create or replace function public.resolve_integrity_alerts_kind(p_kind text)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  if not public.current_user_is_admin() then
    raise exception 'admin only';
  end if;

  update public.data_integrity_alerts
     set resolved_at = now(), resolved_by = auth.uid()
   where kind = p_kind
     and resolved_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function public.resolve_integrity_alert(uuid) from public, anon;
revoke all on function public.resolve_integrity_alerts_kind(text) from public, anon;
grant execute on function public.resolve_integrity_alert(uuid) to authenticated;
grant execute on function public.resolve_integrity_alerts_kind(text) to authenticated;
