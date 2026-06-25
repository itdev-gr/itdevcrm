# Client Activity Feed — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the client's **Activity** tab show every action for that client — payments, jobs, deals, attachments, and tasks — in one chronological, filterable feed.

**Architecture:** Single event store. Add a `client_id` column to `activity_log`; extend the shared `log_activity()` trigger fn to stamp it; add `log_activity` triggers to `deal_payments`, `user_tasks`, `assigned_tasks`; backfill existing rows. The client feed is one indexed query `WHERE client_id = X`, rendered by a new `describeEvent()` formatter and a `ClientActivityPanel` with category filter chips.

**Tech Stack:** Supabase Postgres (plpgsql triggers, migrations applied via the Supabase MCP), React + TypeScript, @tanstack/react-query, vitest.

**Spec:** `docs/superpowers/specs/2026-06-25-client-activity-feed-design.md`

**Scope note (Phase 1):** Emails / Resend delivery tracking are **Phase 2** and get a separate plan. The email filter chip and `email` category are wired here so the UI is ready, but no email rows are produced yet.

**Prod project (Supabase MCP):** `xujlrclyzxrvxszepquy` (project "CRM"). DDL must go through the MCP `apply_migration`; verify with `execute_sql`. Build verification: `npm run build` (stricter than `tsc --noEmit` — `noUncheckedIndexedAccess` + `eslint --max-warnings=0`).

---

## File Structure

- `supabase/migrations/20260625100000_activity_log_client_id.sql` — add column + index (Task 1)
- `supabase/migrations/20260625100100_log_activity_client_id.sql` — extend `log_activity()` (Task 2)
- `supabase/migrations/20260625100200_activity_triggers_payments_tasks.sql` — new triggers (Task 3)
- `supabase/migrations/20260625100300_backfill_activity_client_id.sql` — backfill + backup (Task 4)
- `src/features/activity/format.ts` — add `categoryOf`, `describeEvent`, helpers (Task 5)
- `src/features/activity/format.test.ts` — tests for the new formatter (Task 5)
- `src/features/activity/hooks/useClientActivity.ts` — new infinite-query hook (Task 6)
- `src/lib/queryKeys.ts` — add `clientActivity` key (Task 6)
- `src/features/activity/ClientActivityPanel.tsx` — feed + filter chips (Task 7)
- `src/features/clients/ClientDetailPage.tsx:147-149` — swap in the new panel (Task 8)

---

## Task 1: Migration — add `activity_log.client_id` + index

**Files:**
- Create: `supabase/migrations/20260625100000_activity_log_client_id.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- 20260625100000_activity_log_client_id.sql
-- Add a client_id column to activity_log so a single indexed query can fetch
-- every event for a client. Nullable: events not tied to a client (e.g. some
-- leads/comments) keep it null. ON DELETE SET NULL so client deletion never
-- blocks on the log.

alter table public.activity_log
  add column if not exists client_id uuid
  references public.clients(id) on delete set null;

create index if not exists activity_log_client_created_idx
  on public.activity_log (client_id, created_at desc)
  where client_id is not null;

-- ROLLBACK:
--   drop index if exists public.activity_log_client_created_idx;
--   alter table public.activity_log drop column if exists client_id;
```

- [ ] **Step 2: Apply via the Supabase MCP**

Apply with `apply_migration` (name `activity_log_client_id`, project `xujlrclyzxrvxszepquy`) using the SQL above.

- [ ] **Step 3: Verify the column + index exist**

Run via `execute_sql`:
```sql
select column_name from information_schema.columns
where table_schema='public' and table_name='activity_log' and column_name='client_id';
select indexname from pg_indexes
where schemaname='public' and indexname='activity_log_client_created_idx';
```
Expected: one row each.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260625100000_activity_log_client_id.sql
git commit -m "feat(activity): add client_id to activity_log + index"
```

---

## Task 2: Migration — extend `log_activity()` to stamp `client_id`

**Files:**
- Create: `supabase/migrations/20260625100100_log_activity_client_id.sql`

This replaces the trigger fn body. The only change vs. the current definition is computing `client_id_value` per source table and adding it to the insert. Existing triggers on clients/deals/jobs/attachments/comments keep working unchanged.

- [ ] **Step 1: Write the migration file**

```sql
-- 20260625100100_log_activity_client_id.sql
-- Extend the shared activity trigger fn to derive and store client_id.
-- Keeps all existing behaviour; only adds client_id resolution + column write.

create or replace function public.log_activity()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  entity_id_value uuid;
  changes_json jsonb;
  rec jsonb;
  client_id_value uuid;
begin
  if tg_op = 'DELETE' then
    rec := row_to_json(old)::jsonb;
    entity_id_value := (rec ->> coalesce(tg_argv[0], 'id'))::uuid;
    changes_json := rec;
  elsif tg_op = 'INSERT' then
    rec := row_to_json(new)::jsonb;
    entity_id_value := (rec ->> coalesce(tg_argv[0], 'id'))::uuid;
    changes_json := rec;
  else
    rec := row_to_json(new)::jsonb;
    entity_id_value := (rec ->> coalesce(tg_argv[0], 'id'))::uuid;
    changes_json := jsonb_build_object('old', row_to_json(old)::jsonb, 'new', rec);
  end if;

  -- Derive the owning client for this event.
  client_id_value := case tg_table_name
    when 'clients'        then entity_id_value
    when 'deals'          then (rec ->> 'client_id')::uuid
    when 'jobs'           then (rec ->> 'client_id')::uuid
    when 'user_tasks'     then (rec ->> 'client_id')::uuid
    when 'assigned_tasks' then (rec ->> 'client_id')::uuid
    when 'deal_payments'  then (select d.client_id from public.deals d
                                where d.id = (rec ->> 'deal_id')::uuid)
    when 'attachments'    then case rec ->> 'parent_type'
        when 'client' then (rec ->> 'parent_id')::uuid
        when 'deal'   then (select d.client_id from public.deals d
                            where d.id = (rec ->> 'parent_id')::uuid)
        when 'job'    then (select j.client_id from public.jobs j
                            where j.id = (rec ->> 'parent_id')::uuid)
        else null
      end
    else null
  end;

  insert into public.activity_log (entity_type, entity_id, user_id, action, changes, client_id)
  values (tg_table_name, entity_id_value, auth.uid(), lower(tg_op), changes_json, client_id_value);

  return coalesce(new, old);
end $function$;

-- ROLLBACK: re-create log_activity() without the client_id_value block and with the
-- original 5-column insert (entity_type, entity_id, user_id, action, changes).
```

- [ ] **Step 2: Apply via the Supabase MCP**

Apply with `apply_migration` (name `log_activity_client_id`).

- [ ] **Step 3: Verify a fresh client/deal change stamps client_id**

Run via `execute_sql` (read-only check on a recent deal update — pick any active deal):
```sql
-- Touch nothing destructive: just confirm the fn definition now writes client_id.
select pg_get_functiondef('public.log_activity'::regproc) ilike '%client_id_value%' as has_client_logic;
```
Expected: `has_client_logic = true`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260625100100_log_activity_client_id.sql
git commit -m "feat(activity): stamp client_id in log_activity trigger fn"
```

---

## Task 3: Migration — add activity triggers on payments + tasks

**Files:**
- Create: `supabase/migrations/20260625100200_activity_triggers_payments_tasks.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- 20260625100200_activity_triggers_payments_tasks.sql
-- Funnel payment + task changes into activity_log via the shared fn.

drop trigger if exists deal_payments_activity on public.deal_payments;
create trigger deal_payments_activity
  after insert or update or delete on public.deal_payments
  for each row execute function public.log_activity();

drop trigger if exists user_tasks_activity on public.user_tasks;
create trigger user_tasks_activity
  after insert or update or delete on public.user_tasks
  for each row execute function public.log_activity();

drop trigger if exists assigned_tasks_activity on public.assigned_tasks;
create trigger assigned_tasks_activity
  after insert or update or delete on public.assigned_tasks
  for each row execute function public.log_activity();

-- ROLLBACK:
--   drop trigger if exists deal_payments_activity on public.deal_payments;
--   drop trigger if exists user_tasks_activity on public.user_tasks;
--   drop trigger if exists assigned_tasks_activity on public.assigned_tasks;
```

- [ ] **Step 2: Apply via the Supabase MCP**

Apply with `apply_migration` (name `activity_triggers_payments_tasks`).

- [ ] **Step 3: Verify the triggers exist**

Run via `execute_sql`:
```sql
select event_object_table, trigger_name
from information_schema.triggers
where trigger_schema='public'
  and trigger_name in ('deal_payments_activity','user_tasks_activity','assigned_tasks_activity')
order by event_object_table;
```
Expected: three trigger names across the three tables (insert/update/delete rows).

- [ ] **Step 4: Smoke-test that a payment change writes a client-stamped row**

Pick a real payment on a known client (e.g. deal `000516`, client `51f2c42b-0c69-4f79-871f-ebcb8ef5b8d2`). A no-op update is enough to fire the trigger:
```sql
update public.deal_payments
set updated_at = now()
where id = (select dp.id from public.deal_payments dp
            join public.deals d on d.id = dp.deal_id
            where d.code = '000516' limit 1);

select entity_type, action, client_id, created_at
from public.activity_log
where entity_type='deal_payments'
order by created_at desc limit 1;
```
Expected: one fresh `deal_payments` / `update` row with `client_id = 51f2c42b-…`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260625100200_activity_triggers_payments_tasks.sql
git commit -m "feat(activity): log payment + task changes to activity_log"
```

---

## Task 4: Migration — backfill `client_id` on existing rows (with backup)

**Files:**
- Create: `supabase/migrations/20260625100300_backfill_activity_client_id.sql`

Only clients/deals/jobs/attachments have pre-existing rows (payments/tasks had no trigger before Task 3). Attachments resolve their parent from the `changes` snapshot.

- [ ] **Step 1: Write the migration file**

```sql
-- 20260625100300_backfill_activity_client_id.sql
-- One-time backfill of activity_log.client_id for rows written before the
-- log_activity() change. Backup first.

create table if not exists public.activity_log_clientid_backfill_backup_20260625 as
select id, client_id from public.activity_log where client_id is null;

-- clients: entity_id IS the client id
update public.activity_log a
  set client_id = a.entity_id
  where a.entity_type = 'clients' and a.client_id is null;

-- deals
update public.activity_log a
  set client_id = d.client_id
  from public.deals d
  where a.entity_type = 'deals' and a.entity_id = d.id and a.client_id is null;

-- jobs
update public.activity_log a
  set client_id = j.client_id
  from public.jobs j
  where a.entity_type = 'jobs' and a.entity_id = j.id and a.client_id is null;

-- attachments: parent info lives in the changes snapshot (flat for insert/delete,
-- under ->'new' for update).
update public.activity_log a
  set client_id = case coalesce(a.changes->>'parent_type', a.changes->'new'->>'parent_type')
    when 'client' then coalesce(a.changes->>'parent_id', a.changes->'new'->>'parent_id')::uuid
    when 'deal'   then (select d.client_id from public.deals d
                        where d.id = coalesce(a.changes->>'parent_id', a.changes->'new'->>'parent_id')::uuid)
    when 'job'    then (select j.client_id from public.jobs j
                        where j.id = coalesce(a.changes->>'parent_id', a.changes->'new'->>'parent_id')::uuid)
    else null
  end
  where a.entity_type = 'attachments' and a.client_id is null;

-- ROLLBACK:
--   update public.activity_log a set client_id = b.client_id
--     from public.activity_log_clientid_backfill_backup_20260625 b where a.id = b.id;
--   drop table if exists public.activity_log_clientid_backfill_backup_20260625;
```

- [ ] **Step 2: Apply via the Supabase MCP**

Apply with `apply_migration` (name `backfill_activity_client_id`).

- [ ] **Step 3: Verify the backfill populated rows for a known client**

Run via `execute_sql`:
```sql
select entity_type, count(*)
from public.activity_log
where client_id = '51f2c42b-0c69-4f79-871f-ebcb8ef5b8d2'
group by entity_type order by entity_type;
```
Expected: multiple rows across `clients` / `deals` / `jobs` (and any `deal_payments` from Task 3's smoke test).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260625100300_backfill_activity_client_id.sql
git commit -m "feat(activity): backfill client_id on existing activity_log rows"
```

---

## Task 5: Formatter — `categoryOf` + `describeEvent`

**Files:**
- Modify: `src/features/activity/format.ts`
- Test: `src/features/activity/format.test.ts`

Adds a per-row renderer that turns any activity row (payment / task / attachment / deal / job / client) into a one-line summary + optional detail lines, plus a category for filtering. Reuses the existing `diffOf`, `snapshotFields`, `formatValue`, `labelFor`.

- [ ] **Step 1: Write the failing tests**

Append to `src/features/activity/format.test.ts`:
```ts
import { categoryOf, describeEvent } from './format';

describe('categoryOf', () => {
  it('maps entity types to feed categories', () => {
    expect(categoryOf('deal_payments')).toBe('payment');
    expect(categoryOf('jobs')).toBe('job');
    expect(categoryOf('deals')).toBe('deal');
    expect(categoryOf('attachments')).toBe('attachment');
    expect(categoryOf('user_tasks')).toBe('task');
    expect(categoryOf('assigned_tasks')).toBe('task');
    expect(categoryOf('email_log')).toBe('email');
    expect(categoryOf('something_else')).toBe('other');
  });
});

describe('describeEvent — payments', () => {
  it('describes a new pending payment', () => {
    const v = describeEvent(
      { entity_type: 'deal_payments', action: 'insert', changes: { amount_net: '346.78', status: 'pending' } },
      resolver,
    );
    expect(v.category).toBe('payment');
    expect(v.summary).toBe('Payment of €346.78 created (pending)');
  });
  it('describes marking a payment paid', () => {
    const v = describeEvent(
      { entity_type: 'deal_payments', action: 'update',
        changes: { old: { amount_net: '346.78', status: 'pending' }, new: { amount_net: '346.78', status: 'paid' } } },
      resolver,
    );
    expect(v.summary).toBe('Payment of €346.78 marked paid');
  });
  it('describes setting a payment back to pending', () => {
    const v = describeEvent(
      { entity_type: 'deal_payments', action: 'update',
        changes: { old: { amount_net: '346.78', status: 'paid' }, new: { amount_net: '346.78', status: 'pending' } } },
      resolver,
    );
    expect(v.summary).toBe('Payment of €346.78 set back to pending');
  });
  it('describes a payment amount change', () => {
    const v = describeEvent(
      { entity_type: 'deal_payments', action: 'update',
        changes: { old: { amount_net: '300', status: 'pending' }, new: { amount_net: '346.78', status: 'pending' } } },
      resolver,
    );
    expect(v.summary).toBe('Payment amount changed €300 → €346.78');
  });
  it('describes a deleted payment', () => {
    const v = describeEvent(
      { entity_type: 'deal_payments', action: 'delete', changes: { amount_net: '346.78', status: 'pending' } },
      resolver,
    );
    expect(v.summary).toBe('Payment of €346.78 deleted');
  });
});

describe('describeEvent — tasks', () => {
  it('describes a created task', () => {
    const v = describeEvent(
      { entity_type: 'user_tasks', action: 'insert', changes: { title: 'Call client', completed_at: null } },
      resolver,
    );
    expect(v.category).toBe('task');
    expect(v.summary).toBe('Task “Call client” created');
  });
  it('describes a completed user task (completed_at set)', () => {
    const v = describeEvent(
      { entity_type: 'user_tasks', action: 'update',
        changes: { old: { title: 'Call client', completed_at: null }, new: { title: 'Call client', completed_at: '2026-06-25T10:00:00Z' } } },
      resolver,
    );
    expect(v.summary).toBe('Task “Call client” completed');
  });
  it('describes a resolved assigned task (status → resolved)', () => {
    const v = describeEvent(
      { entity_type: 'assigned_tasks', action: 'update',
        changes: { old: { title: 'Fix DNS', status: 'open' }, new: { title: 'Fix DNS', status: 'resolved' } } },
      resolver,
    );
    expect(v.summary).toBe('Task “Fix DNS” completed');
  });
});

describe('describeEvent — attachments', () => {
  it('describes an upload', () => {
    const v = describeEvent(
      { entity_type: 'attachments', action: 'insert', changes: { file_name: 'invoice.pdf', parent_type: 'client' } },
      resolver,
    );
    expect(v.category).toBe('attachment');
    expect(v.summary).toBe('Uploaded invoice.pdf');
  });
  it('describes a delete', () => {
    const v = describeEvent(
      { entity_type: 'attachments', action: 'delete', changes: { file_name: 'invoice.pdf' } },
      resolver,
    );
    expect(v.summary).toBe('Deleted invoice.pdf');
  });
});

describe('describeEvent — generic deal/job', () => {
  it('describes a deal stage move using friendly stage names', () => {
    const v = describeEvent(
      { entity_type: 'deals', action: 'update',
        changes: { old: { stage_id: 'stage-new' }, new: { stage_id: 'stage-hot' } } },
      resolver,
    );
    expect(v.category).toBe('deal');
    expect(v.summary).toBe('Updated the deal:');
    expect(v.lines[0]).toEqual({ key: 'stage_id', label: 'Stage', text: 'New Lead → Hot' });
  });
  it('describes a created job', () => {
    const v = describeEvent(
      { entity_type: 'jobs', action: 'insert', changes: { service_type: 'web_seo', status: 'active' } },
      resolver,
    );
    expect(v.summary).toBe('Created the job');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/features/activity/format.test.ts`
Expected: FAIL — `categoryOf` / `describeEvent` are not exported.

- [ ] **Step 3: Implement the new formatter**

Append to `src/features/activity/format.ts`:
```ts
export type ActivityCategory =
  | 'payment' | 'job' | 'deal' | 'client' | 'attachment' | 'task' | 'email' | 'comment' | 'other';

const CATEGORY_BY_ENTITY: Record<string, ActivityCategory> = {
  deal_payments: 'payment',
  jobs: 'job',
  deals: 'deal',
  clients: 'client',
  attachments: 'attachment',
  user_tasks: 'task',
  assigned_tasks: 'task',
  email_log: 'email',
  comments: 'comment',
};

export function categoryOf(entityType: string): ActivityCategory {
  return CATEGORY_BY_ENTITY[entityType] ?? 'other';
}

export type EventView = {
  category: ActivityCategory;
  summary: string;
  lines: { key: string; label: string; text: string }[];
};

type RawEvent = { entity_type: string; action: 'insert' | 'update' | 'delete'; changes: unknown };

/** Current snapshot: flat object for insert/delete, the `new` side for update. */
function currentOf(changes: unknown): Record<string, unknown> {
  if (!changes || typeof changes !== 'object') return {};
  const c = changes as Record<string, unknown>;
  if (c.new && typeof c.new === 'object') return c.new as Record<string, unknown>;
  return c;
}
/** Previous snapshot: the `old` side for update, else empty. */
function previousOf(changes: unknown): Record<string, unknown> {
  if (!changes || typeof changes !== 'object') return {};
  const c = changes as Record<string, unknown>;
  if (c.old && typeof c.old === 'object') return c.old as Record<string, unknown>;
  return {};
}

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  pending: 'pending', paid: 'paid', awaiting: 'awaiting', overdue: 'overdue', cancelled: 'cancelled',
};
function paymentStatus(s: unknown): string {
  const key = String(s ?? '');
  return PAYMENT_STATUS_LABELS[key] ?? key;
}
function paymentAmount(row: Record<string, unknown>): unknown {
  return row.amount_net ?? row.amount;
}

const NOUNS: Record<string, string> = { clients: 'client', deals: 'deal', jobs: 'job', leads: 'lead' };
function nounFor(entityType: string): string {
  return NOUNS[entityType] ?? entityType.replace(/s$/, '');
}

/** Turn one activity row into a feed entry: category + summary + detail lines. */
export function describeEvent(row: RawEvent, resolver: Resolver): EventView {
  const category = categoryOf(row.entity_type);
  const cur = currentOf(row.changes);
  const prev = previousOf(row.changes);

  if (category === 'payment') {
    const amount = formatMoney(paymentAmount(cur) ?? paymentAmount(prev));
    if (row.action === 'insert')
      return { category, summary: `Payment of ${amount} created (${paymentStatus(cur.status)})`, lines: [] };
    if (row.action === 'delete')
      return { category, summary: `Payment of ${amount} deleted`, lines: [] };
    const oldStatus = String(prev.status ?? '');
    const newStatus = String(cur.status ?? '');
    if (oldStatus !== newStatus) {
      if (newStatus === 'paid') return { category, summary: `Payment of ${amount} marked paid`, lines: [] };
      if (newStatus === 'pending') return { category, summary: `Payment of ${amount} set back to pending`, lines: [] };
      return { category, summary: `Payment of ${amount} set to ${paymentStatus(newStatus)}`, lines: [] };
    }
    if (JSON.stringify(paymentAmount(prev)) !== JSON.stringify(paymentAmount(cur)))
      return { category, summary: `Payment amount changed ${formatMoney(paymentAmount(prev))} → ${amount}`, lines: [] };
    return { category, summary: `Payment of ${amount} updated`, lines: [] };
  }

  if (category === 'task') {
    const title = String(cur.title ?? prev.title ?? 'task');
    if (row.action === 'insert') return { category, summary: `Task “${title}” created`, lines: [] };
    if (row.action === 'delete') return { category, summary: `Task “${title}” deleted`, lines: [] };
    const becameDone =
      (!prev.completed_at && !!cur.completed_at) ||
      (prev.status !== 'resolved' && cur.status === 'resolved');
    return { category, summary: becameDone ? `Task “${title}” completed` : `Task “${title}” updated`, lines: [] };
  }

  if (category === 'attachment') {
    const file = String(cur.file_name ?? prev.file_name ?? 'file');
    if (row.action === 'insert') return { category, summary: `Uploaded ${file}`, lines: [] };
    if (row.action === 'delete') return { category, summary: `Deleted ${file}`, lines: [] };
    if (!prev.archived && !!cur.archived) return { category, summary: `Removed ${file}`, lines: [] };
    return { category, summary: `Updated ${file}`, lines: [] };
  }

  // Generic: client / deal / job / lead / other — same rendering as ActivityPanel.
  const noun = nounFor(row.entity_type);
  if (row.action === 'insert') {
    const lines = snapshotFields(row.changes).slice(0, 6)
      .map((f) => ({ key: f.field, label: labelFor(f.field), text: formatValue(f.value, f.field, resolver) }))
      .filter((l) => l.text !== '—');
    return { category, summary: `Created the ${noun}`, lines };
  }
  if (row.action === 'delete') return { category, summary: `Deleted the ${noun}`, lines: [] };
  const diffs = diffOf(row.changes);
  if (diffs.length === 0) return { category, summary: `Saved the ${noun} (no changes)`, lines: [] };
  const lines = diffs.slice(0, 12).map((d) => ({
    key: d.field, label: labelFor(d.field),
    text: `${formatValue(d.before, d.field, resolver)} → ${formatValue(d.after, d.field, resolver)}`,
  }));
  return { category, summary: `Updated the ${noun}:`, lines };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/features/activity/format.test.ts`
Expected: PASS (all new + existing tests green).

- [ ] **Step 5: Commit**

```bash
git add src/features/activity/format.ts src/features/activity/format.test.ts
git commit -m "feat(activity): describeEvent renderer for payments/tasks/files/generic"
```

---

## Task 6: Hook — `useClientActivity` (infinite query) + query key

**Files:**
- Modify: `src/lib/queryKeys.ts:24`
- Create: `src/features/activity/hooks/useClientActivity.ts`

- [ ] **Step 1: Add the query key**

In `src/lib/queryKeys.ts`, directly after the existing `activity:` line (24), add:
```ts
  clientActivity: (clientId: string) => ['activity', 'client', clientId] as const,
```

- [ ] **Step 2: Create the hook**

Create `src/features/activity/hooks/useClientActivity.ts`:
```ts
import { useInfiniteQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { ActivityRow } from './useActivityLog';

const PAGE_SIZE = 50;

/** Every activity_log event for a client, newest first, paginated. */
export function useClientActivity(clientId: string) {
  return useInfiniteQuery({
    queryKey: queryKeys.clientActivity(clientId),
    initialPageParam: 0,
    queryFn: async ({ pageParam }): Promise<ActivityRow[]> => {
      const from = (pageParam as number) * PAGE_SIZE;
      const { data, error } = await supabase
        .from('activity_log')
        .select('*, user:profiles!activity_log_user_id_fkey(full_name, email)')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as ActivityRow[];
    },
    getNextPageParam: (lastPage, pages) =>
      lastPage.length === PAGE_SIZE ? pages.length : undefined,
    enabled: !!clientId,
  });
}
```

- [ ] **Step 3: Verify it type-checks**

Run: `npm run build`
Expected: PASS (no TS/eslint errors).

- [ ] **Step 4: Commit**

```bash
git add src/lib/queryKeys.ts src/features/activity/hooks/useClientActivity.ts
git commit -m "feat(activity): useClientActivity infinite-query hook"
```

---

## Task 7: Component — `ClientActivityPanel` (feed + filter chips)

**Files:**
- Create: `src/features/activity/ClientActivityPanel.tsx`

- [ ] **Step 1: Create the component**

Create `src/features/activity/ClientActivityPanel.tsx`:
```tsx
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useClientActivity } from './hooks/useClientActivity';
import { useMentionableUsers } from '@/features/comments/hooks/useMentionableUsers';
import { usePipelineStages } from '@/features/stages/hooks/usePipelineStages';
import { type ActivityCategory, type Resolver, categoryOf, describeActor, describeEvent } from './format';

type FilterKey = 'all' | ActivityCategory;
const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'payment', label: 'Payments' },
  { key: 'email', label: 'Emails' },
  { key: 'job', label: 'Jobs' },
  { key: 'deal', label: 'Deals' },
  { key: 'attachment', label: 'Files' },
  { key: 'task', label: 'Tasks' },
];

export function ClientActivityPanel({ clientId }: { clientId: string }) {
  const { t, i18n } = useTranslation('sales');
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useClientActivity(clientId);
  const { data: users = [] } = useMentionableUsers();
  const { data: stages = [] } = usePipelineStages();
  const [filter, setFilter] = useState<FilterKey>('all');

  const rows = useMemo(() => data?.pages.flat() ?? [], [data]);
  const resolver: Resolver = { stages, users, lang };
  const visible = useMemo(
    () => (filter === 'all' ? rows : rows.filter((r) => categoryOf(r.entity_type) === filter)),
    [rows, filter],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`rounded-full border px-3 py-1 text-xs ${
              filter === f.key ? 'border-primary bg-primary text-primary-foreground' : 'bg-card text-muted-foreground'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('activity.empty')}</p>
      ) : (
        <ul className="space-y-2">
          {visible.map((r) => {
            const who = describeActor(r);
            const when = new Date(r.created_at).toLocaleString('en-GB', {
              day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
            });
            const view = describeEvent(r, resolver);
            return (
              <li key={r.id} className="rounded-md border bg-card p-3 text-sm">
                <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{who}</span>
                  <span>{when}</span>
                </div>
                <div className="mt-1 text-foreground">{view.summary}</div>
                {view.lines.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                    {view.lines.map((l) => (
                      <li key={l.key}>
                        <span className="font-medium text-foreground">{l.label}:</span> {l.text}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {hasNextPage && (
        <Button variant="outline" size="sm" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
          {isFetchingNextPage ? '…' : t('activity.loadMore', 'Load more')}
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify it builds**

Run: `npm run build`
Expected: PASS. (If `Button` import path differs, match the path used elsewhere in `src/features/clients`.)

- [ ] **Step 3: Commit**

```bash
git add src/features/activity/ClientActivityPanel.tsx
git commit -m "feat(activity): ClientActivityPanel unified feed with filter chips"
```

---

## Task 8: Wire into the client page + verify

**Files:**
- Modify: `src/features/clients/ClientDetailPage.tsx:16,148`

- [ ] **Step 1: Swap the panel on the Activity tab**

In `src/features/clients/ClientDetailPage.tsx`, add the import near line 16:
```tsx
import { ClientActivityPanel } from '@/features/activity/ClientActivityPanel';
```
Replace line 148:
```tsx
          <ActivityPanel entityType="clients" entityId={clientId} />
```
with:
```tsx
          <ClientActivityPanel clientId={clientId} />
```
(Leave the existing `ActivityPanel` import — it's still used by deal/job/lead pages. If eslint flags it as unused *in this file*, remove only this file's `ActivityPanel` import.)

- [ ] **Step 2: Full build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Run the unit tests**

Run: `npx vitest run src/features/activity`
Expected: PASS.

- [ ] **Step 4: Live smoke (real client)**

On `www.itdevcrm.com`, open client `AVS-Business…` (deal `000516`) → **Activity** tab. Confirm:
- Events from the client, its deals, and its jobs all appear in one list (not just client-row edits).
- The Task-3 smoke payment update shows as a payment line.
- Filter chips switch the list (Payments / Jobs / Deals / Files / Tasks); Emails is empty (Phase 2).
- "Load more" appears only when >50 events.

- [ ] **Step 5: Commit**

```bash
git add src/features/clients/ClientDetailPage.tsx
git commit -m "feat(activity): client Activity tab shows the full per-client feed"
```

---

## Self-Review (done while writing)

- **Spec coverage:** payments ✓ (Task 3 trigger + Task 5 renderer), jobs ✓ (existing trigger + renderer + chip), deals ✓, attachments ✓ (existing trigger + renderer + backfill), tasks ✓ (Task 3 trigger + renderer). Emails are explicitly Phase 2 — chip/category stubbed. `client_id` single-store + one indexed query ✓ (Tasks 1/6). Actor "System" behavior unchanged ✓. Changes/Revert: every migration carries rollback SQL + backup before backfill ✓.
- **Placeholders:** none — all SQL, TS, and tests are complete.
- **Type consistency:** `describeEvent`/`categoryOf`/`EventView`/`ActivityCategory` names match across Tasks 5 and 7; `ActivityRow` reused from `useActivityLog` in Task 6; `queryKeys.clientActivity` defined (Task 6) and used (hook).
- **Phase 2 follow-up (separate plan):** `email_log` client linkage + columns, `resend-webhook` edge fn (reuse `auth-email` HMAC verifier, `RESEND_WEBHOOK_SECRET`), email→activity funnel trigger, email renderer in `describeEvent`, Resend dashboard config.
