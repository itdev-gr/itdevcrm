# CRM Email Inbox (Εισερχόμενα) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A topbar Mail icon (between the profile icon and the notifications bell) with a per-user unread badge for inbound client emails, a dedicated `/inbox` page listing them, and capture+manual-filing of client emails that matched no card (today they are silently dropped).

**Architecture:** Reuse the existing capture pipeline end-to-end. gmail-sync stops dropping unmatched inbound on **shared mailboxes** and stores them as "unfiled" `email_messages` rows (all card ids null). A new `email_message_reads` table tracks per-user seen state. The `email_messages_select` RLS policy (live body = the peer session's `20260903140000` emission — base on it verbatim) gains one branch for unfiled rows. A SECURITY DEFINER RPC files an unfiled message (and its thread) onto a lead or client. Frontend: `useEmailInbox` hook (poll 60s + realtime), `EmailInboxButton` in the Topbar, `InboxPage` with tabs Όλα/Αδιάβαστα/Δικά μου/Χωρίς καρτέλα and a filing dialog.

**Tech Stack:** Supabase (Postgres RLS, Deno edge fn gmail-sync), React 19 + TanStack Query v5, Tailwind + shadcn, vitest.

## Global Constraints

- All user-facing copy in Greek (i18n keys in BOTH `src/i18n/locales/{el,en}/sales.json`); UI never displays a staff email address (owner rule 2026-09-03 — icon/name only).
- DB changes via migration files applied with the Management-API token flow (`sbp.token` script, user runs via `!` if the classifier blocks); function md5 pre/post printed when replacing an existing function/policy body.
- `email_messages_select` is ALSO owned by the parallel session «multi-role-offer-and-email» (their 20260903140000 is the live body) — message that session before applying Task 1 and base any rewrite on the body quoted in Task 1 (verify live md5 first).
- gmail-sync deploy = Management API multipart, bundle: `gmail-sync/index.ts` + `_shared/{google,timing,emailDedup,recipients,signature}.ts`, `verify_jwt:false` preserved.
- Unfiled capture only for **shared mailboxes** (sales@/info@/accounting@/support@) and only `direction=inbound` from non-staff senders; senders matching `/no-?reply|newsletter|mailer[-_]?daemon|postmaster/i` are still dropped (noise).
- Every task: vitest green + eslint clean on touched files before commit; commits carry the standard Co-Authored-By trailer.

## File Structure

- `supabase/migrations/20260903210000_email_inbox.sql` — reads table + RLS, unfiled-visibility branch, `file_email_message` RPC, realtime publication.
- `supabase/functions/gmail-sync/index.ts` — unfiled-store branch (only edge file touched).
- `src/lib/queryKeys.ts` — `emailInbox` key.
- `src/features/email/hooks/useEmailInbox.ts` (+`.test.ts`) — rows+reads+unread, mark-read mutation, realtime invalidation.
- `src/features/email/EmailInboxButton.tsx` (+`.test.tsx`) — topbar icon+badge.
- `src/features/email/InboxPage.tsx` (+`.test.tsx`) — the page.
- `src/features/email/FileEmailDialog.tsx` (+`.test.tsx`) — assign-to-card dialog.
- `src/components/layout/Topbar.tsx` — mount the button.
- `src/app/router.tsx` — `/inbox` route.
- `src/i18n/locales/{el,en}/sales.json` — `inbox.*` keys.

---

### Task 1: Migration — reads table, unfiled RLS, filing RPC, realtime

**Files:**
- Create: `supabase/migrations/20260903210000_email_inbox.sql`

**Interfaces:**
- Produces: table `public.email_message_reads(message_pk uuid, user_id uuid, read_at timestamptz)`; RPC `public.file_email_message(p_message_pk uuid, p_target_type text, p_target_id uuid) returns int`; `email_messages` in `supabase_realtime`.
- Consumes: live `email_messages_select` policy body (quoted below from 20260903140000 — verify against prod before applying).

- [ ] **Step 1: Write the migration file** (full content):

```sql
-- =============================================================================
-- 20260903210000_email_inbox.sql
-- CRM Inbox (owner spec 2026-09-03):
--  §1 per-user read state for email_messages
--  §2 unfiled rows (no card ids) become visible to admins + the capturing
--     shared-mailbox department + the capturing user
--  §3 SECURITY DEFINER filing RPC: unfiled message (+ thread) -> lead/client
--  §4 email_messages joins supabase_realtime so the topbar badge is live
-- Coordination: the select-policy base body is 20260903140000 (the parallel
-- session's emission) — verify live md5 before applying; changes are additive.
-- =============================================================================

-- §1 read state ---------------------------------------------------------------
create table if not exists public.email_message_reads (
  message_pk uuid not null references public.email_messages(id) on delete cascade,
  user_id    uuid not null references public.profiles(user_id) on delete cascade,
  read_at    timestamptz not null default now(),
  primary key (message_pk, user_id)
);
alter table public.email_message_reads enable row level security;
drop policy if exists email_message_reads_own on public.email_message_reads;
create policy email_message_reads_own on public.email_message_reads
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- §2 unfiled visibility -------------------------------------------------------
-- Base body: 20260903140000_email_visibility_technical_boards.sql, verbatim,
-- plus ONE new top-level OR branch for unfiled rows.
drop policy if exists email_messages_select on public.email_messages;
create policy email_messages_select on public.email_messages for select using (
  staff_user_id = auth.uid()
  or (select auth.uid()) in (select public.group_member_ids('accounting'))
  or (
    case when lead_id is not null and client_id is null then
      public.current_user_is_admin()
      or exists (select 1 from public.leads l
                  where l.id = email_messages.lead_id and l.owner_user_id = auth.uid())
    else public.current_user_can(department, 'view')
    end
  )
  or (
    job_id is not null
    and exists (
      select 1 from public.jobs j
       where j.id = email_messages.job_id
         and public.current_user_can(j.service_type, 'view')
    )
  )
  -- 2026-09-03 Inbox: unfiled captures (no card at all) are workable items —
  -- admins, the capturing user, and the capturing shared-mailbox's department.
  or (
    client_id is null and lead_id is null and job_id is null and deal_id is null
    and (
      public.current_user_is_admin()
      or captured_from_user_id = auth.uid()
      or exists (
        select 1 from public.shared_mailboxes sm
         where sm.user_id = email_messages.captured_from_user_id
           and public.current_user_can(sm.department, 'view')
      )
    )
  )
);

-- §3 filing RPC ---------------------------------------------------------------
create or replace function public.file_email_message(
  p_message_pk uuid, p_target_type text, p_target_id uuid)
returns int
language plpgsql security definer set search_path = public as $$
declare
  m public.email_messages;
  v_dept text;
  v_moved int := 0;
begin
  if p_target_type not in ('lead', 'client') then
    raise exception 'bad_target_type';
  end if;
  select * into m from public.email_messages where id = p_message_pk;
  if m.id is null then raise exception 'message_not_found'; end if;
  if m.client_id is not null or m.lead_id is not null
     or m.job_id is not null or m.deal_id is not null then
    raise exception 'already_filed';
  end if;

  -- department: the capturing shared mailbox's, else 'sales'
  select sm.department into v_dept from public.shared_mailboxes sm
   where sm.user_id = m.captured_from_user_id;
  v_dept := coalesce(v_dept, 'sales');

  if p_target_type = 'lead' then
    if not exists (select 1 from public.leads where id = p_target_id) then
      raise exception 'lead_not_found';
    end if;
    update public.email_messages em
       set lead_id = p_target_id, department = 'sales'
     where em.client_id is null and em.lead_id is null
       and em.job_id is null and em.deal_id is null
       and (em.id = p_message_pk
            or (m.thread_id is not null and em.thread_id = m.thread_id)
            or lower(em.from_email) = lower(m.from_email));
  else
    if not exists (select 1 from public.clients where id = p_target_id) then
      raise exception 'client_not_found';
    end if;
    update public.email_messages em
       set client_id = p_target_id, department = v_dept
     where em.client_id is null and em.lead_id is null
       and em.job_id is null and em.deal_id is null
       and (em.id = p_message_pk
            or (m.thread_id is not null and em.thread_id = m.thread_id)
            or lower(em.from_email) = lower(m.from_email));
  end if;
  get diagnostics v_moved = row_count;
  return v_moved;
end $$;
revoke execute on function public.file_email_message(uuid, text, uuid) from public, anon;
grant execute on function public.file_email_message(uuid, text, uuid) to authenticated;

-- §4 realtime -----------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.email_messages;
exception when duplicate_object then null;
end $$;

-- ROLLBACK:
--   drop function if exists public.file_email_message(uuid, text, uuid);
--   drop table if exists public.email_message_reads;
--   alter publication supabase_realtime drop table public.email_messages;
--   re-run the CREATE POLICY from 20260903140000 (removes the unfiled branch).
```

- [ ] **Step 2: Message the peer session** (SendMessage to `uds:/tmp/cc-socks/11756.sock`): "Rewriting email_messages_select in 20260903210000, base = your 20260903140000 body + one additive unfiled branch — ping if you have another rewrite in flight."
- [ ] **Step 3: Apply via token script** (copy `apply-recency-guard.mjs` pattern in the scratchpad; print `md5(pg_get_functiondef)` is N/A for policies — instead print `select policyname, md5(coalesce(qual,'')) from pg_policies where tablename='email_messages'` pre/post). Verify output shows the reads table, RPC, and the publication row (`select * from pg_publication_tables where tablename='email_messages'`).
- [ ] **Step 4: Negative probe** (same script, rolled-back DO block, impersonation pattern): as a NON-admin sales rep, `select count(*) from email_messages where client_id is null and lead_id is null and job_id is null and deal_id is null` returns only rows captured by sales-department shared mailboxes.
- [ ] **Step 5: Commit** `git add supabase/migrations/20260903210000_email_inbox.sql && git commit -m "feat(inbox): read-state table, unfiled visibility, filing RPC, realtime"`

### Task 2: gmail-sync — store unfiled inbound on shared mailboxes

**Files:**
- Modify: `supabase/functions/gmail-sync/index.ts` (the `if (!f) continue;` site, ~line 142)

**Interfaces:**
- Consumes: existing `storeCaptured(row)` (line 41) and the `shared` lookup (line 108) already in scope.
- Produces: unfiled `email_messages` rows: `direction='inbound'`, all card ids null, `department: null`, `staff_user_id: null`, `captured_from_user_id: uid`.

- [ ] **Step 1: Replace the drop with the unfiled branch** — change:

```ts
      const f = Array.isArray(fil) ? fil[0] : null;
      if (!f) continue;
```

to:

```ts
      const f = Array.isArray(fil) ? fil[0] : null;
      if (!f) {
        // Inbox (2026-09-03): on SHARED mailboxes, unknown-party inbound is
        // stored unfiled (all card ids null) so staff can file it manually.
        // Staff↔staff and noise senders stay dropped, as before.
        if (!shared) continue;
        const fromLower = m.from_email.toLowerCase();
        if (/no-?reply|newsletter|mailer[-_]?daemon|postmaster/i.test(fromLower)) continue;
        const { data: staffFrom } = await admin
          .from('profiles').select('user_id').eq('email', fromLower).maybeSingle();
        if (staffFrom) continue; // our own copy / internal mail
        const ok = await storeCaptured({
          message_id: m.message_id, gmail_id: m.gmail_id, thread_id: m.thread_id,
          direction: 'inbound', from_email: m.from_email, from_name: m.from_name,
          to_email: m.to_email, subject: m.subject, body_text: m.body_text,
          body_html: m.body_html, snippet: m.snippet, cc_emails: m.cc_emails,
          sent_at: m.internal_date ? new Date(m.internal_date).toISOString() : null,
          client_id: null, deal_id: null, job_id: null, lead_id: null,
          department: null, staff_user_id: null, captured_from_user_id: uid,
        });
        if (ok) stored++; else errors++;
        continue;
      }
```

- [ ] **Step 2: Run the edge-fn tests that exist**: `npx vitest run supabase/functions 2>&1 | tail -3` — expected all green (no gmail-sync unit tests exist; templates/google suites must stay green).
- [ ] **Step 3: Deploy gmail-sync** via a token script (multipart, bundle per Global Constraints, `verify_jwt:false`); verify the deploy response `status:"ACTIVE"` and that `email_drain_heartbeat`-style sanity isn't applicable — instead wait one sweep (2΄) and confirm no error spike: `select count(*) from email_messages where captured_from_user_id='043f3507-8c5b-49c2-b5d6-0940923fbed8' and client_id is null and lead_id is null` ≥ 0 without sync failures in `user_google_sync.last_synced_at` stalling.
- [ ] **Step 4: Commit** `git add supabase/functions/gmail-sync/index.ts && git commit -m "feat(inbox): gmail-sync stores unfiled inbound on shared mailboxes"`

### Task 3: `useEmailInbox` hook + mark-read + realtime

**Files:**
- Modify: `src/lib/queryKeys.ts` (add `emailInbox: () => ['email-inbox'] as const,` next to `jobsForDeal`)
- Create: `src/features/email/hooks/useEmailInbox.ts`
- Test: `src/features/email/hooks/useEmailInbox.test.ts`

**Interfaces:**
- Consumes: `EmailMessageRow` + `COLS` from `./useEmailThreads` (export `COLS` there: `export const EMAIL_COLS = COLS;` — add alongside, do not rename the private const), `supabase`, `queryKeys.emailInbox()`, `useAuthStore` (`s.user?.email`, `s.user?.id`).
- Produces:

```ts
export type InboxItem = EmailMessageRow & {
  captured_from_user_id: string | null;
  client_id: string | null;
  deal_id: string | null;
  unread: boolean;
  unfiled: boolean;
  mine: boolean; // to_email matches the viewer's email (case-insensitive)
};
export function useEmailInbox(): UseQueryResult & { items: InboxItem[]; unreadCount: number };
export function useMarkEmailRead(): { markRead: (messagePk: string) => Promise<void>; markAllRead: (pks: string[]) => Promise<void> };
export function useEmailInboxRealtime(): void; // channel `email-inbox-${userId}-${crypto.randomUUID()}`, postgres_changes INSERT on email_messages -> invalidate emailInbox
```

- [ ] **Step 1: Write the failing test** (`useEmailInbox.test.ts`): mock `supabase.from` so `email_messages` select resolves 3 rows (one unfiled, one to the viewer's email, one other) and `email_message_reads` resolves 1 read row for the "other" message; assert `items.length===3`, `unreadCount===2`, the unfiled row has `unfiled===true`, the viewer-addressed row has `mine===true`. Mock `@/lib/stores/authStore` selector to return `{ user: { id: 'u1', email: 'me@itdev.gr' } }` shape used by the hook. Follow the mocking style of `useBulkUpdateLeads.test.tsx` (vi.hoisted mocks + renderHook + QueryClientProvider wrapper).
- [ ] **Step 2:** `npx vitest run src/features/email/hooks/useEmailInbox.test.ts` — FAIL (module not found).
- [ ] **Step 3: Implement the hook:**

```ts
import { useEffect } from 'react';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { useAuthStore } from '@/lib/stores/authStore';
import { EMAIL_COLS, type EmailMessageRow } from './useEmailThreads';

export type InboxItem = EmailMessageRow & {
  captured_from_user_id: string | null;
  client_id: string | null;
  deal_id: string | null;
  unread: boolean;
  unfiled: boolean;
  mine: boolean;
};

const INBOX_COLS = `${EMAIL_COLS}, client_id, deal_id, captured_from_user_id`;

export function useEmailInbox() {
  const myEmail = (useAuthStore((s) => s.user?.email) ?? '').toLowerCase();
  const query = useQuery({
    queryKey: queryKeys.emailInbox(),
    queryFn: async () => {
      const [msgs, reads] = await Promise.all([
        supabase
          .from('email_messages')
          .select(INBOX_COLS)
          .eq('direction', 'inbound')
          .order('sent_at', { ascending: false, nullsFirst: false })
          .limit(300),
        supabase.from('email_message_reads').select('message_pk'),
      ]);
      if (msgs.error) throw new Error(msgs.error.message);
      if (reads.error) throw new Error(reads.error.message);
      return { rows: msgs.data ?? [], readPks: new Set((reads.data ?? []).map((r) => r.message_pk as string)) };
    },
    refetchInterval: 60_000,
  });
  const rows = (query.data?.rows ?? []) as unknown as (EmailMessageRow & {
    client_id: string | null; deal_id: string | null; captured_from_user_id: string | null;
  })[];
  const readPks = query.data?.readPks ?? new Set<string>();
  const items: InboxItem[] = rows.map((r) => ({
    ...r,
    unread: !readPks.has(r.id),
    unfiled: !r.client_id && !r.lead_id && !r.job_id && !r.deal_id,
    mine: myEmail !== '' && r.to_email.toLowerCase().includes(myEmail),
  }));
  return { ...query, items, unreadCount: items.filter((i) => i.unread).length };
}

export function useMarkEmailRead() {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id);
  async function insert(pks: string[]) {
    if (!userId || pks.length === 0) return;
    const { error } = await supabase
      .from('email_message_reads')
      .upsert(pks.map((message_pk) => ({ message_pk, user_id: userId })), { onConflict: 'message_pk,user_id', ignoreDuplicates: true });
    if (error) throw new Error(error.message);
    void qc.invalidateQueries({ queryKey: queryKeys.emailInbox() });
  }
  return {
    markRead: (pk: string) => insert([pk]),
    markAllRead: (pks: string[]) => insert(pks),
  };
}

export function useEmailInboxRealtime() {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id);
  useEffect(() => {
    if (!userId) return;
    // Unique topic per mount — supabase-js reuses channels per identical topic
    // and a second .on() after subscribe() throws (deal 000121, 2026-09-03).
    const channel = supabase
      .channel(`email-inbox-${userId}-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'email_messages' }, () => {
        void qc.invalidateQueries({ queryKey: queryKeys.emailInbox() });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, qc]);
}
```

Also in `src/features/email/hooks/useEmailThreads.ts` add (below the private `COLS`): `export const EMAIL_COLS = COLS;` — and in `src/lib/queryKeys.ts` add `emailInbox: () => ['email-inbox'] as const,`.

- [ ] **Step 4:** `npx vitest run src/features/email/hooks/useEmailInbox.test.ts` — PASS; `npx eslint` on the three touched files.
- [ ] **Step 5: Commit** `git commit -m "feat(inbox): useEmailInbox hook — rows, per-user unread, realtime"`

### Task 4: Topbar `EmailInboxButton`

**Files:**
- Create: `src/features/email/EmailInboxButton.tsx`
- Test: `src/features/email/EmailInboxButton.test.tsx`
- Modify: `src/components/layout/Topbar.tsx`

**Interfaces:**
- Consumes: `useEmailInbox`, `useEmailInboxRealtime` from Task 3.
- Produces: `<EmailInboxButton />` — Link to `/inbox`, Mail icon, red unread badge (same badge classes as `NotificationsBell.tsx:41-45`).

- [ ] **Step 1: Failing test** — mock `useEmailInbox` to return `{ unreadCount: 3, items: [] }` and `useEmailInboxRealtime` to a noop; render inside MemoryRouter; assert the badge shows «3» and the link points to `/inbox`. Mock pattern: `vi.mock('./hooks/useEmailInbox', …)`.
- [ ] **Step 2:** run it — FAIL.
- [ ] **Step 3: Implement:**

```tsx
import { Link } from 'react-router-dom';
import { Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useEmailInbox, useEmailInboxRealtime } from './hooks/useEmailInbox';

export function EmailInboxButton() {
  const { unreadCount } = useEmailInbox();
  useEmailInboxRealtime();
  return (
    <Button asChild variant="ghost" size="icon" className="relative">
      <Link to="/inbox" aria-label="Inbox">
        <Mail className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 rounded-full bg-red-500 px-1 text-[10px] text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </Link>
    </Button>
  );
}
```

In `Topbar.tsx`: import it and render `{session && <EmailInboxButton />}` immediately AFTER the profile `<Link to="/profile">…</Link>` and BEFORE `<NotificationsBell />` (i.e. between the profile icon and the bell, per the owner's placement).

- [ ] **Step 4:** tests PASS + eslint clean (`EmailInboxButton.tsx`, `Topbar.tsx`).
- [ ] **Step 5: Commit** `git commit -m "feat(inbox): topbar mail icon with unread badge"`

### Task 5: `/inbox` page + filing dialog

**Files:**
- Create: `src/features/email/InboxPage.tsx`, `src/features/email/FileEmailDialog.tsx`
- Test: `src/features/email/InboxPage.test.tsx`, `src/features/email/FileEmailDialog.test.tsx`
- Modify: `src/app/router.tsx`

**Interfaces:**
- Consumes: `useEmailInbox`, `useMarkEmailRead` (Task 3), `htmlToText` from `src/features/email/htmlToText.ts`, `relativeFromNow` from `@/lib/datetime`.
- Produces: route `/inbox` (inside the authed shell, no RequireGroup — RLS already scopes rows); `FileEmailDialog` props: `{ messagePk: string | null, fromEmail: string, onClose: () => void, onFiled: () => void }`.

- [ ] **Step 1: Failing InboxPage test** — mock `useEmailInbox` with 3 items (unfiled / mine-unread / read+lead_id) and `useMarkEmailRead`; render with MemoryRouter+QueryClientProvider; assert: 3 rows on «Όλα», switching to «Χωρίς καρτέλα» leaves 1, the unfiled row shows a «Καταχώρηση» button, clicking a row calls `markRead` with its id.
- [ ] **Step 2:** run — FAIL.
- [ ] **Step 3: Implement `InboxPage`:**

```tsx
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Mail, FolderInput } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/layout/PageHeader';
import { relativeFromNow } from '@/lib/datetime';
import { htmlToText } from './htmlToText';
import { useEmailInbox, useMarkEmailRead, useEmailInboxRealtime, type InboxItem } from './hooks/useEmailInbox';
import { FileEmailDialog } from './FileEmailDialog';

type Tab = 'all' | 'unread' | 'mine' | 'unfiled';

export function InboxPage() {
  const { t } = useTranslation('sales');
  const { items, unreadCount, refetch } = useEmailInbox();
  useEmailInboxRealtime();
  const { markRead, markAllRead } = useMarkEmailRead();
  const [tab, setTab] = useState<Tab>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [filing, setFiling] = useState<InboxItem | null>(null);

  const shown = useMemo(() => {
    if (tab === 'unread') return items.filter((i) => i.unread);
    if (tab === 'mine') return items.filter((i) => i.mine);
    if (tab === 'unfiled') return items.filter((i) => i.unfiled);
    return items;
  }, [items, tab]);

  const tabs: { id: Tab; label: string; n: number }[] = [
    { id: 'all', label: t('inbox.tabs.all'), n: items.length },
    { id: 'unread', label: t('inbox.tabs.unread'), n: unreadCount },
    { id: 'mine', label: t('inbox.tabs.mine'), n: items.filter((i) => i.mine).length },
    { id: 'unfiled', label: t('inbox.tabs.unfiled'), n: items.filter((i) => i.unfiled).length },
  ];

  function cardLink(i: InboxItem): { to: string; label: string } | null {
    if (i.lead_id) return { to: `/leads/${i.lead_id}`, label: t('inbox.card.lead') };
    if (i.deal_id) return { to: `/deals/${i.deal_id}`, label: t('inbox.card.deal') };
    if (i.client_id) return { to: `/clients/${i.client_id}`, label: t('inbox.card.client') };
    return null;
  }

  return (
    <div className="flex min-h-full flex-col gap-4 px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader title={t('inbox.title')}>
        <Button
          variant="outline"
          size="sm"
          disabled={unreadCount === 0}
          onClick={() => void markAllRead(items.filter((i) => i.unread).map((i) => i.id))}
        >
          {t('inbox.mark_all_read')}
        </Button>
      </PageHeader>

      <div className="flex flex-wrap gap-1.5">
        {tabs.map((x) => (
          <button
            key={x.id}
            type="button"
            onClick={() => setTab(x.id)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              tab === x.id ? 'border-primary/40 bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:bg-muted',
            )}
          >
            {x.label} <span className="text-muted-foreground">({x.n})</span>
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {shown.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">{t('inbox.empty')}</p>
        ) : (
          shown.map((i) => {
            const link = cardLink(i);
            const open = openId === i.id;
            const body = (i.body_text?.trim() || htmlToText(i.body_html ?? '')).trim();
            return (
              <article
                key={i.id}
                className={cn(
                  'rounded-xl border px-4 py-3 transition-colors',
                  i.unread ? 'border-primary/25 bg-primary/5' : 'border-border/60 bg-card',
                )}
              >
                <button
                  type="button"
                  className="flex w-full items-start justify-between gap-3 text-left"
                  onClick={() => {
                    setOpenId(open ? null : i.id);
                    if (i.unread) void markRead(i.id);
                  }}
                >
                  <span className="min-w-0">
                    <span className={cn('block truncate text-sm', i.unread ? 'font-semibold' : 'font-medium')}>
                      {i.from_name || i.from_email}
                      <span className="ml-2 text-xs font-normal text-muted-foreground">{i.from_email}</span>
                    </span>
                    <span className="block truncate text-sm text-foreground/90">{i.subject || '—'}</span>
                    {!open && <span className="block truncate text-xs text-muted-foreground">{i.snippet ?? ''}</span>}
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-xs text-muted-foreground">{i.sent_at ? relativeFromNow(i.sent_at) : ''}</span>
                    {link ? (
                      <Link to={link.to} className="text-xs text-[#157777] hover:underline dark:text-[#7ad4d4]" onClick={(e) => e.stopPropagation()}>
                        {link.label}
                      </Link>
                    ) : (
                      <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                        {t('inbox.unfiled_badge')}
                      </span>
                    )}
                  </span>
                </button>
                {open && (
                  <div className="mt-3 border-t border-border/60 pt-3">
                    <pre className="max-h-[40vh] overflow-y-auto whitespace-pre-wrap break-words font-sans text-sm text-foreground/90">{body || '—'}</pre>
                    {i.unfiled && (
                      <Button size="sm" className="mt-3" onClick={() => setFiling(i)}>
                        <FolderInput className="mr-1.5 size-3.5" /> {t('inbox.file_action')}
                      </Button>
                    )}
                  </div>
                )}
              </article>
            );
          })
        )}
      </div>

      <FileEmailDialog
        messagePk={filing?.id ?? null}
        fromEmail={filing?.from_email ?? ''}
        onClose={() => setFiling(null)}
        onFiled={() => {
          setFiling(null);
          void refetch();
        }}
      />
      <p className="text-xs text-muted-foreground">
        <Mail className="mr-1 inline size-3" /> {t('inbox.footnote')}
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Failing FileEmailDialog test** — mock supabase: `leads` select → 1 row, `clients` select → 1 row, `rpc` resolves `{ data: 2, error: null }`; type «μητσ» in search, click the lead result, click «Καταχώρηση», assert `rpc` called with `('file_email_message', { p_message_pk: 'pk1', p_target_type: 'lead', p_target_id: 'l1' })` and `onFiled` fired.
- [ ] **Step 5: Implement `FileEmailDialog`:**

```tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

type Target = { type: 'lead' | 'client'; id: string; label: string; sub: string };
type Props = { messagePk: string | null; fromEmail: string; onClose: () => void; onFiled: () => void };

export function FileEmailDialog({ messagePk, fromEmail, onClose, onFiled }: Props) {
  const { t } = useTranslation('sales');
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Target[]>([]);
  const [picked, setPicked] = useState<Target | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = !!messagePk;

  useEffect(() => {
    setQ(''); setResults([]); setPicked(null); setError(null);
  }, [messagePk]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setResults([]); return; }
    const h = window.setTimeout(async () => {
      const like = `%${term.replace(/[%_]/g, '\\$&')}%`;
      const [leads, clients] = await Promise.all([
        supabase.from('leads').select('id, title, code, email')
          .or(`title.ilike.${like},code.ilike.${like},email.ilike.${like}`)
          .eq('archived', false).limit(6),
        supabase.from('clients').select('id, name, code, email')
          .or(`name.ilike.${like},code.ilike.${like},email.ilike.${like}`)
          .limit(6),
      ]);
      setResults([
        ...(leads.data ?? []).map((l) => ({
          type: 'lead' as const, id: l.id as string,
          label: (l.title as string) || (l.email as string) || '—',
          sub: `${t('inbox.card.lead')} · ${l.code ?? ''}`,
        })),
        ...(clients.data ?? []).map((c) => ({
          type: 'client' as const, id: c.id as string,
          label: (c.name as string) || (c.email as string) || '—',
          sub: `${t('inbox.card.client')} · ${c.code ?? ''}`,
        })),
      ]);
    }, 250);
    return () => window.clearTimeout(h);
  }, [q, t]);

  async function onConfirm() {
    if (!messagePk || !picked) return;
    setBusy(true); setError(null);
    const { error: e } = await supabase.rpc('file_email_message' as never, {
      p_message_pk: messagePk, p_target_type: picked.type, p_target_id: picked.id,
    } as never);
    setBusy(false);
    if (e) { setError(e.message); return; }
    onFiled();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('inbox.file_title')}</DialogTitle>
          <DialogDescription>{t('inbox.file_description', { email: fromEmail })}</DialogDescription>
        </DialogHeader>
        <Input autoFocus placeholder={t('inbox.file_search_placeholder')} value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="max-h-56 space-y-1 overflow-y-auto">
          {results.map((r) => (
            <button
              key={`${r.type}:${r.id}`}
              type="button"
              onClick={() => setPicked(r)}
              className={cn(
                'flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm',
                picked?.id === r.id && picked.type === r.type ? 'border-primary/50 bg-primary/10' : 'border-border hover:bg-muted',
              )}
            >
              <span className="truncate">{r.label}</span>
              <span className="ml-2 shrink-0 text-xs text-muted-foreground">{r.sub}</span>
            </button>
          ))}
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>{t('inbox.file_cancel')}</Button>
          <Button onClick={() => void onConfirm()} disabled={!picked || busy}>
            {busy ? '…' : t('inbox.file_confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 6: Route** — in `src/app/router.tsx`: `const InboxPage = lazyPage(() => import('@/features/email/InboxPage'), 'InboxPage');` and add `{ path: '/inbox', element: <InboxPage /> }` next to the `/tasks` route (inside the authed shell, NO RequireGroup).
- [ ] **Step 7:** all four test files PASS; eslint clean on every touched file.
- [ ] **Step 8: Commit** `git commit -m "feat(inbox): /inbox page with tabs, read-tracking and manual filing"`

### Task 6: i18n keys

**Files:**
- Modify: `src/i18n/locales/el/sales.json`, `src/i18n/locales/en/sales.json` (top-level `inbox` object)

- [ ] **Step 1: Add the keys** (el shown; en with the English equivalents):

```json
"inbox": {
  "title": "Εισερχόμενα",
  "tabs": { "all": "Όλα", "unread": "Αδιάβαστα", "mine": "Δικά μου", "unfiled": "Χωρίς καρτέλα" },
  "empty": "Δεν υπάρχουν emails εδώ.",
  "mark_all_read": "Όλα ως διαβασμένα",
  "unfiled_badge": "Χωρίς καρτέλα",
  "file_action": "Καταχώρηση σε καρτέλα",
  "file_title": "Καταχώρηση email",
  "file_description": "Διάλεξε την καρτέλα (lead ή πελάτη) για το email από {{email}} — θα καταχωρηθεί όλη η συνομιλία.",
  "file_search_placeholder": "Αναζήτηση με όνομα, κωδικό ή email…",
  "file_cancel": "Άκυρο",
  "file_confirm": "Καταχώρηση",
  "card": { "lead": "Lead", "client": "Πελάτης", "deal": "Deal" },
  "footnote": "Εμφανίζονται τα εισερχόμενα πελατών που επιτρέπουν οι κανόνες ορατότητας του τμήματός σου."
}
```

- [ ] **Step 2:** `npx vitest run src/i18n 2>&1 | tail -3` (key-parity suites, if any, stay green) + full `npx vitest run` green.
- [ ] **Step 3: Commit + push** `git commit -m "feat(inbox): i18n" && git push origin main`

### Task 7: Live verification

- [ ] **Step 1:** After Vercel deploy: topbar shows the Mail icon between profile and bell; `/inbox` renders.
- [ ] **Step 2:** Send an email FROM an outside address (owner's personal) TO sales@itdev.gr with an unknown sender → within ~2΄ it appears on «Χωρίς καρτέλα» with the amber badge and bumps the topbar counter (realtime or 60s poll).
- [ ] **Step 3:** File it to a test lead via the dialog → it disappears from «Χωρίς καρτέλα», appears on the lead's Emails tab, and the whole thread went with it (`select lead_id from email_messages where thread_id = …`).
- [ ] **Step 4:** Second user check: a sales rep sees it; an unrelated technical-only user does not (RLS branch).
- [ ] **Step 5:** Mark-all-read zeroes the badge for the current user only (other users unaffected).

## Self-Review Notes

- Spec coverage: topbar icon+badge ✓ (T4), per-user seen ✓ (T1 §1 + T3), current filing rules preserved ✓ (no change to resolve_email_filing), per-user email check ✓ («Δικά μου» tab + `mine` flag), unfiled capture+filing ✓ (T1 §2-3, T2, T5 dialog), dedicated page ✓ (T5).
- Deliberate scope choices for the implementer to NOT change: unfiled capture is shared-mailboxes-only; noise senders dropped; filing RPC also drags thread + same-sender unfiled siblings; no auto-add of the address to the card (follow-up candidate).
- Type consistency checked: `InboxItem`, `file_email_message(p_message_pk, p_target_type, p_target_id)`, `queryKeys.emailInbox()`, `EMAIL_COLS` used consistently across T3-T5.
