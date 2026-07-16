# Design: Ads + Social comment channels & unread-tab dots

**Date:** 2026-07-16
**Status:** Design approved in conversation. Product decisions confirmed: DB-backed
per-user read state; small amber dot indicator; deal page only (job pages get the
shared threads but no dots for now); unread computed client-side (no new RPC).

## Problem

The deal Comments panel is tabbed General / Dev / SEO (shipped 07-09), where Dev and
SEO are the same conversations as the matching job pages. Ads (`ads`) and Social
(`social_media`) jobs still have private job threads invisible from the deal page.
Also, nothing tells accounting that a channel tab has comments they haven't seen.

Two features:

1. **Ads + Social channels** — same system as Dev/SEO: deal-owned threads, tabs on
   the deal Comments panel, job pages as extra doors into the same room.
2. **Unread dots** — each channel tab shows a small amber dot when its thread has a
   comment newer than what that user last saw there (own comments never count).

## Mental model

| Channel | Deal page tab | Also rendered on | Thread identity |
|---|---|---|---|
| General | always | — | `('deal', deal_id)` (unchanged) |
| Dev | when a web_dev job exists | web_dev job pages | `('deal_dev', deal_id)` (unchanged) |
| SEO | when a web/local/ai_seo job exists | those job pages | `('deal_seo', deal_id)` (unchanged) |
| **Ads** | when an `ads` job exists | ads job pages | `('deal_ads', deal_id)` **new** |
| **Social** | when a `social_media` job exists | social_media job pages | `('deal_social', deal_id)` **new** |

Tab order: General, Dev, SEO, Ads, Social. Hosting job pages keep private job
threads; client/lead comment surfaces untouched.

**Read state** is per **(user, thread)**: `comment_thread_reads(user_id, parent_type,
parent_id, last_seen_at)`. A tab is *unread* when the thread's newest non-archived,
not-authored-by-me comment is newer than my `last_seen_at` (or I have no row).
Viewing a tab upserts `last_seen_at = now()`.

## Verified facts (live prod + code, 07-16)

- Prod has **21 `ads` jobs and 21 `social_media` jobs with ZERO comments** on their
  job threads → **no reparenting migration, no backup table** (unlike 07-09).
- `comments` parent_type CHECK is currently the 6-value set from
  `20260709150000_deal_comment_channels.sql:24-26`.
- Channel plumbing all keys on `(parent_type, parent_id)`: query keys, draft keys,
  mention payloads, partial index `comments_parent`, open-to-staff RLS
  (`20260619000002`) — new values reuse all of it unchanged.
- `fanout_mention_notifications()` has per-type label branches
  (`20260709150000:29-60`); needs `deal_ads` / `deal_social` branches.
- Task auto-comments route dept tasks into channels via `v_st` branches
  (`20260709170000_task_auto_comments.sql:62-63,86-87`); needs
  `ads → deal_ads`, `social_media → deal_social` in both functions.
- `comments_activity` uses generic `log_activity('id')` (`20260502000009:30-32`) —
  no change needed for new parent types.
- Deal page: comments are an **aside inside the Overview tab**
  (`DealDetailPage.tsx:351-362`) — there is no outer "Comments" page tab, so the
  channel-tab dots are visible on landing (Overview is the default tab). The
  sidebar unmounts when another page tab is active (no forceMount), so
  mounted ⇒ visible, which makes mark-seen safe to key off the active channel tab.
- Job page hint hardcodes a Dev/SEO ternary (`JobDetailPage.tsx:634`) — becomes a
  label map covering all four channels.
- Frontend surfaces to extend: `commentChannels.ts` (types, `jobCommentThread`,
  `dealChannelTabs`), `DealCommentsTabs.tsx` (`THREAD`/`LABEL` maps, dots),
  `notification-presenters.tsx` (readPath → `/deals/<id>`, labels).
- Prod fn drift: read live bodies via `pg_get_functiondef` before rewriting
  `fanout_mention_notifications` and the task auto-comment functions
  (see reference_flip_fix_prod_drift).

## DB changes (one migration, e.g. `20260716..._ads_social_channels_unread.sql`)

1. Widen `comments_parent_type_check` to
   `('client','deal','job','lead','deal_dev','deal_seo','deal_ads','deal_social')`.
2. `fanout_mention_notifications()`: add branches labeling
   `<deal.title> — Ads` / `<deal.title> — Social`.
3. Task auto-comment functions: add `ads`/`social_media` routing branches so
   dept-tagged tasks post their 📋/✅ auto-comments into the new channels.
4. New table:

   ```sql
   create table public.comment_thread_reads (
     user_id uuid not null references public.profiles(user_id) on delete cascade,
     parent_type text not null,
     parent_id uuid not null,
     last_seen_at timestamptz not null default now(),
     primary key (user_id, parent_type, parent_id)
   );
   ```

   RLS enabled; select/insert/update policies all `user_id = auth.uid()`;
   grants to `authenticated` only (no `anon` — grant-boundary rule).
   `on delete cascade` keeps the profile-delete FK cleanup story intact.

## Frontend changes

- `commentChannels.ts`: `CommentParentType` + `ChannelTab` gain `deal_ads`/`ads`
  and `deal_social`/`social`; `jobCommentThread` routes `ads`/`social_media`;
  `dealChannelTabs` appends the tabs when matching non-archived jobs exist.
- `DealCommentsTabs.tsx`: extend `THREAD`/`LABEL` ("Ads", "Social"); render an
  amber dot on a `TabsTrigger` whose channel is unread; call `markSeen(tab)` when
  a tab is (or becomes) the active one. Single-tab deals keep the plain panel
  (no tabs ⇒ no dots; the thread itself is visible on Overview).
- New hook `useCommentThreadReads(dealId, tabs)` (comments feature):
  - fetches my `comment_thread_reads` rows for the deal's threads (≤5 rows) and,
    per visible channel, the newest non-own comment
    (`select id, created_at … order by created_at desc limit 1` — hits the
    `comments_parent` partial index; ≤6 tiny parallel queries, one query key);
  - pure helper `deriveUnread(latestByTab, readRows, uid)` returns
    `Record<ChannelTab, boolean>` (unit-testable);
  - `markSeen(tab)` upserts `last_seen_at = now()` and optimistically clears the
    dot (invalidate on settle).
  - Freshness: standard react-query (page load / refocus / after posting). No
    realtime — comments don't have it today and this feature doesn't add it.
- `JobDetailPage.tsx`: hint label map — "Shared with the deal — Ads/Social thread".
  Job pages showing a shared channel also call `markSeen` for it (no dot UI there —
  just read-state consistency, so reading on the job page clears the deal-page dot).
- `notification-presenters.tsx`: `deal_ads`/`deal_social` mentions deep-link to
  `/deals/<id>`; labels match the fanout labels.
- Visible to **all staff** who open the deal page — no role gate.

## Testing (TDD)

- `commentChannels.test.ts`: routing + tab gating for `ads`/`social_media`.
- `deriveUnread` unit tests: no row ⇒ unread; own-only comments ⇒ read; newer
  comment ⇒ unread; seen ⇒ read; archived ignored (query-level).
- `DealCommentsTabs.test.tsx`: new tabs render when jobs exist; dot renders per
  unread map; markSeen fires for the active tab.
- Migration post-asserts: CHECK accepts new values; table + RLS policies exist.
- Manual smoke on prod after deploy: two users, one posts in Ads, other sees dot,
  opens tab, dot clears and survives reload.

## Changes / Revert

- **Changes:** one migration (constraint widen, 2–3 fn updates, new table);
  frontend commits per task (small, atomic; direct to main per standing rule).
- **Revert:**
  - restore pre-change fn bodies (captured via `pg_get_functiondef` live-reads
    during implementation — stored in the plan);
  - `drop table public.comment_thread_reads;`
  - re-narrow the CHECK to the 6-value set — requires first handling any
    `deal_ads`/`deal_social` rows written in the meantime (reparent to the job
    thread of the deal's matching job, or delete — manual decision at revert time);
  - revert frontend commits.
