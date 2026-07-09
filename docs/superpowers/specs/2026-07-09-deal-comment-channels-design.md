# Design: Deal comment channels (General / Dev / SEO)

**Date:** 2026-07-09
**Status:** Approach approved in conversation (Option A: threads move up to the deal). Product decisions confirmed: migrate old job comments in; tabs appear only when the matching job exists; the SEO channel works from the first SEO job (one or both).

## Problem

The deal page has one Comments thread. Work conversations happen per department:
web-dev talk on the web_dev job page, SEO talk split across the local_seo and
web_seo job pages. Accounting/sales on the deal page can't see or join those.
We want the deal's Comments panel tabbed — **General / Dev / SEO** — where Dev
is *the same conversation* as the web_dev job page and SEO is *one unified
conversation* shared by the local_seo and web_seo job pages (whether the jobs
came from an AI SEO split or were sold individually).

## Mental model

A conversation belongs to the **deal, per department** — the job pages are
extra doors into the right room:

| Channel | Deal page tab | Also rendered on | Thread identity |
|---|---|---|---|
| General | always | — | `('deal', deal_id)` (today's thread, unchanged) |
| Dev | when a web_dev job exists | web_dev job page(s) | `('deal_dev', deal_id)` |
| SEO | when a local_seo / web_seo / ai_seo job exists | local_seo, web_seo, and ai_seo-parent job pages | `('deal_seo', deal_id)` |

All other comment surfaces (client, lead, hosting/ads/social job pages) are untouched.

## Why new parent_types (not a channel column)

Every layer already keys a thread on `(parent_type, parent_id)`:
`useComments` + query key `['comments', parentType, parentId]`
(`queryKeys.ts:23`), draft keys `comment:${parentType}:${parentId}`
(`commentDraftStore.ts:10-14`), mention payloads (`20260502000032:42-50`),
notification routing (`notification-presenters.tsx:12-53`), the partial index
`comments_parent`, and open-to-all-staff RLS. Two new parent_type values
(`deal_dev`, `deal_seo`) with `parent_id = deal_id` reuse ALL of it unchanged —
same trick as adding `lead` (`20260502000031`). A `channel` column would force
a third dimension through every one of those layers.

## Verified facts (live prod + code)

- `comments` schema `20260502000009:8-21`; parent_type CHECK currently
  `('client','deal','job','lead')` (`20260502000031:6-8`); `reply_to_id`
  threading (`20260502000033`). RLS: SELECT `using(true)`, INSERT
  `auth.uid()=author_id` (`20260619000002`) — channels add zero rights complexity.
- Mount points: DealDetailPage.tsx:355 (`parentType="deal"`), JobDetailPage.tsx:581
  (`parentType="job"`), client/lead pages (untouched).
- Mention fanout trigger `fanout_mention_notifications` (`20260502000032:6-54`)
  snapshots `parent_type/parent_id/parent_label` into the notification payload;
  `readPath` routes purely off `payload.parent_type` → needs `deal_dev`/`deal_seo`
  branches (→ `/deals/<id>`), and the trigger needs `parent_label` branches.
- Comments ARE in the realtime publication but the UI intentionally uses
  react-query invalidation only (no live subscription) — channels keep that
  behavior; realtime comments is out of scope.
- **Migration blast radius (live counts):** web_seo 93 comments (76 deals),
  web_dev 8 (5 deals), local_seo 1, ai_seo-parent 0. **Zero deals** have history
  on both SEO jobs → no interleaving surprises. 5 orphan comments (job deleted)
  stay as-is (invisible today, invisible after).
- ai_seo parent job pages render CommentsPanel unconditionally today
  (JobDetailPage.tsx:581) but have zero comments — switching them to the SEO
  channel loses nothing.

## Design

### Migration (one file, applied via Management API after go-ahead)

1. Rebuild `comments_parent_type_check` → `('client','deal','job','lead','deal_dev','deal_seo')`.
2. Update `fanout_mention_notifications`: `parent_label` for `deal_dev` =
   `<deal title> — Dev`, `deal_seo` = `<deal title> — SEO` (deal looked up by
   `new.parent_id`, same as the existing `deal` branch).
3. **Backup then reparent** (Track-changes rule — reparenting is lossy for the
   original job id):
   - `create table comments_reparent_backup_20260709 as select id, parent_type, parent_id from comments where parent_type='job' and parent_id in (select id from jobs where service_type in ('web_dev','web_seo','local_seo','ai_seo'));`
   - web_dev job comments → `('deal_dev', jobs.deal_id)`
   - local_seo / web_seo / ai_seo job comments → `('deal_seo', jobs.deal_id)`
   - Orphans (no matching job) untouched.
4. Rollback: restore from the backup table
   (`update comments c set parent_type=b.parent_type, parent_id=b.parent_id from comments_reparent_backup_20260709 b where c.id=b.id;`),
   revert trigger + constraint.

### Frontend

- **`src/features/comments/commentChannels.ts`** — pure, unit-tested:
  - `type ChannelTab = 'general' | 'dev' | 'seo'`
  - `jobCommentThread(job: { id; deal_id; service_type }): { parentType; parentId }`
    → web_dev → `deal_dev`/deal_id; local_seo|web_seo|ai_seo → `deal_seo`/deal_id;
    everything else → `job`/job.id.
  - `dealChannelTabs(jobs: Array<{ service_type }>): ChannelTab[]` → always
    `['general']`, `+dev` if any web_dev, `+seo` if any local_seo/web_seo/ai_seo.
- **`src/features/comments/DealCommentsTabs.tsx`** — replaces the bare
  CommentsPanel inside the deal page's comments aside. Uses `useJobsForDeal(dealId)`
  (already cached by the billing panel) + `dealChannelTabs`; renders
  `Tabs/TabsList/TabsTrigger` (`@/components/ui/tabs`) with one `CommentsPanel`
  per visible tab: General→`('deal', dealId)`, Dev→`('deal_dev', dealId)`,
  SEO→`('deal_seo', dealId)`. Single tab (general only) → render exactly today's
  UI (no tab strip).
- **JobDetailPage**: comments aside uses `jobCommentThread(job)`; for shared
  threads show a muted hint "Shared with the deal — Dev/SEO thread". Non-dev/seo
  jobs unchanged.
- **`CommentsPanel` prop union** (and any dependent types) extends to
  `'client'|'deal'|'job'|'lead'|'deal_dev'|'deal_seo'`.
- **`notification-presenters.tsx` `readPath`**: `deal_dev`/`deal_seo` →
  `/deals/${parent_id}`.

### Behavior notes

- Old mention notifications (snapshot `parent_type='job'`) keep working: they
  deep-link to the job page, whose comments section now *is* the channel thread
  containing the migrated comment. No notification backfill needed.
- Old localStorage drafts keyed `comment:job:<job_id>` on migrated jobs no longer
  mount and expire via the existing 30-day prune. Acceptable.
- Cross-window freshness = existing behavior (react-query invalidation +
  refetch-on-focus), same as today's comments. Realtime subscription: out of scope.
- Multiple web_dev jobs on one deal share the one Dev channel (deliberate:
  "the dev conversation of this deal").

## Testing

- Unit: `jobCommentThread` (web_dev / local_seo / web_seo / ai_seo / hosting fall-through),
  `dealChannelTabs` (none / dev only / seo via each service / both).
- Component: `DealCommentsTabs` with mocked `useJobsForDeal` + `CommentsPanel` —
  correct tabs appear; general-only renders without a tab strip; each tab mounts
  CommentsPanel with the right `(parentType, parentId)`.
- `readPath` unit cases for `deal_dev`/`deal_seo`.
- Migration verified on prod via rolled-back DO-block (insert fake deal+jobs+comments,
  run the reparent statements, assert thread contents, RAISE to roll back), then
  applied with the backup table; spot-check one real web_seo deal after.

## Changes / Revert

**Changes:** migration `2026…_deal_comment_channels.sql` (constraint + trigger +
backup + reparent); new `commentChannels.ts`, `DealCommentsTabs.tsx` (+tests);
edits to `CommentsPanel` types, `DealDetailPage.tsx`, `JobDetailPage.tsx`,
`notification-presenters.tsx`.

**Revert:** restore comments from `comments_reparent_backup_20260709`; re-apply
previous trigger body + 4-value check constraint; `git revert` the frontend
commits. Backup table is kept until the owner confirms stability.
