# Admin Announcements — Design Spec

**Date:** 2026-06-24
**Status:** Approved (brainstorm)

## Goal

Let an admin compose a broadcast **pop-up announcement** from Settings — a title, message, severity, and a target audience (one or more **groups**, or **all users**) — and **Publish** it. Targeted users get the announcement as a **modal pop-up**: immediately if they're online (realtime), or on their next page load. Each user sees a given announcement **once** — dismissing it ("Got it") records a per-user dismissal so it never re-appears for them. Admins can deactivate, expire, or delete announcements.

This is distinct from the existing per-user `notifications` bell (passive, individual rows): announcements are a single broadcast row with group targeting + per-user dismissal, and they actively pop up.

## Architecture

One broadcast `announcements` row (regardless of audience size), an `announcement_targets` join for group targeting, and an `announcement_dismissals` row per user who dismisses. All user-facing reads/writes go through `security definer` RPCs; direct table access is admin-only via RLS. The frontend adds an admin Settings page (compose + manage list) and an app-wide `AnnouncementPopup` mounted in the authenticated shell that reads `get_my_announcements()` and re-fetches on a realtime insert signal.

## Tech Stack

React + Vite + TypeScript, @tanstack/react-query, react-i18next, shadcn/ui (Dialog/Input/Label/Button/Textarea/Select), Supabase Postgres (plpgsql RPCs) + Realtime, Vitest. Mirrors patterns already in the repo: the New Deal feature (pure validator + param-builder + loose `rpcCall` wrapper + mutation hook), `useNotificationsRealtime` (realtime → query invalidation), and the `global_search` perf approach (security-definer read, compute caller access once).

## Data Model

```sql
create table public.announcements (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  body        text not null,
  severity    text not null default 'info' check (severity in ('info','warning')),
  target_all  boolean not null default false,
  expires_at  timestamptz,                -- optional auto-expire
  is_active   boolean not null default true,
  created_by  uuid references public.profiles(user_id) on delete set null,
  created_at  timestamptz not null default now()
);

create table public.announcement_targets (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  group_id        uuid not null references public.groups(id) on delete cascade,
  primary key (announcement_id, group_id)
);
create index announcement_targets_group_idx on public.announcement_targets(group_id);

create table public.announcement_dismissals (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  user_id         uuid not null references public.profiles(user_id) on delete cascade,
  dismissed_at    timestamptz not null default now(),
  primary key (announcement_id, user_id)
);
```

**RLS** (all three tables, `enable row level security`):
- `announcements` / `announcement_targets`: `for all using (current_user_is_admin()) with check (current_user_is_admin())` — admins manage + read the table directly (management list). Non-admins get nothing directly; they use the RPCs.
- `announcement_dismissals`: `for select using (user_id = auth.uid() or current_user_is_admin())`. Inserts happen only through the `dismiss_announcement` security-definer RPC.

## Backend (RPCs, `security definer`, `set search_path = public`)

1. **`create_announcement(p_title text, p_body text, p_severity text default 'info', p_target_all boolean default false, p_group_ids uuid[] default '{}', p_expires_at timestamptz default null) returns jsonb`** — admin-gated (`current_user_is_admin()`; else `{ok:false,errors:['not_authorized']}`). Validates: non-empty title + body, `severity in ('info','warning')`, and `target_all OR ≥1 group` (else `missing_title` / `missing_body` / `invalid_severity` / `missing_target`). Inserts the announcement (`created_by = auth.uid()`) + target rows (when not `target_all`) atomically. Returns `{ok:true, announcement_id}`.
2. **`get_my_announcements() returns table(id uuid, title text, body text, severity text, created_at timestamptz)`** — the pop-up's source. Returns active, non-expired announcements that target the caller (`target_all` OR caller ∈ a targeted group via `user_groups`) and the caller has **not** dismissed, newest first. `auth.uid()` null → returns nothing.
3. **`dismiss_announcement(p_id uuid) returns jsonb`** — inserts `(p_id, auth.uid())` into dismissals `on conflict do nothing`; `{ok:true}`.
4. **`set_announcement_active(p_id uuid, p_active boolean) returns jsonb`** — admin-gated; sets `is_active`.
5. **`delete_announcement(p_id uuid) returns jsonb`** — admin-gated; deletes the announcement (cascades targets + dismissals).

All granted to `authenticated`. The admin-gated RPCs re-check `current_user_is_admin()` server-side (defence in depth beyond the UI `AdminGuard`).

## Frontend

**Settings → "Announcements"** — new route `/admin/announcements`, new `SettingsNav` tab in `AdminLayout` (`AdminGuard`-wrapped like the rest of `/admin`):
- **Compose form**: Title (Input), Message (Textarea), Severity (Select info/warning), Target = "All users" toggle **or** a group multi-select (chips/checkboxes from the groups list), optional Expiry (date input). **Publish** button.
- **Manage list**: existing announcements with title, severity, target summary ("All users" or group names), active state, created/expiry; per-row **Deactivate/Reactivate** + **Delete** (confirm).
- Pure `validateAnnouncement` + `buildCreateAnnouncementParams` in `announcement.ts`, unit-tested (same shape as `newDeal.ts`).

**App-wide `AnnouncementPopup`** — mounted once in the authenticated shell layout:
- `useMyAnnouncements()` (calls `get_my_announcements`) → renders a modal `Dialog` for the first item (styled by `severity`); "Got it" → `useDismissAnnouncement` → next item.
- `useAnnouncementsRealtime()` subscribes to `announcements` INSERT (and UPDATE for deactivate) → invalidates the `useMyAnnouncements` query, so it **pops live** for online users. The server RPC decides targeting/dismissal — realtime is only a "refetch" signal (no membership logic client-side).

**Files:**
- `src/features/announcements/announcement.ts` (+ `.test.ts`) — types + validator + param builder.
- `src/lib/rpc.ts` — `createAnnouncement` / `dismissAnnouncement` / `setAnnouncementActive` / `deleteAnnouncement` wrappers (loose `rpcCall`).
- `src/features/announcements/hooks/` — `useCreateAnnouncement`, `useAnnouncements` (admin list, direct select), `useMyAnnouncements`, `useSetAnnouncementActive`, `useDeleteAnnouncement`, `useDismissAnnouncement`, `useAnnouncementsRealtime`.
- `src/features/announcements/AnnouncementsAdminPage.tsx`, `AnnouncementPopup.tsx`.
- `src/i18n/locales/{en,el}/announcements.json` + namespace registration.
- `src/app/router.tsx` (+ route), `src/app/AdminLayout.tsx` (+ tab), `src/i18n/locales/{en,el}/admin.json` (nav key), the shell layout (mount `AnnouncementPopup`).

## Behavior / Edge Cases

- User in multiple targeted groups → distinct rows → **sees once**.
- Dismissed → never again (dismissal row). Deactivated or expired → excluded from `get_my_announcements` → stops popping.
- New announcement while a user is online → realtime → pops within seconds.
- Admin who is also targeted sees their own announcement (can dismiss).
- `target_all = true` → ignores targets; everyone sees it.

## Permissions

Admin-only for compose/manage (UI `AdminGuard` + RPC `current_user_is_admin()`), consistent with the rest of `/admin`. Not a delegated capability (YAGNI; can add later).

## Out of Scope (YAGNI)

No scheduling beyond `expires_at`; no rich text/images/links formatting; no read-receipt analytics; no per-individual-user targeting (groups + all-users only); no edit-after-publish (delete + recreate).

## Testing

- **Unit**: `validateAnnouncement`, `buildCreateAnnouncementParams`, and the pop-up "which announcement shows next" queue logic.
- **DB (impersonation, rolled back)**: `create_announcement` (admin ok; non-admin denied; validation), `get_my_announcements` (group target hit/miss, `target_all`, dismissal hides it, expiry/inactive hide it), `dismiss_announcement` idempotent.
- **Build**: `npm run build` (strict) + full `npm run test:run`.
- **Live smoke**: admin publishes to a group → a user in that group gets the pop-up (realtime) → dismiss → gone → no re-pop. Clean up test rows.

## Changes / Revert

**Changes:**
- New tables `announcements`, `announcement_targets`, `announcement_dismissals` (+ RLS + index).
- New RPCs `create_announcement`, `get_my_announcements`, `dismiss_announcement`, `set_announcement_active`, `delete_announcement`.
- Frontend: new `announcements` feature, `/admin/announcements` route + Settings tab, `AnnouncementPopup` mounted in the shell, new i18n namespace.

**Revert:**
- `drop function` the five RPCs; `drop table` the three tables (cascades targets/dismissals); revert `router.tsx` / `AdminLayout.tsx` / shell / i18n edits. No backfill or data migration to undo.
