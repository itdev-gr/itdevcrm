# Shared Company Mailboxes (accounting@ / support@) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture client email on accounting@itdev.gr and support@itdev.gr into the existing email pipeline (Accounting / Technical categories), include automated Resend sends in the threads, with a 90-day paginated backfill.

**Architecture:** Two never-login "service identity" auth users + a `shared_mailboxes` registry make the shared boxes first-class staff parties for the existing sweep and filing; `resolve_email_filing` gains a registry department override; google-oauth gains an admin-initiated target connect; gmail-sync gains Gmail pagination (90d for shared boxes) and reply "thread adoption"; send-email writes successful client-facing sends into `email_messages` by reusing `resolve_email_filing`.

**Tech Stack:** Supabase (Postgres, plpgsql, RLS, Deno edge fns), React + TanStack Query, i18next (en+el), vitest.

**Spec:** `docs/superpowers/specs/2026-07-10-shared-mailboxes-design.md`

## Global Constraints

- `npm run build` = `tsc -b` + `eslint --max-warnings=0`; index accesses need `!`.
- `email_messages` not in generated types → `from('email_messages' as never)` casts stay. No `any`.
- Commit per task; push to `main` only at the final task, after all migrations are applied and edge fns deployed (frontend depends on the new RPC/actions).
- Prod DB via Management API (recipe + payload-builder as in `docs/superpowers/plans/2026-07-10-lead-emails-3-categories.md` Global Constraints; owner sbp_ token — ROTATION OWED end of session).
- **Drift check before replacing any live fn**: `pg_get_functiondef` vs the repo base named in the task; STOP on logic drift.
- Edge fn deploys: `SUPABASE_ACCESS_TOKEN=<sbp> npx supabase functions deploy <fn> --project-ref xujlrclyzxrvxszepquy`. `config.toml` already pins verify_jwt for google-oauth and gmail-sync; do not change it.
- Only run scoped vitest commands named in tasks (repo suite touches prod).
- i18n: every new key in BOTH `src/i18n/locales/en/...` and `el/...`.
- The gmail-sync cron sweeps every 5 min with vault secret `gmail_sync_secret` — deploy gmail-sync only in its task's stated order (fn tolerates old schema, but keep sequence).

## File Structure

| File | Responsibility |
| --- | --- |
| `supabase/migrations/20260710170000_shared_mailboxes.sql` (create) | service identities, registry, `support` group, status RPC, `backfill_page_token` |
| `supabase/migrations/20260710171000_filing_registry_dept.sql` (create) | `resolve_email_filing` v4 (registry dept override) |
| `supabase/functions/_shared/google.ts` (modify) | `listGmailMessageIds` pagination |
| `supabase/functions/gmail-sync/index.ts` (modify) | shared-box 90d paginated backfill + thread adoption |
| `supabase/functions/google-oauth/index.ts` (modify) | admin target connect/disconnect |
| `supabase/functions/send-email/index.ts` (modify) | automated sends → `email_messages` |
| `src/features/admin/SharedMailboxesPage.tsx` (create) | Settings section UI |
| `src/app/AdminLayout.tsx`, `src/app/router.tsx` (modify) | tab + route |
| `src/i18n/locales/{en,el}/admin.json` (modify) | nav + page strings |

---

### Task 1: Migration — identities, registry, `support` group, status RPC, sync column

**Files:**
- Create: `supabase/migrations/20260710170000_shared_mailboxes.sql`

**Interfaces:**
- Produces: `public.shared_mailboxes(user_id uuid pk → profiles, email text unique, department text)` with rows for accounting@ ('accounting') and support@ ('support'); auth users + inactive profiles for both addresses; `groups` row `support` (parent_label 'Technical') + `group_permissions(board='support', action='view', scope='group')`; `user_google_sync.backfill_page_token text`; secdef RPC `shared_mailbox_status()` (admin-gated) returning `(email text, department text, google_email text, connected boolean, last_synced_at timestamptz, backfilled boolean)`.

- [ ] **Step 1: Write the migration**

```sql
-- 2026-07-10: shared company mailboxes (accounting@/support@) as first-class
-- capture sources. Spec: docs/superpowers/specs/2026-07-10-shared-mailboxes-design.md

-- 1. Service identities: auth users that never log in (random bcrypt password,
-- no auth.identities row). handle_new_auth_user backfills profiles.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', gen_random_uuid(),
       'authenticated', 'authenticated', m.email,
       extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')),
       now(), '{"provider":"email","providers":["email"]}'::jsonb,
       jsonb_build_object('full_name', m.label, 'must_change_password', false),
       '', '', '', '', now(), now()
from (values ('accounting@itdev.gr', 'Accounting Mailbox'),
             ('support@itdev.gr', 'Support Mailbox')) as m(email, label)
where not exists (select 1 from auth.users u where lower(u.email) = m.email);

-- Invisible to rosters/pickers (they filter is_active), never assignable.
update public.profiles set is_active = false
 where lower(email) in ('accounting@itdev.gr', 'support@itdev.gr');

-- 2. Registry: which addresses are company mailboxes + their fixed department.
create table if not exists public.shared_mailboxes (
  user_id uuid primary key references public.profiles(user_id) on delete cascade,
  email text not null unique,
  department text not null check (department in ('accounting', 'support')),
  created_at timestamptz not null default now()
);
alter table public.shared_mailboxes enable row level security;
create policy shared_mailboxes_admin_select on public.shared_mailboxes
  for select using (public.current_user_is_admin());
-- writes: service_role / migrations only.

insert into public.shared_mailboxes (user_id, email, department)
select p.user_id, lower(p.email),
       case lower(p.email) when 'accounting@itdev.gr' then 'accounting' else 'support' end
  from public.profiles p
 where lower(p.email) in ('accounting@itdev.gr', 'support@itdev.gr')
on conflict (user_id) do nothing;

-- 3. 'support' group (Technical bucket) + own-board view permission.
insert into public.groups (code, display_names, parent_label, position)
select 'support', '{"en": "Support", "el": "Υποστήριξη"}'::jsonb, 'Technical',
       coalesce((select max(position) + 1 from public.groups), 99)
where not exists (select 1 from public.groups where code = 'support');

insert into public.group_permissions (group_id, board, action, scope, allowed)
select id, 'support', 'view', 'group', true
  from public.groups where code = 'support'
on conflict (group_id, board, action) do nothing;
-- No members seeded: admins see everything; owner adds members in Settings.

-- 4. Paginated backfill cursor for shared boxes (Task 4 uses it).
alter table public.user_google_sync add column if not exists backfill_page_token text;

-- 5. Status for the admin Settings page (user_google_accounts has no client
-- policies, so an admin-gated security-definer RPC reads it).
create or replace function public.shared_mailbox_status()
returns table (user_id uuid, email text, department text, google_email text, connected boolean,
               last_synced_at timestamptz, backfilled boolean)
language sql stable security definer set search_path = public as $$
  select sm.user_id, sm.email, sm.department, uga.google_email,
         (uga.user_id is not null and uga.revoked_at is null
          and coalesce(uga.scopes, '') like '%gmail.readonly%') as connected,
         s.last_synced_at,
         (s.backfilled_at is not null and s.backfill_page_token is null) as backfilled
    from public.shared_mailboxes sm
    left join public.user_google_accounts uga on uga.user_id = sm.user_id
    left join public.user_google_sync s on s.user_id = sm.user_id
   where public.current_user_is_admin()
   order by sm.email;
$$;
revoke execute on function public.shared_mailbox_status() from public, anon;
grant execute on function public.shared_mailbox_status() to authenticated;

notify pgrst, 'reload schema';

-- ROLLBACK:
--   drop function if exists public.shared_mailbox_status();
--   alter table public.user_google_sync drop column if exists backfill_page_token;
--   delete from public.group_permissions where board = 'support';
--   delete from public.groups where code = 'support';
--   drop table if exists public.shared_mailboxes;
--   delete from auth.users where lower(email) in ('accounting@itdev.gr','support@itdev.gr');
--     (cascades profiles + user_google_accounts + user_google_sync)
```

- [ ] **Step 2: Apply via Management API** (payload-builder recipe). Expected HTTP 201.

- [ ] **Step 3: Verify**

```sql
select (select count(*) from auth.users where lower(email) in ('accounting@itdev.gr','support@itdev.gr')) as auth_users,
       (select count(*) from profiles where lower(email) in ('accounting@itdev.gr','support@itdev.gr') and is_active = false) as inactive_profiles,
       (select json_agg(json_build_object('email', email, 'dept', department)) from shared_mailboxes) as registry,
       (select count(*) from groups where code = 'support') as support_group,
       (select count(*) from group_permissions gp join groups g on g.id = gp.group_id
         where g.code = 'support' and gp.board = 'support' and gp.action = 'view') as support_view,
       (select count(*) from information_schema.columns where table_name = 'user_google_sync' and column_name = 'backfill_page_token') as pt_col;
```
Expected: 2, 2, both rows with correct depts, 1, 1, 1. Also confirm the service identities are invisible: the roster query from the session (active profiles) must NOT include them.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260710170000_shared_mailboxes.sql
git commit -m "feat(email): shared mailbox identities, registry, support group, status RPC"
```

---

### Task 2: Migration — `resolve_email_filing` v4 (registry department override)

**Files:**
- Create: `supabase/migrations/20260710171000_filing_registry_dept.sql`

**Interfaces:**
- Consumes: `shared_mailboxes` (Task 1); v3 base body in `supabase/migrations/20260710150000_lead_email_capture.sql`.
- Produces: uncoded client mail whose staff party is a shared mailbox tags the registry department instead of the staff-group rule. Everything else (code precedence, lead fallback → 'sales', skips) unchanged.

- [ ] **Step 1: Drift check** — `pg_get_functiondef('public.resolve_email_filing(text,text,text)'::regprocedure)` vs the v3 migration. STOP on logic drift.

- [ ] **Step 2: Write the migration** — full v3 body via `create or replace function` (same signature → grants preserved), with EXACTLY ONE change: in the uncoded, client-matched branch, replace the staff-group rule block

```sql
      -- Uncoded client mail: department from the staff party's groups
      -- (owner-approved 07-10). sales wins over accounting; neither => sales.
      if exists (select 1 from user_groups ug join groups g on g.id = ug.group_id
                  where ug.user_id = v_staff and g.code = 'sales') then
        v_dept := 'sales';
      elsif exists (select 1 from user_groups ug join groups g on g.id = ug.group_id
                     where ug.user_id = v_staff and g.code = 'accounting') then
        v_dept := 'accounting';
      else
        v_dept := 'sales';
      end if;
```

with

```sql
      -- Uncoded client mail: a shared company mailbox has a fixed department
      -- (registry); a person tags by their groups (sales > accounting > sales).
      select department into v_dept from shared_mailboxes where user_id = v_staff;
      if v_dept is null then
        if exists (select 1 from user_groups ug join groups g on g.id = ug.group_id
                    where ug.user_id = v_staff and g.code = 'sales') then
          v_dept := 'sales';
        elsif exists (select 1 from user_groups ug join groups g on g.id = ug.group_id
                       where ug.user_id = v_staff and g.code = 'accounting') then
          v_dept := 'accounting';
        else
          v_dept := 'sales';
        end if;
      end if;
```

Header comment names the base (`20260710150000_lead_email_capture.sql`) as the rollback body. Everything else byte-identical to v3 (diff the extracted bodies to prove it — same technique as the carry-over migration).

- [ ] **Step 3: Apply + probe**

```sql
-- client <-> accounting@ uncoded => accounting; client <-> support@ uncoded => support
select department from resolve_email_filing('accounting@itdev.gr', '<a real client email>', 'no code');   -- accounting
select department from resolve_email_filing('support@itdev.gr', '<a real client email>', 'no code');      -- support
-- job code beats registry:
select department, job_id is not null as coded from resolve_email_filing('support@itdev.gr', '<any external>', 'about 000280-WEBDEV');  -- web_dev, true
-- staff <-> shared skipped (both are profiles):
select count(*) from resolve_email_filing('mkifokeris@itdev.gr', 'accounting@itdev.gr', 'x');  -- 0
-- lead <-> support@ => lead match, sales:
select lead_id is not null as lead_matched, department from resolve_email_filing('support@itdev.gr', '<a real open-lead email>', 'hi');  -- true, sales
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260710171000_filing_registry_dept.sql
git commit -m "feat(email): filing tags shared-mailbox mail by registry department"
```

---

### Task 3: google-oauth — admin connects a shared mailbox

**Files:**
- Modify: `supabase/functions/google-oauth/index.ts`
- Modify: `src/features/email/useGoogleConnection.ts`

**Interfaces:**
- Consumes: `signState({ uid }, STATE_SECRET, 600)` / `verifyState` from `_shared/google.ts` (formats in the fn today); `callerUserId` helper; `shared_mailboxes` registry.
- Produces: `action: 'start'` and `action: 'disconnect'` accept optional `target_user_id`; when present the fn requires (a) caller is admin (`profiles.is_admin`) and (b) target exists in `shared_mailboxes`; state is then signed as `{ uid: target_user_id }`. Callback unchanged (keys on `verified.uid`). Frontend: `useGoogleConnection` gains optional `targetUserId` param passed through both mutations (default undefined → exact current behavior).

- [ ] **Step 1: Edge fn edit**

In the start action (and mirrored in disconnect), after resolving `callerUserId`:

```ts
    const target = typeof body.target_user_id === 'string' ? body.target_user_id : null;
    let uid = caller;
    if (target && target !== caller) {
      // Only admins may act for a different identity, and only for registered
      // shared mailboxes — never for another person.
      const { data: isAdmin } = await admin.from('profiles')
        .select('is_admin').eq('user_id', caller).maybeSingle();
      const { data: shared } = await admin.from('shared_mailboxes')
        .select('user_id').eq('user_id', target).maybeSingle();
      if (!isAdmin?.is_admin || !shared) return json({ error: 'forbidden' }, 403);
      uid = target;
    }
```

then sign/disconnect with `uid` instead of the caller id. Match the file's existing helpers/response style exactly (read it first — the fragment above adapts to the real variable names).

- [ ] **Step 2: Frontend hook**

`useGoogleConnection(targetUserId?: string)`: both `functions.invoke('google-oauth', ...)` calls add `target_user_id: targetUserId` to the body (key omitted when undefined — spread `...(targetUserId ? { target_user_id: targetUserId } : {})`). Existing callers pass nothing — behavior unchanged. Keep `my_google_status` usage as is (the shared page uses the Task 1 RPC instead).

- [ ] **Step 3: Deploy + verify**

Deploy google-oauth. Verify: `functions.invoke` style probe with a non-admin JWT is impractical here — instead verify via curl that a `start` with `target_user_id` and **no** auth header still 401s (gateway/JWT handling unchanged), and rely on Task 6's live connect for the positive path. Run `npx vitest run src/features/email/` (hook file compiles; 15/15 stay green) and `npm run build`.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/google-oauth/index.ts src/features/email/useGoogleConnection.ts
git commit -m "feat(email): google-oauth admin target-connect for shared mailboxes"
```

---

### Task 4: gmail-sync — 90-day paginated backfill for shared boxes + thread adoption

**Files:**
- Modify: `supabase/functions/_shared/google.ts` (listGmailMessageIds pagination)
- Modify: `supabase/functions/gmail-sync/index.ts`

**Interfaces:**
- Consumes: `shared_mailboxes`, `user_google_sync.backfill_page_token` (Task 1).
- Produces: `listGmailMessageIds(accessToken, query, max, pageToken?)` returns `{ ids: string[], nextPageToken: string | null }` — **breaking signature change; update BOTH call sites** (gmail-sync is the only caller today; grep to confirm). Shared mailboxes backfill `newer_than:90d`, 200 ids/run, persisting `backfill_page_token` across runs; `backfilled_at` set only when pagination exhausts. Staff mailboxes keep single-run `newer_than:10d`. After storing an inbound message that has a `thread_id`, same-client/lead null-thread rows with matching normalized subject adopt it.

- [ ] **Step 1: google.ts**

```ts
export async function listGmailMessageIds(
  accessToken: string, query: string, max: number, pageToken?: string,
): Promise<{ ids: string[]; nextPageToken: string | null }> {
  const u = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
  u.searchParams.set('maxResults', String(max));
  if (query) u.searchParams.set('q', query);
  if (pageToken) u.searchParams.set('pageToken', pageToken);
  const r = await fetch(u, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!r.ok) throw new Error(`list_failed: ${await r.text()}`);
  const j = await r.json();
  return {
    ids: ((j.messages ?? []) as { id: string }[]).map((m) => m.id),
    nextPageToken: (j.nextPageToken as string | undefined) ?? null,
  };
}
```

- [ ] **Step 2: gmail-sync `syncOneUser`**

Replace the query-build + list block (current lines ~36–45) with:

```ts
  const { data: shared } = await admin.from('shared_mailboxes')
    .select('user_id').eq('user_id', uid).maybeSingle();

  const { data: cur } = await admin.from('user_google_sync')
    .select('last_synced_at, backfilled_at, backfill_page_token').eq('user_id', uid).maybeSingle();

  // Shared boxes backfill 90 days, paged 200/run; staff keep the single-run 10d.
  const backfillQ = shared ? 'newer_than:90d' : 'newer_than:10d';
  const backfilling = !cur?.backfilled_at || cur?.backfill_page_token;
  let q = backfillQ;
  let pageToken: string | undefined = cur?.backfill_page_token ?? undefined;
  if (!backfilling && cur?.last_synced_at) {
    const since = Math.floor(new Date(cur.last_synced_at as string).getTime() / 1000) - OVERLAP_SEC;
    q = `after:${since}`;
    pageToken = undefined;
  }

  const { ids, nextPageToken } = await listGmailMessageIds(access, q, 200, pageToken);
```

and change the final `user_google_sync` upsert to persist pagination state:

```ts
  const morePages = backfilling && !!nextPageToken;
  await admin.from('user_google_sync').upsert({
    user_id: uid,
    last_synced_at: new Date().toISOString(),
    backfilled_at: morePages ? null : ((cur?.backfilled_at as string | null) ?? new Date().toISOString()),
    backfill_page_token: morePages ? nextPageToken : null,
  });
```

(Note: `backfilling` treats a null `backfilled_at` OR a pending page token as "still backfilling", so an interrupted paged backfill resumes. INTENTIONAL behavior change for staff mailboxes: a first-run 10d backfill with >200 messages now pages across sweeps instead of silently truncating at 200 — bounded by the 10-day window.)

- [ ] **Step 3: thread adoption (same file, inside the stored-message branch)**

After a successful upsert (`if (!error) stored++;`), add:

```ts
      if (!error && m.thread_id && f.direction === 'inbound' && (f.client_id || f.lead_id)) {
        // Automated sends (thread_id null) adopt the reply's Gmail thread so the
        // conversation folds together. Normalized-subject match, same client/lead.
        const norm = (m.subject ?? '').replace(/^((re|fwd?):\s*)+/i, '').trim().toLowerCase();
        if (norm) {
          let adopt = admin.from('email_messages')
            .update({ thread_id: m.thread_id })
            .is('thread_id', null)
            .ilike('subject', `%${norm.replace(/[%_]/g, '\\$&')}`);
          adopt = f.client_id ? adopt.eq('client_id', f.client_id) : adopt.eq('lead_id', f.lead_id);
          await adopt;
        }
      }
```

(ilike anchored at the end tolerates Re:/Fwd: prefixes on either side; escaped `%`/`_`. Keep it inside the per-message try/catch.)

- [ ] **Step 4: Deploy + verify**

Deploy gmail-sync. Trigger one sweep manually with the vault secret (from the session scratchpad file) and verify: staff mailboxes still advance (`user_google_sync.last_synced_at`), zero errors growth, and no shared rows exist yet (registry connected in Task 6). SQL-verify the adoption UPDATE logic separately with a rolled-back probe: insert an automated-style row (`thread_id` null) + run the UPDATE statement shape with a fake thread id → row adopts; rollback.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/google.ts supabase/functions/gmail-sync/index.ts
git commit -m "feat(email): shared-mailbox 90d paginated backfill + reply thread adoption"
```

---

### Task 5: send-email — automated sends land in the threads

**Files:**
- Modify: `supabase/functions/send-email/index.ts`

**Interfaces:**
- Consumes: success branch (current lines ~141–143: `email_log` insert with `identity, to, templateKey, dedupeKey, body.id`), `IDENTITIES[identity]` from `identities.ts` (from/replyTo strings), `resolve_email_filing` RPC (v4), `rendered.subject`/`rendered.text`.
- Produces: each successful **client-facing** send (`identity !== 'internal'` AND `dbTpl?.client_facing !== false` — read the file; use the template row already fetched) also inserts an `email_messages` row filed by `resolve_email_filing(fromEmail, to, rendered.subject)`; skipped silently when filing returns no row (unknown recipient / from-address not a registered profile). Never blocks the send result.

- [ ] **Step 1: Implement**

After the existing `email_log` insert in the success branch:

```ts
    // Mirror client-facing sends into the captured-email threads (spec 07-10):
    // filing decides ownership; unknown parties are skipped, errors never
    // affect the send result.
    if (identity !== 'internal' && dbTpl?.client_facing !== false) {
      try {
        const fromEmail = (fromOverride ?? id.from).replace(/^.*<([^>]+)>.*$/, '$1').toLowerCase();
        const { data: fil } = await admin.rpc('resolve_email_filing', {
          p_from: fromEmail, p_to: to, p_subject: rendered.subject,
        });
        const f = Array.isArray(fil) ? fil[0] : null;
        if (f) {
          await admin.from('email_messages').upsert({
            message_id: `resend:${body.id ?? crypto.randomUUID()}`,
            direction: 'outbound', from_email: fromEmail, from_name: 'ITDEV (automated)',
            to_email: to, subject: rendered.subject, body_text: rendered.text ?? null,
            sent_at: new Date().toISOString(),
            client_id: f.client_id, deal_id: f.deal_id, job_id: f.job_id, lead_id: f.lead_id,
            department: f.department, staff_user_id: f.staff_user_id,
          }, { onConflict: 'message_id', ignoreDuplicates: true });
        }
      } catch (_e) { /* thread mirroring must never fail a send */ }
    }
```

IMPORTANT nuance for the implementer: filing only matches when `fromEmail` is a `profiles` email. Today that means sends from accounting@itdev.gr mirror into threads; sends from other identities (e.g. a sales From that isn't a profile address) are skipped by design — read `identities.ts` and note in your report which identities' From addresses are profile-matched. Do NOT force-insert unmatched sends.

- [ ] **Step 2: Deploy + verify**

Deploy send-email. Probe filing-only (no real email): `select * from resolve_email_filing('accounting@itdev.gr', '<real client email>', 'Payment reminder');` → row with department 'accounting'. Then verify a REAL automated send end-to-end only if one occurs naturally; otherwise leave e2e to the final task's live watch. `npx vitest run src/features/email/` + `npm run build` (no frontend change expected — command is a regression gate).

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/send-email/index.ts
git commit -m "feat(email): mirror client-facing automated sends into email threads"
```

---

### Task 6: Settings → Shared mailboxes page + wiring + final verify/push

**Files:**
- Create: `src/features/admin/SharedMailboxesPage.tsx`
- Modify: `src/app/AdminLayout.tsx` (SETTINGS_TABS), `src/app/router.tsx` (child route, lazyPage)
- Modify: `src/i18n/locales/en/admin.json`, `src/i18n/locales/el/admin.json`

**Interfaces:**
- Consumes: RPC `shared_mailbox_status()` (Task 1), `useGoogleConnection(targetUserId)` (Task 3).
- Produces: `/admin/shared-mailboxes` — one card per registry row: email, department chip, status (connected / not connected / syncing / backfilling with last_synced), Connect and Disconnect buttons calling `useGoogleConnection(row.user_id)`. The status RPC's return interface (Task 1) is `(user_id uuid, email text, department text, google_email text, connected boolean, last_synced_at timestamptz, backfilled boolean)`.

- [ ] **Step 1: Page component**

```tsx
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { useGoogleConnection } from '@/features/email/useGoogleConnection';

type Row = {
  user_id: string; email: string; department: string; google_email: string | null;
  connected: boolean; last_synced_at: string | null; backfilled: boolean;
};

export function SharedMailboxesPage() {
  const { t } = useTranslation('admin');
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['shared-mailbox-status'],
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase.rpc('shared_mailbox_status' as never);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as Row[];
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">{t('shared_mailboxes.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('shared_mailboxes.subtitle')}</p>
      </div>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">…</p>
      ) : (
        rows.map((row) => <MailboxCard key={row.user_id} row={row} t={t} />)
      )}
    </div>
  );
}

function MailboxCard({ row, t }: { row: Row; t: ReturnType<typeof useTranslation>['t'] }) {
  const conn = useGoogleConnection(row.user_id);
  const status = !row.connected
    ? t('shared_mailboxes.not_connected')
    : row.backfilled
      ? t('shared_mailboxes.syncing')
      : t('shared_mailboxes.backfilling');
  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-card p-4 shadow-sm">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">{row.email}</p>
        <p className="text-xs text-muted-foreground">
          <span className="mr-2 rounded-full bg-muted px-1.5 py-0.5 uppercase tracking-wide">{row.department}</span>
          {status}
          {row.last_synced_at && ` · ${new Date(row.last_synced_at).toLocaleString()}`}
        </p>
      </div>
      {row.connected ? (
        <Button variant="outline" size="sm" onClick={() => conn.disconnect.mutate()} disabled={conn.disconnect.isPending}>
          {t('shared_mailboxes.disconnect')}
        </Button>
      ) : (
        <Button size="sm" onClick={() => conn.connect.mutate()} disabled={conn.connect.isPending}>
          {t('shared_mailboxes.connect')}
        </Button>
      )}
    </section>
  );
}
```

(Adapt the `useGoogleConnection` call shape to the hook as Task 3 actually shipped it — mutate signatures must match. If the hook exposes `connect()`/`disconnect()` directly, call those.)

- [ ] **Step 2: Route + tab + i18n**

- `AdminLayout.tsx` SETTINGS_TABS: add `{ to: '/admin/shared-mailboxes', key: 'shared_mailboxes' }` (after email-health).
- `router.tsx`: `const SharedMailboxesPage = lazyPage(() => import('@/features/admin/SharedMailboxesPage'), 'SharedMailboxesPage');` + child `{ path: 'shared-mailboxes', element: <SharedMailboxesPage /> }`.
- `en/admin.json`: `"nav": { ... "shared_mailboxes": "Shared mailboxes" }` plus a `"shared_mailboxes"` block: `title` "Shared mailboxes", `subtitle` "Company inboxes captured into client email threads.", `connect` "Connect Google", `disconnect` "Disconnect", `not_connected` "Not connected", `syncing` "Syncing", `backfilling` "Backfilling history…".
- `el/admin.json`: `"shared_mailboxes": "Κοινά γραμματοκιβώτια"` in nav; block: `title` "Κοινά γραμματοκιβώτια", `subtitle` "Εταιρικά inbox που καταγράφονται στις συνομιλίες email πελατών.", `connect` "Σύνδεση με Google", `disconnect` "Αποσύνδεση", `not_connected` "Μη συνδεδεμένο", `syncing` "Συγχρονίζεται", `backfilling` "Φόρτωση ιστορικού…".

- [ ] **Step 3: Verify + push**

```bash
npx vitest run src/features/email/   # 15/15
npm run build                        # exit 0
git add -A src/features/admin/SharedMailboxesPage.tsx src/app/AdminLayout.tsx src/app/router.tsx src/i18n/locales/en/admin.json src/i18n/locales/el/admin.json
git commit -m "feat(admin): Shared mailboxes settings page (connect accounting@/support@)"
git fetch origin && git log HEAD..origin/main --oneline   # expect empty
git push origin main
```

- [ ] **Step 4: Live activation (controller + owner)**

1. Owner opens `/admin/shared-mailboxes`, clicks Connect on accounting@ → Google login as accounting@itdev.gr → repeat for support@.
2. Watch sweeps: `select * from shared_mailbox_status()` equivalent via Management API — page tokens churn until `backfilled` true (90d ≈ several ticks per box).
3. Verify threads: a client with accounting@ correspondence shows an **Accounting** section thread; a support@ conversation shows under **Technical**; automated reminder sends appear as "ITDEV (automated)" outbound entries once the next reminder fires.

## Changes / Revert

Per-task ROLLBACK blocks in each migration; edge fns revert by redeploying prior versions; UI reverts via git. `email_messages` rows created by mirroring/backfill are data — keep (harmless) or delete by `message_id like 'resend:%'` / `captured_from_user_id in (shared ids)`.
