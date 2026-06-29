-- 20260629140000_email_ops_rpcs.sql
-- Spec: docs/superpowers/specs/2026-06-29-admin-email-health-page-design.md
-- Admin-gated actions for the Email Health page. Direct client writes to
-- email_outbox are blocked by RLS, so Retry/Cancel go through these.

-- Retry: re-queue a stuck/failed email so the drain picks it up again.
create or replace function public.email_outbox_retry(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.current_user_is_admin() then
    return jsonb_build_object('ok', false, 'error', 'permission_denied');
  end if;
  update public.email_outbox
     set status = 'pending', attempts = 0, last_error = null
   where id = p_id and status in ('pending','sending','failed');
  return jsonb_build_object('ok', found);
end $$;

-- Cancel: take a queued email out of the pending queue (so the banner clears).
create or replace function public.email_outbox_cancel(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.current_user_is_admin() then
    return jsonb_build_object('ok', false, 'error', 'permission_denied');
  end if;
  update public.email_outbox
     set status = 'failed', last_error = 'cancelled by admin'
   where id = p_id and status in ('pending','sending');
  return jsonb_build_object('ok', found);
end $$;

revoke all on function public.email_outbox_retry(uuid) from public;
revoke all on function public.email_outbox_cancel(uuid) from public;
grant execute on function public.email_outbox_retry(uuid) to authenticated;
grant execute on function public.email_outbox_cancel(uuid) to authenticated;

-- ROLLBACK:
--   drop function if exists public.email_outbox_retry(uuid);
--   drop function if exists public.email_outbox_cancel(uuid);
