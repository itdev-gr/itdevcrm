# Ads + Social Comment Channels & Unread Tab Dots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the deal comment channels (General/Dev/SEO) with Ads and Social tabs (shared with `ads` / `social_media` job pages), and show a per-user amber "new comments" dot on channel tabs.

**Architecture:** Two new `comments.parent_type` values (`deal_ads`, `deal_social`) with `parent_id = deal_id` — identical pattern to `deal_dev`/`deal_seo` (07-09). Read state is a new `comment_thread_reads` table (one row per user × thread, RLS own-rows). Unread is derived client-side by a pure helper from ≤5 `limit 1` queries + the user's read rows. Mark-seen lives inside `CommentsPanel` — since Radix only mounts the active tab's panel, "mounted" = "visible", and this one integration point covers deal tabs, single-tab deals, AND job pages.

**Tech Stack:** React + TypeScript, TanStack Query, supabase-js, Radix Tabs (shadcn), vitest + @testing-library/react, Supabase Postgres (project `xujlrclyzxrvxszepquy`).

**Spec:** `docs/superpowers/specs/2026-07-16-ads-social-channels-unread-design.md`

## Global Constraints

- Commit directly to `main` after each task — NO pull requests. `git pull --rebase origin main` before any push (the owner commits in parallel).
- `npm run build` = `tsc -b && eslint (max-warnings=0) && vite build` — must pass clean; unused imports fail the build.
- NEVER run the full vitest suite — some integration tests hit PROD. Run ONLY the test files named in each step.
- Prod Supabase project id: `xujlrclyzxrvxszepquy` (name "CRM"). The migration (Task 1) MUST be applied to prod before any frontend task is pushed.
- Live prod bodies of `fanout_mention_notifications`, `assigned_tasks_comment_on_insert`, `assigned_tasks_comment_on_resolve` were verified on 2026-07-16 to exactly match the repo migrations (no drift). The Task 1 SQL below embeds those bodies with only the new branches added. If Task 1 is executed on a later date, re-verify first: `select md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='<fn>'` — expected md5s: fanout `685630f254e4ef1d8faa460b3d1b7960`, insert `081d8ae2302a708cc81ec8e826a8823e`, resolve `b97bd087a23e554a2708cd13b001d027`.
- Tab labels are hardcoded English ("General", "Dev", "SEO", "Ads", "Social") — matches the existing component; do not introduce i18n keys for them.

---

### Task 1: DB migration — new parent types, fn routing, `comment_thread_reads`

**Files:**
- Create: `supabase/migrations/20260716100000_ads_social_channels_unread.sql`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `comments.parent_type` accepts `'deal_ads'` / `'deal_social'`; table `public.comment_thread_reads(user_id uuid, parent_type text, parent_id uuid, last_seen_at timestamptz)` with PK `(user_id, parent_type, parent_id)`, RLS own-rows, grants `select,insert,update` to `authenticated`. Frontend tasks rely on exactly these column names.

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/20260716100000_ads_social_channels_unread.sql` with exactly:

```sql
-- =============================================================================
-- Ads + Social comment channels & per-user thread read state.
-- New parent_type values 'deal_ads' / 'deal_social' (parent_id = deal id) —
-- same pattern as deal_dev/deal_seo (20260709150000). Verified 2026-07-16:
-- prod has 21 ads + 21 social_media jobs with ZERO job comments, so unlike
-- 07-09 there is NO reparenting and NO backup table.
-- comment_thread_reads: one row per (user, thread); a channel tab shows an
-- unread dot when the thread's newest non-own comment is newer than the
-- user's last_seen_at.
--
-- ROLLBACK (manual):
--   drop table if exists public.comment_thread_reads;
--   -- re-narrow the CHECK (first handle any deal_ads/deal_social comment rows:
--   -- reparent to the deal's matching job thread, or delete — owner decision):
--   alter table public.comments drop constraint comments_parent_type_check;
--   alter table public.comments add constraint comments_parent_type_check
--     check (parent_type in ('client','deal','job','lead','deal_dev','deal_seo'));
--   -- restore the three function bodies from 20260709150000 (fanout) and
--   -- 20260709170000 (assigned_tasks_*) — live bodies matched those files
--   -- exactly before this migration.
-- =============================================================================

-- 1) Allow the new parent types.
alter table public.comments drop constraint if exists comments_parent_type_check;
alter table public.comments add constraint comments_parent_type_check
  check (parent_type in ('client','deal','job','lead','deal_dev','deal_seo','deal_ads','deal_social'));

-- 2) Mention notification labels for the new channels.
create or replace function public.fanout_mention_notifications() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  uid uuid;
  author_name text;
  parent_label text;
begin
  if new.mentioned_user_ids is null or array_length(new.mentioned_user_ids, 1) is null then
    return new;
  end if;

  select coalesce(nullif(p.full_name, ''), p.email)
    into author_name
    from public.profiles p where p.user_id = new.author_id;

  if new.parent_type = 'lead' then
    select coalesce(
      nullif(trim(coalesce(l.contact_first_name, '') || ' ' || coalesce(l.contact_last_name, '')), ''),
      l.company_name,
      l.title
    )
      into parent_label
      from public.leads l where l.id = new.parent_id;
  elsif new.parent_type = 'client' then
    select c.name into parent_label from public.clients c where c.id = new.parent_id;
  elsif new.parent_type = 'deal' then
    select d.title into parent_label from public.deals d where d.id = new.parent_id;
  elsif new.parent_type = 'deal_dev' then
    select d.title || ' — Dev' into parent_label from public.deals d where d.id = new.parent_id;
  elsif new.parent_type = 'deal_seo' then
    select d.title || ' — SEO' into parent_label from public.deals d where d.id = new.parent_id;
  elsif new.parent_type = 'deal_ads' then
    select d.title || ' — Ads' into parent_label from public.deals d where d.id = new.parent_id;
  elsif new.parent_type = 'deal_social' then
    select d.title || ' — Social' into parent_label from public.deals d where d.id = new.parent_id;
  elsif new.parent_type = 'job' then
    select j.service_type into parent_label from public.jobs j where j.id = new.parent_id;
  end if;

  foreach uid in array new.mentioned_user_ids loop
    insert into public.notifications (user_id, type, payload)
    values (
      uid,
      'mention',
      jsonb_build_object(
        'comment_id', new.id,
        'parent_type', new.parent_type,
        'parent_id', new.parent_id,
        'author_id', new.author_id,
        'author_name', author_name,
        'parent_label', parent_label,
        'preview', left(new.body, 200)
      )
    );
  end loop;
  return new;
end $$;

-- 3) Task auto-comments: route ads / social_media job tasks into the new channels.
create or replace function public.assigned_tasks_comment_on_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_type text; v_id uuid; v_assignee text; v_st text; v_deal uuid;
begin
  if new.deal_id is not null then v_type := 'deal'; v_id := new.deal_id;
  elsif new.job_id is not null then
    select j.service_type, j.deal_id into v_st, v_deal from public.jobs j where j.id = new.job_id;
    if v_st is null then return new; end if;
    if v_st = 'web_dev' then v_type := 'deal_dev'; v_id := v_deal;
    elsif v_st in ('web_seo','local_seo','ai_seo') then v_type := 'deal_seo'; v_id := v_deal;
    elsif v_st = 'ads' then v_type := 'deal_ads'; v_id := v_deal;
    elsif v_st = 'social_media' then v_type := 'deal_social'; v_id := v_deal;
    else v_type := 'job'; v_id := new.job_id; end if;
  else return new; end if;
  select coalesce(nullif(p.full_name,''), p.email) into v_assignee
    from public.profiles p where p.user_id = new.assignee_user_id;
  insert into public.comments (parent_type, parent_id, author_id, body, mentioned_user_ids, task_key)
  values (v_type, v_id, new.created_by_user_id,
    format('📋 New task: "%s" — for %s · %s', new.title, coalesce(v_assignee, '—'), new.importance),
    '{}', 'assigned:' || new.id);
  return new;
end $$;

create or replace function public.assigned_tasks_comment_on_resolve() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_type text; v_id uuid; v_st text; v_deal uuid;
begin
  if new.deal_id is not null then v_type := 'deal'; v_id := new.deal_id;
  elsif new.job_id is not null then
    select j.service_type, j.deal_id into v_st, v_deal from public.jobs j where j.id = new.job_id;
    if v_st is null then return new; end if;
    if v_st = 'web_dev' then v_type := 'deal_dev'; v_id := v_deal;
    elsif v_st in ('web_seo','local_seo','ai_seo') then v_type := 'deal_seo'; v_id := v_deal;
    elsif v_st = 'ads' then v_type := 'deal_ads'; v_id := v_deal;
    elsif v_st = 'social_media' then v_type := 'deal_social'; v_id := v_deal;
    else v_type := 'job'; v_id := new.job_id; end if;
  else return new; end if;
  insert into public.comments (parent_type, parent_id, author_id, body, mentioned_user_ids, task_key)
  values (v_type, v_id, coalesce(new.resolved_by_user_id, auth.uid(), new.assignee_user_id),
    format('✅ Task resolved: "%s"', new.title), '{}', 'assigned:' || new.id);
  return new;
end $$;

-- 4) Per-user thread read state.
create table public.comment_thread_reads (
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  parent_type text not null,
  parent_id uuid not null,
  last_seen_at timestamptz not null default now(),
  primary key (user_id, parent_type, parent_id)
);

alter table public.comment_thread_reads enable row level security;

create policy comment_thread_reads_select on public.comment_thread_reads
  for select to authenticated using (user_id = auth.uid());
create policy comment_thread_reads_insert on public.comment_thread_reads
  for insert to authenticated with check (user_id = auth.uid());
create policy comment_thread_reads_update on public.comment_thread_reads
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on public.comment_thread_reads from anon;
grant select, insert, update on public.comment_thread_reads to authenticated;

-- 5) Post-asserts — fail the migration loudly if anything is off.
do $$
declare n int;
begin
  if (select pg_get_constraintdef(oid) from pg_constraint
      where conname = 'comments_parent_type_check') not like '%deal_ads%' then
    raise exception 'comments_parent_type_check missing deal_ads';
  end if;
  select count(*) into n from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public' and p.prosrc like '%deal_ads%'
      and p.proname in ('fanout_mention_notifications',
                        'assigned_tasks_comment_on_insert',
                        'assigned_tasks_comment_on_resolve');
  if n <> 3 then
    raise exception 'expected 3 functions routing deal_ads, found %', n;
  end if;
  if not exists (select 1 from pg_tables
                 where schemaname = 'public' and tablename = 'comment_thread_reads') then
    raise exception 'comment_thread_reads missing';
  end if;
  select count(*) into n from pg_policies
    where schemaname = 'public' and tablename = 'comment_thread_reads';
  if n < 3 then
    raise exception 'comment_thread_reads expected >=3 policies, found %', n;
  end if;
end $$;
```

- [ ] **Step 2: Apply to prod**

Use the Supabase MCP tool `mcp__plugin_supabase_supabase__apply_migration` with `project_id: "xujlrclyzxrvxszepquy"`, `name: "ads_social_channels_unread"`, and the file's SQL as `query`. (If the executing agent has no MCP access, STOP and hand this step back to the orchestrator session.)

Expected: success — the `do $$` post-assert block raises if anything is wrong, so success = verified.

- [ ] **Step 3: Independent verification query**

Run via `mcp__plugin_supabase_supabase__execute_sql` (same project id):

```sql
select
  (select count(*) from pg_policies where schemaname='public' and tablename='comment_thread_reads') as policies,
  (select count(*) from information_schema.role_table_grants
     where table_name='comment_thread_reads' and grantee='anon') as anon_grants,
  (select pg_get_constraintdef(oid) like '%deal_social%' from pg_constraint
     where conname='comments_parent_type_check') as check_ok;
```

Expected: `policies = 3`, `anon_grants = 0`, `check_ok = true`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260716100000_ads_social_channels_unread.sql
git commit -m "feat(comments): DB — ads/social channels + comment_thread_reads"
```

---

### Task 2: Channel plumbing — routing, tabs, labels, notification paths

**Files:**
- Modify: `src/features/comments/commentChannels.ts` (full rewrite below)
- Modify: `src/features/comments/commentChannels.test.ts` (full rewrite below)
- Modify: `src/features/notifications/notification-presenters.tsx:44-47` (extend switch)
- Modify: `src/features/notifications/notification-presenters.test.ts` (add 1 test)

**Interfaces:**
- Consumes: nothing from other tasks (pure TS).
- Produces (later tasks import these from `./commentChannels` / `../commentChannels`):
  - `type CommentParentType = 'client'|'deal'|'job'|'lead'|'deal_dev'|'deal_seo'|'deal_ads'|'deal_social'`
  - `type ChannelTab = 'general'|'dev'|'seo'|'ads'|'social'`
  - `const CHANNEL_THREAD: Record<ChannelTab, CommentParentType>`
  - `const CHANNEL_LABEL: Record<ChannelTab, string>`
  - `function channelLabelFor(parentType: CommentParentType): string | null`
  - `jobCommentThread`, `dealChannelTabs` (extended, same signatures)

- [ ] **Step 1: Write the failing tests**

Replace `src/features/comments/commentChannels.test.ts` entirely with:

```ts
import { describe, it, expect } from 'vitest';
import {
  jobCommentThread,
  dealChannelTabs,
  channelLabelFor,
  CHANNEL_THREAD,
  CHANNEL_LABEL,
} from './commentChannels';

const job = (service_type: string) => ({ id: 'J1', deal_id: 'D1', service_type });

describe('jobCommentThread', () => {
  it('web_dev job -> the deal dev channel', () =>
    expect(jobCommentThread(job('web_dev'))).toEqual({ parentType: 'deal_dev', parentId: 'D1' }));
  it('web_seo / local_seo / ai_seo jobs -> the deal seo channel', () => {
    expect(jobCommentThread(job('web_seo'))).toEqual({ parentType: 'deal_seo', parentId: 'D1' });
    expect(jobCommentThread(job('local_seo'))).toEqual({ parentType: 'deal_seo', parentId: 'D1' });
    expect(jobCommentThread(job('ai_seo'))).toEqual({ parentType: 'deal_seo', parentId: 'D1' });
  });
  it('ads job -> the deal ads channel', () =>
    expect(jobCommentThread(job('ads'))).toEqual({ parentType: 'deal_ads', parentId: 'D1' }));
  it('social_media job -> the deal social channel', () =>
    expect(jobCommentThread(job('social_media'))).toEqual({
      parentType: 'deal_social',
      parentId: 'D1',
    }));
  it('other services keep their private job thread', () => {
    expect(jobCommentThread(job('hosting'))).toEqual({ parentType: 'job', parentId: 'J1' });
  });
});

describe('dealChannelTabs', () => {
  it('no channel jobs -> general only', () =>
    expect(dealChannelTabs([job('hosting')])).toEqual(['general']));
  it('web_dev job -> +dev', () =>
    expect(dealChannelTabs([job('web_dev')])).toEqual(['general', 'dev']));
  it('any seo service -> +seo', () => {
    expect(dealChannelTabs([job('web_seo')])).toEqual(['general', 'seo']);
    expect(dealChannelTabs([job('local_seo')])).toEqual(['general', 'seo']);
    expect(dealChannelTabs([job('ai_seo')])).toEqual(['general', 'seo']);
  });
  it('ads job -> +ads', () => expect(dealChannelTabs([job('ads')])).toEqual(['general', 'ads']));
  it('social_media job -> +social', () =>
    expect(dealChannelTabs([job('social_media')])).toEqual(['general', 'social']));
  it('all services -> all five tabs, stable order', () =>
    expect(
      dealChannelTabs([job('social_media'), job('ads'), job('local_seo'), job('web_dev')]),
    ).toEqual(['general', 'dev', 'seo', 'ads', 'social']));
  it('empty -> general only', () => expect(dealChannelTabs([])).toEqual(['general']));
});

describe('channel maps', () => {
  it('CHANNEL_THREAD maps every tab to its parent_type', () => {
    expect(CHANNEL_THREAD).toEqual({
      general: 'deal',
      dev: 'deal_dev',
      seo: 'deal_seo',
      ads: 'deal_ads',
      social: 'deal_social',
    });
  });
  it('CHANNEL_LABEL covers every tab', () => {
    expect(CHANNEL_LABEL).toEqual({
      general: 'General',
      dev: 'Dev',
      seo: 'SEO',
      ads: 'Ads',
      social: 'Social',
    });
  });
  it('channelLabelFor labels channel parent types and rejects the rest', () => {
    expect(channelLabelFor('deal_dev')).toBe('Dev');
    expect(channelLabelFor('deal_seo')).toBe('SEO');
    expect(channelLabelFor('deal_ads')).toBe('Ads');
    expect(channelLabelFor('deal_social')).toBe('Social');
    expect(channelLabelFor('deal')).toBeNull();
    expect(channelLabelFor('job')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/comments/commentChannels.test.ts`
Expected: FAIL — `channelLabelFor`, `CHANNEL_THREAD`, `CHANNEL_LABEL` not exported; ads/social routing assertions fail.

- [ ] **Step 3: Implement**

Replace `src/features/comments/commentChannels.ts` entirely with:

```ts
/** Thread identity stays (parent_type, parent_id) everywhere. Channels are
 *  extra parent types owned by the deal: 'deal_dev', 'deal_seo', 'deal_ads',
 *  'deal_social'. */
export type CommentParentType =
  | 'client'
  | 'deal'
  | 'job'
  | 'lead'
  | 'deal_dev'
  | 'deal_seo'
  | 'deal_ads'
  | 'deal_social';
export type ChannelTab = 'general' | 'dev' | 'seo' | 'ads' | 'social';
export type CommentThreadRef = { parentType: CommentParentType; parentId: string };

const SEO_SERVICES = new Set(['web_seo', 'local_seo', 'ai_seo']);

/** Thread parent_type behind each deal-channel tab. */
export const CHANNEL_THREAD: Record<ChannelTab, CommentParentType> = {
  general: 'deal',
  dev: 'deal_dev',
  seo: 'deal_seo',
  ads: 'deal_ads',
  social: 'deal_social',
};

export const CHANNEL_LABEL: Record<ChannelTab, string> = {
  general: 'General',
  dev: 'Dev',
  seo: 'SEO',
  ads: 'Ads',
  social: 'Social',
};

const LABEL_BY_PARENT: Partial<Record<CommentParentType, string>> = {
  deal_dev: 'Dev',
  deal_seo: 'SEO',
  deal_ads: 'Ads',
  deal_social: 'Social',
};

/** "Dev" / "SEO" / "Ads" / "Social" for a channel parent_type; null otherwise
 *  (used by the job page's "Shared with the deal — X thread" hint). */
export function channelLabelFor(parentType: CommentParentType): string | null {
  return LABEL_BY_PARENT[parentType] ?? null;
}

/** Which thread a job page shows: channel services share the deal's channel,
 *  everything else (hosting) keeps its private job thread. */
export function jobCommentThread(job: {
  id: string;
  deal_id: string;
  service_type: string;
}): CommentThreadRef {
  if (job.service_type === 'web_dev') return { parentType: 'deal_dev', parentId: job.deal_id };
  if (SEO_SERVICES.has(job.service_type)) return { parentType: 'deal_seo', parentId: job.deal_id };
  if (job.service_type === 'ads') return { parentType: 'deal_ads', parentId: job.deal_id };
  if (job.service_type === 'social_media')
    return { parentType: 'deal_social', parentId: job.deal_id };
  return { parentType: 'job', parentId: job.id };
}

/** Which tabs the deal comments panel shows for its (non-archived) jobs. */
export function dealChannelTabs(jobs: ReadonlyArray<{ service_type: string }>): ChannelTab[] {
  const tabs: ChannelTab[] = ['general'];
  if (jobs.some((j) => j.service_type === 'web_dev')) tabs.push('dev');
  if (jobs.some((j) => SEO_SERVICES.has(j.service_type))) tabs.push('seo');
  if (jobs.some((j) => j.service_type === 'ads')) tabs.push('ads');
  if (jobs.some((j) => j.service_type === 'social_media')) tabs.push('social');
  return tabs;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/comments/commentChannels.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Extend readPath (test first)**

In `src/features/notifications/notification-presenters.test.ts`, inside the `describe('readPath — parent fallback', …)` block, after the `client` test add:

```ts
  it('maps deal channel parents to the deal page', () => {
    expect(readPath({ parent_type: 'deal_dev', parent_id: 'd1' })).toBe('/deals/d1');
    expect(readPath({ parent_type: 'deal_seo', parent_id: 'd1' })).toBe('/deals/d1');
    expect(readPath({ parent_type: 'deal_ads', parent_id: 'd1' })).toBe('/deals/d1');
    expect(readPath({ parent_type: 'deal_social', parent_id: 'd1' })).toBe('/deals/d1');
  });
```

Run: `npx vitest run src/features/notifications/notification-presenters.test.ts`
Expected: FAIL — `deal_ads` / `deal_social` return null.

In `src/features/notifications/notification-presenters.tsx`, change the switch cases (currently lines 44-47):

```ts
    case 'deal_dev':
    case 'deal_seo':
    case 'deal_ads':
    case 'deal_social':
      // Deal comment channels live on the deal page's Comments panel.
      return `/deals/${parentId}`;
```

Run: `npx vitest run src/features/notifications/notification-presenters.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/comments/commentChannels.ts src/features/comments/commentChannels.test.ts src/features/notifications/notification-presenters.tsx src/features/notifications/notification-presenters.test.ts
git commit -m "feat(comments): route ads/social jobs to deal channels"
```

---

### Task 3: Unread derivation helper + query keys

**Files:**
- Create: `src/features/comments/unread.ts`
- Create: `src/features/comments/unread.test.ts`
- Modify: `src/lib/queryKeys.ts` (add 2 keys after the `comments:` entry at line 23)

**Interfaces:**
- Consumes: `ChannelTab`, `CHANNEL_THREAD` from `./commentChannels` (Task 2).
- Produces:
  - `type LatestComment = { author_id: string; created_at: string }`
  - `type ThreadReadRow = { parent_type: string; last_seen_at: string }`
  - `function deriveUnread(tabs: ChannelTab[], latestByTab: Partial<Record<ChannelTab, LatestComment | null>>, readRows: ThreadReadRow[], myId: string | null): Partial<Record<ChannelTab, boolean>>`
  - `queryKeys.dealCommentUnread(dealId)` → `['deal-comment-unread', dealId]` (invalidation prefix)
  - `queryKeys.dealCommentUnreadFor(dealId, tabsKey)` → `['deal-comment-unread', dealId, tabsKey]`

- [ ] **Step 1: Write the failing tests**

Create `src/features/comments/unread.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { deriveUnread } from './unread';

const T1 = '2026-07-16T10:00:00Z';
const T2 = '2026-07-16T11:00:00Z';
const other = (created_at: string) => ({ author_id: 'them', created_at });

describe('deriveUnread', () => {
  it('empty thread -> read', () => {
    expect(deriveUnread(['general', 'ads'], { general: null, ads: null }, [], 'me')).toEqual({
      general: false,
      ads: false,
    });
  });

  it('newest comment is my own -> read', () => {
    expect(
      deriveUnread(['ads'], { ads: { author_id: 'me', created_at: T2 } }, [], 'me'),
    ).toEqual({ ads: false });
  });

  it("someone else's comment with no read row -> unread", () => {
    expect(deriveUnread(['ads'], { ads: other(T1) }, [], 'me')).toEqual({ ads: true });
  });

  it('comment newer than my last_seen -> unread', () => {
    expect(
      deriveUnread(['ads'], { ads: other(T2) }, [{ parent_type: 'deal_ads', last_seen_at: T1 }], 'me'),
    ).toEqual({ ads: true });
  });

  it('comment at or before my last_seen -> read', () => {
    expect(
      deriveUnread(['ads'], { ads: other(T1) }, [{ parent_type: 'deal_ads', last_seen_at: T2 }], 'me'),
    ).toEqual({ ads: false });
    expect(
      deriveUnread(['ads'], { ads: other(T1) }, [{ parent_type: 'deal_ads', last_seen_at: T1 }], 'me'),
    ).toEqual({ ads: false });
  });

  it('read rows only clear their own tab (keyed by parent_type)', () => {
    expect(
      deriveUnread(
        ['dev', 'social'],
        { dev: other(T2), social: other(T2) },
        [{ parent_type: 'deal_dev', last_seen_at: T2 }],
        'me',
      ),
    ).toEqual({ dev: false, social: true });
  });

  it('general tab reads its state from the plain deal thread', () => {
    expect(
      deriveUnread(['general'], { general: other(T2) }, [{ parent_type: 'deal', last_seen_at: T1 }], 'me'),
    ).toEqual({ general: true });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/comments/unread.test.ts`
Expected: FAIL — `./unread` module not found.

- [ ] **Step 3: Implement**

Create `src/features/comments/unread.ts`:

```ts
import { CHANNEL_THREAD, type ChannelTab } from './commentChannels';

export type LatestComment = { author_id: string; created_at: string };
export type ThreadReadRow = { parent_type: string; last_seen_at: string };

/** A tab is unread when its newest comment exists, wasn't written by me, and
 *  is newer than my last_seen_at for that thread (no row = never seen). */
export function deriveUnread(
  tabs: ChannelTab[],
  latestByTab: Partial<Record<ChannelTab, LatestComment | null>>,
  readRows: ThreadReadRow[],
  myId: string | null,
): Partial<Record<ChannelTab, boolean>> {
  const lastSeen = new Map(readRows.map((r) => [r.parent_type, Date.parse(r.last_seen_at)]));
  const unread: Partial<Record<ChannelTab, boolean>> = {};
  for (const tab of tabs) {
    const latest = latestByTab[tab];
    if (!latest || latest.author_id === myId) {
      unread[tab] = false;
      continue;
    }
    const seen = lastSeen.get(CHANNEL_THREAD[tab]);
    unread[tab] = seen === undefined || Date.parse(latest.created_at) > seen;
  }
  return unread;
}
```

In `src/lib/queryKeys.ts`, directly after the `comments:` line (line 23), add:

```ts
  // Prefix key: mark-seen invalidates by (dealId); the query itself also keys
  // on the visible tab set so a jobs change refetches with the right threads.
  dealCommentUnread: (dealId: string) => ['deal-comment-unread', dealId] as const,
  dealCommentUnreadFor: (dealId: string, tabsKey: string) =>
    ['deal-comment-unread', dealId, tabsKey] as const,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/comments/unread.test.ts`
Expected: PASS (all 7).

- [ ] **Step 5: Commit**

```bash
git add src/features/comments/unread.ts src/features/comments/unread.test.ts src/lib/queryKeys.ts
git commit -m "feat(comments): unread derivation helper + query keys"
```

---

### Task 4: Data hooks — `useDealCommentUnread`, `useMarkThreadSeen` + CommentsPanel wiring

**Files:**
- Create: `src/features/comments/hooks/useDealCommentUnread.ts`
- Create: `src/features/comments/hooks/useMarkThreadSeen.ts`
- Create: `src/features/comments/hooks/useMarkThreadSeen.test.tsx`
- Modify: `src/features/comments/CommentsPanel.tsx` (3 lines)

**Interfaces:**
- Consumes: Task 2 (`CHANNEL_THREAD`, types), Task 3 (`deriveUnread`, query keys), DB table from Task 1. Auth pattern: `useAuthStore((s) => s.user?.id ?? null)` from `@/lib/stores/authStore` (same as `CommentItem.tsx:25`).
- Produces:
  - `useDealCommentUnread(dealId: string, tabs: ChannelTab[])` → TanStack `useQuery` result whose `data` is `Partial<Record<ChannelTab, boolean>>`; disabled unless `tabs.length > 1` (Task 5 consumes).
  - `useMarkThreadSeen(parentType: CommentParentType, parentId: string, newestKey: string | null)` → void effect hook (CommentsPanel consumes).

- [ ] **Step 1: Write the failing test for useMarkThreadSeen**

Create `src/features/comments/hooks/useMarkThreadSeen.test.tsx`:

```tsx
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { ReactNode } from 'react';

const upserts: Array<{ table: string; row: Record<string, unknown> }> = [];
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      upsert: (row: Record<string, unknown>) => {
        upserts.push({ table, row });
        return Promise.resolve({ error: null });
      },
    }),
  },
}));
vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (sel: (s: { user: { id: string } | null }) => unknown) =>
    sel({ user: { id: 'me' } }),
}));

import { useMarkThreadSeen } from './useMarkThreadSeen';

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

describe('useMarkThreadSeen', () => {
  beforeEach(() => {
    upserts.length = 0;
  });

  it('upserts my last_seen row for a deal channel once the thread has loaded', async () => {
    renderHook(() => useMarkThreadSeen('deal_ads', 'D1', '2026-07-16T10:00:00Z'), { wrapper });
    await waitFor(() => expect(upserts).toHaveLength(1));
    expect(upserts[0].table).toBe('comment_thread_reads');
    expect(upserts[0].row).toMatchObject({
      user_id: 'me',
      parent_type: 'deal_ads',
      parent_id: 'D1',
    });
    expect(typeof upserts[0].row.last_seen_at).toBe('string');
  });

  it('does nothing while the thread is still loading (newestKey null)', async () => {
    renderHook(() => useMarkThreadSeen('deal_ads', 'D1', null), { wrapper });
    await new Promise((r) => setTimeout(r, 20));
    expect(upserts).toHaveLength(0);
  });

  it('ignores non-deal threads (lead / client / job pages)', async () => {
    renderHook(() => useMarkThreadSeen('lead', 'L1', 'x'), { wrapper });
    renderHook(() => useMarkThreadSeen('job', 'J1', 'x'), { wrapper });
    await new Promise((r) => setTimeout(r, 20));
    expect(upserts).toHaveLength(0);
  });

  it('re-marks when new comments arrive while the tab stays open', async () => {
    const { rerender } = renderHook(
      ({ key }: { key: string | null }) => useMarkThreadSeen('deal', 'D1', key),
      { wrapper, initialProps: { key: 'a' as string | null } },
    );
    await waitFor(() => expect(upserts).toHaveLength(1));
    rerender({ key: 'b' });
    await waitFor(() => expect(upserts).toHaveLength(2));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/comments/hooks/useMarkThreadSeen.test.tsx`
Expected: FAIL — `./useMarkThreadSeen` module not found.

- [ ] **Step 3: Implement both hooks**

Create `src/features/comments/hooks/useMarkThreadSeen.ts`:

```ts
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { useAuthStore } from '@/lib/stores/authStore';
import type { CommentParentType } from '../commentChannels';

/** Threads that can carry an unread dot on the deal page's tab strip. */
const DEAL_THREADS = new Set<CommentParentType>([
  'deal',
  'deal_dev',
  'deal_seo',
  'deal_ads',
  'deal_social',
]);

/** Record that I'm looking at a deal thread. CommentsPanel only mounts for
 *  the visible thread (inactive Radix tabs unmount), so mounted = seen —
 *  this covers the deal tabs, single-tab deals, and job pages sharing a
 *  channel. `newestKey` changes when new comments load, re-marking an open
 *  tab; pass null until the thread query succeeds. Non-deal threads
 *  (client/lead/private job) have no dots and are ignored. */
export function useMarkThreadSeen(
  parentType: CommentParentType,
  parentId: string,
  newestKey: string | null,
) {
  const qc = useQueryClient();
  const myId = useAuthStore((s) => s.user?.id ?? null);

  useEffect(() => {
    if (!myId || !parentId || newestKey === null || !DEAL_THREADS.has(parentType)) return;
    let cancelled = false;
    void supabase
      .from('comment_thread_reads')
      .upsert({
        user_id: myId,
        parent_type: parentType,
        parent_id: parentId,
        last_seen_at: new Date().toISOString(),
      })
      .then(({ error }) => {
        if (error || cancelled) return;
        void qc.invalidateQueries({ queryKey: queryKeys.dealCommentUnread(parentId) });
      });
    return () => {
      cancelled = true;
    };
  }, [parentType, parentId, newestKey, myId, qc]);
}
```

Create `src/features/comments/hooks/useDealCommentUnread.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { useAuthStore } from '@/lib/stores/authStore';
import { CHANNEL_THREAD, type ChannelTab } from '../commentChannels';
import { deriveUnread, type LatestComment, type ThreadReadRow } from '../unread';

/** Per-tab "has comments I haven't seen" for the deal Comments tab strip.
 *  One tiny limit-1 query per visible tab (hits the comments_parent index)
 *  plus my read rows (RLS scopes them — no user_id filter needed). Disabled
 *  for single-tab deals: no strip, nowhere to show a dot. */
export function useDealCommentUnread(dealId: string, tabs: ChannelTab[]) {
  const myId = useAuthStore((s) => s.user?.id ?? null);
  const tabsKey = tabs.join(',');

  return useQuery({
    queryKey: queryKeys.dealCommentUnreadFor(dealId, tabsKey),
    queryFn: async (): Promise<Partial<Record<ChannelTab, boolean>>> => {
      const uid = myId;
      if (!uid) return {};
      const [reads, latest] = await Promise.all([
        supabase
          .from('comment_thread_reads')
          .select('parent_type, last_seen_at')
          .eq('parent_id', dealId),
        Promise.all(
          tabs.map((tab) =>
            supabase
              .from('comments')
              .select('author_id, created_at')
              .eq('parent_type', CHANNEL_THREAD[tab])
              .eq('parent_id', dealId)
              .eq('archived', false)
              .neq('author_id', uid)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle(),
          ),
        ),
      ]);
      if (reads.error) throw new Error(reads.error.message);
      const latestByTab: Partial<Record<ChannelTab, LatestComment | null>> = {};
      tabs.forEach((tab, i) => {
        const res = latest[i];
        if (res.error) throw new Error(res.error.message);
        latestByTab[tab] = (res.data as LatestComment | null) ?? null;
      });
      return deriveUnread(tabs, latestByTab, (reads.data ?? []) as ThreadReadRow[], uid);
    },
    enabled: !!dealId && !!myId && tabs.length > 1,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/comments/hooks/useMarkThreadSeen.test.tsx`
Expected: PASS (all 4).

- [ ] **Step 5: Wire CommentsPanel**

In `src/features/comments/CommentsPanel.tsx`:

Add import after the `CommentEmptyState` import:

```ts
import { useMarkThreadSeen } from './hooks/useMarkThreadSeen';
```

Change the `useComments` line inside the component from:

```ts
  const { data: comments = [] } = useComments(parentType, parentId);
```

to:

```ts
  const { data: comments = [], isSuccess } = useComments(parentType, parentId);
  // Being mounted = this thread is the visible one; mark it seen once loaded
  // and again whenever new comments arrive while it stays open.
  const newestKey = isSuccess ? (comments[comments.length - 1]?.created_at ?? 'empty') : null;
  useMarkThreadSeen(parentType, parentId, newestKey);
```

- [ ] **Step 6: Verify no regressions in the comments feature tests**

Run: `npx vitest run src/features/comments`
Expected: PASS — all existing comment tests (CommentForm drafts/enter, TaskCommentLink, DealCommentsTabs, commentChannels, unread, useMarkThreadSeen) still green. Note: `DealCommentsTabs.test.tsx` mocks `./CommentsPanel` entirely, so the new hook does not affect it.

- [ ] **Step 7: Commit**

```bash
git add src/features/comments/hooks/useDealCommentUnread.ts src/features/comments/hooks/useMarkThreadSeen.ts src/features/comments/hooks/useMarkThreadSeen.test.tsx src/features/comments/CommentsPanel.tsx
git commit -m "feat(comments): mark-seen + per-channel unread hooks"
```

---

### Task 5: DealCommentsTabs — Ads/Social tabs + unread dots

**Files:**
- Modify: `src/features/comments/DealCommentsTabs.tsx` (full rewrite below)
- Modify: `src/features/comments/DealCommentsTabs.test.tsx` (full rewrite below)

**Interfaces:**
- Consumes: `dealChannelTabs`, `CHANNEL_THREAD`, `CHANNEL_LABEL`, `ChannelTab` (Task 2); `useDealCommentUnread` (Task 4).
- Produces: same component API `DealCommentsTabs({ dealId })` — no consumer changes.

- [ ] **Step 1: Write the failing tests**

Replace `src/features/comments/DealCommentsTabs.test.tsx` entirely with:

```tsx
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';

const ref: { jobs: Array<{ id: string; service_type: string }> } = { jobs: [] };
vi.mock('@/features/jobs/hooks/useJobsForDeal', () => ({
  useJobsForDeal: () => ({ data: ref.jobs }),
}));
vi.mock('./CommentsPanel', () => ({
  CommentsPanel: ({ parentType, parentId }: { parentType: string; parentId: string }) => (
    <div>panel:{parentType}:{parentId}</div>
  ),
}));
const unreadRef: { map: Record<string, boolean> } = { map: {} };
vi.mock('./hooks/useDealCommentUnread', () => ({
  useDealCommentUnread: () => ({ data: unreadRef.map }),
}));

import { DealCommentsTabs } from './DealCommentsTabs';

describe('DealCommentsTabs', () => {
  beforeEach(() => {
    ref.jobs = [];
    unreadRef.map = {};
  });

  it('renders the plain General thread (no tab strip) when the deal has no channel jobs', () => {
    ref.jobs = [{ id: 'j1', service_type: 'hosting' }];
    render(<DealCommentsTabs dealId="D1" />);
    expect(screen.getByText('panel:deal:D1')).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('shows a Dev tab for a web_dev job and opens the deal_dev thread', async () => {
    ref.jobs = [{ id: 'j1', service_type: 'web_dev' }];
    render(<DealCommentsTabs dealId="D1" />);
    expect(screen.getByRole('tab', { name: 'General' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Dev' }));
    expect(screen.getByText('panel:deal_dev:D1')).toBeInTheDocument();
  });

  it('shows an Ads tab for an ads job and opens the deal_ads thread', async () => {
    ref.jobs = [{ id: 'j1', service_type: 'ads' }];
    render(<DealCommentsTabs dealId="D1" />);
    await userEvent.click(screen.getByRole('tab', { name: 'Ads' }));
    expect(screen.getByText('panel:deal_ads:D1')).toBeInTheDocument();
  });

  it('shows a Social tab for a social_media job and opens the deal_social thread', async () => {
    ref.jobs = [{ id: 'j1', service_type: 'social_media' }];
    render(<DealCommentsTabs dealId="D1" />);
    await userEvent.click(screen.getByRole('tab', { name: 'Social' }));
    expect(screen.getByText('panel:deal_social:D1')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Dev' })).not.toBeInTheDocument();
  });

  it('shows all five tabs in stable order when every service exists', () => {
    ref.jobs = [
      { id: 'j1', service_type: 'web_dev' },
      { id: 'j2', service_type: 'web_seo' },
      { id: 'j3', service_type: 'ads' },
      { id: 'j4', service_type: 'social_media' },
    ];
    render(<DealCommentsTabs dealId="D1" />);
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent);
    expect(tabs).toEqual(['General', 'Dev', 'SEO', 'Ads', 'Social']);
    expect(screen.getByText('panel:deal:D1')).toBeInTheDocument();
  });

  it('shows an unread dot on inactive tabs that have new comments', () => {
    ref.jobs = [{ id: 'j1', service_type: 'ads' }];
    unreadRef.map = { ads: true, general: false };
    render(<DealCommentsTabs dealId="D1" />);
    const adsTab = screen.getByRole('tab', { name: /Ads/ });
    expect(within(adsTab).getByLabelText('new comments')).toBeInTheDocument();
    const generalTab = screen.getByRole('tab', { name: /General/ });
    expect(within(generalTab).queryByLabelText('new comments')).not.toBeInTheDocument();
  });

  it('never shows a dot on the tab the user is currently viewing', () => {
    ref.jobs = [{ id: 'j1', service_type: 'ads' }];
    unreadRef.map = { general: true, ads: true };
    render(<DealCommentsTabs dealId="D1" />);
    // General is the active default tab -> its dot is suppressed.
    const generalTab = screen.getByRole('tab', { name: /General/ });
    expect(within(generalTab).queryByLabelText('new comments')).not.toBeInTheDocument();
    const adsTab = screen.getByRole('tab', { name: /Ads/ });
    expect(within(adsTab).getByLabelText('new comments')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run src/features/comments/DealCommentsTabs.test.tsx`
Expected: FAIL — Ads/Social tabs missing, no dot rendering. (The first two tests still pass.)

- [ ] **Step 3: Implement**

Replace `src/features/comments/DealCommentsTabs.tsx` entirely with:

```tsx
import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useJobsForDeal } from '@/features/jobs/hooks/useJobsForDeal';
import { CommentsPanel } from './CommentsPanel';
import { useDealCommentUnread } from './hooks/useDealCommentUnread';
import { CHANNEL_LABEL, CHANNEL_THREAD, dealChannelTabs, type ChannelTab } from './commentChannels';

/** The deal page's Comments panel, tabbed per channel. Tabs appear only when
 *  the deal has matching jobs; a deal with none looks exactly like before.
 *  An inactive tab shows an amber dot when its thread has comments this user
 *  hasn't seen (own comments never count); viewing a tab marks it seen via
 *  CommentsPanel's useMarkThreadSeen. */
export function DealCommentsTabs({ dealId }: { dealId: string }) {
  const { data: jobs = [] } = useJobsForDeal(dealId);
  const tabs = dealChannelTabs(jobs);
  const { data: unread } = useDealCommentUnread(dealId, tabs);
  const [active, setActive] = useState<ChannelTab>('general');
  const current = tabs.includes(active) ? active : 'general';

  if (tabs.length === 1) {
    return <CommentsPanel parentType="deal" parentId={dealId} />;
  }

  return (
    <Tabs
      value={current}
      onValueChange={(v) => setActive(v as ChannelTab)}
      className="flex min-h-0 flex-1 flex-col"
    >
      <TabsList className="mb-2 w-full shrink-0 justify-start">
        {tabs.map((tab) => (
          <TabsTrigger key={tab} value={tab} className="text-xs">
            {CHANNEL_LABEL[tab]}
            {tab !== current && unread?.[tab] && (
              <span
                aria-label="new comments"
                className="ml-1.5 inline-block size-1.5 shrink-0 rounded-full bg-amber-500"
              />
            )}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((tab) => (
        <TabsContent
          key={tab}
          value={tab}
          className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden outline-none"
        >
          <CommentsPanel parentType={CHANNEL_THREAD[tab]} parentId={dealId} />
        </TabsContent>
      ))}
    </Tabs>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/comments/DealCommentsTabs.test.tsx`
Expected: PASS (all 7).

- [ ] **Step 5: Commit**

```bash
git add src/features/comments/DealCommentsTabs.tsx src/features/comments/DealCommentsTabs.test.tsx
git commit -m "feat(comments): Ads/Social tabs + unread dots on deal panel"
```

---

### Task 6: Job-page hint labels + full verification + push

**Files:**
- Modify: `src/features/jobs/JobDetailPage.tsx:36` (import) and `:634` (hint)

**Interfaces:**
- Consumes: `channelLabelFor` (Task 2). Everything else ships as-is.
- Produces: deployed feature (push to main → Vercel auto-deploy).

- [ ] **Step 1: Replace the hardcoded Dev/SEO hint**

In `src/features/jobs/JobDetailPage.tsx` line 36, extend the import:

```ts
import { channelLabelFor, jobCommentThread } from '@/features/comments/commentChannels';
```

At line 634, change:

```tsx
                      Shared with the deal — {commentThread.parentType === 'deal_dev' ? 'Dev' : 'SEO'} thread
```

to:

```tsx
                      Shared with the deal — {channelLabelFor(commentThread.parentType)} thread
```

(The surrounding `{commentThread.parentType !== 'job' && …}` guard already ensures `channelLabelFor` only renders for channel threads, where it never returns null. Ads/social job pages now show "Shared with the deal — Ads/Social thread" and — via CommentsPanel from Task 4 — mark the channel seen when read.)

- [ ] **Step 2: Run all touched test files**

Run: `npx vitest run src/features/comments src/features/notifications/notification-presenters.test.ts`
Expected: PASS — every file green. Do NOT run the whole suite (integration tests hit PROD).

- [ ] **Step 3: Full strict build**

Run: `npm run build`
Expected: exits 0 — `tsc -b` clean, eslint zero warnings, vite build succeeds. If tsc flags an exhaustive-switch or widened-union error in a file this plan didn't touch, fix it by adding the new parent types to that switch/map (same treatment as the cases above) — do not silence with casts.

- [ ] **Step 4: Commit and push everything**

```bash
git add src/features/jobs/JobDetailPage.tsx
git commit -m "feat(comments): job-page channel hint via channelLabelFor"
git pull --rebase origin main
git push origin main
```

Expected: push succeeds. Vercel auto-deploys `main`.

- [ ] **Step 5: Post-deploy smoke note**

Report to the owner for manual verification (test creds in memory): log in as two different staff users; on a deal with an ads job, user A posts in the Ads tab; user B opens the deal — amber dot on Ads (not on General), dot clears on opening the tab, stays cleared after reload; the ads job page shows "Shared with the deal — Ads thread" with the same conversation.
