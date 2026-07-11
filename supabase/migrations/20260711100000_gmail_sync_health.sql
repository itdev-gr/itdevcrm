-- =============================================================================
-- Gmail sweep health: a status RPC for the in-app admin alert, mirroring
-- email_pipeline_health. user_google_sync is service-role-only (RLS), so a
-- security-definer function exposes sweep freshness to admins.
-- =============================================================================

-- Returns { accounts, stale_accounts, newest_synced_at, oldest_synced_at } over
-- public.user_google_sync. Stale = last swept over 30 minutes ago (cadence is
-- 5 min) or never. Non-admins get a bare {status:'ok'} (no leakage).
create or replace function public.gmail_sync_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_accounts int;
  v_stale    int;
  v_newest   timestamptz;
  v_oldest   timestamptz;
begin
  if not public.current_user_is_admin() then
    return jsonb_build_object('status', 'ok');
  end if;

  select count(*),
         count(*) filter (
           where last_synced_at is null
              or last_synced_at < now() - interval '30 minutes'
         ),
         max(last_synced_at),
         min(last_synced_at)
    into v_accounts, v_stale, v_newest, v_oldest
    from public.user_google_sync;

  return jsonb_build_object(
    'accounts', coalesce(v_accounts, 0),
    'stale_accounts', coalesce(v_stale, 0),
    'newest_synced_at', v_newest,
    'oldest_synced_at', v_oldest
  );
end;
$$;

revoke all on function public.gmail_sync_health() from public;
grant execute on function public.gmail_sync_health() to authenticated;

-- ---------------------------------------------------------------------------
-- ROLLBACK:
--   drop function if exists public.gmail_sync_health();
-- ---------------------------------------------------------------------------
