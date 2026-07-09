# Deal Comment Channels (General / Dev / SEO) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tab the deal page Comments panel into General / Dev / SEO channels, where Dev is the same thread as the web_dev job page and SEO is one thread shared by the local_seo / web_seo / ai_seo job pages; migrate existing job comments into the channels.

**Architecture:** Two new `comments.parent_type` values — `deal_dev` and `deal_seo`, both with `parent_id = deal_id` — reuse the entire existing thread stack (query keys, draft keys, mention payloads, index, open RLS) unchanged, exactly how `lead` was added. One migration rebuilds the CHECK constraint, adds mention-label branches, backs up then reparents ~102 old job comments. Frontend: a pure `jobCommentThread`/`dealChannelTabs` helper pair, a `DealCommentsTabs` wrapper on the deal page, and a thread-switch on the job page.

**Tech Stack:** Postgres/Supabase, React + TypeScript, TanStack Query, Radix Tabs (`@/components/ui/tabs`), Vitest + @testing-library/react.

## Global Constraints

- **Do NOT apply the migration to prod** — commit the file only. Prod apply requires the user's explicit go-ahead (it joins the pending queue with the emails-box migration). The apply runbook is in Task 1.
- `npm run build` = `tsc -b` + `eslint --max-warnings=0` + `vite build`; must exit 0 (the >500 kB chunk note is advisory).
- Never run the full vitest suite (some suites hit prod). Run only the test paths named in steps.
- Client & lead comment surfaces, and hosting/ads/social job comment threads, must be untouched.
- Commit messages end with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: Migration — constraint, mention labels, backup, reparent

**Files:**
- Create: `supabase/migrations/20260709150000_deal_comment_channels.sql`

**Interfaces:**
- Produces: parent_type values `deal_dev`/`deal_seo` valid on `public.comments`; backup table `public.comments_reparent_backup_20260709`; updated `fanout_mention_notifications` labels.

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/20260709150000_deal_comment_channels.sql`:

```sql
-- =============================================================================
-- Deal comment channels: General / Dev / SEO.
-- New parent_type values 'deal_dev' / 'deal_seo' (parent_id = deal id) — same
-- pattern as adding 'lead' (20260502000031). Old job comments are backed up
-- then reparented: web_dev job threads -> deal_dev, web/local/ai SEO job
-- threads -> deal_seo. Orphan comments (job deleted) are left untouched.
--
-- Trigger note: comments_set_updated_at would stamp updated_at (falsely marking
-- rows as edited) and comments_activity would spam ~102 rows into client
-- Activity feeds, so both are disabled around the reparent UPDATEs.
--
-- ROLLBACK (manual):
--   update public.comments c set parent_type=b.parent_type, parent_id=b.parent_id
--     from public.comments_reparent_backup_20260709 b where c.id=b.id;
--   re-apply 20260502000032 (previous fanout_mention_notifications body);
--   alter table public.comments drop constraint comments_parent_type_check;
--   alter table public.comments add constraint comments_parent_type_check
--     check (parent_type in ('client','deal','job','lead'));
--   (keep the backup table until the owner confirms stability)
-- =============================================================================

-- 1) Allow the new parent types.
alter table public.comments drop constraint if exists comments_parent_type_check;
alter table public.comments add constraint comments_parent_type_check
  check (parent_type in ('client','deal','job','lead','deal_dev','deal_seo'));

-- 2) Mention notification labels for channel threads.
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

-- 3) Backup the rows we are about to move (revert path).
create table if not exists public.comments_reparent_backup_20260709 as
  select c.id, c.parent_type, c.parent_id
  from public.comments c
  join public.jobs j on j.id = c.parent_id
  where c.parent_type = 'job'
    and j.service_type in ('web_dev','web_seo','local_seo','ai_seo');

-- 4) Reparent job threads into the deal channels (triggers paused: see header).
alter table public.comments disable trigger comments_set_updated_at;
alter table public.comments disable trigger comments_activity;

update public.comments c
   set parent_type = 'deal_dev', parent_id = j.deal_id
  from public.jobs j
 where c.parent_type = 'job' and c.parent_id = j.id
   and j.service_type = 'web_dev';

update public.comments c
   set parent_type = 'deal_seo', parent_id = j.deal_id
  from public.jobs j
 where c.parent_type = 'job' and c.parent_id = j.id
   and j.service_type in ('web_seo','local_seo','ai_seo');

alter table public.comments enable trigger comments_set_updated_at;
alter table public.comments enable trigger comments_activity;
```

- [ ] **Step 2: Commit the migration file (NOT applied)**

```bash
git add supabase/migrations/20260709150000_deal_comment_channels.sql
git commit -m "feat(db): deal comment channels migration (deal_dev/deal_seo; file only, NOT applied)"
```

- [ ] **Step 3 (APPLY RUNBOOK — main session only, AFTER user go-ahead; not for the implementer):**

1. Pre-check trigger names exist: `select tgname from pg_trigger where tgrelid='public.comments'::regclass and not tgisinternal;` — expect `comments_set_updated_at`, `comments_activity`, `comments_fanout_mentions`.
2. Pre-count: `select count(*) from public.comments c join public.jobs j on j.id=c.parent_id where c.parent_type='job' and j.service_type in ('web_dev','web_seo','local_seo','ai_seo');` (expect ~102).
3. Apply the migration SQL via the Management API.
4. Post-asserts: same count query now returns 0; `select count(*) from public.comments_reparent_backup_20260709;` equals the pre-count; `select parent_type, count(*) from public.comments group by 1;` shows `deal_dev` ≈ 8 and `deal_seo` ≈ 94.
5. Spot-check one web_seo deal in the live UI (its SEO tab shows the old job comments).

---

### Task 2: `commentChannels` pure helpers + tests

**Files:**
- Create: `src/features/comments/commentChannels.ts`
- Test: `src/features/comments/commentChannels.test.ts`

**Interfaces:**
- Produces: `type CommentParentType = 'client'|'deal'|'job'|'lead'|'deal_dev'|'deal_seo'`; `type ChannelTab = 'general'|'dev'|'seo'`; `type CommentThreadRef = { parentType: CommentParentType; parentId: string }`; `jobCommentThread(job: { id: string; deal_id: string; service_type: string }): CommentThreadRef`; `dealChannelTabs(jobs: ReadonlyArray<{ service_type: string }>): ChannelTab[]`.

- [ ] **Step 1: Write the failing test**

Create `src/features/comments/commentChannels.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { jobCommentThread, dealChannelTabs } from './commentChannels';

const job = (service_type: string) => ({ id: 'J1', deal_id: 'D1', service_type });

describe('jobCommentThread', () => {
  it('web_dev job -> the deal dev channel', () =>
    expect(jobCommentThread(job('web_dev'))).toEqual({ parentType: 'deal_dev', parentId: 'D1' }));
  it('web_seo / local_seo / ai_seo jobs -> the deal seo channel', () => {
    expect(jobCommentThread(job('web_seo'))).toEqual({ parentType: 'deal_seo', parentId: 'D1' });
    expect(jobCommentThread(job('local_seo'))).toEqual({ parentType: 'deal_seo', parentId: 'D1' });
    expect(jobCommentThread(job('ai_seo'))).toEqual({ parentType: 'deal_seo', parentId: 'D1' });
  });
  it('other services keep their private job thread', () => {
    expect(jobCommentThread(job('hosting'))).toEqual({ parentType: 'job', parentId: 'J1' });
    expect(jobCommentThread(job('ads'))).toEqual({ parentType: 'job', parentId: 'J1' });
    expect(jobCommentThread(job('social_media'))).toEqual({ parentType: 'job', parentId: 'J1' });
  });
});

describe('dealChannelTabs', () => {
  it('no dev/seo jobs -> general only', () =>
    expect(dealChannelTabs([job('hosting')])).toEqual(['general']));
  it('web_dev job -> +dev', () =>
    expect(dealChannelTabs([job('web_dev')])).toEqual(['general', 'dev']));
  it('any seo service -> +seo', () => {
    expect(dealChannelTabs([job('web_seo')])).toEqual(['general', 'seo']);
    expect(dealChannelTabs([job('local_seo')])).toEqual(['general', 'seo']);
    expect(dealChannelTabs([job('ai_seo')])).toEqual(['general', 'seo']);
  });
  it('both -> all three, stable order', () =>
    expect(dealChannelTabs([job('local_seo'), job('web_dev')])).toEqual(['general', 'dev', 'seo']));
  it('empty -> general only', () => expect(dealChannelTabs([])).toEqual(['general']));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/features/comments/commentChannels.test.ts`
Expected: FAIL — cannot resolve `./commentChannels`.

- [ ] **Step 3: Implement**

Create `src/features/comments/commentChannels.ts`:

```ts
/** Thread identity stays (parent_type, parent_id) everywhere. Channels are
 *  just two extra parent types owned by the deal: 'deal_dev' and 'deal_seo'. */
export type CommentParentType = 'client' | 'deal' | 'job' | 'lead' | 'deal_dev' | 'deal_seo';
export type ChannelTab = 'general' | 'dev' | 'seo';
export type CommentThreadRef = { parentType: CommentParentType; parentId: string };

const SEO_SERVICES = new Set(['web_seo', 'local_seo', 'ai_seo']);

/** Which thread a job page shows: web_dev -> the deal's Dev channel,
 *  any SEO flavor -> the deal's SEO channel, everything else keeps
 *  its private job thread. */
export function jobCommentThread(job: {
  id: string;
  deal_id: string;
  service_type: string;
}): CommentThreadRef {
  if (job.service_type === 'web_dev') return { parentType: 'deal_dev', parentId: job.deal_id };
  if (SEO_SERVICES.has(job.service_type)) return { parentType: 'deal_seo', parentId: job.deal_id };
  return { parentType: 'job', parentId: job.id };
}

/** Which tabs the deal comments panel shows for its (non-archived) jobs. */
export function dealChannelTabs(jobs: ReadonlyArray<{ service_type: string }>): ChannelTab[] {
  const tabs: ChannelTab[] = ['general'];
  if (jobs.some((j) => j.service_type === 'web_dev')) tabs.push('dev');
  if (jobs.some((j) => SEO_SERVICES.has(j.service_type))) tabs.push('seo');
  return tabs;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/features/comments/commentChannels.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/comments/commentChannels.ts src/features/comments/commentChannels.test.ts
git commit -m "feat(comments): channel helpers — jobCommentThread + dealChannelTabs"
```

---

### Task 3: Widen parent-type unions + notification routing

**Files:**
- Modify: `src/features/comments/hooks/useComments.ts:7,18`
- Modify: `src/features/comments/hooks/useCreateComment.ts:8`
- Modify: `src/features/comments/CommentForm.tsx:13`
- Modify: `src/features/comments/CommentsPanel.tsx:9`
- Modify: `src/features/notifications/notification-presenters.tsx:37-52`
- Test: `src/features/notifications/notification-presenters.test.ts` (append)

**Interfaces:**
- Consumes: `CommentParentType` from Task 2.
- Produces: all four comment modules accept `CommentParentType`; `readPath` routes `deal_dev`/`deal_seo` → `/deals/<parent_id>`.

- [ ] **Step 1: Widen the four unions**

In `src/features/comments/hooks/useComments.ts`: add `import type { CommentParentType } from '../commentChannels';` and replace both occurrences of `'client' | 'deal' | 'job' | 'lead'` (the `CommentRow.parent_type` field at line 7 and the `useComments` parameter at line 18) with `CommentParentType`.

In `src/features/comments/hooks/useCreateComment.ts`: add `import type { CommentParentType } from '../commentChannels';` and replace the `parent_type: 'client' | 'deal' | 'job' | 'lead';` field (line 8) with `parent_type: CommentParentType;`.

In `src/features/comments/CommentForm.tsx`: add `import type { CommentParentType } from './commentChannels';` and replace `parentType: 'client' | 'deal' | 'job' | 'lead';` (line 13) with `parentType: CommentParentType;`.

In `src/features/comments/CommentsPanel.tsx`: add `import type { CommentParentType } from './commentChannels';` and replace `parentType: 'client' | 'deal' | 'job' | 'lead';` (line 9) with `parentType: CommentParentType;`.

- [ ] **Step 2: Write the failing readPath test**

Append to `src/features/notifications/notification-presenters.test.ts`:

```ts
describe('readPath — deal comment channels', () => {
  it('routes deal_dev and deal_seo mentions to the deal page', () => {
    expect(readPath({ parent_type: 'deal_dev', parent_id: 'D1' })).toBe('/deals/D1');
    expect(readPath({ parent_type: 'deal_seo', parent_id: 'D1' })).toBe('/deals/D1');
  });
});
```

(If the file does not already import `readPath`, extend its existing import from `./notification-presenters`. Vitest globals are not used in this repo — ensure `describe/it/expect` are imported at top; they already are in this file.)

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run src/features/notifications/notification-presenters.test.ts`
Expected: FAIL — the two new assertions return `null`.

- [ ] **Step 4: Add the routing cases**

In `src/features/notifications/notification-presenters.tsx`, inside the `switch (payload['parent_type'])` (lines 37-52), add directly after the `case 'deal':` return:

```ts
    case 'deal_dev':
    case 'deal_seo':
      // Deal comment channels live on the deal page's Comments panel.
      return `/deals/${parentId}`;
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run src/features/notifications/notification-presenters.test.ts src/features/comments`
Expected: PASS (readPath cases + Task 2 helpers + any pre-existing comments tests).
Run: `npx tsc -b --pretty false 2>&1 | head -10`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/features/comments/hooks/useComments.ts src/features/comments/hooks/useCreateComment.ts src/features/comments/CommentForm.tsx src/features/comments/CommentsPanel.tsx src/features/notifications/notification-presenters.tsx src/features/notifications/notification-presenters.test.ts
git commit -m "feat(comments): accept deal_dev/deal_seo threads + route their mentions"
```

---

### Task 4: `DealCommentsTabs` + wire into the deal page

**Files:**
- Create: `src/features/comments/DealCommentsTabs.tsx`
- Test: `src/features/comments/DealCommentsTabs.test.tsx`
- Modify: `src/features/deals/DealDetailPage.tsx:355` (+ imports)

**Interfaces:**
- Consumes: `dealChannelTabs`, `ChannelTab`, `CommentParentType` (Task 2); `CommentsPanel` (Task 3 types); `useJobsForDeal(dealId)` from `@/features/jobs/hooks/useJobsForDeal`; `Tabs, TabsContent, TabsList, TabsTrigger` from `@/components/ui/tabs`.
- Produces: `DealCommentsTabs({ dealId: string })`.

- [ ] **Step 1: Write the failing test**

Create `src/features/comments/DealCommentsTabs.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
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

import { DealCommentsTabs } from './DealCommentsTabs';

describe('DealCommentsTabs', () => {
  beforeEach(() => { ref.jobs = []; });

  it('renders the plain General thread (no tab strip) when the deal has no dev/seo jobs', () => {
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

  it('shows a SEO tab for any seo job and opens the deal_seo thread', async () => {
    ref.jobs = [{ id: 'j1', service_type: 'local_seo' }];
    render(<DealCommentsTabs dealId="D1" />);
    await userEvent.click(screen.getByRole('tab', { name: 'SEO' }));
    expect(screen.getByText('panel:deal_seo:D1')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Dev' })).not.toBeInTheDocument();
  });

  it('shows all three tabs when both dev and seo jobs exist, General first', () => {
    ref.jobs = [{ id: 'j1', service_type: 'web_dev' }, { id: 'j2', service_type: 'web_seo' }];
    render(<DealCommentsTabs dealId="D1" />);
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent);
    expect(tabs).toEqual(['General', 'Dev', 'SEO']);
    expect(screen.getByText('panel:deal:D1')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/features/comments/DealCommentsTabs.test.tsx`
Expected: FAIL — cannot resolve `./DealCommentsTabs`.

- [ ] **Step 3: Implement**

Create `src/features/comments/DealCommentsTabs.tsx`:

```tsx
import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useJobsForDeal } from '@/features/jobs/hooks/useJobsForDeal';
import { CommentsPanel } from './CommentsPanel';
import { dealChannelTabs, type ChannelTab, type CommentParentType } from './commentChannels';

const THREAD: Record<ChannelTab, CommentParentType> = {
  general: 'deal',
  dev: 'deal_dev',
  seo: 'deal_seo',
};
const LABEL: Record<ChannelTab, string> = { general: 'General', dev: 'Dev', seo: 'SEO' };

/** The deal page's Comments panel, tabbed per channel. Tabs appear only when
 *  the deal has matching jobs; a deal with none looks exactly like before. */
export function DealCommentsTabs({ dealId }: { dealId: string }) {
  const { data: jobs = [] } = useJobsForDeal(dealId);
  const tabs = dealChannelTabs(jobs);
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
            {LABEL[tab]}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((tab) => (
        <TabsContent
          key={tab}
          value={tab}
          className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden outline-none"
        >
          <CommentsPanel parentType={THREAD[tab]} parentId={dealId} />
        </TabsContent>
      ))}
    </Tabs>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/features/comments/DealCommentsTabs.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire into the deal page**

In `src/features/deals/DealDetailPage.tsx`:

Replace the import `import { CommentsPanel } from '@/features/comments/CommentsPanel';` with `import { DealCommentsTabs } from '@/features/comments/DealCommentsTabs';` (if `CommentsPanel` is referenced nowhere else in the file — verify with a search; it is used only at line 355).

Replace (line 355):

```tsx
                  <CommentsPanel parentType="deal" parentId={dealId} />
```

with:

```tsx
                  <DealCommentsTabs dealId={dealId} />
```

- [ ] **Step 6: Commit**

```bash
git add src/features/comments/DealCommentsTabs.tsx src/features/comments/DealCommentsTabs.test.tsx src/features/deals/DealDetailPage.tsx
git commit -m "feat(deals): tabbed comment channels (General/Dev/SEO) on the deal page"
```

---

### Task 5: Job pages open their deal channel + verification

**Files:**
- Modify: `src/features/jobs/JobDetailPage.tsx:573-584` (+ import)

**Interfaces:**
- Consumes: `jobCommentThread` (Task 2). `job.id`, `job.deal_id`, `job.service_type` are on the job row from `useJob(jobId)`.

- [ ] **Step 1: Add the import**

In `src/features/jobs/JobDetailPage.tsx`, next to the existing `import { CommentsPanel } from '@/features/comments/CommentsPanel';`:

```tsx
import { jobCommentThread } from '@/features/comments/commentChannels';
```

- [ ] **Step 2: Switch the thread + add the shared hint**

Replace the comments aside body (lines 573-584):

```tsx
            <aside className="min-w-0 lg:h-full lg:min-h-0">
              <div className={cn(commentsPanelShellClass, 'lg:h-full lg:min-h-0')}>
                <div className={commentsPanelHeaderClass}>
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Comments
                  </h2>
                </div>
                <div className={commentsPanelBodyClass}>
                  <CommentsPanel parentType="job" parentId={job.id} />
                </div>
              </div>
            </aside>
```

with:

```tsx
            <aside className="min-w-0 lg:h-full lg:min-h-0">
              <div className={cn(commentsPanelShellClass, 'lg:h-full lg:min-h-0')}>
                <div className={commentsPanelHeaderClass}>
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Comments
                  </h2>
                  {commentThread.parentType !== 'job' && (
                    <p className="text-[11px] font-normal normal-case tracking-normal text-muted-foreground">
                      Shared with the deal — {commentThread.parentType === 'deal_dev' ? 'Dev' : 'SEO'} thread
                    </p>
                  )}
                </div>
                <div className={commentsPanelBodyClass}>
                  <CommentsPanel parentType={commentThread.parentType} parentId={commentThread.parentId} />
                </div>
              </div>
            </aside>
```

and declare, next to the other derived values after the `job` null-guard (near `const serviceType = …` at line 89 — job is non-null past the early returns):

```tsx
  const commentThread = jobCommentThread(job);
```

(If TypeScript complains that `job.deal_id` may be null on the `JobRow` type, pass `{ id: job.id, deal_id: job.deal_id ?? '', service_type: job.service_type }` — `jobs.deal_id` is NOT NULL in the DB, the fallback is type-appeasement only.)

- [ ] **Step 3: Full build**

Run: `npm run build`
Expected: exit 0, zero warnings/errors.

- [ ] **Step 4: Regression sweep (comments + deals + jobs + notifications test files)**

Run: `npx vitest run src/features/comments src/features/deals src/features/notifications src/features/jobs`
Expected: all files PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/jobs/JobDetailPage.tsx
git commit -m "feat(jobs): web_dev/SEO job pages open their deal's comment channel"
```

---

## Changes / Revert

**Changes:** migration `20260709150000_deal_comment_channels.sql` (constraint + mention labels + backup table + reparent; **apply deferred**); new `commentChannels.ts`, `DealCommentsTabs.tsx` (+tests); parent-type unions widened in 4 comment modules; `readPath` channel routes; `DealDetailPage.tsx` + `JobDetailPage.tsx` wiring.

**Revert:** DB — restore rows from `comments_reparent_backup_20260709`, re-apply the `20260502000032` trigger body, restore the 4-value CHECK (exact SQL in the migration header). Code — `git revert` the five commits. Keep the backup table until the owner confirms stability.

## Self-Review

- **Spec coverage:** channels as parent types ✅ (T1/T2/T3); tabs only when jobs exist + general-only unchanged ✅ (T4); web_dev/SEO/ai_seo-parent job pages share deal threads + hint ✅ (T5); migration with backup + trigger-noise suppression ✅ (T1); mention labels + deep links ✅ (T1/T3); client/lead/hosting untouched ✅ (T2 fall-through + no edits to those pages); old-notification behavior needs no backfill ✅ (routing unchanged for 'job').
- **Placeholder scan:** clean — full code + commands everywhere.
- **Type consistency:** `CommentParentType`/`ChannelTab`/`CommentThreadRef` defined in T2, consumed in T3/T4/T5 with matching names; `jobCommentThread` arg shape matches `useJob` row fields; `DealCommentsTabs({ dealId })` matches the T4 wiring; test mocks match real hook shapes (`useJobsForDeal` → `{ data }`).
