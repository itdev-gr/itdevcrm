# Expenses Autopay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A per-expense "Autopay ⚡" switch on `/accounting/expenses`: while on, each recurring period's row is automatically marked `paid` on its start date, and enabling it settles the chain's already-due pending rows immediately.

**Architecture:** New `expenses.autopay boolean` chain-level flag. The existing nightly cron gains a settle step (`settle_autopay_expenses()`) via a `run_daily_expenses()` wrapper; the spawner starts copying `autopay` + `payment_method` onto renewed rows. A `set_expense_autopay` RPC (admin-guarded, security definer) stamps the whole chain and settles due rows on enable. Frontend: toggle in create + detail dialogs, ⚡ badge in the table.

**Tech Stack:** React 18 + TypeScript + @tanstack/react-query + supabase-js; Postgres (Supabase) + pg_cron; vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-07-07-expenses-autopay-design.md`

## Global Constraints

- Verify frontend with `npm run build` (tsc -b with `noUncheckedIndexedAccess` + eslint `--max-warnings=0`) — stricter than `tsc --noEmit`. Assert array indices with `!` in tests (existing convention: `update.mock.calls[0]![0]`).
- Never capture `supabase.rpc`/`supabase.from` into a variable without `.bind(supabase)`; calling them as methods (`supabase.rpc(...)`) is fine.
- The vitest suite runs against PROD config — all new tests must fully mock `@/lib/supabase`. Never write tests that hit the live DB.
- Prod DDL/DML runs via the Supabase Management API (`POST https://api.supabase.com/v1/projects/xujlrclyzxrvxszepquy/database/query`, curl with `Authorization: Bearer <sbp_ token from user>`, body `{"query":"..."}` via `--data @file.json`). Reference env-var/user-supplied tokens only — never write a literal token into any committed file.
- **Applying the migration to prod is a mutation — requires the user's explicit go-ahead (checkpoint in Task 1).**
- Before `create or replace` of any existing prod function, re-read the live body with `pg_get_functiondef` and diff against expectations (prod fn bodies drift; owner may commit/apply mid-session).
- Commit per task, push directly to `main` (no PRs). Do not push frontend work until the migration is applied (the new `autopay` column is in SELECT strings; PostgREST 400s if it doesn't exist).
- Amounts: only `amount_net` is written; `vat_amount`/`amount_gross` are DB generated columns. Dates are `YYYY-MM-DD` strings.
- Both i18n locales (`en`, `el`) must be updated together.

---

### Task 1: DB migration — autopay column, settle function, RPC, cron wrapper

**Files:**
- Create: `supabase/migrations/20260707000000_expenses_autopay.sql`

**Interfaces:**
- Produces (used by later tasks):
  - column `public.expenses.autopay boolean not null default false`
  - `public.set_expense_autopay(p_expense_id uuid, p_enabled boolean, p_payment_method text default null) returns int` — RPC the frontend calls; returns number of rows settled; raises `admin only`, `expense not found`, `autopay is only available on recurring expenses`, `payment method required to enable autopay`.
  - `public.settle_autopay_expenses() returns int` — nightly settle (not called from frontend).
  - `public.run_daily_expenses() returns void` — cron wrapper (spawn → settle).

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/20260707000000_expenses_autopay.sql` with exactly:

```sql
-- Expenses Autopay: stable recurring expenses (rent, subscriptions) that are
-- charged automatically get marked paid by the system on each period's start
-- date, instead of requiring a manual "mark paid" every month.
-- Spec: docs/superpowers/specs/2026-07-07-expenses-autopay-design.md

-- 1) Chain-level flag ---------------------------------------------------------
alter table public.expenses
  add column if not exists autopay boolean not null default false;

-- 2) Spawner: copy autopay + payment_method onto the renewed row --------------
-- (unchanged apart from the two extra columns in the INSERT)
create or replace function public.ensure_recurring_expenses()
returns int
language plpgsql security definer set search_path = public as $$
declare
  r record;
  next_start date;
  next_end date;
  created int := 0;
begin
  for r in
    select e.*
      from public.expenses e
     where e.billing_type in ('recurring_monthly','recurring_yearly')
       and e.end_date is not null
       and e.end_date <= current_date + interval '7 days'
       and not exists (
         select 1 from public.expenses e2
          where coalesce(e2.parent_expense_id, e2.id)
              = coalesce(e.parent_expense_id, e.id)
            and e2.start_date >= e.end_date
       )
  loop
    next_start := r.end_date;
    if r.billing_type = 'recurring_monthly' then
      next_end := next_start + interval '1 month';
    else
      next_end := next_start + interval '1 year';
    end if;

    insert into public.expenses
      (category_id, vendor, billing_type, amount_net, vat_rate,
       start_date, end_date, status, notes, parent_expense_id, created_by,
       payment_method, autopay)
      values
      (r.category_id, r.vendor, r.billing_type, r.amount_net, r.vat_rate,
       next_start, next_end, 'pending', r.notes,
       coalesce(r.parent_expense_id, r.id), r.created_by,
       r.payment_method, r.autopay);

    created := created + 1;
  end loop;
  return created;
end $$;

grant execute on function public.ensure_recurring_expenses() to authenticated;

-- 3) Nightly settle: flip due autopay rows pending -> paid --------------------
create or replace function public.settle_autopay_expenses()
returns int
language plpgsql security definer set search_path = public as $$
declare
  settled int;
begin
  update public.expenses
     set status = 'paid',
         paid_at = start_date::timestamptz,  -- attribute to the period month
         paid_by = null                      -- shows as "System" in activity
   where autopay
     and status = 'pending'
     and start_date <= current_date
     and payment_method is not null;         -- CHECK requires one on paid rows
  get diagnostics settled = row_count;
  return settled;
end $$;

revoke all on function public.settle_autopay_expenses() from public, anon, authenticated;

-- 4) Toggle RPC: stamp the chain; on enable, settle its due rows now ----------
create or replace function public.set_expense_autopay(
  p_expense_id uuid,
  p_enabled boolean,
  p_payment_method text default null
)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_chain uuid;
  v_billing text;
  v_tip_method text;
  settled int := 0;
begin
  if not public.current_user_is_admin() then
    raise exception 'admin only';
  end if;

  select coalesce(e.parent_expense_id, e.id), e.billing_type
    into v_chain, v_billing
    from public.expenses e
   where e.id = p_expense_id;
  if v_chain is null then
    raise exception 'expense not found';
  end if;
  if v_billing = 'one_time' then
    raise exception 'autopay is only available on recurring expenses';
  end if;

  update public.expenses e
     set autopay = p_enabled
   where coalesce(e.parent_expense_id, e.id) = v_chain;

  if p_enabled then
    -- Fill missing payment methods; never overwrite an existing one.
    if nullif(trim(coalesce(p_payment_method, '')), '') is not null then
      update public.expenses e
         set payment_method = trim(p_payment_method)
       where coalesce(e.parent_expense_id, e.id) = v_chain
         and e.payment_method is null;
    end if;

    -- The chain tip is what the spawner copies from — it must have a method.
    select e.payment_method
      into v_tip_method
      from public.expenses e
     where coalesce(e.parent_expense_id, e.id) = v_chain
     order by e.start_date desc, e.created_at desc
     limit 1;
    if v_tip_method is null then
      raise exception 'payment method required to enable autopay';
    end if;

    -- Settle this chain's already-due pending rows immediately.
    update public.expenses e
       set status = 'paid',
           paid_at = e.start_date::timestamptz,
           paid_by = null
     where coalesce(e.parent_expense_id, e.id) = v_chain
       and e.autopay
       and e.status = 'pending'
       and e.start_date <= current_date
       and e.payment_method is not null;
    get diagnostics settled = row_count;
  end if;

  return settled;
end $$;

revoke all on function public.set_expense_autopay(uuid, boolean, text) from public, anon;
grant execute on function public.set_expense_autopay(uuid, boolean, text) to authenticated;

-- 5) Cron: spawn first, then settle (wrapper keeps one clear entry point) -----
create or replace function public.run_daily_expenses()
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.ensure_recurring_expenses();
  perform public.settle_autopay_expenses();
end $$;

revoke all on function public.run_daily_expenses() from public, anon, authenticated;

select cron.unschedule('daily_ensure_recurring_expenses')
 where exists (select 1 from cron.job where jobname = 'daily_ensure_recurring_expenses');

select cron.schedule(
  'daily_ensure_recurring_expenses',
  '5 2 * * *',
  $$ select public.run_daily_expenses(); $$
);

-- ROLLBACK:
-- select cron.unschedule('daily_ensure_recurring_expenses')
--   where exists (select 1 from cron.job where jobname = 'daily_ensure_recurring_expenses');
-- select cron.schedule('daily_ensure_recurring_expenses', '5 2 * * *',
--   $$ select public.ensure_recurring_expenses(); $$);
-- drop function if exists public.run_daily_expenses();
-- drop function if exists public.set_expense_autopay(uuid, boolean, text);
-- drop function if exists public.settle_autopay_expenses();
-- (restore ensure_recurring_expenses body from
--  supabase/migrations/20260601000004_ensure_recurring_expenses.sql)
-- alter table public.expenses drop column if exists autopay;
```

- [ ] **Step 2: Drift check against live prod (read-only)**

Run via Management API (write the SQL to a scratch JSON file, `curl --data @file.json`):

```sql
select pg_get_functiondef(p.oid)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'ensure_recurring_expenses';
```

Expected: body matches `supabase/migrations/20260601000004_ensure_recurring_expenses.sql` (verified 2026-07-07; re-verify in case the owner applied something mid-session). If it differs, STOP and surface the diff to the user before proceeding.

- [ ] **Step 3: Commit the migration file (not yet applied)**

```bash
git add supabase/migrations/20260707000000_expenses_autopay.sql
git commit -m "feat(expenses): autopay migration — flag, settle fn, toggle RPC, cron wrapper"
```

- [ ] **Step 4: CHECKPOINT — ask the user for go-ahead to apply to prod**

Show a one-line summary ("apply autopay migration to prod: 1 column, 3 new fns, 1 fn update, cron command swap") and wait for explicit yes. Do NOT apply without it.

- [ ] **Step 5: Apply the migration to prod**

Send the whole migration file as one Management API query (read the file into the JSON body; e.g. `python3 -c "import json;print(json.dumps({'query':open('supabase/migrations/20260707000000_expenses_autopay.sql').read()}))" > apply.json` then `curl --data @apply.json ...`). Expected: HTTP 200, `[]` or empty result (DDL returns no rows).

- [ ] **Step 6: Verify objects + functional dry-run (rolled back, loud failures)**

Run via Management API in ONE query (single transaction; the final `rollback` discards the probe):

```sql
begin;

-- objects exist
do $chk$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='expenses' and column_name='autopay') then
    raise exception 'FAIL: autopay column missing';
  end if;
  if (select command from cron.job where jobname='daily_ensure_recurring_expenses')
       not like '%run_daily_expenses%' then
    raise exception 'FAIL: cron command not updated';
  end if;
end $chk$;

-- probe chain: due yesterday, autopay, has method -> settle pays exactly it
insert into public.expenses
  (category_id, vendor, billing_type, amount_net, vat_rate,
   start_date, end_date, status, payment_method, autopay)
values
  ((select id from public.expense_categories limit 1), '__AUTOPAY_PROBE__',
   'recurring_monthly', 10, 0, current_date - 1, current_date + 29,
   'pending', 'CARD', true);

do $chk$
declare n int; v_status text; v_paid_at timestamptz;
begin
  n := public.settle_autopay_expenses();
  if n < 1 then raise exception 'FAIL: settle returned %, expected >= 1', n; end if;
  select status, paid_at into v_status, v_paid_at
    from public.expenses where vendor = '__AUTOPAY_PROBE__';
  if v_status <> 'paid' then raise exception 'FAIL: probe status %', v_status; end if;
  if v_paid_at <> (current_date - 1)::timestamptz then
    raise exception 'FAIL: probe paid_at % (expected period start)', v_paid_at;
  end if;
end $chk$;

-- RPC guard: as anon-ish context (no jwt), must raise 'admin only'
do $chk$
begin
  begin
    perform public.set_expense_autopay(
      (select id from public.expenses where vendor = '__AUTOPAY_PROBE__'), true, null);
    raise exception 'FAIL: admin guard did not fire';
  exception when others then
    if sqlerrm <> 'admin only' then raise; end if;
  end;
end $chk$;

-- RPC happy path: impersonate the admin (role-switch technique)
select set_config('request.jwt.claims',
  json_build_object('sub', (select id from auth.users where email = 'info@itdev.gr'),
                    'role', 'authenticated')::text, true);
set local role authenticated;

do $chk$
declare v_id uuid; n int;
begin
  select id into v_id from public.expenses where vendor = '__AUTOPAY_PROBE__';
  -- disable then re-enable: exercises chain stamp + tip-method check + settle
  n := public.set_expense_autopay(v_id, false, null);
  if (select autopay from public.expenses where id = v_id) then
    raise exception 'FAIL: disable did not clear flag';
  end if;
  n := public.set_expense_autopay(v_id, true, null);
  if not (select autopay from public.expenses where id = v_id) then
    raise exception 'FAIL: enable did not set flag';
  end if;
end $chk$;

reset role;
rollback;
select 'ALL AUTOPAY DB CHECKS PASSED' as result;
```

Expected output: `[{"result":"ALL AUTOPAY DB CHECKS PASSED"}]`. Any `FAIL:` exception → stop, report, do not proceed. (Note: the `rollback` removes the probe; the migration's DDL from Step 5 was already committed separately and stays.)

---

### Task 2: Frontend plumbing — `autopay` in types/selects, create hook, new RPC hook, i18n keys

**Files:**
- Modify: `src/features/accounting_report/hooks/useExpenses.ts` (type + SELECT)
- Modify: `src/features/accounting_report/hooks/useExpenseDetail.ts` (SELECT)
- Modify: `src/features/accounting_report/hooks/useCreateExpense.ts` (autopay input)
- Create: `src/features/accounting_report/hooks/useSetExpenseAutopay.ts`
- Test: `src/features/accounting_report/hooks/useSetExpenseAutopay.test.tsx`
- Modify: `src/i18n/locales/en/accounting_report.json`, `src/i18n/locales/el/accounting_report.json`

**Interfaces:**
- Consumes: `set_expense_autopay(p_expense_id, p_enabled, p_payment_method)` RPC from Task 1.
- Produces:
  - `ExpenseListRow` gains `autopay: boolean` (both list + detail queries return it).
  - `CreateExpenseInput` gains `autopay?: boolean`.
  - `useSetExpenseAutopay(): UseMutationResult` with `mutateAsync({ id: string; enabled: boolean; paymentMethod?: string | null }): Promise<number>`.
  - i18n keys: `autopay.label`, `autopay.hint`, `autopay.on`, `autopay.off`, `autopay.enable`, `autopay.disable`, `autopay.badge`, and `expense_form.validation.autopay_requires_method`.

- [ ] **Step 1: Write the failing hook test**

Create `src/features/accounting_report/hooks/useSetExpenseAutopay.test.tsx`:

```tsx
import type { ReactNode } from 'react';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc },
}));

import { useSetExpenseAutopay } from './useSetExpenseAutopay';

function wrap(c: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{c}</QueryClientProvider>;
}

describe('useSetExpenseAutopay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpc.mockResolvedValue({ data: 1, error: null });
  });

  it('calls set_expense_autopay with id, enabled, and payment method', async () => {
    const { result } = renderHook(() => useSetExpenseAutopay(), {
      wrapper: ({ children }) => wrap(children),
    });
    await act(async () => {
      await result.current.mutateAsync({ id: 'e1', enabled: true, paymentMethod: 'CARD' });
    });
    expect(rpc).toHaveBeenCalledWith('set_expense_autopay', {
      p_expense_id: 'e1',
      p_enabled: true,
      p_payment_method: 'CARD',
    });
  });

  it('passes null payment method when omitted (disable path)', async () => {
    const { result } = renderHook(() => useSetExpenseAutopay(), {
      wrapper: ({ children }) => wrap(children),
    });
    await act(async () => {
      await result.current.mutateAsync({ id: 'e1', enabled: false });
    });
    expect(rpc).toHaveBeenCalledWith('set_expense_autopay', {
      p_expense_id: 'e1',
      p_enabled: false,
      p_payment_method: null,
    });
  });

  it('surfaces RPC errors (e.g. missing payment method) as a rejection', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'payment method required to enable autopay' },
    });
    const { result } = renderHook(() => useSetExpenseAutopay(), {
      wrapper: ({ children }) => wrap(children),
    });
    await expect(
      act(async () => {
        await result.current.mutateAsync({ id: 'e1', enabled: true });
      }),
    ).rejects.toThrow('payment method required to enable autopay');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/accounting_report/hooks/useSetExpenseAutopay.test.tsx`
Expected: FAIL — cannot resolve `./useSetExpenseAutopay`.

- [ ] **Step 3: Implement the hook**

Create `src/features/accounting_report/hooks/useSetExpenseAutopay.ts`:

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export type SetExpenseAutopayInput = {
  id: string;
  enabled: boolean;
  paymentMethod?: string | null;
};

export function useSetExpenseAutopay() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SetExpenseAutopayInput): Promise<number> => {
      const { data, error } = await supabase.rpc('set_expense_autopay', {
        p_expense_id: input.id,
        p_enabled: input.enabled,
        p_payment_method: input.paymentMethod ?? null,
      });
      if (error) throw new Error(error.message);
      return (data as number) ?? 0;
    },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['expenses'] });
      void qc.invalidateQueries({ queryKey: ['expense', vars.id] });
      void qc.invalidateQueries({ queryKey: ['accounting-ledger'] });
      void qc.invalidateQueries({ queryKey: ['accounting-pl-summary'] });
    },
  });
}
```

- [ ] **Step 4: Extend types, SELECTs, and create hook**

In `src/features/accounting_report/hooks/useExpenses.ts`:
- Add to `ExpenseListRow` (after `parent_expense_id`): `autopay: boolean;`
- In the `SELECT` template string, change the line
  `notes, receipt_path, parent_expense_id, created_by, created_at,` to
  `notes, receipt_path, parent_expense_id, autopay, created_by, created_at,`

In `src/features/accounting_report/hooks/useExpenseDetail.ts`: make the identical `SELECT` line change.

In `src/features/accounting_report/hooks/useCreateExpense.ts`:
- Add to `CreateExpenseInput` (after `markPaid?: boolean;`): `autopay?: boolean;`
- In the `.insert({...})` object add (after `status: ...`): `autopay: input.autopay === true,`

- [ ] **Step 5: Add i18n keys**

In `src/i18n/locales/en/accounting_report.json` add a top-level `"autopay"` object and one validation key inside the existing `expense_form.validation` object:

```json
"autopay": {
  "label": "Autopay",
  "badge": "Autopay",
  "hint": "Each period is automatically marked paid on its start date",
  "on": "On",
  "off": "Off",
  "enable": "Enable autopay",
  "disable": "Disable autopay"
}
```
and in `expense_form.validation`: `"autopay_requires_method": "A payment method is required for autopay"`.

In `src/i18n/locales/el/accounting_report.json`:

```json
"autopay": {
  "label": "Αυτόματη πληρωμή",
  "badge": "Αυτόματη πληρωμή",
  "hint": "Κάθε περίοδος σημαίνεται αυτόματα ως πληρωμένη την ημερομηνία έναρξής της",
  "on": "Ενεργή",
  "off": "Ανενεργή",
  "enable": "Ενεργοποίηση αυτόματης πληρωμής",
  "disable": "Απενεργοποίηση αυτόματης πληρωμής"
}
```
and in `expense_form.validation`: `"autopay_requires_method": "Απαιτείται τρόπος πληρωμής για την αυτόματη πληρωμή"`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/features/accounting_report/hooks/`
Expected: all PASS (new file green; existing hook tests unaffected).

- [ ] **Step 7: Commit**

```bash
git add src/features/accounting_report/hooks/useSetExpenseAutopay.ts \
        src/features/accounting_report/hooks/useSetExpenseAutopay.test.tsx \
        src/features/accounting_report/hooks/useExpenses.ts \
        src/features/accounting_report/hooks/useExpenseDetail.ts \
        src/features/accounting_report/hooks/useCreateExpense.ts \
        src/i18n/locales/en/accounting_report.json \
        src/i18n/locales/el/accounting_report.json
git commit -m "feat(expenses): autopay plumbing — RPC hook, row type, create input, i18n"
```

---

### Task 3: NewExpenseDialog — Autopay toggle on create

**Files:**
- Modify: `src/features/accounting_report/components/NewExpenseDialog.tsx`
- Test: `src/features/accounting_report/components/NewExpenseDialog.test.tsx` (extend)

**Interfaces:**
- Consumes: `useSetExpenseAutopay` (Task 2), `CreateExpenseInput.autopay` (Task 2), i18n keys (Task 2).
- Produces: create dialog behavior — autopay checkbox visible only for recurring billing types; requires payment method; on submit inserts with `autopay: true` then calls the RPC so an already-due first period settles immediately.

- [ ] **Step 1: Write the failing tests (extend the existing file)**

In `src/features/accounting_report/components/NewExpenseDialog.test.tsx`:

Replace the hoisted block at the top:

```tsx
const { mutateAsync, autopayMutateAsync } = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  autopayMutateAsync: vi.fn(),
}));
```

Add below the existing `vi.mock('../hooks/useCreateExpense', ...)`:

```tsx
vi.mock('../hooks/useSetExpenseAutopay', () => ({
  useSetExpenseAutopay: () => ({ mutateAsync: autopayMutateAsync, isPending: false }),
}));
```

Append a new describe block at the end of the file:

```tsx
describe('NewExpenseDialog — Autopay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutateAsync.mockResolvedValue({ id: 'e1' });
    autopayMutateAsync.mockResolvedValue(1);
  });

  it('hides the autopay toggle for one_time billing', () => {
    render(wrap(<NewExpenseDialog open onClose={() => {}} />));
    expect(screen.queryByLabelText('Autopay')).toBeNull();
  });

  it('shows the autopay toggle for recurring billing', () => {
    render(wrap(<NewExpenseDialog open onClose={() => {}} />));
    fireEvent.click(screen.getByRole('button', { name: 'Monthly' }));
    expect(screen.getByLabelText('Autopay')).toBeTruthy();
  });

  it('blocks Save when autopay is on but payment method is empty', () => {
    render(wrap(<NewExpenseDialog open onClose={() => {}} />));
    fillRequiredFields();
    fireEvent.click(screen.getByRole('button', { name: 'Monthly' }));
    fireEvent.click(screen.getByLabelText('Autopay'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByText('A payment method is required for autopay')).toBeTruthy();
  });

  it('creates with autopay=true and settles via RPC when method provided', async () => {
    render(wrap(<NewExpenseDialog open onClose={() => {}} />));
    fillRequiredFields();
    fireEvent.click(screen.getByRole('button', { name: 'Monthly' }));
    fireEvent.click(screen.getByLabelText('Autopay'));
    fireEvent.change(screen.getByLabelText('Payment method'), { target: { value: 'CARD' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByRole('button', { name: 'Save' }); // let async submit settle
    expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ autopay: true }));
    expect(autopayMutateAsync).toHaveBeenCalledWith({
      id: 'e1',
      enabled: true,
      paymentMethod: 'CARD',
    });
  });

  it('switching back to one_time drops autopay from the payload', () => {
    render(wrap(<NewExpenseDialog open onClose={() => {}} />));
    fillRequiredFields();
    fireEvent.click(screen.getByRole('button', { name: 'Monthly' }));
    fireEvent.click(screen.getByLabelText('Autopay'));
    fireEvent.click(screen.getByRole('button', { name: 'One-time' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ autopay: false }));
    expect(autopayMutateAsync).not.toHaveBeenCalled();
  });
});
```

Note: the button labels 'Monthly' / 'One-time' / 'Save' are the verified exact values of `expense_form.recurring_monthly` / `expense_form.one_time` / `expense_form.submit` in `src/i18n/locales/en/accounting_report.json`.

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run src/features/accounting_report/components/NewExpenseDialog.test.tsx`
Expected: existing tests PASS, all 5 new tests FAIL (no `Autopay` control rendered yet).

- [ ] **Step 3: Implement the toggle**

In `src/features/accounting_report/components/NewExpenseDialog.tsx`:

Add the import:
```tsx
import { useSetExpenseAutopay } from '../hooks/useSetExpenseAutopay';
```

Inside the component add (next to the other hooks/state):
```tsx
const autopayMut = useSetExpenseAutopay();
const [autopayOn, setAutopayOn] = useState(false);
```

The effective flag (recurring only) and validation — in `submit(markPaid)`, after the existing `markPaid && !paymentMethod.trim()` check, add:
```tsx
const wantsAutopay = billingType !== 'one_time' && autopayOn;
if (wantsAutopay && !paymentMethod.trim())
  return setError(t('expense_form.validation.autopay_requires_method'));
```

Change the create call to pass the flag and settle after (replace the existing `await create.mutateAsync({...}); onClose();` body):
```tsx
const created = await create.mutateAsync({
  categoryId,
  vendor: vendor || null,
  billingType,
  amountNet: Number(amountNet),
  vatRate: Number(vatRate),
  startDate,
  endDate: endDate || null,
  paymentMethod: paymentMethod || null,
  notes: notes || null,
  markPaid,
  autopay: wantsAutopay,
});
if (wantsAutopay && created?.id) {
  // Settles an already-due first period now; if it fails, the nightly
  // sweep settles it — the flag is already on the row.
  await autopayMut.mutateAsync({
    id: created.id as string,
    enabled: true,
    paymentMethod: paymentMethod.trim() || null,
  }).catch(() => undefined);
}
onClose();
```

Render the toggle after the billing-type button group `</div>` (the one closing the `mt-3 text-sm` block) — visible only for recurring:
```tsx
{billingType !== 'one_time' && (
  <label className="mt-3 flex items-center gap-2 text-sm">
    <input
      type="checkbox"
      aria-label={t('autopay.label')}
      checked={autopayOn}
      onChange={(ev) => setAutopayOn(ev.target.checked)}
    />
    <span>⚡ {t('autopay.label')}</span>
    <span className="text-xs text-muted-foreground">{t('autopay.hint')}</span>
  </label>
)}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/accounting_report/components/NewExpenseDialog.test.tsx`
Expected: ALL PASS (old + new).

- [ ] **Step 5: Commit**

```bash
git add src/features/accounting_report/components/NewExpenseDialog.tsx \
        src/features/accounting_report/components/NewExpenseDialog.test.tsx
git commit -m "feat(expenses): autopay toggle on the create-expense dialog"
```

---

### Task 4: ExpenseDetailDialog — Autopay toggle on existing expenses

**Files:**
- Modify: `src/features/accounting_report/components/ExpenseDetailDialog.tsx`
- Test: `src/features/accounting_report/components/ExpenseDetailDialog.test.tsx` (new file)

**Interfaces:**
- Consumes: `useSetExpenseAutopay` (Task 2), `ExpenseListRow.autopay` (Task 2), i18n keys (Task 2).
- Produces: detail dialog shows an Autopay section for recurring expenses — current state (On/Off), Enable (asks for a payment method inline when the row has none) and Disable actions; RPC errors shown inline.

- [ ] **Step 1: Write the failing tests**

Create `src/features/accounting_report/components/ExpenseDetailDialog.test.tsx`:

```tsx
import type { ReactNode } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';
import '@/lib/i18n';

const { autopayMutateAsync, detailData } = vi.hoisted(() => ({
  autopayMutateAsync: vi.fn(),
  detailData: { current: null as Record<string, unknown> | null },
}));

vi.mock('../hooks/useExpenseDetail', () => ({
  useExpenseDetail: () => ({ data: detailData.current, isLoading: false }),
}));
vi.mock('../hooks/useMarkExpensePaid', () => ({
  useMarkExpensePaid: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('../hooks/useDeleteExpense', () => ({
  useDeleteExpense: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('../hooks/useUploadReceipt', () => ({
  useUploadReceipt: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('../hooks/useSetExpenseAutopay', () => ({
  useSetExpenseAutopay: () => ({ mutateAsync: autopayMutateAsync, isPending: false }),
}));

import { ExpenseDetailDialog } from './ExpenseDetailDialog';

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

function baseExpense(overrides: Record<string, unknown> = {}) {
  return {
    id: 'e1',
    category_id: 'cat-1',
    vendor: 'COSMOTE',
    billing_type: 'recurring_monthly',
    amount_net: 99.8,
    vat_rate: 0,
    vat_amount: 0,
    amount_gross: 99.8,
    start_date: '2026-07-01',
    end_date: '2026-08-01',
    status: 'pending',
    payment_method: 'CARD',
    paid_at: null,
    paid_by: null,
    notes: null,
    receipt_path: null,
    parent_expense_id: null,
    autopay: false,
    created_by: null,
    created_at: '2026-07-07T00:00:00Z',
    category: { key: 'software', name_en: 'Software', name_el: 'Λογισμικό' },
    ...overrides,
  };
}

describe('ExpenseDetailDialog — Autopay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    autopayMutateAsync.mockResolvedValue(1);
  });

  it('hides the autopay section for one_time expenses', () => {
    detailData.current = baseExpense({ billing_type: 'one_time' });
    render(wrap(<ExpenseDetailDialog open id="e1" onClose={() => {}} />));
    expect(screen.queryByText('Enable autopay')).toBeNull();
    expect(screen.queryByText('Disable autopay')).toBeNull();
  });

  it('enables autopay via RPC when the row already has a payment method', () => {
    detailData.current = baseExpense();
    render(wrap(<ExpenseDetailDialog open id="e1" onClose={() => {}} />));
    fireEvent.click(screen.getByRole('button', { name: 'Enable autopay' }));
    expect(autopayMutateAsync).toHaveBeenCalledWith({
      id: 'e1',
      enabled: true,
      paymentMethod: null,
    });
  });

  it('asks for a payment method first when the row has none', () => {
    detailData.current = baseExpense({ payment_method: null });
    render(wrap(<ExpenseDetailDialog open id="e1" onClose={() => {}} />));
    fireEvent.click(screen.getByRole('button', { name: 'Enable autopay' }));
    // no method typed yet -> no RPC call, an input appears instead
    expect(autopayMutateAsync).not.toHaveBeenCalled();
    const input = screen.getByLabelText('Autopay payment method');
    fireEvent.change(input, { target: { value: 'CARD' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enable autopay' }));
    expect(autopayMutateAsync).toHaveBeenCalledWith({
      id: 'e1',
      enabled: true,
      paymentMethod: 'CARD',
    });
  });

  it('shows Disable for an autopay expense and calls the RPC', () => {
    detailData.current = baseExpense({ autopay: true });
    render(wrap(<ExpenseDetailDialog open id="e1" onClose={() => {}} />));
    fireEvent.click(screen.getByRole('button', { name: 'Disable autopay' }));
    expect(autopayMutateAsync).toHaveBeenCalledWith({ id: 'e1', enabled: false });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/accounting_report/components/ExpenseDetailDialog.test.tsx`
Expected: FAIL — 'Enable autopay' buttons not found (section not implemented).

- [ ] **Step 3: Implement the autopay section**

In `src/features/accounting_report/components/ExpenseDetailDialog.tsx`:

Add the import (next to the other hook imports):
```tsx
import { useSetExpenseAutopay } from '../hooks/useSetExpenseAutopay';
```

Inside the component add state + hook (next to the mark-paid state):
```tsx
const autopayMut = useSetExpenseAutopay();
const [autopayMethod, setAutopayMethod] = useState('');
const [showAutopayMethod, setShowAutopayMethod] = useState(false);
const [autopayError, setAutopayError] = useState<string | null>(null);
```

Add handlers (below `onMarkPaid`):
```tsx
async function onEnableAutopay() {
  if (!id || !e) return;
  setAutopayError(null);
  // A method must exist somewhere: on the row or typed just now.
  if (!e.payment_method && !autopayMethod.trim()) {
    setShowAutopayMethod(true);
    return;
  }
  try {
    await autopayMut.mutateAsync({
      id,
      enabled: true,
      paymentMethod: autopayMethod.trim() || null,
    });
    setShowAutopayMethod(false);
    setAutopayMethod('');
  } catch (err) {
    setAutopayError(err instanceof Error ? err.message : String(err));
  }
}

async function onDisableAutopay() {
  if (!id) return;
  setAutopayError(null);
  try {
    await autopayMut.mutateAsync({ id, enabled: false });
  } catch (err) {
    setAutopayError(err instanceof Error ? err.message : String(err));
  }
}
```

Note: `onDisableAutopay` intentionally omits `paymentMethod` (the test asserts the exact two-key payload; the hook fills `p_payment_method: null`).

Render the section after the status `<p>` block (the one showing `transaction_drawer.status`) and before the notes paragraph:
```tsx
{e.billing_type !== 'one_time' && (
  <div className="mt-3 rounded border p-3 text-sm">
    <div className="flex items-center justify-between">
      <span className="font-medium">⚡ {t('autopay.label')}</span>
      <span className={e.autopay ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}>
        {e.autopay ? t('autopay.on') : t('autopay.off')}
      </span>
    </div>
    <p className="mt-1 text-xs text-muted-foreground">{t('autopay.hint')}</p>
    <div className="mt-2 flex items-end gap-2">
      {showAutopayMethod && !e.payment_method && (
        <label className="text-sm">
          {t('expense_form.payment_method')}
          <input
            aria-label="Autopay payment method"
            value={autopayMethod}
            onChange={(ev) => setAutopayMethod(ev.target.value)}
            className="mt-1 block rounded border px-2 py-1"
          />
        </label>
      )}
      {e.autopay ? (
        <button
          type="button"
          onClick={onDisableAutopay}
          disabled={autopayMut.isPending}
          className="rounded border px-3 py-1.5 text-sm"
        >
          {t('autopay.disable')}
        </button>
      ) : (
        <button
          type="button"
          onClick={onEnableAutopay}
          disabled={autopayMut.isPending}
          className="rounded border px-3 py-1.5 text-sm"
        >
          {t('autopay.enable')}
        </button>
      )}
    </div>
    {autopayError && (
      <p className="mt-2 text-sm text-red-600 dark:text-red-400">{autopayError}</p>
    )}
  </div>
)}
```

The `aria-label="Autopay payment method"` is intentionally a fixed English aria-label (matching the test); the visible label text stays translated.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/accounting_report/components/ExpenseDetailDialog.test.tsx`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/accounting_report/components/ExpenseDetailDialog.tsx \
        src/features/accounting_report/components/ExpenseDetailDialog.test.tsx
git commit -m "feat(expenses): autopay enable/disable on the expense detail dialog"
```

---

### Task 5: ExpenseRow — ⚡ Autopay badge in the table

**Files:**
- Modify: `src/features/accounting_report/components/ExpenseRow.tsx`
- Test: `src/features/accounting_report/components/ExpenseRow.test.tsx` (new file)

**Interfaces:**
- Consumes: `ExpenseListRow.autopay` (Task 2), i18n key `autopay.badge` (Task 2).
- Produces: an "⚡ Autopay" pill next to the status chip when `row.autopay` is true.

- [ ] **Step 1: Write the failing test**

Create `src/features/accounting_report/components/ExpenseRow.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import '@/lib/i18n';
import { ExpenseRow } from './ExpenseRow';
import type { ExpenseListRow } from '../hooks/useExpenses';

function row(overrides: Partial<ExpenseListRow> = {}): ExpenseListRow {
  return {
    id: 'e1',
    category_id: 'cat-1',
    vendor: 'COSMOTE',
    billing_type: 'recurring_monthly',
    amount_net: 99.8,
    vat_rate: 0,
    vat_amount: 0,
    amount_gross: 99.8,
    start_date: '2026-07-01',
    end_date: '2026-08-01',
    status: 'pending',
    payment_method: 'CARD',
    paid_at: null,
    paid_by: null,
    notes: null,
    receipt_path: null,
    parent_expense_id: null,
    autopay: false,
    created_by: null,
    created_at: '2026-07-07T00:00:00Z',
    category: { key: 'software', name_en: 'Software', name_el: 'Λογισμικό' },
    ...overrides,
  };
}

function renderRow(r: ExpenseListRow) {
  return render(
    <table>
      <tbody>
        <ExpenseRow row={r} onClick={() => {}} />
      </tbody>
    </table>,
  );
}

describe('ExpenseRow — autopay badge', () => {
  it('shows the Autopay badge when autopay is on', () => {
    renderRow(row({ autopay: true }));
    expect(screen.getByText(/Autopay/)).toBeTruthy();
  });

  it('hides the badge when autopay is off', () => {
    renderRow(row());
    expect(screen.queryByText(/Autopay/)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/accounting_report/components/ExpenseRow.test.tsx`
Expected: first test FAILS (badge not rendered); second passes.

- [ ] **Step 3: Implement the badge**

In `src/features/accounting_report/components/ExpenseRow.tsx`, inside the status `<td>` after the status `<span>…</span>`, add:

```tsx
{row.autopay && (
  <span className="ml-1.5 inline-flex rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800 dark:bg-sky-950/50 dark:text-sky-300">
    ⚡ {t('autopay.badge')}
  </span>
)}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/accounting_report/components/ExpenseRow.test.tsx`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/accounting_report/components/ExpenseRow.tsx \
        src/features/accounting_report/components/ExpenseRow.test.tsx
git commit -m "feat(expenses): autopay badge on expense table rows"
```

---

### Task 6: Full verification, deploy, live smoke

**Files:** none new (verification + push).

**Interfaces:**
- Consumes: everything above. The migration (Task 1) MUST already be applied to prod before pushing (deployed frontend selects the `autopay` column).

- [ ] **Step 1: Run the feature's test files**

Run: `npx vitest run src/features/accounting_report/`
Expected: all accounting_report tests PASS. (Do not run the whole repo suite — it runs against prod and has 17 known test-fixture failures elsewhere; unrelated noise.)

- [ ] **Step 2: Strict build**

Run: `npm run build`
Expected: exit 0, no eslint warnings, no tsc errors.

- [ ] **Step 3: Confirm migration is applied (from Task 1 Step 6) — if not, STOP**

The push must not go out before the DB has the `autopay` column.

- [ ] **Step 4: Push to main**

```bash
git push origin main
```
Vercel auto-deploys. Reminder: a cached index.html can 404 on old hashed chunks right after deploy — hard-refresh before triaging anything as broken.

- [ ] **Step 5: Live smoke check (read-only + one real toggle with user consent)**

- Read-only SQL: `select vendor, start_date, status, autopay, payment_method from expenses order by created_at desc limit 10;` — column present, all `autopay=false`.
- In the app (admin account): open `/accounting/expenses`, open a recurring expense (e.g. COSMOTE), confirm the Autopay section renders with state Off.
- Ask the user whether to enable autopay on one real expense now (e.g. COSMOTE) as the production smoke test; if yes, click Enable, confirm the ⚡ badge appears and any due pending row flips to paid with `paid_at = period start`.

- [ ] **Step 6: Report**

Summarize what shipped, the cron behavior (02:05 UTC nightly: spawn → settle), and the rollback pointer (migration file's ROLLBACK block).
