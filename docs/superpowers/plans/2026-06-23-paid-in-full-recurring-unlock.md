# Paid In Full — living paid-up state + recurring unlock — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the accounting "Paid In Full" column the steady home for every paid-up client — spawning jobs for a new deal and unlocking frozen jobs for an existing one — with the money (payment status) driving the board automatically.

**Architecture:** One atomic Postgres migration (applied via the Supabase MCP `apply_migration`) makes `paid_in_full` non-terminal, adds an `accounting_mark_paid_in_full` RPC that branches on "does the deal already have jobs?", adds an auto-return trigger on `deal_payments`, relaxes the overdue→On-Hold cron, and runs a one-time backlog sweep. A small frontend change points the kanban's drag-to-Paid-In-Full at the new RPC.

**Tech Stack:** Postgres (Supabase, security-definer functions + triggers, pg_cron), React + TypeScript, @tanstack/react-query, vitest. DDL is applied to prod through the Supabase MCP server (Bash/curl are blocked for DDL by the safety classifier); reads/verification use the MCP `execute_sql`.

**Spec:** `docs/superpowers/specs/2026-06-23-paid-in-full-recurring-unlock-design.md`

---

## File structure

- **Create** `supabase/migrations/20260623130000_paid_in_full_recurring_unlock.sql` — the whole DB change (Changes A–E) + in-file rollback. (Bump the timestamp if it collides with an existing `20260623*` migration; keep it lexically last.)
- **Modify** `src/lib/rpc.ts` — add `markPaidInFull()` wrapper + result type.
- **Create** `src/features/accounting/hooks/useMarkPaidInFull.ts` — react-query mutation.
- **Create** `src/features/accounting/hooks/useMarkPaidInFull.test.tsx` — hook test.
- **Modify** `src/features/accounting/AccountingOnboardingKanbanPage.tsx` — drag-to-Paid-In-Full calls the new hook.
- **Modify** `src/i18n/locales/en/accounting.json` + `src/i18n/locales/el/accounting.json` — one new error key.
- **Regenerate** `src/types/supabase.ts` — so the new RPC name is typed.

---

## Task 1: Author the migration (Changes A–E)

**Files:**
- Create: `supabase/migrations/20260623130000_paid_in_full_recurring_unlock.sql`

This task only writes the file; Task 2 applies and verifies it.

- [ ] **Step 1: Create the file with a header + Change A (make `paid_in_full` non-terminal)**

```sql
-- =============================================================================
-- Paid In Full becomes the living "paid-up" resting state + recurring unlock.
-- Spec: docs/superpowers/specs/2026-06-23-paid-in-full-recurring-unlock-design.md
--
--  A. paid_in_full -> non-terminal (done/closed stay terminal).
--  B. accounting_mark_paid_in_full(): drag works both ways (spawn OR unlock).
--  C. deal_payments_release_from_on_hold(): paid -> auto-return + unlock.
--  D. move_overdue_deals_to_on_hold(): also sweep onboarded recurring deals.
--  E. one-time backlog sweep of paid-up On-Hold deals (+ backup table).
-- =============================================================================

-- ── A. paid_in_full is a resting state, not a dead-end ───────────────────────
update public.pipeline_stages
   set is_terminal = false
 where board = 'accounting_onboarding' and code = 'paid_in_full';

-- Safety: done + closed MUST stay terminal so the cron sweep never touches a
-- finished client. (No-op if already true; documents the invariant.)
update public.pipeline_stages
   set is_terminal = true
 where board = 'accounting_onboarding' and code in ('done', 'closed');
```

- [ ] **Step 2: Append Change B — the `accounting_mark_paid_in_full` RPC**

```sql
-- ── B. Drag to Paid In Full, both ways ───────────────────────────────────────
-- Existing client (already has jobs, or already onboarded): move the card to
-- paid_in_full and let the deals_hold_jobs_on_stage_change trigger release the
-- account_on_hold holds. Fresh client (no jobs): delegate to complete_accounting,
-- which spawns jobs from services_planned (unchanged behavior).
create or replace function public.accounting_mark_paid_in_full(target_deal_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  d record;
  paid_stage_id uuid;
  has_jobs boolean;
begin
  if not (public.current_user_is_admin()
          or public.current_user_can('accounting_onboarding', 'complete_accounting')) then
    return jsonb_build_object('ok', false, 'errors', array['permission_denied']);
  end if;

  select * into d from public.deals where id = target_deal_id;
  if d is null then
    return jsonb_build_object('ok', false, 'errors', array['deal_not_found']);
  end if;

  select exists (
    select 1 from public.jobs j where j.deal_id = d.id and not j.archived
  ) into has_jobs;

  if has_jobs or d.accounting_completed_at is not null then
    -- Established client: just move + unlock (no spawning).
    select id into paid_stage_id from public.pipeline_stages
      where board = 'accounting_onboarding' and code = 'paid_in_full' limit 1;

    update public.deals
       set accounting_stage_id    = coalesce(paid_stage_id, accounting_stage_id),
           accounting_completed_at = coalesce(accounting_completed_at, now()),
           accounting_completed_by = coalesce(accounting_completed_by, auth.uid())
     where id = d.id;

    return jsonb_build_object('ok', true, 'deal_id', d.id, 'mode', 'unlocked');
  end if;

  -- Fresh onboarding: spawn jobs the normal way (returns its own ok/errors jsonb).
  return public.complete_accounting(target_deal_id);
end $$;

grant execute on function public.accounting_mark_paid_in_full(uuid) to authenticated;
```

- [ ] **Step 3: Append Change C — the auto-return trigger on `deal_payments`**

```sql
-- ── C. Money drives the board: paid -> auto-return from On Hold + unlock ──────
create or replace function public.deal_payments_release_from_on_hold()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  on_hold_id   uuid;
  paid_stage_id uuid;
  cur_stage_id uuid;
  still_owes   boolean;
begin
  -- Only act when a payment newly becomes paid.
  if new.status <> 'paid' or old.status is not distinct from 'paid' then
    return new;
  end if;

  select accounting_stage_id into cur_stage_id
    from public.deals where id = new.deal_id;
  if cur_stage_id is null then
    return new;
  end if;

  select id into on_hold_id from public.pipeline_stages
    where board = 'accounting_onboarding' and code = 'on_hold' limit 1;
  if on_hold_id is null or cur_stage_id <> on_hold_id then
    return new;  -- only rescue deals that are currently On Hold
  end if;

  -- Caught up only when NO past-due unpaid payment remains.
  select exists (
    select 1 from public.deal_payments dp
     where dp.deal_id = new.deal_id
       and dp.status <> 'paid'
       and dp.billing_type <> 'recurring_test_2min'
       and dp.end_date is not null
       and dp.end_date <= current_date
  ) into still_owes;
  if still_owes then
    return new;
  end if;

  select id into paid_stage_id from public.pipeline_stages
    where board = 'accounting_onboarding' and code = 'paid_in_full' limit 1;
  if paid_stage_id is null then
    return new;
  end if;

  update public.deals
     set accounting_stage_id = paid_stage_id
   where id = new.deal_id;
  -- deals_hold_jobs_on_stage_change releases the account_on_hold holds.
  return new;
end $$;

drop trigger if exists deal_payments_release_from_on_hold on public.deal_payments;
create trigger deal_payments_release_from_on_hold
  after update on public.deal_payments
  for each row execute function public.deal_payments_release_from_on_hold();
```

- [ ] **Step 4: Append Change D — overdue cron sees onboarded recurring deals**

This re-creates `move_overdue_deals_to_on_hold()` exactly as in migration `20260619110000` **except** the `and d.accounting_completed_at is null` line is removed. Keep the terminal/`closed` exclusion.

```sql
-- ── D. Overdue cron: also drop onboarded recurring deals to On Hold ───────────
create or replace function public.move_overdue_deals_to_on_hold()
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare
  on_hold_id uuid;
  moved int := 0;
begin
  select id into on_hold_id
    from public.pipeline_stages
   where board = 'accounting_onboarding' and code = 'on_hold'
   limit 1;
  if on_hold_id is null then
    return 0;
  end if;

  with overdue_deals as (
    select distinct dp.deal_id
      from public.deal_payments dp
     where dp.billing_type in ('one_time','recurring_monthly','recurring_yearly')
       and dp.status = 'pending'
       and dp.end_date is not null
       and dp.end_date <= current_date
  )
  update public.deals d
     set accounting_stage_id = on_hold_id
    from overdue_deals od
   where d.id = od.deal_id
     and d.accounting_stage_id is not null
     and d.accounting_stage_id <> on_hold_id
     and not exists (
       select 1 from public.pipeline_stages ps
        where ps.id = d.accounting_stage_id
          and (ps.is_terminal = true or ps.code = 'closed')  -- never re-hold done/closed
     );
  get diagnostics moved = row_count;
  return moved;
end $function$;
```

- [ ] **Step 5: Append Change E — one-time backlog sweep + backup, and the rollback notes**

```sql
-- ── E. One-time sweep: paid-up On-Hold deals -> Paid In Full + unlock ─────────
-- Backup the deals we are about to move (id + their current On-Hold stage).
create table if not exists public.deals_onhold_sweep_backup_20260623 as
select d.id as deal_id, d.accounting_stage_id as prev_stage_id, now() as backed_up_at
  from public.deals d
  join public.pipeline_stages ps
    on ps.id = d.accounting_stage_id
   and ps.board = 'accounting_onboarding' and ps.code = 'on_hold'
 where not exists (
   select 1 from public.deal_payments dp
    where dp.deal_id = d.id
      and dp.status <> 'paid'
      and dp.billing_type <> 'recurring_test_2min'
      and dp.end_date is not null
      and dp.end_date <= current_date
 );

-- Move them (fires deals_hold_jobs_on_stage_change -> releases account_on_hold).
update public.deals d
   set accounting_stage_id = (
        select id from public.pipeline_stages
         where board = 'accounting_onboarding' and code = 'paid_in_full' limit 1)
 where d.id in (select deal_id from public.deals_onhold_sweep_backup_20260623);

-- Belt-and-braces: ensure those deals' SEO jobs are unlocked.
update public.jobs j
   set is_blocked = false, blocked_reason = null, blocked_at = null
 where j.blocked_reason = 'account_on_hold'
   and j.deal_id in (select deal_id from public.deals_onhold_sweep_backup_20260623);

-- =============================================================================
-- CHANGES / REVERT
--   A. pipeline_stages('paid_in_full').is_terminal  true -> false
--   B. + function accounting_mark_paid_in_full(uuid)
--   C. + function/trigger deal_payments_release_from_on_hold
--   D. move_overdue_deals_to_on_hold() : dropped `accounting_completed_at is null`
--   E. one-time sweep + deals_onhold_sweep_backup_20260623
--
-- ROLLBACK:
--   update public.pipeline_stages set is_terminal = true
--     where board='accounting_onboarding' and code='paid_in_full';
--   drop function if exists public.accounting_mark_paid_in_full(uuid);
--   drop trigger if exists deal_payments_release_from_on_hold on public.deal_payments;
--   drop function if exists public.deal_payments_release_from_on_hold();
--   -- restore move_overdue_deals_to_on_hold() body from migration 20260619110000
--   --   (re-add the `and d.accounting_completed_at is null` clause);
--   -- re-hold swept deals: move each back to its prev_stage_id from
--   --   deals_onhold_sweep_backup_20260623 (the hold trigger re-blocks SEO jobs).
-- =============================================================================
```

- [ ] **Step 6: Commit the migration file**

```bash
git add supabase/migrations/20260623130000_paid_in_full_recurring_unlock.sql
git commit -m "feat(accounting): migration — Paid In Full living state, auto-return + recurring unlock"
```

---

## Task 2: Apply the migration + verify each change

**Files:** none (uses the Supabase MCP).

- [ ] **Step 1: Apply the migration via the Supabase MCP**

Use the MCP tool `mcp__plugin_supabase__apply_migration` with `name: "paid_in_full_recurring_unlock"` and `query:` = the full contents of `supabase/migrations/20260623130000_paid_in_full_recurring_unlock.sql`.
Expected: success (no error). If the MCP is disconnected, run `/mcp` to reconnect first (Bash/curl are blocked for DDL).

- [ ] **Step 2: Verify Change A — terminal flags**

Run via `mcp__plugin_supabase__execute_sql`:

```sql
select code, is_terminal from public.pipeline_stages
 where board='accounting_onboarding' and code in ('paid_in_full','done','closed')
 order by code;
```
Expected: `closed → true`, `done → true`, `paid_in_full → false`.

- [ ] **Step 3: Verify Changes B, C, D exist**

```sql
select proname from pg_proc
 where proname in ('accounting_mark_paid_in_full','deal_payments_release_from_on_hold')
 order by proname;
select tgname from pg_trigger where tgname = 'deal_payments_release_from_on_hold';
select pg_get_functiondef('public.move_overdue_deals_to_on_hold'::regproc) like '%accounting_completed_at is null%' as still_has_completed_guard;
```
Expected: both functions listed; the trigger listed; `still_has_completed_guard → false`.

- [ ] **Step 4: Verify Change E — the sweep ran**

```sql
select count(*) as swept from public.deals_onhold_sweep_backup_20260623;
select count(*) as still_blocked_for_swept
  from public.jobs j
 where j.blocked_reason = 'account_on_hold'
   and j.deal_id in (select deal_id from public.deals_onhold_sweep_backup_20260623);
```
Expected: `swept ≥ 0` (the count of paid-up On-Hold deals at apply time); `still_blocked_for_swept → 0`.

---

## Task 3: Regenerate Supabase types so the new RPC is typed

**Files:**
- Modify: `src/types/supabase.ts` (generated)

- [ ] **Step 1: Regenerate types**

Use the MCP tool `mcp__plugin_supabase__generate_typescript_types` and overwrite `src/types/supabase.ts` with the result. (If unavailable, hand-add an `accounting_mark_paid_in_full` entry to the `Functions` block mirroring `complete_accounting`: `Args: { target_deal_id: string }`, `Returns: Json`.)

- [ ] **Step 2: Verify the type is present**

Run: `grep -n "accounting_mark_paid_in_full" src/types/supabase.ts`
Expected: at least one match under the `Functions` block.

- [ ] **Step 3: Commit**

```bash
git add src/types/supabase.ts
git commit -m "chore(types): regenerate supabase types for accounting_mark_paid_in_full"
```

---

## Task 4: Add the `markPaidInFull` RPC wrapper

**Files:**
- Modify: `src/lib/rpc.ts`

- [ ] **Step 1: Add the wrapper + result type**

Append to `src/lib/rpc.ts` (it already imports `supabase` and uses the same `supabase.rpc(...)` pattern as `completeAccounting`):

```typescript
export type MarkPaidInFullResult =
  | { ok: true; deal_id: string; mode?: 'unlocked' | 'spawned' }
  | { ok: false; errors: string[] };

export async function markPaidInFull(dealId: string): Promise<MarkPaidInFullResult> {
  const { data, error } = await supabase.rpc('accounting_mark_paid_in_full', {
    target_deal_id: dealId,
  });
  if (error) {
    return { ok: false, errors: [error.message] };
  }
  return data as MarkPaidInFullResult;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors referencing `rpc.ts` or `accounting_mark_paid_in_full`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/rpc.ts
git commit -m "feat(accounting): markPaidInFull rpc wrapper"
```

---

## Task 5: Add the `useMarkPaidInFull` hook (TDD)

**Files:**
- Create: `src/features/accounting/hooks/useMarkPaidInFull.ts`
- Test: `src/features/accounting/hooks/useMarkPaidInFull.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/features/accounting/hooks/useMarkPaidInFull.test.tsx` (mirrors `useMoveAccountingStage.test.tsx`, but mocks the rpc wrapper):

```tsx
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { markPaidInFull } = vi.hoisted(() => ({ markPaidInFull: vi.fn() }));

vi.mock('@/lib/rpc', () => ({ markPaidInFull }));
vi.mock('@/lib/sentry/captureMutation', () => ({
  captureMutation: (_s: string, _o: string, fn: (...a: unknown[]) => unknown) => fn,
}));

import { useMarkPaidInFull } from './useMarkPaidInFull';
import { queryKeys } from '@/lib/queryKeys';

function wrap(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe('useMarkPaidInFull', () => {
  beforeEach(() => markPaidInFull.mockReset());

  it('invalidates accountingDeals, deal and clients on success', async () => {
    markPaidInFull.mockResolvedValue({ ok: true, deal_id: 'deal-1', mode: 'unlocked' });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useMarkPaidInFull(), { wrapper: wrap(qc) });
    await result.current.mutateAsync('deal-1');

    await waitFor(() => {
      const keys = invalidate.mock.calls.map((c) => (c[0] as { queryKey: readonly unknown[] }).queryKey);
      expect(keys).toContainEqual(queryKeys.accountingDeals());
      expect(keys).toContainEqual(queryKeys.deal('deal-1'));
      expect(keys).toContainEqual(queryKeys.clients());
    });
  });

  it('throws with .errors when the rpc returns ok:false', async () => {
    markPaidInFull.mockResolvedValue({ ok: false, errors: ['services_planned_empty'] });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useMarkPaidInFull(), { wrapper: wrap(qc) });

    await expect(result.current.mutateAsync('deal-1')).rejects.toMatchObject({
      errors: ['services_planned_empty'],
    });
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx vitest run src/features/accounting/hooks/useMarkPaidInFull.test.tsx`
Expected: FAIL — `Cannot find module './useMarkPaidInFull'`.

- [ ] **Step 3: Implement the hook**

Create `src/features/accounting/hooks/useMarkPaidInFull.ts`:

```typescript
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { markPaidInFull } from '@/lib/rpc';
import { queryKeys } from '@/lib/queryKeys';
import { captureMutation } from '@/lib/sentry/captureMutation';

export function useMarkPaidInFull() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: captureMutation('accounting', 'mark_paid_in_full', async (dealId: string) => {
      const result = await markPaidInFull(dealId);
      if (!result.ok) {
        const err = new Error(result.errors[0] ?? 'mark_paid_failed');
        (err as Error & { errors?: string[] }).errors = result.errors;
        throw err;
      }
      return result.deal_id;
    }),
    onSuccess: (_dealId, dealId) => {
      void qc.invalidateQueries({ queryKey: queryKeys.accountingDeals() });
      void qc.invalidateQueries({ queryKey: queryKeys.deal(dealId) });
      void qc.invalidateQueries({ queryKey: queryKeys.clients() });
      void qc.invalidateQueries({ queryKey: ['jobs'] });
    },
  });
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx vitest run src/features/accounting/hooks/useMarkPaidInFull.test.tsx`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add src/features/accounting/hooks/useMarkPaidInFull.ts src/features/accounting/hooks/useMarkPaidInFull.test.tsx
git commit -m "feat(accounting): useMarkPaidInFull hook"
```

---

## Task 6: Wire the kanban drag + i18n

**Files:**
- Modify: `src/features/accounting/AccountingOnboardingKanbanPage.tsx`
- Modify: `src/i18n/locales/en/accounting.json`, `src/i18n/locales/el/accounting.json`

- [ ] **Step 1: Add the `deal_not_found` error key (en)**

In `src/i18n/locales/en/accounting.json`, inside `complete.errors`, add the key (after `invalid_one_time_value`):

```json
      "invalid_one_time_value": "Invalid one-time value.",
      "deal_not_found": "Deal not found."
```

- [ ] **Step 2: Add the `deal_not_found` error key (el)**

In `src/i18n/locales/el/accounting.json`, inside `complete.errors`, add the matching key:

```json
      "deal_not_found": "Δεν βρέθηκε η συμφωνία."
```
(Place it after the existing `invalid_one_time_value` entry; add the trailing comma to the line above as needed.)

- [ ] **Step 3: Swap the hook in the kanban page**

In `src/features/accounting/AccountingOnboardingKanbanPage.tsx`:

Replace the import line
```tsx
import { useCompleteAccounting } from './hooks/useCompleteAccounting';
```
with
```tsx
import { useMarkPaidInFull } from './hooks/useMarkPaidInFull';
```

Replace the hook instantiation
```tsx
  const complete = useCompleteAccounting();
```
with
```tsx
  const markPaid = useMarkPaidInFull();
```

In `onDragEnd`, replace the Paid-In-Full branch
```tsx
    if (paidStage && stageId === paidStage.id) {
      try {
        await complete.mutateAsync(dealId);
      } catch (err) {
        const errors = (err as Error & { errors?: string[] }).errors ?? [(err as Error).message];
        alert(errors.map((er) => t(`complete.errors.${er}`, { defaultValue: er })).join('\n'));
      }
    } else {
```
with
```tsx
    if (paidStage && stageId === paidStage.id) {
      try {
        await markPaid.mutateAsync(dealId);
      } catch (err) {
        const errors = (err as Error & { errors?: string[] }).errors ?? [(err as Error).message];
        alert(errors.map((er) => t(`complete.errors.${er}`, { defaultValue: er })).join('\n'));
      }
    } else {
```

- [ ] **Step 4: Typecheck, lint, run the related tests**

Run: `npx tsc --noEmit && npx eslint src/features/accounting/AccountingOnboardingKanbanPage.tsx src/features/accounting/hooks/useMarkPaidInFull.ts && npx vitest run src/features/accounting`
Expected: no type errors, no lint errors, all accounting tests PASS. (If `useCompleteAccounting` is now unused project-wide, `tsc`/eslint will flag the leftover file import — it is no longer imported here; the hook file itself can stay for reference since nothing imports it, or delete it if lint complains about an unused export elsewhere.)

- [ ] **Step 5: Commit**

```bash
git add src/features/accounting/AccountingOnboardingKanbanPage.tsx src/i18n/locales/en/accounting.json src/i18n/locales/el/accounting.json
git commit -m "feat(accounting): drag to Paid In Full unlocks existing clients (both ways)"
```

---

## Task 7: Full build + live smoke test

**Files:** none.

- [ ] **Step 1: Full verification build**

Run: `npm run build && npx vitest run`
Expected: build succeeds; full test suite passes.

- [ ] **Step 2: Live smoke — existing client unlock (manual, in the app)**

As an accounting/admin user (e.g. `info@itdev.gr`):
1. Find a deal that has jobs and is in **On Hold** (or drag one there).
2. Open the deal, mark its overdue payment **paid** in the Payments panel.
   Expected: the card auto-returns to **Paid In Full**; its SEO jobs show unblocked (Change C).
3. Separately, drag an already-onboarded On-Hold deal to **Paid In Full** by hand.
   Expected: no "already completed / no services planned" alert; card lands in Paid In Full; SEO jobs unblocked (Change B).
4. Drag a brand-new locked deal with planned services to **Paid In Full**.
   Expected: jobs spawn as before (Change B fresh path).

- [ ] **Step 3: Verify the overdue loop guard (read-only)**

Run via MCP `execute_sql`:
```sql
select count(*) as onboarded_overdue_not_yet_onhold
  from public.deals d
  join public.deal_payments dp on dp.deal_id = d.id
 where d.accounting_completed_at is not null
   and dp.status = 'pending' and dp.end_date is not null and dp.end_date <= current_date
   and coalesce((select code from public.pipeline_stages ps where ps.id = d.accounting_stage_id),'') not in ('on_hold','done','closed');
```
Note the count — these are the onboarded deals the **next** 02:05 cron run will sweep to On Hold (previously they were skipped forever). This confirms Change D will act. (Optionally run `select public.move_overdue_deals_to_on_hold();` to apply immediately and re-check.)

---

## Self-review

- **Spec coverage:** A→Task 1 Step 1 + verify Task 2 Step 2. B→Task 1 Step 2, Tasks 4–6, verify Task 2 Step 3 + Task 7 Step 2. C→Task 1 Step 3, verify Task 2 Step 3 + Task 7 Step 2. D→Task 1 Step 4, verify Task 2 Step 3 + Task 7 Step 3. E→Task 1 Step 5, verify Task 2 Step 4. Frontend "both ways" + payment_method precheck preserved→Task 6. All spec sections covered.
- **Placeholders:** none — every code/SQL step is complete.
- **Type consistency:** `markPaidInFull` / `MarkPaidInFullResult` used identically in `rpc.ts`, the hook, and its test; the RPC name `accounting_mark_paid_in_full` and arg `target_deal_id` match between the migration, types regen, and wrapper; error keys flow through the existing `complete.errors.*` handler.
- **Note for executor:** Tasks 1→2 (apply) and 3 (types) are sequential and use the Supabase MCP for DDL; Tasks 4–6 are ordinary TDD. Don't reorder 2 before 1.
```
