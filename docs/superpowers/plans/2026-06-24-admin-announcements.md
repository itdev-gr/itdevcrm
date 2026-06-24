# Admin Announcements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin publish a broadcast pop-up announcement (title + message + severity + audience) from Settings; targeted users (selected groups or all) get it as a modal that appears live (realtime) or on next load, once each, until they dismiss it.

**Architecture:** One `announcements` row + `announcement_targets` (group join) + `announcement_dismissals` (per-user). Five `security definer` RPCs do all work; direct table access is admin-only via RLS. Frontend: an admin Settings page (compose + manage list) and an app-wide `AnnouncementPopup` mounted in the authenticated shell that reads `get_my_announcements()` and refetches on a realtime insert signal.

**Tech Stack:** React + Vite + TypeScript, @tanstack/react-query, react-i18next, shadcn/ui Dialog/Input/Label/Button, Supabase Postgres (plpgsql) + Realtime, Vitest. Spec: `docs/superpowers/specs/2026-06-24-admin-announcements-design.md`.

**Prod DB apply note:** Apply migration files to prod (project `xujlrclyzxrvxszepquy`) with the Supabase MCP `apply_migration` tool; verify with `execute_sql`. Bash/curl DDL is classifier-blocked.

---

## File Structure

**Create:**
- `supabase/migrations/20260624100000_announcements_tables.sql` — tables + RLS + index.
- `supabase/migrations/20260624100100_announcements_rpcs.sql` — the 5 RPCs.
- `src/features/announcements/announcement.ts` (+ `.test.ts`) — types + `validateNewAnnouncement` + `buildCreateAnnouncementParams`.
- `src/features/announcements/hooks/useMyAnnouncements.ts`, `useDismissAnnouncement.ts`, `useAnnouncementsRealtime.ts`, `useCreateAnnouncement.ts`, `useAnnouncements.ts`, `useSetAnnouncementActive.ts`, `useDeleteAnnouncement.ts`.
- `src/features/announcements/AnnouncementPopup.tsx`, `AnnouncementsAdminPage.tsx`.
- `src/i18n/locales/en/announcements.json`, `src/i18n/locales/el/announcements.json`.

**Modify:**
- `src/lib/rpc.ts` — wrappers + result types.
- `src/lib/queryKeys.ts` — `announcements()` + `myAnnouncements()` keys.
- `src/lib/i18n.ts` — register the `announcements` namespace.
- `src/i18n/locales/en/admin.json`, `src/i18n/locales/el/admin.json` — `nav.announcements`.
- `src/app/router.tsx` — `/admin/announcements` route.
- `src/app/AdminLayout.tsx` — Settings tab.
- `src/app/ShellLayout.tsx` — mount `AnnouncementPopup`.

---

## Task 1: Tables + RLS migration

**Files:** Create `supabase/migrations/20260624100000_announcements_tables.sql`

- [ ] **Step 1: Write the migration**

```sql
-- =============================================================================
-- Admin broadcast announcements: one row per announcement, group targeting via
-- announcement_targets, per-user dismissal via announcement_dismissals.
-- =============================================================================
create table if not exists public.announcements (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  body        text not null,
  severity    text not null default 'info' check (severity in ('info','warning')),
  target_all  boolean not null default false,
  expires_at  timestamptz,
  is_active   boolean not null default true,
  created_by  uuid references public.profiles(user_id) on delete set null,
  created_at  timestamptz not null default now()
);

create table if not exists public.announcement_targets (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  group_id        uuid not null references public.groups(id) on delete cascade,
  primary key (announcement_id, group_id)
);
create index if not exists announcement_targets_group_idx on public.announcement_targets(group_id);

create table if not exists public.announcement_dismissals (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  user_id         uuid not null references public.profiles(user_id) on delete cascade,
  dismissed_at    timestamptz not null default now(),
  primary key (announcement_id, user_id)
);

alter table public.announcements enable row level security;
alter table public.announcement_targets enable row level security;
alter table public.announcement_dismissals enable row level security;

-- Admins manage + read the tables directly (for the management list).
-- Non-admins never touch these tables directly; they use the security-definer
-- RPCs (which bypass RLS).
create policy announcements_admin_all on public.announcements
  for all using (public.current_user_is_admin()) with check (public.current_user_is_admin());

create policy announcement_targets_admin_all on public.announcement_targets
  for all using (public.current_user_is_admin()) with check (public.current_user_is_admin());

-- A user can see their own dismissal rows (admins see all). Inserts happen only
-- through dismiss_announcement (security definer).
create policy announcement_dismissals_select_own on public.announcement_dismissals
  for select using (user_id = auth.uid() or public.current_user_is_admin());

-- Rollback:
-- drop table if exists public.announcement_dismissals;
-- drop table if exists public.announcement_targets;
-- drop table if exists public.announcements;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260624100000_announcements_tables.sql
git commit -m "feat(announcements): tables + RLS (announcements/targets/dismissals)"
```

---

## Task 2: RPCs migration

**Files:** Create `supabase/migrations/20260624100100_announcements_rpcs.sql`

- [ ] **Step 1: Write the migration**

```sql
-- =============================================================================
-- Announcement RPCs. Admin-gated create/manage; user-facing read + dismiss.
-- =============================================================================

-- create_announcement: admin composes + publishes.
create or replace function public.create_announcement(
  p_title text,
  p_body text,
  p_severity text default 'info',
  p_target_all boolean default false,
  p_group_ids uuid[] default '{}',
  p_expires_at timestamptz default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  errors text[] := '{}';
  v_title text;
  v_body text;
  v_id uuid;
begin
  if not public.current_user_is_admin() then
    return jsonb_build_object('ok', false, 'errors', array['not_authorized']);
  end if;

  v_title := nullif(trim(coalesce(p_title, '')), '');
  v_body  := nullif(trim(coalesce(p_body, '')), '');
  if v_title is null then errors := array_append(errors, 'missing_title'); end if;
  if v_body  is null then errors := array_append(errors, 'missing_body'); end if;
  if coalesce(p_severity, 'info') not in ('info','warning') then
    errors := array_append(errors, 'invalid_severity');
  end if;
  if not coalesce(p_target_all, false) and coalesce(array_length(p_group_ids, 1), 0) = 0 then
    errors := array_append(errors, 'missing_target');
  end if;
  if coalesce(array_length(errors, 1), 0) > 0 then
    return jsonb_build_object('ok', false, 'errors', errors);
  end if;

  insert into public.announcements (title, body, severity, target_all, expires_at, created_by)
  values (v_title, v_body, coalesce(p_severity, 'info'), coalesce(p_target_all, false),
          p_expires_at, auth.uid())
  returning id into v_id;

  if not coalesce(p_target_all, false) then
    insert into public.announcement_targets (announcement_id, group_id)
    select v_id, g from unnest(p_group_ids) as g
    on conflict do nothing;
  end if;

  return jsonb_build_object('ok', true, 'announcement_id', v_id);
end $$;

-- get_my_announcements: active, non-expired, targets the caller, not dismissed.
create or replace function public.get_my_announcements()
returns table (id uuid, title text, body text, severity text, created_at timestamptz)
language plpgsql security definer set search_path = public stable as $$
declare uid uuid := auth.uid();
begin
  if uid is null then return; end if;
  return query
  select a.id, a.title, a.body, a.severity, a.created_at
  from public.announcements a
  where a.is_active
    and (a.expires_at is null or a.expires_at > now())
    and (
      a.target_all
      or exists (
        select 1
        from public.announcement_targets t
        join public.user_groups ug on ug.group_id = t.group_id
        where t.announcement_id = a.id and ug.user_id = uid
      )
    )
    and not exists (
      select 1 from public.announcement_dismissals d
      where d.announcement_id = a.id and d.user_id = uid
    )
  order by a.created_at desc;
end $$;

-- dismiss_announcement: record the caller's dismissal (idempotent).
create or replace function public.dismiss_announcement(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'errors', array['not_authenticated']);
  end if;
  insert into public.announcement_dismissals (announcement_id, user_id)
  values (p_id, auth.uid())
  on conflict do nothing;
  return jsonb_build_object('ok', true);
end $$;

-- set_announcement_active: admin toggle.
create or replace function public.set_announcement_active(p_id uuid, p_active boolean)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.current_user_is_admin() then
    return jsonb_build_object('ok', false, 'errors', array['not_authorized']);
  end if;
  update public.announcements set is_active = coalesce(p_active, true) where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- delete_announcement: admin delete (cascades targets + dismissals).
create or replace function public.delete_announcement(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.current_user_is_admin() then
    return jsonb_build_object('ok', false, 'errors', array['not_authorized']);
  end if;
  delete from public.announcements where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.create_announcement(text, text, text, boolean, uuid[], timestamptz) to authenticated;
grant execute on function public.get_my_announcements() to authenticated;
grant execute on function public.dismiss_announcement(uuid) to authenticated;
grant execute on function public.set_announcement_active(uuid, boolean) to authenticated;
grant execute on function public.delete_announcement(uuid) to authenticated;

-- Rollback:
-- drop function if exists public.create_announcement(text, text, text, boolean, uuid[], timestamptz);
-- drop function if exists public.get_my_announcements();
-- drop function if exists public.dismiss_announcement(uuid);
-- drop function if exists public.set_announcement_active(uuid, boolean);
-- drop function if exists public.delete_announcement(uuid);
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260624100100_announcements_rpcs.sql
git commit -m "feat(announcements): RPCs (create/get_my/dismiss/set_active/delete)"
```

---

## Task 3: Apply migrations to prod + verify

**Files:** none (Supabase MCP against `xujlrclyzxrvxszepquy`).

- [ ] **Step 1:** `apply_migration` name `announcements_tables` with Task 1 SQL.
- [ ] **Step 2:** `apply_migration` name `announcements_rpcs` with Task 2 SQL.
- [ ] **Step 3: Functional verification (impersonation, rolled back).** Run via `execute_sql`:

```sql
do $$
declare
  admin_id uuid; member_id uuid; grp uuid; r jsonb; a_id uuid; mine_before int; mine_after int;
begin
  select user_id into admin_id from public.profiles where is_admin and is_active limit 1;
  -- a non-admin user + one of their groups
  select ug.user_id, ug.group_id into member_id, grp
    from public.user_groups ug
    join public.profiles p on p.user_id = ug.user_id
    where coalesce(p.is_admin,false) = false
    limit 1;

  -- admin publishes to that group
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id::text)::text, true);
  r := public.create_announcement('PLAN TEST title','PLAN TEST body','warning', false, array[grp], null);
  a_id := (r->>'announcement_id')::uuid;

  -- the member sees it
  perform set_config('request.jwt.claims', json_build_object('sub', member_id::text)::text, true);
  select count(*) into mine_before from public.get_my_announcements() where id = a_id;
  -- dismiss -> no longer sees it
  perform public.dismiss_announcement(a_id);
  select count(*) into mine_after from public.get_my_announcements() where id = a_id;

  raise exception 'VERIFY create=% member_sees=% after_dismiss=%', r, mine_before, mine_after;
end $$;
```
Expected: `create` has `ok:true` + an `announcement_id`; `member_sees = 1`; `after_dismiss = 0`. The RAISE rolls everything back.

- [ ] **Step 4: Denial + all-users + expiry checks (rolled back).**

```sql
do $$
declare sales_id uuid; r_denied jsonb; admin_id uuid; r_all jsonb; r_exp jsonb; a_all uuid; a_exp uuid; sees_all int; sees_exp int;
begin
  select user_id into sales_id from public.profiles where coalesce(is_admin,false)=false and is_active limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', sales_id::text)::text, true);
  r_denied := public.create_announcement('x','y','info', true, '{}', null);  -- non-admin

  select user_id into admin_id from public.profiles where is_admin and is_active limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id::text)::text, true);
  r_all := public.create_announcement('ALL','to everyone','info', true, '{}', null);
  r_exp := public.create_announcement('EXP','expired','info', true, '{}', now() - interval '1 day');
  a_all := (r_all->>'announcement_id')::uuid; a_exp := (r_exp->>'announcement_id')::uuid;

  perform set_config('request.jwt.claims', json_build_object('sub', sales_id::text)::text, true);
  select count(*) into sees_all from public.get_my_announcements() where id = a_all;
  select count(*) into sees_exp from public.get_my_announcements() where id = a_exp;

  raise exception 'VERIFY denied=% sees_all=% sees_expired=%', r_denied, sees_all, sees_exp;
end $$;
```
Expected: `denied` = `{"ok":false,"errors":["not_authorized"]}`; `sees_all = 1`; `sees_expired = 0`.

- [ ] **Step 5:** No commit (DB-only; migration files committed in Tasks 1–2).

---

## Task 4: Pure validator + param builder (TDD)

**Files:** Create `src/features/announcements/announcement.ts`, Test `src/features/announcements/announcement.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import {
  validateNewAnnouncement,
  buildCreateAnnouncementParams,
  type NewAnnouncementInput,
} from './announcement';

const base: NewAnnouncementInput = {
  title: 'Heads up',
  body: 'The office is closed Friday.',
  severity: 'info',
  targetAll: true,
  groupIds: [],
  expiresAt: '',
};

describe('validateNewAnnouncement', () => {
  it('passes for a valid all-users announcement', () => {
    expect(validateNewAnnouncement(base)).toEqual([]);
  });
  it('requires a title', () => {
    expect(validateNewAnnouncement({ ...base, title: '  ' })).toEqual(['missing_title']);
  });
  it('requires a body', () => {
    expect(validateNewAnnouncement({ ...base, body: '' })).toEqual(['missing_body']);
  });
  it('requires a target when not all-users', () => {
    expect(
      validateNewAnnouncement({ ...base, targetAll: false, groupIds: [] }),
    ).toEqual(['missing_target']);
  });
  it('passes for a valid group-targeted announcement', () => {
    expect(
      validateNewAnnouncement({ ...base, targetAll: false, groupIds: ['g1'] }),
    ).toEqual([]);
  });
});

describe('buildCreateAnnouncementParams', () => {
  it('maps an all-users announcement (no groups, no expiry)', () => {
    expect(buildCreateAnnouncementParams({ ...base, title: ' Heads up ', body: ' hi ' })).toEqual({
      p_title: 'Heads up',
      p_body: 'hi',
      p_severity: 'info',
      p_target_all: true,
      p_group_ids: [],
      p_expires_at: null,
    });
  });
  it('maps a group-targeted announcement with expiry', () => {
    expect(
      buildCreateAnnouncementParams({
        ...base,
        severity: 'warning',
        targetAll: false,
        groupIds: ['g1', 'g2'],
        expiresAt: '2026-07-01',
      }),
    ).toEqual({
      p_title: 'Heads up',
      p_body: 'The office is closed Friday.',
      p_severity: 'warning',
      p_target_all: false,
      p_group_ids: ['g1', 'g2'],
      p_expires_at: '2026-07-01',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/features/announcements/announcement.test.ts`
Expected: FAIL — cannot resolve `./announcement`.

- [ ] **Step 3: Write the implementation**

```ts
export type AnnouncementSeverity = 'info' | 'warning';

export type NewAnnouncementInput = {
  title: string;
  body: string;
  severity: AnnouncementSeverity;
  targetAll: boolean;
  groupIds: string[];
  expiresAt: string; // '' or 'yyyy-mm-dd'
};

export type NewAnnouncementError = 'missing_title' | 'missing_body' | 'missing_target';

export type CreateAnnouncementParams = {
  p_title: string;
  p_body: string;
  p_severity: AnnouncementSeverity;
  p_target_all: boolean;
  p_group_ids: string[];
  p_expires_at: string | null;
};

export function validateNewAnnouncement(input: NewAnnouncementInput): NewAnnouncementError[] {
  const errors: NewAnnouncementError[] = [];
  if (input.title.trim() === '') errors.push('missing_title');
  if (input.body.trim() === '') errors.push('missing_body');
  if (!input.targetAll && input.groupIds.length === 0) errors.push('missing_target');
  return errors;
}

export function buildCreateAnnouncementParams(input: NewAnnouncementInput): CreateAnnouncementParams {
  const expires = input.expiresAt.trim();
  return {
    p_title: input.title.trim(),
    p_body: input.body.trim(),
    p_severity: input.severity,
    p_target_all: input.targetAll,
    p_group_ids: input.targetAll ? [] : input.groupIds,
    p_expires_at: expires === '' ? null : expires,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/features/announcements/announcement.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/announcements/announcement.ts src/features/announcements/announcement.test.ts
git commit -m "feat(announcements): validateNewAnnouncement + buildCreateAnnouncementParams (tested)"
```

---

## Task 5: RPC wrappers + queryKeys

**Files:** Modify `src/lib/rpc.ts`, `src/lib/queryKeys.ts`

- [ ] **Step 1: Add the import to `src/lib/rpc.ts`** (after the existing `CreateDealParams` import near the top):

```ts
import type { CreateAnnouncementParams } from '@/features/announcements/announcement';
```

- [ ] **Step 2: Append wrappers to the end of `src/lib/rpc.ts`** (uses the module-private `rpcCall`):

```ts
// --- Announcements -----------------------------------------------------------
export type AnnouncementActionResult = { ok: true } | { ok: false; errors: string[] };
export type CreateAnnouncementResult =
  | { ok: true; announcement_id: string }
  | { ok: false; errors: string[] };
export type MyAnnouncementRow = {
  id: string;
  title: string;
  body: string;
  severity: 'info' | 'warning';
  created_at: string;
};

export async function createAnnouncement(
  params: CreateAnnouncementParams,
): Promise<CreateAnnouncementResult> {
  const { data, error } = await rpcCall('create_announcement', params);
  if (error) return { ok: false, errors: [error.message] };
  const r = data as { ok: boolean; announcement_id?: string; errors?: string[] };
  if (!r.ok || !r.announcement_id) return { ok: false, errors: r.errors ?? ['create_failed'] };
  return { ok: true, announcement_id: r.announcement_id };
}

export async function dismissAnnouncement(id: string): Promise<AnnouncementActionResult> {
  const { data, error } = await rpcCall('dismiss_announcement', { p_id: id });
  if (error) return { ok: false, errors: [error.message] };
  const r = data as { ok: boolean; errors?: string[] };
  return r.ok ? { ok: true } : { ok: false, errors: r.errors ?? ['dismiss_failed'] };
}

export async function setAnnouncementActive(
  id: string,
  active: boolean,
): Promise<AnnouncementActionResult> {
  const { data, error } = await rpcCall('set_announcement_active', { p_id: id, p_active: active });
  if (error) return { ok: false, errors: [error.message] };
  const r = data as { ok: boolean; errors?: string[] };
  return r.ok ? { ok: true } : { ok: false, errors: r.errors ?? ['update_failed'] };
}

export async function deleteAnnouncement(id: string): Promise<AnnouncementActionResult> {
  const { data, error } = await rpcCall('delete_announcement', { p_id: id });
  if (error) return { ok: false, errors: [error.message] };
  const r = data as { ok: boolean; errors?: string[] };
  return r.ok ? { ok: true } : { ok: false, errors: r.errors ?? ['delete_failed'] };
}

export async function getMyAnnouncements(): Promise<MyAnnouncementRow[]> {
  const { data, error } = await rpcCall('get_my_announcements', {});
  if (error) throw new Error(error.message);
  return (data as MyAnnouncementRow[] | null) ?? [];
}
```

- [ ] **Step 3: Add query keys to `src/lib/queryKeys.ts`** (next to the existing `notifications` key):

```ts
  announcements: () => ['announcements'] as const,
  myAnnouncements: () => ['my-announcements'] as const,
```

- [ ] **Step 4: Verify it compiles**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rpc.ts src/lib/queryKeys.ts
git commit -m "feat(announcements): rpc wrappers + query keys"
```

---

## Task 6: Hooks

**Files:** Create the seven hook files under `src/features/announcements/hooks/`.

- [ ] **Step 1: `useMyAnnouncements.ts`**

```ts
import { useQuery } from '@tanstack/react-query';
import { getMyAnnouncements, type MyAnnouncementRow } from '@/lib/rpc';
import { queryKeys } from '@/lib/queryKeys';
import { useAuthStore } from '@/lib/stores/authStore';

export function useMyAnnouncements() {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  return useQuery<MyAnnouncementRow[]>({
    queryKey: queryKeys.myAnnouncements(),
    queryFn: getMyAnnouncements,
    enabled: !!userId,
  });
}
```

- [ ] **Step 2: `useDismissAnnouncement.ts`**

```ts
import { useMutation, useQueryClient, type DefaultError } from '@tanstack/react-query';
import { dismissAnnouncement } from '@/lib/rpc';
import { queryKeys } from '@/lib/queryKeys';
import { captureMutation } from '@/lib/sentry/captureMutation';

export function useDismissAnnouncement() {
  const qc = useQueryClient();
  return useMutation<void, DefaultError, string>({
    mutationFn: captureMutation('announcements', 'dismiss', async (id: string) => {
      const r = await dismissAnnouncement(id);
      if (!r.ok) throw new Error(r.errors[0] ?? 'dismiss_failed');
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.myAnnouncements() });
    },
  });
}
```

- [ ] **Step 3: `useAnnouncementsRealtime.ts`** (mirrors `useNotificationsRealtime`)

```ts
import { useEffect, useId } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/lib/stores/authStore';
import { queryKeys } from '@/lib/queryKeys';

export function useAnnouncementsRealtime() {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const instanceId = useId();
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`announcements-${userId}-${instanceId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'announcements' },
        () => {
          void qc.invalidateQueries({ queryKey: queryKeys.myAnnouncements() });
          void qc.invalidateQueries({ queryKey: queryKeys.announcements() });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc, userId, instanceId]);
}
```

- [ ] **Step 4: `useCreateAnnouncement.ts`**

```ts
import { useMutation, useQueryClient, type DefaultError } from '@tanstack/react-query';
import { createAnnouncement } from '@/lib/rpc';
import type { CreateAnnouncementParams } from '../announcement';
import { queryKeys } from '@/lib/queryKeys';
import { captureMutation } from '@/lib/sentry/captureMutation';

export function useCreateAnnouncement() {
  const qc = useQueryClient();
  return useMutation<string, DefaultError, CreateAnnouncementParams>({
    mutationFn: captureMutation('announcements', 'create', async (params: CreateAnnouncementParams) => {
      const r = await createAnnouncement(params);
      if (!r.ok) {
        const err = new Error(r.errors[0] ?? 'create_failed');
        (err as Error & { errors?: string[] }).errors = r.errors;
        throw err;
      }
      return r.announcement_id;
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.announcements() });
    },
  });
}
```

- [ ] **Step 5: `useAnnouncements.ts`** (admin management list)

```ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export type AdminAnnouncement = {
  id: string;
  title: string;
  body: string;
  severity: 'info' | 'warning';
  target_all: boolean;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
  announcement_targets: { group_id: string; groups: { code: string; display_names: { en: string; el: string } } | null }[];
};

export function useAnnouncements() {
  return useQuery<AdminAnnouncement[]>({
    queryKey: queryKeys.announcements(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('announcements')
        .select('id, title, body, severity, target_all, expires_at, is_active, created_at, announcement_targets(group_id, groups(code, display_names))')
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as AdminAnnouncement[];
    },
  });
}
```

- [ ] **Step 6: `useSetAnnouncementActive.ts`**

```ts
import { useMutation, useQueryClient, type DefaultError } from '@tanstack/react-query';
import { setAnnouncementActive } from '@/lib/rpc';
import { queryKeys } from '@/lib/queryKeys';
import { captureMutation } from '@/lib/sentry/captureMutation';

export function useSetAnnouncementActive() {
  const qc = useQueryClient();
  return useMutation<void, DefaultError, { id: string; active: boolean }>({
    mutationFn: captureMutation('announcements', 'set_active', async ({ id, active }: { id: string; active: boolean }) => {
      const r = await setAnnouncementActive(id, active);
      if (!r.ok) throw new Error(r.errors[0] ?? 'update_failed');
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.announcements() });
    },
  });
}
```

- [ ] **Step 7: `useDeleteAnnouncement.ts`**

```ts
import { useMutation, useQueryClient, type DefaultError } from '@tanstack/react-query';
import { deleteAnnouncement } from '@/lib/rpc';
import { queryKeys } from '@/lib/queryKeys';
import { captureMutation } from '@/lib/sentry/captureMutation';

export function useDeleteAnnouncement() {
  const qc = useQueryClient();
  return useMutation<void, DefaultError, string>({
    mutationFn: captureMutation('announcements', 'delete', async (id: string) => {
      const r = await deleteAnnouncement(id);
      if (!r.ok) throw new Error(r.errors[0] ?? 'delete_failed');
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.announcements() });
    },
  });
}
```

- [ ] **Step 8: Verify compile + commit**

Run: `npm run typecheck` → PASS.

```bash
git add src/features/announcements/hooks
git commit -m "feat(announcements): react-query hooks (read/create/manage/realtime)"
```

---

## Task 7: i18n

**Files:** Create `src/i18n/locales/en/announcements.json`, `src/i18n/locales/el/announcements.json`; Modify `src/lib/i18n.ts`, `src/i18n/locales/en/admin.json`, `src/i18n/locales/el/admin.json`

- [ ] **Step 1: `src/i18n/locales/en/announcements.json`**

```json
{
  "admin": {
    "title": "Announcements",
    "description": "Publish a pop-up announcement to selected groups or everyone.",
    "field_title": "Title",
    "field_message": "Message",
    "field_severity": "Style",
    "severity_info": "Info",
    "severity_warning": "Warning",
    "target": "Audience",
    "target_all": "All users",
    "target_groups": "Selected groups",
    "field_expires": "Expires (optional)",
    "publish": "Publish",
    "publishing": "Publishing…",
    "published": "Announcement published.",
    "list_title": "Published announcements",
    "col_title": "Title",
    "col_audience": "Audience",
    "col_status": "Status",
    "col_created": "Created",
    "status_active": "Active",
    "status_inactive": "Inactive",
    "status_expired": "Expired",
    "deactivate": "Deactivate",
    "reactivate": "Reactivate",
    "delete": "Delete",
    "delete_confirm": "Delete this announcement? This cannot be undone.",
    "empty": "No announcements yet.",
    "errors": {
      "missing_title": "Enter a title.",
      "missing_body": "Enter a message.",
      "missing_target": "Pick at least one group, or choose All users.",
      "not_authorized": "You don't have permission to publish announcements.",
      "invalid_severity": "Invalid style.",
      "create_failed": "Could not publish. Try again."
    }
  },
  "popup": {
    "got_it": "Got it"
  }
}
```

- [ ] **Step 2: `src/i18n/locales/el/announcements.json`**

```json
{
  "admin": {
    "title": "Ανακοινώσεις",
    "description": "Δημοσίευσε αναδυόμενη ανακοίνωση σε επιλεγμένες ομάδες ή σε όλους.",
    "field_title": "Τίτλος",
    "field_message": "Μήνυμα",
    "field_severity": "Στυλ",
    "severity_info": "Πληροφορία",
    "severity_warning": "Προειδοποίηση",
    "target": "Παραλήπτες",
    "target_all": "Όλοι οι χρήστες",
    "target_groups": "Επιλεγμένες ομάδες",
    "field_expires": "Λήξη (προαιρετικό)",
    "publish": "Δημοσίευση",
    "publishing": "Δημοσίευση…",
    "published": "Η ανακοίνωση δημοσιεύτηκε.",
    "list_title": "Δημοσιευμένες ανακοινώσεις",
    "col_title": "Τίτλος",
    "col_audience": "Παραλήπτες",
    "col_status": "Κατάσταση",
    "col_created": "Δημιουργία",
    "status_active": "Ενεργή",
    "status_inactive": "Ανενεργή",
    "status_expired": "Έληξε",
    "deactivate": "Απενεργοποίηση",
    "reactivate": "Επανενεργοποίηση",
    "delete": "Διαγραφή",
    "delete_confirm": "Διαγραφή της ανακοίνωσης; Δεν αναιρείται.",
    "empty": "Δεν υπάρχουν ανακοινώσεις.",
    "errors": {
      "missing_title": "Συμπλήρωσε τίτλο.",
      "missing_body": "Συμπλήρωσε μήνυμα.",
      "missing_target": "Διάλεξε τουλάχιστον μία ομάδα ή «Όλοι οι χρήστες».",
      "not_authorized": "Δεν έχεις δικαίωμα δημοσίευσης ανακοινώσεων.",
      "invalid_severity": "Μη έγκυρο στυλ.",
      "create_failed": "Αδυναμία δημοσίευσης. Δοκίμασε ξανά."
    }
  },
  "popup": {
    "got_it": "Εντάξει"
  }
}
```

- [ ] **Step 3: Register the namespace in `src/lib/i18n.ts`**

Add imports after the `enContracts`/`elContracts` import lines:

```ts
import enAnnouncements from '@/i18n/locales/en/announcements.json';
import elAnnouncements from '@/i18n/locales/el/announcements.json';
```

Add `'announcements'` to the end of the `ns: [...]` array. Add to `resources.en` (next to `contracts: enContracts`):

```ts
        announcements: enAnnouncements,
```
Add to `resources.el` (next to `contracts: elContracts`):

```ts
        announcements: elAnnouncements,
```

- [ ] **Step 4: Add `nav.announcements` to `admin.json` (both locales)**

In `src/i18n/locales/en/admin.json`, inside the `"nav"` object, add: `"announcements": "Announcements",`
In `src/i18n/locales/el/admin.json`, inside the `"nav"` object, add: `"announcements": "Ανακοινώσεις",`

- [ ] **Step 5: Verify JSON + commit**

Run: `node -e "['en','el'].forEach(l=>require('./src/i18n/locales/'+l+'/announcements.json'));console.log('json ok')"`
Expected: `json ok`.

```bash
git add src/i18n/locales/en/announcements.json src/i18n/locales/el/announcements.json src/lib/i18n.ts src/i18n/locales/en/admin.json src/i18n/locales/el/admin.json
git commit -m "i18n(announcements): namespace + admin nav key (en + el)"
```

---

## Task 8: AnnouncementPopup + mount

**Files:** Create `src/features/announcements/AnnouncementPopup.tsx`; Modify `src/app/ShellLayout.tsx`

- [ ] **Step 1: Create the popup**

```tsx
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useMyAnnouncements } from './hooks/useMyAnnouncements';
import { useDismissAnnouncement } from './hooks/useDismissAnnouncement';
import { useAnnouncementsRealtime } from './hooks/useAnnouncementsRealtime';

export function AnnouncementPopup() {
  const { t } = useTranslation('announcements');
  useAnnouncementsRealtime();
  const { data = [] } = useMyAnnouncements();
  const dismiss = useDismissAnnouncement();

  const current = data[0] ?? null;
  if (!current) return null;

  const warning = current.severity === 'warning';

  return (
    <Dialog open onOpenChange={() => undefined}>
      <DialogContent
        className={warning ? 'border-l-4 border-l-amber-500 sm:max-w-md' : 'sm:max-w-md'}
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{current.title}</DialogTitle>
          <DialogDescription className="whitespace-pre-wrap text-foreground">
            {current.body}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={() => dismiss.mutate(current.id)} disabled={dismiss.isPending}>
            {t('popup.got_it')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Mount in `src/app/ShellLayout.tsx`**

Add the import:

```tsx
import { AnnouncementPopup } from '@/features/announcements/AnnouncementPopup';
```

Render it inside `RequireAuth`, after `</AppShell>`:

```tsx
  return (
    <RequireAuth>
      <AppShell>
        <Suspense fallback={<div className="p-8">…</div>}>
          <Outlet />
        </Suspense>
      </AppShell>
      <AnnouncementPopup />
    </RequireAuth>
  );
```

- [ ] **Step 3: Build + commit**

Run: `npm run build` → PASS.

```bash
git add src/features/announcements/AnnouncementPopup.tsx src/app/ShellLayout.tsx
git commit -m "feat(announcements): app-wide pop-up + realtime mount"
```

---

## Task 9: Admin page + route + Settings tab

**Files:** Create `src/features/announcements/AnnouncementsAdminPage.tsx`; Modify `src/app/router.tsx`, `src/app/AdminLayout.tsx`

- [ ] **Step 1: Create the admin page**

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader, SettingsCard } from '@/components/layout/page-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useGroups } from '@/features/groups/hooks/useGroups';
import { useCreateAnnouncement } from './hooks/useCreateAnnouncement';
import { useAnnouncements } from './hooks/useAnnouncements';
import { useSetAnnouncementActive } from './hooks/useSetAnnouncementActive';
import { useDeleteAnnouncement } from './hooks/useDeleteAnnouncement';
import {
  validateNewAnnouncement,
  buildCreateAnnouncementParams,
  type AnnouncementSeverity,
} from './announcement';

export function AnnouncementsAdminPage() {
  const { t, i18n } = useTranslation('announcements');
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const { data: groups = [] } = useGroups();
  const create = useCreateAnnouncement();
  const { data: list = [] } = useAnnouncements();
  const setActive = useSetAnnouncementActive();
  const del = useDeleteAnnouncement();

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [severity, setSeverity] = useState<AnnouncementSeverity>('info');
  const [targetAll, setTargetAll] = useState(true);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [expiresAt, setExpiresAt] = useState('');

  function toggleGroup(id: string) {
    setGroupIds((cur) => (cur.includes(id) ? cur.filter((g) => g !== id) : [...cur, id]));
  }

  function reset() {
    setTitle('');
    setBody('');
    setSeverity('info');
    setTargetAll(true);
    setGroupIds([]);
    setExpiresAt('');
  }

  function onPublish() {
    const input = { title, body, severity, targetAll, groupIds, expiresAt };
    const errs = validateNewAnnouncement(input);
    if (errs.length > 0) {
      alert(errs.map((k) => t(`admin.errors.${k}`, { defaultValue: k })).join('\n'));
      return;
    }
    create.mutate(buildCreateAnnouncementParams(input), {
      onSuccess: () => reset(),
      onError: (err) => {
        const errors = (err as Error & { errors?: string[] }).errors ?? [(err as Error).message];
        alert(errors.map((k) => t(`admin.errors.${k}`, { defaultValue: k })).join('\n'));
      },
    });
  }

  function audienceLabel(a: (typeof list)[number]): string {
    if (a.target_all) return t('admin.target_all');
    return a.announcement_targets
      .map((tg) => tg.groups?.display_names?.[lang] ?? tg.group_id)
      .join(', ');
  }

  function statusLabel(a: (typeof list)[number]): string {
    if (a.expires_at && new Date(a.expires_at) <= new Date()) return t('admin.status_expired');
    return a.is_active ? t('admin.status_active') : t('admin.status_inactive');
  }

  return (
    <div className="space-y-5">
      <SettingsCard className="p-5">
        <PageHeader title={t('admin.title')} description={t('admin.description')} />

        <div className="mt-4 max-w-2xl space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="an-title">{t('admin.field_title')}</Label>
            <Input id="an-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="an-body">{t('admin.field_message')}</Label>
            <textarea
              id="an-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="an-sev">{t('admin.field_severity')}</Label>
              <select
                id="an-sev"
                value={severity}
                onChange={(e) => setSeverity(e.target.value as AnnouncementSeverity)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
              >
                <option value="info">{t('admin.severity_info')}</option>
                <option value="warning">{t('admin.severity_warning')}</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="an-exp">{t('admin.field_expires')}</Label>
              <Input
                id="an-exp"
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t('admin.target')}</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={targetAll ? 'default' : 'outline'}
                onClick={() => setTargetAll(true)}
              >
                {t('admin.target_all')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={!targetAll ? 'default' : 'outline'}
                onClick={() => setTargetAll(false)}
              >
                {t('admin.target_groups')}
              </Button>
            </div>
            {!targetAll ? (
              <div className="flex flex-wrap gap-2 pt-1">
                {groups.map((g) => (
                  <label
                    key={g.id}
                    className="flex items-center gap-1.5 rounded-md border border-input px-2 py-1 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={groupIds.includes(g.id)}
                      onChange={() => toggleGroup(g.id)}
                    />
                    {g.display_names[lang]}
                  </label>
                ))}
              </div>
            ) : null}
          </div>

          <Button onClick={onPublish} disabled={create.isPending}>
            {create.isPending ? t('admin.publishing') : t('admin.publish')}
          </Button>
        </div>
      </SettingsCard>

      <SettingsCard className="p-5">
        <h2 className="text-lg font-semibold">{t('admin.list_title')}</h2>
        {list.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">{t('admin.empty')}</p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-2">{t('admin.col_title')}</th>
                <th className="py-2">{t('admin.col_audience')}</th>
                <th className="py-2">{t('admin.col_status')}</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {list.map((a) => (
                <tr key={a.id} className="border-t border-border/60">
                  <td className="py-2 pr-3">{a.title}</td>
                  <td className="py-2 pr-3">{audienceLabel(a)}</td>
                  <td className="py-2 pr-3">{statusLabel(a)}</td>
                  <td className="py-2 text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setActive.mutate({ id: a.id, active: !a.is_active })}
                      >
                        {a.is_active ? t('admin.deactivate') : t('admin.reactivate')}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          if (confirm(t('admin.delete_confirm'))) del.mutate(a.id);
                        }}
                      >
                        {t('admin.delete')}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SettingsCard>
    </div>
  );
}
```

- [ ] **Step 2: Add the route in `src/app/router.tsx`**

Add a lazy import next to the other admin lazy pages (e.g. after `FieldRulesPage`):

```tsx
const AnnouncementsAdminPage = lazyPage(
  () => import('@/features/announcements/AnnouncementsAdminPage'),
  'AnnouncementsAdminPage',
);
```

Add a child route inside the `admin` children array (after `contract-templates`):

```tsx
              { path: 'announcements', element: <AnnouncementsAdminPage /> },
```

- [ ] **Step 3: Add the Settings tab in `src/app/AdminLayout.tsx`**

Add to the `SETTINGS_TABS` array (after `contract_templates`):

```tsx
  { to: '/admin/announcements', key: 'announcements' },
```

- [ ] **Step 4: Build (strict) + commit**

Run: `npm run build` → PASS.

```bash
git add src/features/announcements/AnnouncementsAdminPage.tsx src/app/router.tsx src/app/AdminLayout.tsx
git commit -m "feat(announcements): admin Settings page + route + tab"
```

> Note: `lazyPage` expects a named export matching the second arg — `AnnouncementsAdminPage` is exported as a named function above, consistent with the other admin pages.

---

## Task 10: Full build + test gate

- [ ] **Step 1:** Run `npm run build` → PASS (tsc -b + eslint --max-warnings=0 + vite).
- [ ] **Step 2:** Run `npm run test:run` → all pass (existing + the 7 new announcement tests).
- [ ] **Step 3:** No commit (verification only).

---

## Task 11: Live smoke test

**Precondition:** Tasks 1–3 applied to prod; frontend deployed (or `npm run dev`).

- [ ] **Step 1:** As admin, open Settings → **Announcements**. Publish a `warning` to one group (e.g. `accounting`) with a title + message.
- [ ] **Step 2:** In a second session logged in as a member of that group, confirm the modal **pops up** (within a few seconds via realtime, or on reload). Click **Got it**.
- [ ] **Step 3:** Reload — confirm it does **not** re-appear (dismissal recorded).
- [ ] **Step 4:** Confirm a user **not** in the target group never sees it.
- [ ] **Step 5:** As admin, **Deactivate** then **Delete** the test announcement; confirm the list updates.
- [ ] **Step 6:** No commit (verification only). Clean up any test rows left in prod.

---

## Self-Review (completed during planning)

**Spec coverage:** tables+RLS → Task 1; RPCs (create/get_my/dismiss/set_active/delete) → Task 2; prod apply+verify → Task 3; validator/param-builder → Task 4; wrappers+keys → Task 5; hooks (incl. realtime) → Task 6; i18n+namespace+nav → Task 7; pop-up+mount → Task 8; admin page+route+tab → Task 9; build/test → Task 10; live smoke → Task 11. All spec sections covered. ✓

**Placeholder scan:** No TBD/TODO; all code blocks complete. ✓

**Type consistency:** `NewAnnouncementInput` / `CreateAnnouncementParams` / `AnnouncementSeverity` defined in `announcement.ts` (Task 4) and imported by `rpc.ts` (Task 5), `useCreateAnnouncement` + `AnnouncementsAdminPage` (Tasks 6/9). RPC param names (`p_title`, `p_body`, `p_severity`, `p_target_all`, `p_group_ids`, `p_expires_at`) match between `buildCreateAnnouncementParams`, the `create_announcement` wrapper, and the SQL signature. `MyAnnouncementRow` shape matches the `get_my_announcements` return columns. ✓
