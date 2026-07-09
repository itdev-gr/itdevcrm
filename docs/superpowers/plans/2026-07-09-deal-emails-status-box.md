# Deal Overview Emails Status Box — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a box on the Deal Overview listing the deal's emails (its own + its jobs' + its payments'), color-coded 🟢 delivered / 🟡 sent-not-delivered / 🔴 bounced-or-failed, updating in real time.

**Architecture:** A `security definer` RPC `deal_email_statuses(deal)` reads `email_log` and deal-scopes rows by matching each `dedupe_key`'s trailing UUID to the deal's id / job ids / payment ids. A react-query hook fetches it and live-invalidates via a Supabase Realtime subscription on the (public) `activity_log` filtered by `client_id`. A presentational box renders counts + rows. Mirrors existing patterns: `seo_access_sent_map` RPC and `useJobsForDeal` realtime.

**Tech Stack:** Postgres/Supabase, React + TypeScript, TanStack Query, Supabase Realtime, Vitest + @testing-library/react.

## Global Constraints

- Reuse existing patterns: RPC = mirror `seo_access_sent_map` (`20260702150000`); realtime = mirror `src/features/jobs/hooks/useJobsForDeal.ts:31-46`; template labels = `emailTemplateLabel` in `src/features/activity/format.ts` (export it).
- Do NOT change `email_log` RLS (stays admin-only; RPC is the access path). Do NOT read `email_log` directly from the client.
- Color mapping (from `email_log.status`): `delivered`→green, `sent`→yellow, everything else (`bounced`/`failed`/`complained`/unknown)→red.
- `npm run build` runs `tsc -b` + `eslint --max-warnings=0` + `vite build`; must stay warning-clean. RPC names aren't in generated types → call with `supabase.rpc('name' as never, { … } as never)` (as `useSeoAccessSentMap.ts:16`).
- Migration is applied to prod via the Supabase Management API (project standard) by the main session, with a rolled-back verification first. No local Supabase.

---

### Task 1: Migration — `deal_email_statuses` RPC + `activity_log` realtime

**Files:**
- Create: `supabase/migrations/20260709130000_deal_email_statuses_and_activity_realtime.sql`

**Interfaces:**
- Produces: SQL function `public.deal_email_statuses(p_deal_id uuid)` returning `table(id uuid, to_email text, template_key text, status text, delivered_at timestamptz, bounced_at timestamptz, error text, created_at timestamptz, dedupe_key text)`, ordered `created_at desc`; granted to `authenticated`. Adds `public.activity_log` to `supabase_realtime` publication.

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/20260709130000_deal_email_statuses_and_activity_realtime.sql`:

```sql
-- Deal Overview "Emails" box.
-- (1) deal_email_statuses: emails sent for a deal (its own + its jobs' + its
--     payments'), resolved from email_log (which carries only client_id) by
--     matching each dedupe_key's trailing UUID to the deal.id / job ids /
--     payment ids. security definer because email_log is admin-only RLS.
-- (2) add activity_log (already public: SELECT qual=true) to the realtime
--     publication so the box can live-update from the email mirror.
--
-- ROLLBACK:
--   drop function if exists public.deal_email_statuses(uuid);
--   alter publication supabase_realtime drop table public.activity_log;

create or replace function public.deal_email_statuses(p_deal_id uuid)
returns table (
  id uuid, to_email text, template_key text, status text,
  delivered_at timestamptz, bounced_at timestamptz, error text,
  created_at timestamptz, dedupe_key text
)
language sql
security definer
set search_path = public
stable
as $$
  with d as (select client_id from public.deals where id = p_deal_id),
  ids as (
    select p_deal_id as k
    union all select j.id  from public.jobs j          where j.deal_id  = p_deal_id
    union all select dp.id from public.deal_payments dp where dp.deal_id = p_deal_id
  )
  select e.id, e.to_email, e.template_key, e.status,
         e.delivered_at, e.bounced_at, e.error, e.created_at, e.dedupe_key
  from public.email_log e
  join d on e.client_id = d.client_id
  where e.dedupe_key ~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and (substring(e.dedupe_key from '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))::uuid
        in (select k from ids)
  order by e.created_at desc;
$$;

grant execute on function public.deal_email_statuses(uuid) to authenticated;

alter publication supabase_realtime add table public.activity_log;
```

- [ ] **Step 2: Apply to prod via Management API (main session; needs the sbp token)**

Apply the file's SQL via the Management API query endpoint (as done for prior migrations). Expected: no error.

- [ ] **Step 3: Rolled-back verification on prod (zero footprint)**

Run this DO-block via the Management API; it must raise `VERIFY_OK …` proving deal-scoping (includes deal/job/payment-keyed emails for the deal, excludes a same-client email keyed to a different deal):

```sql
do $v$
declare
  v_client uuid; v_deal uuid; v_other_deal uuid; v_job uuid; v_pay uuid;
  v_sales uuid; v_got int;
begin
  select stage_id into v_sales from public.deals where stage_id is not null limit 1;
  insert into public.clients (name, status) values ('ZZZ_EMAILBOX', 'active') returning id into v_client;
  insert into public.deals (client_id, title, stage_id, code) values (v_client,'ZZZ A',v_sales,'ZZZA') returning id into v_deal;
  insert into public.deals (client_id, title, stage_id, code) values (v_client,'ZZZ B',v_sales,'ZZZB') returning id into v_other_deal;
  insert into public.jobs (deal_id, client_id, service_type, billing_type, status, started_at, code)
    values (v_deal, v_client, 'local_seo','recurring_monthly','active', now(),'ZZZA') returning id into v_job;
  insert into public.deal_payments (deal_id) values (v_deal) returning id into v_pay;
  -- 3 emails that SHOULD match (deal, job, payment) + 1 same-client email for the OTHER deal (should NOT match)
  insert into public.email_log (identity,to_email,template_key,status,client_id,dedupe_key)
  values
    ('accounting','x@y.gr','localseo_gbp_access','delivered', v_client, 'localseo_gbp:'||v_deal),
    ('accounting','x@y.gr','custom','sent',                    v_client, 'job:'||v_job),
    ('accounting','x@y.gr','payment_overdue','bounced',        v_client, 'pay_overdue:'||v_pay),
    ('accounting','x@y.gr','localseo_gbp_access','delivered',  v_client, 'localseo_gbp:'||v_other_deal);
  select count(*) into v_got from public.deal_email_statuses(v_deal);
  raise exception 'VERIFY_OK matched=% (expect 3)', v_got;
end $v$;
```

Expected message: `VERIFY_OK matched=3 (expect 3)`.

- [ ] **Step 4: Confirm publication membership**

Run: `select tablename from pg_publication_tables where pubname='supabase_realtime' and tablename='activity_log';`
Expected: one row (`activity_log`).

- [ ] **Step 5: Commit the migration file**

```bash
git add supabase/migrations/20260709130000_deal_email_statuses_and_activity_realtime.sql
git commit -m "feat(db): deal_email_statuses RPC + activity_log realtime for deal emails box"
```

---

### Task 2: `emailStatusColor` pure helpers + tests

**Files:**
- Create: `src/features/deals/emailStatusColor.ts`
- Test: `src/features/deals/emailStatusColor.test.ts`

**Interfaces:**
- Produces: `type EmailColor = 'green'|'yellow'|'red'`; `emailStatusColor(status: string): EmailColor`; `summarizeEmailStatuses(rows: ReadonlyArray<{status:string}>): { green:number; yellow:number; red:number; total:number }`.

- [ ] **Step 1: Write the failing test**

Create `src/features/deals/emailStatusColor.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { emailStatusColor, summarizeEmailStatuses } from './emailStatusColor';

describe('emailStatusColor', () => {
  it('delivered -> green', () => expect(emailStatusColor('delivered')).toBe('green'));
  it('sent -> yellow', () => expect(emailStatusColor('sent')).toBe('yellow'));
  it('bounced/failed/complained/unknown -> red', () => {
    expect(emailStatusColor('bounced')).toBe('red');
    expect(emailStatusColor('failed')).toBe('red');
    expect(emailStatusColor('complained')).toBe('red');
    expect(emailStatusColor('anything')).toBe('red');
  });
});

describe('summarizeEmailStatuses', () => {
  it('counts a mixed set', () => {
    expect(
      summarizeEmailStatuses([
        { status: 'delivered' }, { status: 'delivered' },
        { status: 'sent' }, { status: 'bounced' }, { status: 'failed' },
      ]),
    ).toEqual({ green: 2, yellow: 1, red: 2, total: 5 });
  });
  it('handles empty', () =>
    expect(summarizeEmailStatuses([])).toEqual({ green: 0, yellow: 0, red: 0, total: 0 }));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/features/deals/emailStatusColor.test.ts`
Expected: FAIL — cannot resolve `./emailStatusColor`.

- [ ] **Step 3: Implement**

Create `src/features/deals/emailStatusColor.ts`:

```ts
export type EmailColor = 'green' | 'yellow' | 'red';

/** email_log.status -> traffic-light color. delivered = green,
 *  sent (awaiting delivery) = yellow, everything else
 *  (bounced/failed/complained/unknown) = red. */
export function emailStatusColor(status: string): EmailColor {
  if (status === 'delivered') return 'green';
  if (status === 'sent') return 'yellow';
  return 'red';
}

export function summarizeEmailStatuses(
  rows: ReadonlyArray<{ status: string }>,
): { green: number; yellow: number; red: number; total: number } {
  const s = { green: 0, yellow: 0, red: 0, total: rows.length };
  for (const r of rows) s[emailStatusColor(r.status)] += 1;
  return s;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/features/deals/emailStatusColor.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/deals/emailStatusColor.ts src/features/deals/emailStatusColor.test.ts
git commit -m "feat(deals): email status -> traffic-light color helpers"
```

---

### Task 3: `useDealEmails` hook (RPC + realtime) + query key

**Files:**
- Create: `src/features/deals/hooks/useDealEmails.ts`
- Modify: `src/lib/queryKeys.ts` (add one key)

**Interfaces:**
- Consumes: RPC `deal_email_statuses` (Task 1); `queryKeys.dealEmails` (added here).
- Produces: `type DealEmailRow = { id:string; to_email:string; template_key:string; status:string; delivered_at:string|null; bounced_at:string|null; error:string|null; created_at:string; dedupe_key:string }`; `useDealEmails(dealId: string, clientId: string | null | undefined)` → TanStack `UseQueryResult<DealEmailRow[]>`.

- [ ] **Step 1: Add the query key**

In `src/lib/queryKeys.ts`, add inside the `queryKeys` object (next to `deal`):

```ts
  dealEmails: (dealId: string) => ['deal-emails', dealId] as const,
```

- [ ] **Step 2: Create the hook**

Create `src/features/deals/hooks/useDealEmails.ts`:

```ts
import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export type DealEmailRow = {
  id: string;
  to_email: string;
  template_key: string;
  status: string;
  delivered_at: string | null;
  bounced_at: string | null;
  error: string | null;
  created_at: string;
  dedupe_key: string;
};

/** Emails sent for a deal (its own + its jobs' + its payments'), newest first,
 *  via the deal_email_statuses RPC. Live-updates by subscribing to the client's
 *  public activity_log, which mirrors every email_log insert/delivery/bounce. */
export function useDealEmails(dealId: string, clientId: string | null | undefined) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.dealEmails(dealId),
    enabled: !!dealId,
    staleTime: 30_000,
    queryFn: async (): Promise<DealEmailRow[]> => {
      // RPC not in generated types; cast the name + args.
      const { data, error } = await supabase.rpc(
        'deal_email_statuses' as never,
        { p_deal_id: dealId } as never,
      );
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as DealEmailRow[];
    },
  });

  useEffect(() => {
    if (!dealId || !clientId) return;
    const channel = supabase
      .channel(`deal-emails-${dealId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'activity_log', filter: `client_id=eq.${clientId}` },
        (payload) => {
          const nt = (payload.new as { entity_type?: string } | null)?.entity_type;
          const ot = (payload.old as { entity_type?: string } | null)?.entity_type;
          if (nt === 'email_log' || ot === 'email_log') {
            void qc.invalidateQueries({ queryKey: queryKeys.dealEmails(dealId) });
          }
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [dealId, clientId, qc]);

  return query;
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc -b --pretty false 2>&1 | head -20`
Expected: no errors referencing `useDealEmails.ts` or `queryKeys.ts`. (Full lint runs in Task 5's build.)

- [ ] **Step 4: Commit**

```bash
git add src/features/deals/hooks/useDealEmails.ts src/lib/queryKeys.ts
git commit -m "feat(deals): useDealEmails hook — RPC fetch + activity_log realtime"
```

---

### Task 4: `DealEmailsBox` component + test (+ export `emailTemplateLabel`)

**Files:**
- Modify: `src/features/activity/format.ts` (export `emailTemplateLabel`)
- Create: `src/features/deals/DealEmailsBox.tsx`
- Test: `src/features/deals/DealEmailsBox.test.tsx`

**Interfaces:**
- Consumes: `useDealEmails` + `DealEmailRow` (Task 3); `emailStatusColor` + `summarizeEmailStatuses` (Task 2); `emailTemplateLabel` (format.ts); `relativeFromNow` (`@/lib/datetime`).
- Produces: `DealEmailsBox({ dealId: string; clientId: string | null })`.

- [ ] **Step 1: Export `emailTemplateLabel`**

In `src/features/activity/format.ts`, change the declaration:

```ts
export function emailTemplateLabel(key: string): string {
```

(It currently reads `function emailTemplateLabel(key: string): string {`.)

- [ ] **Step 2: Write the failing component test**

Create `src/features/deals/DealEmailsBox.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { DealEmailRow } from './hooks/useDealEmails';

const ref: { rows: DealEmailRow[]; isLoading: boolean } = { rows: [], isLoading: false };
vi.mock('./hooks/useDealEmails', () => ({
  useDealEmails: () => ({ data: ref.rows, isLoading: ref.isLoading }),
}));

import { DealEmailsBox } from './DealEmailsBox';

function row(p: Partial<DealEmailRow>): DealEmailRow {
  return {
    id: p.id ?? 'e1',
    to_email: p.to_email ?? 'a@b.gr',
    template_key: p.template_key ?? 'localseo_gbp_access',
    status: p.status ?? 'delivered',
    delivered_at: p.delivered_at ?? null,
    bounced_at: p.bounced_at ?? null,
    error: p.error ?? null,
    created_at: p.created_at ?? '2026-07-09T00:00:00Z',
    dedupe_key: p.dedupe_key ?? 'localseo_gbp:d',
  };
}

describe('DealEmailsBox', () => {
  beforeEach(() => { ref.rows = []; ref.isLoading = false; });

  it('shows the count header, per-email rows, and one dot per status color', () => {
    ref.rows = [
      row({ id: 'e1', status: 'delivered', template_key: 'localseo_gbp_access', to_email: 'x@y.gr' }),
      row({ id: 'e2', status: 'sent', template_key: 'webseo_gsc_access' }),
      row({ id: 'e3', status: 'bounced', template_key: 'payment_overdue' }),
    ];
    const { container } = render(<DealEmailsBox dealId="d1" clientId="c1" />);
    expect(screen.getByText('Emails (3)')).toBeInTheDocument();
    expect(screen.getByText('Local SEO – GBP access request')).toBeInTheDocument();
    expect(screen.getByText('x@y.gr')).toBeInTheDocument();
    expect(container.querySelectorAll('.bg-emerald-500').length).toBeGreaterThanOrEqual(1);
    expect(container.querySelectorAll('.bg-amber-400').length).toBeGreaterThanOrEqual(1);
    expect(container.querySelectorAll('.bg-red-500').length).toBeGreaterThanOrEqual(1);
  });

  it('renders the empty state when there are no emails', () => {
    ref.rows = [];
    render(<DealEmailsBox dealId="d1" clientId="c1" />);
    expect(screen.getByText(/no emails sent for this deal yet/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run src/features/deals/DealEmailsBox.test.tsx`
Expected: FAIL — cannot resolve `./DealEmailsBox`.

- [ ] **Step 4: Implement the component**

Create `src/features/deals/DealEmailsBox.tsx`:

```tsx
import { relativeFromNow } from '@/lib/datetime';
import { emailTemplateLabel } from '@/features/activity/format';
import { useDealEmails } from './hooks/useDealEmails';
import { emailStatusColor, summarizeEmailStatuses, type EmailColor } from './emailStatusColor';

const DOT: Record<EmailColor, string> = {
  green: 'bg-emerald-500',
  yellow: 'bg-amber-400',
  red: 'bg-red-500',
};

export function DealEmailsBox({ dealId, clientId }: { dealId: string; clientId: string | null }) {
  const { data: rows = [], isLoading } = useDealEmails(dealId, clientId);
  const counts = summarizeEmailStatuses(rows);

  return (
    <div className="rounded-xl border border-border/60 bg-card p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Emails ({counts.total})</h3>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" />{counts.green}</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-400" />{counts.yellow}</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-500" />{counts.red}</span>
        </div>
      </div>
      {isLoading ? (
        <p className="text-xs text-muted-foreground">…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No emails sent for this deal yet.</p>
      ) : (
        <ul className="divide-y divide-border/60">
          {rows.map((r) => {
            const color = emailStatusColor(r.status);
            const failed = color === 'red';
            return (
              <li
                key={r.id}
                className="flex items-center gap-2 py-1.5"
                title={failed && r.error ? r.error : undefined}
              >
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${DOT[color]}`} />
                <span className="truncate text-sm">{emailTemplateLabel(r.template_key)}</span>
                <span className="truncate text-xs text-muted-foreground">{r.to_email}</span>
                <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                  {relativeFromNow(r.delivered_at ?? r.bounced_at ?? r.created_at)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/features/deals/DealEmailsBox.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/features/activity/format.ts src/features/deals/DealEmailsBox.tsx src/features/deals/DealEmailsBox.test.tsx
git commit -m "feat(deals): DealEmailsBox — 3-color email status list"
```

---

### Task 5: Wire into the Deal Overview

**Files:**
- Modify: `src/features/deals/DealDetailPage.tsx` (import + render under `<DealForm>`)

**Interfaces:**
- Consumes: `DealEmailsBox` (Task 4). `deal.id` and `deal.client_id` are in scope on the page.

- [ ] **Step 1: Add the import**

In `src/features/deals/DealDetailPage.tsx`, near the other `./` imports (e.g. after `import { DealForm } from './DealForm';` at line 11):

```tsx
import { DealEmailsBox } from './DealEmailsBox';
```

- [ ] **Step 2: Render the box under the Deal summary**

In the Overview left column, immediately after the `<DealForm initial={deal} />` line (~line 332), add:

```tsx
            <DealEmailsBox dealId={deal.id} clientId={deal.client_id} />
```

(It becomes the second child of the left `space-y-3` stack, directly below the Deal summary box.)

- [ ] **Step 3: Build (tsc + eslint + vite)**

Run: `npm run build`
Expected: exit 0, zero warnings/errors (chunk-size advisory is fine).

- [ ] **Step 4: Regression — deals + activity test files**

Run: `npx vitest run src/features/deals src/features/activity`
Expected: PASS (no regressions from the `format.ts` export change).

- [ ] **Step 5: Commit**

```bash
git add src/features/deals/DealDetailPage.tsx
git commit -m "feat(deals): show emails status box on deal Overview"
```

---

## Changes / Revert

**Changes:** one migration (`deal_email_statuses` RPC + `activity_log` → realtime publication, applied to prod); new files `emailStatusColor.ts`, `hooks/useDealEmails.ts`, `DealEmailsBox.tsx` (+ tests); `queryKeys.dealEmails`; export `emailTemplateLabel`; wire into `DealDetailPage.tsx`.

**Revert:**
- DB: `drop function if exists public.deal_email_statuses(uuid);` and `alter publication supabase_realtime drop table public.activity_log;`
- Code: `git revert` the frontend commits (or delete the new files + undo the `DealDetailPage.tsx`, `queryKeys.ts`, `format.ts` edits).
- No data mutated; fully reversible.

## Self-Review

- **Spec coverage:** box on Overview next to Deal ✅ (Task 5); 3 colors green/yellow/red ✅ (Task 2 + Task 4); includes jobs' + payments' emails via deal-scoped RPC ✅ (Task 1); real time ✅ (Task 3 realtime + Task 1 publication); build-on-existing (RPC/realtime/label reuse) ✅; empty/loading ✅ (Task 4); tests for colors, counts, rows, empty, and rolled-back RPC deal-scoping ✅.
- **Placeholder scan:** none — every step has full code + exact commands.
- **Type consistency:** `DealEmailRow` (with `error`) defined in Task 3 is used identically in Task 4; RPC return columns in Task 1 match `DealEmailRow`; `EmailColor`/`emailStatusColor`/`summarizeEmailStatuses` consistent across Tasks 2/4; `queryKeys.dealEmails` defined in Task 3 used by the hook; `useDealEmails(dealId, clientId)` signature consistent Task 3↔4↔5.
