# Admin Email Health page

- **Date:** 2026-06-29
- **Status:** Design — approved, ready for implementation

## Goal

Give admins a page to **see and act on stuck/pending emails and recent failures** — the data behind the yellow `EmailHealthBanner`, which today shows only a count with no drill-down. Admin-only.

## Decisions

- **Actions:** view + **Retry** + **Cancel** on queued/stuck emails.
- **Scope:** problems only — the queue (pending/stuck/failed) + recent failures/bounces. No full searchable "all emails" log.

## Current facts (verified)

- `email_outbox` (queue): `id, identity, to_email, template_key, data, dedupe_key, status (pending|sent|failed|sending), attempts, last_error, created_at, sent_at`. RLS: admin SELECT (`current_user_is_admin()`). Direct client writes blocked.
- `email_log` (history): `id, identity, to_email, template_key, resend_id, status (sent|failed|delivered|bounced|complained), dedupe_key, error, created_at` (+ later `client_id, delivered_at, bounced_at`). RLS: admin SELECT.
- `email_pipeline_health()` RPC (admin-gated) already returns status/reason/counts and feeds the banner (`src/features/system_health/`).
- Admin pages: tabs in `src/app/AdminLayout.tsx` (`SETTINGS_TABS`) + routes in `src/app/router.tsx`; i18n under `admin` namespace `nav.*`. Page pattern: `src/features/email_automations/EmailAutomationsPage.tsx` using `page-shell` (`PageHeader`, `SettingsCard`).

## Design

### Route & nav
- New tab `{ to: '/admin/email-health', key: 'email_health' }` in `SETTINGS_TABS` (placed right after `email-automations`).
- i18n: add `nav.email_health` (en: "Email health", el: "Κατάσταση email") to the `admin` namespace.
- Route in `router.tsx`: `{ path: 'email-health', element: <EmailHealthPage /> }` (lazy, like siblings).
- `EmailHealthBanner` becomes a `<Link to="/admin/email-health">` (clickable; keep the colored bar styling).

### Page — `src/features/system_health/EmailHealthPage.tsx`
Three sections inside `SettingsCard`s:
1. **Status summary** — from `useEmailHealth`: status pill + reason + counts (stuck, failed last 1h, onboarding unsent, drain last-run age).
2. **Queue — needs attention** — `useEmailQueue()` (email_outbox where `status in ('pending','sending','failed')`, newest first): To · Template · Status · Attempts · Age · Error(`last_error`). Per-row **Retry** (status pending/sending/failed) and **Cancel** (status pending/sending) buttons.
3. **Recent failures & bounces** — `useEmailFailures()` (email_log where `status in ('failed','bounced','complained')` and `created_at > now()-interval '7 days'`, newest first, limit 200): To · Template · Status · Error · When. Read-only.

### Hooks — `src/features/system_health/hooks/`
- `useEmailQueue()` — `supabase.from('email_outbox').select(...).in('status', ['pending','sending','failed']).order('created_at')`.
- `useEmailFailures()` — `supabase.from('email_log').select(...).in('status', ['failed','bounced','complained']).gte('created_at', <7d>).order('created_at',{ascending:false}).limit(200)`.
- `useRetryEmail()` / `useCancelEmail()` — call the RPCs below; invalidate the queue + health queries on success.

### Backend RPCs (new migration) — admin-gated, security definer
```sql
create or replace function public.email_outbox_retry(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.current_user_is_admin() then return jsonb_build_object('ok',false,'error','permission_denied'); end if;
  update public.email_outbox set status='pending', attempts=0, last_error=null
   where id = p_id and status in ('pending','sending','failed');
  return jsonb_build_object('ok', found);
end $$;

create or replace function public.email_outbox_cancel(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.current_user_is_admin() then return jsonb_build_object('ok',false,'error','permission_denied'); end if;
  update public.email_outbox set status='failed', last_error='cancelled by admin'
   where id = p_id and status in ('pending','sending');
  return jsonb_build_object('ok', found);
end $$;
revoke all on function public.email_outbox_retry(uuid), public.email_outbox_cancel(uuid) from public;
grant execute on function public.email_outbox_retry(uuid), public.email_outbox_cancel(uuid) to authenticated;
```
(`found` = the implicit `FOUND` after the UPDATE.) Retry re-queues (drain re-picks); Cancel takes it out of the pending queue so the banner clears. Both no-op safely if the row already moved on.

## Edge cases
- Retry on a bad-data email (e.g. malformed `to_email`) will fail again — documented; the real fix is correcting the client's email. Cancel is the way to clear those from the banner.
- Empty states: "No emails need attention" / "No recent failures".
- Non-admin: route already behind `AdminGuard`; RPCs reject; banner/page hidden.

## Verification
- **Frontend:** `npm run build` (tsc + eslint + vite) green.
- **Backend:** RPCs applied via Management API; rolled-back test — retry resets a row to pending/attempts 0; cancel sets failed; both confirmed admin-gated. Reads verified by the page itself.
- **Live:** open `/admin/email-health` as admin (Playwright) — confirm it lists the 3 currently-stuck + recent failures, and the buttons render. (Won't click Cancel on real rows without go-ahead.)
- Gated on explicit go-ahead before applying RPCs to prod.

## Changes / Revert
**Changes:** new `EmailHealthPage` + 3 hooks; `AdminLayout` tab; `router.tsx` route; i18n keys; `EmailHealthBanner` becomes a link; new migration with `email_outbox_retry` / `email_outbox_cancel`.
**Revert:** drop the two functions; revert the frontend files. No data migration.
