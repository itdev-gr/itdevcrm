# Prepay N Months + Period-Month Revenue Attribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accounting can record N prepaid months in one click (chained paid periods, atomic RPC), and the Report attributes recurring revenue/expenses to the month each period covers instead of the collection month.

**Architecture:** One view migration flips `accounting_ledger_v`'s event date for recurring rows to `start_date` (P&L/exports/month-filter inherit it — zero frontend changes). One RPC (`accounting_prepay_months`) mirrors the nightly spawner's chain-grouping to create N chained periods born `paid`, with a `p_dry_run` mode that returns the exact preview the dialog shows. Frontend adds a Prepay dialog to the Payments tab calling the RPC via the loose `rpcCall` pattern (no types regen needed).

**Tech Stack:** Supabase Postgres (project `xujlrclyzxrvxszepquy`), React + TS, TanStack Query, shadcn Dialog, vitest.

**Spec:** `docs/superpowers/specs/2026-07-16-prepay-months-revenue-attribution-design.md` (owner approved incl. the 4 assumption defaults). Spec refinement locked here: the dialog preview is SERVER-computed via `p_dry_run => true` — no client-side chain math.

## Global Constraints

- Commit directly to `main` after each task — NO pull requests. `git pull --rebase origin main` before any push (owner commits in parallel).
- `npm run build` (tsc -b + eslint max-warnings=0 + vite build) must pass clean.
- NEVER run the full vitest suite (integration tests hit PROD). Run ONLY the named test files.
- Both migrations are applied to prod by the CONTROLLER session (implementer subagents only write + commit the files). Controller runs a rolled-back RED/GREEN harness for the RPC before applying.
- Frontend RPC calls use the loose `rpcCall` helper pattern from `src/lib/rpc.ts:81` (`supabase.rpc.bind(supabase)`) — the standing workaround for RPCs absent from generated types; NO types regen in this plan.
- New function follows the grant-boundary rule: `revoke execute … from public, anon; grant execute … to authenticated;` (bare CREATE FUNCTION grants EXECUTE to PUBLIC by default).
- i18n: all new user-facing strings in BOTH `src/i18n/locales/en/deals.json` and `el/deals.json`, exact values below.
- Live definitions of `accounting_ledger_v` and `ensure_recurring_payments_v2` were read via pg_get_viewdef/functiondef on 2026-07-16 (no drift vs expectations); the view rollback block embeds the captured definition verbatim.

---

### Task 1: Migration — period-month attribution in `accounting_ledger_v`

**Files:**
- Create: `supabase/migrations/20260716210000_ledger_period_month_attribution.sql`

**Interfaces:**
- Consumes: existing view (captured in the rollback block).
- Produces: `accounting_ledger_v.event_date/period` = `start_date` month for `recurring_monthly`/`recurring_yearly` rows (both deal_payments and expenses arms); `coalesce(paid_at, start_date)` for one_time. `accounting_pl_summary_v` inherits (no change). No frontend contract changes.

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/20260716210000_ledger_period_month_attribution.sql` with exactly:

```sql
-- =============================================================================
-- Revenue/expense attribution by PERIOD month (owner decision 2026-07-16):
-- recurring (monthly + yearly) ledger rows count in the month their period
-- STARTS; one_time rows keep the paid month. Applies to BOTH arms (income =
-- deal_payments, outgo = expenses) so monthly net profit compares like with
-- like. accounting_pl_summary_v derives from this view — no change needed.
-- Frontend (useLedger/usePLSummary/exports/month filter) consumes
-- event_date/period as-is — no code changes.
-- NOTE: retroactive by design — historical recurring rows paid late move back
-- to their covered month.
--
-- ROLLBACK (manual): recreate the view with the previous event date expression
-- `COALESCE(paid_at::date, start_date)` on both arms (captured live 2026-07-16):
--   create or replace view public.accounting_ledger_v as
--   SELECT 'in'::text AS direction,
--       COALESCE(dp.paid_at::date, dp.start_date) AS event_date,
--       to_char(COALESCE(dp.paid_at::date, dp.start_date)::timestamptz, 'YYYY-MM') AS period,
--       dp.status, dp.amount_net, dp.vat_amount, dp.amount_gross,
--       dp.service_type AS category_key, c.name AS counterparty, dp.billing_type,
--       'deal_payments'::text AS source_table, dp.id AS source_id
--     FROM deal_payments dp
--       JOIN deals d ON d.id = dp.deal_id
--       JOIN clients c ON c.id = d.client_id
--   UNION ALL
--   SELECT 'out'::text, COALESCE(e.paid_at::date, e.start_date),
--       to_char(COALESCE(e.paid_at::date, e.start_date)::timestamptz, 'YYYY-MM'),
--       e.status, e.amount_net, e.vat_amount, e.amount_gross,
--       cat.key, e.vendor, e.billing_type, 'expenses'::text, e.id
--     FROM expenses e
--       JOIN expense_categories cat ON cat.id = e.category_id;
-- =============================================================================

create or replace view public.accounting_ledger_v as
select 'in'::text as direction,
       case when dp.billing_type in ('recurring_monthly','recurring_yearly')
            then dp.start_date
            else coalesce(dp.paid_at::date, dp.start_date) end as event_date,
       to_char((case when dp.billing_type in ('recurring_monthly','recurring_yearly')
                     then dp.start_date
                     else coalesce(dp.paid_at::date, dp.start_date) end)::timestamptz,
               'YYYY-MM') as period,
       dp.status,
       dp.amount_net,
       dp.vat_amount,
       dp.amount_gross,
       dp.service_type as category_key,
       c.name as counterparty,
       dp.billing_type,
       'deal_payments'::text as source_table,
       dp.id as source_id
  from deal_payments dp
  join deals d on d.id = dp.deal_id
  join clients c on c.id = d.client_id
union all
select 'out'::text as direction,
       case when e.billing_type in ('recurring_monthly','recurring_yearly')
            then e.start_date
            else coalesce(e.paid_at::date, e.start_date) end as event_date,
       to_char((case when e.billing_type in ('recurring_monthly','recurring_yearly')
                     then e.start_date
                     else coalesce(e.paid_at::date, e.start_date) end)::timestamptz,
               'YYYY-MM') as period,
       e.status,
       e.amount_net,
       e.vat_amount,
       e.amount_gross,
       cat.key as category_key,
       e.vendor as counterparty,
       e.billing_type,
       'expenses'::text as source_table,
       e.id as source_id
  from expenses e
  join expense_categories cat on cat.id = e.category_id;

-- Post-asserts — fail loudly if the semantics are off.
do $$
declare n int;
begin
  -- every recurring deal_payments ledger row sits in its start_date month
  select count(*) into n
    from public.accounting_ledger_v l
    join public.deal_payments dp on dp.id = l.source_id
   where l.source_table = 'deal_payments'
     and dp.billing_type in ('recurring_monthly','recurring_yearly')
     and dp.start_date is not null
     and l.period <> to_char(dp.start_date::timestamptz, 'YYYY-MM');
  if n <> 0 then
    raise exception 'ledger attribution: % recurring rows off their period month', n;
  end if;
  -- paid one_time rows keep the paid month
  select count(*) into n
    from public.accounting_ledger_v l
    join public.deal_payments dp on dp.id = l.source_id
   where l.source_table = 'deal_payments'
     and dp.billing_type = 'one_time' and dp.paid_at is not null
     and l.period <> to_char(dp.paid_at, 'YYYY-MM');
  if n <> 0 then
    raise exception 'ledger attribution: % one_time rows off their paid month', n;
  end if;
end $$;
```

- [ ] **Step 2: Apply to prod (CONTROLLER session only)**

`mcp__plugin_supabase_supabase__apply_migration` with `project_id: "xujlrclyzxrvxszepquy"`, `name: "ledger_period_month_attribution"`. Success = post-asserts passed. Implementer subagents: skip and hand back.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260716210000_ledger_period_month_attribution.sql
git commit -m "feat(report): ledger attributes recurring rows to their period month"
```

---

### Task 2: Migration — `accounting_prepay_months` RPC

**Files:**
- Create: `supabase/migrations/20260716220000_accounting_prepay_months.sql`

**Interfaces:**
- Consumes: `current_user_is_admin()`, `current_user_in_group(text)`, the duplicate-period BEFORE-INSERT trigger (silently suppresses exact-duplicate recurring inserts → `insert … returning id into v` leaves it NULL), `deal_payment_lines` seeding conventions from `ensure_recurring_payments_v2`.
- Produces (Task 3 calls this): `public.accounting_prepay_months(p_deal_id uuid, p_months int, p_dry_run boolean default false) returns jsonb`. Shapes:
  - denied: `{ok:false, errors:['permission_denied']}`
  - no chain: `{ok:false, errors:['no_monthly_chain']}`
  - success: `{ok:true, dry_run:bool, months:int, periods_created:int, skipped_duplicates:int, groups:[{group_key, services:text[], monthly_net:numeric, from:date, to:date, created:int}]}` (groups with no seeded period report `{…, error:'no_base_period', created:0}` and are skipped).

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/20260716220000_accounting_prepay_months.sql` with exactly:

```sql
-- =============================================================================
-- Prepay N months (owner decision 2026-07-16): one RPC creates N chained
-- recurring_monthly periods per active monthly chain of the deal, born PAID
-- (paid_at = now()), mirroring ensure_recurring_payments_v2's grouping
-- (billing_group_id or solo:<job_id>) and line-seeding exactly. p_dry_run
-- returns the same per-group preview without inserting — the UI dialog shows
-- server-computed numbers. Knock-ons are all existing verified machinery:
-- recompute_job_period_dates, reconcile_deal_stage, on-hold release, nightly
-- spawner successor guard, duplicate-period trigger (suppressed inserts are
-- counted as skipped_duplicates, the chain still advances).
--
-- ROLLBACK (manual): drop function public.accounting_prepay_months(uuid, int, boolean);
-- =============================================================================

create or replace function public.accounting_prepay_months(
  p_deal_id uuid,
  p_months int,
  p_dry_run boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  grp record;
  v_months int;
  v_payment_id uuid;
  v_start date;
  v_end date;
  v_created int := 0;
  v_skipped int := 0;
  v_grp_created int;
  v_services text[];
  v_monthly_net numeric;
  v_groups jsonb := '[]'::jsonb;
  i int;
begin
  if not (public.current_user_is_admin() or public.current_user_in_group('accounting')) then
    return jsonb_build_object('ok', false, 'errors', array['permission_denied']);
  end if;
  v_months := least(greatest(coalesce(p_months, 0), 1), 12);

  for grp in
    select coalesce(jb.billing_group_id::text, 'solo:' || jb.id::text) as group_key,
           max(p.end_date) as cur_end
      from public.jobs jb
      join public.deal_payment_lines l on l.job_id = jb.id
      join public.deal_payments p on p.id = l.payment_id and p.billing_type = jb.billing_type
     where jb.deal_id = p_deal_id and jb.billing_active and not jb.archived
       and jb.billing_type = 'recurring_monthly'
     group by 1
  loop
    select array_agg(distinct jj.service_type),
           coalesce(sum(coalesce(jj.amount_net, 0)), 0)
      into v_services, v_monthly_net
      from public.jobs jj
     where jj.deal_id = p_deal_id and jj.billing_active and not jj.archived
       and jj.billing_type = 'recurring_monthly'
       and coalesce(jj.billing_group_id::text, 'solo:' || jj.id::text) = grp.group_key;

    if grp.cur_end is null then
      v_groups := v_groups || jsonb_build_object(
        'group_key', grp.group_key, 'services', to_jsonb(v_services),
        'monthly_net', v_monthly_net, 'error', 'no_base_period', 'created', 0);
      continue;
    end if;

    v_start := grp.cur_end;
    v_grp_created := 0;

    for i in 1..v_months loop
      v_end := (v_start + interval '1 month')::date;
      if not p_dry_run then
        v_payment_id := null;
        insert into public.deal_payments
          (deal_id, service_type, billing_type, start_date, end_date, status, paid_at, amount_net, vat_rate)
        values
          (p_deal_id, null, 'recurring_monthly', v_start, v_end, 'paid', now(), 0, 24)
        returning id into v_payment_id;

        if v_payment_id is null then
          -- duplicate-period trigger suppressed the row; chain still advances
          v_skipped := v_skipped + 1;
        else
          insert into public.deal_payment_lines (payment_id, job_id, label, amount_net, vat_rate)
            select v_payment_id, jj.id,
                   coalesce(nullif(jj.title, ''), jj.service_type),
                   coalesce(jj.amount_net, 0), coalesce(jj.vat_rate, 24)
              from public.jobs jj
             where jj.deal_id = p_deal_id and jj.billing_active and not jj.archived
               and jj.billing_type = 'recurring_monthly'
               and coalesce(jj.billing_group_id::text, 'solo:' || jj.id::text) = grp.group_key;
          update public.deal_payments p set
            amount_net = coalesce((select sum(amount_net) from public.deal_payment_lines where payment_id = p.id), 0),
            vat_rate   = coalesce((select max(vat_rate)  from public.deal_payment_lines where payment_id = p.id), 24)
           where p.id = v_payment_id;
          v_created := v_created + 1;
          v_grp_created := v_grp_created + 1;
        end if;
      end if;
      v_start := v_end;
    end loop;

    v_groups := v_groups || jsonb_build_object(
      'group_key', grp.group_key, 'services', to_jsonb(v_services),
      'monthly_net', v_monthly_net, 'from', grp.cur_end, 'to', v_start,
      'created', case when p_dry_run then v_months else v_grp_created end);
  end loop;

  if jsonb_array_length(v_groups) = 0 then
    return jsonb_build_object('ok', false, 'errors', array['no_monthly_chain']);
  end if;

  return jsonb_build_object(
    'ok', true, 'dry_run', p_dry_run, 'months', v_months,
    'periods_created', v_created, 'skipped_duplicates', v_skipped,
    'groups', v_groups);
end $$;

revoke execute on function public.accounting_prepay_months(uuid, int, boolean) from public, anon;
grant execute on function public.accounting_prepay_months(uuid, int, boolean) to authenticated;

-- Post-asserts.
do $$
declare n int;
begin
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'accounting_prepay_months';
  if n <> 1 then raise exception 'accounting_prepay_months missing (found %)', n; end if;
  if exists (
    select 1 from information_schema.routine_privileges rp
     where rp.routine_schema = 'public' and rp.routine_name = 'accounting_prepay_months'
       and rp.grantee in ('anon', 'PUBLIC')
  ) then
    raise exception 'accounting_prepay_months leaked to anon/PUBLIC';
  end if;
end $$;
```

- [ ] **Step 2: RED/GREEN harness + apply (CONTROLLER session only)**

Controller runs a rolled-back DO-block on prod BEFORE applying: fixture (client + deal + recurring_monthly job + seeded first paid period), impersonate admin via `perform set_config('request.jwt.claims', json_build_object('sub', <admin user_id>, 'role', 'authenticated')::text, true)`, then assert: RED = function does not exist yet; GREEN (create fn inside the block) = `p_months=>3` creates 3 chained paid rows (`start[i] = end[i-1]`, header amount = job amount), re-call `p_months=>1` continues from the new horizon, `p_dry_run=>true` inserts nothing, and without impersonation returns `permission_denied`. Everything rolled back via `raise exception`. Then apply via `apply_migration` (`name: "accounting_prepay_months"`). Implementer subagents: skip and hand back.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260716220000_accounting_prepay_months.sql
git commit -m "feat(billing): accounting_prepay_months RPC (chained paid periods + dry-run preview)"
```

---

### Task 3: Frontend — Prepay dialog in the Payments tab

**Files:**
- Modify: `src/lib/rpc.ts` (add typed wrapper next to the existing loose-`rpcCall` consumers, ~line 95)
- Create: `src/features/deals/PrepayDialog.tsx`
- Create: `src/features/deals/PrepayDialog.test.tsx`
- Modify: `src/features/deals/PaymentsPanel.tsx` (button + dialog mount)
- Modify: `src/i18n/locales/en/deals.json` + `src/i18n/locales/el/deals.json` (new `payments.prepay*` keys)

**Interfaces:**
- Consumes: Task 2's RPC result shapes (verbatim above); `rpcCall` from `src/lib/rpc.ts:81`; shadcn `Dialog/DialogContent/DialogHeader/DialogTitle/DialogDescription/DialogFooter` from `@/components/ui/dialog`; `dealPaymentsKey`/`jobsBillingKey` invalidation keys.
- Produces: `accountingPrepayMonths(dealId, months, dryRun)` helper; `<PrepayDialog dealId open onClose />` component; Prepay button in PaymentsPanel visible only when a `recurring_monthly` payment row exists.

- [ ] **Step 1: Add the rpc helper**

In `src/lib/rpc.ts`, after the `delete_leads` wrapper block (~line 95), add:

```ts
export type PrepayGroup = {
  group_key: string;
  services: string[];
  monthly_net: number;
  from?: string;
  to?: string;
  created: number;
  error?: string;
};
export type PrepayResult = {
  ok: boolean;
  errors?: string[];
  dry_run?: boolean;
  months?: number;
  periods_created?: number;
  skipped_duplicates?: number;
  groups?: PrepayGroup[];
};

/** Prepay N months of every active monthly chain on a deal (accounting/admin
 *  only — the RPC re-checks). dryRun returns the preview without inserting. */
export async function accountingPrepayMonths(
  dealId: string,
  months: number,
  dryRun: boolean,
): Promise<PrepayResult> {
  const { data, error } = await rpcCall('accounting_prepay_months', {
    p_deal_id: dealId,
    p_months: months,
    p_dry_run: dryRun,
  });
  if (error) throw new Error(error.message);
  return data as PrepayResult;
}
```

- [ ] **Step 2: Write the failing component test**

Create `src/features/deals/PrepayDialog.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { ReactNode } from 'react';

const calls: Array<{ months: number; dryRun: boolean }> = [];
const result: { value: Record<string, unknown> } = { value: {} };
// Flat mock — do NOT importOriginal: the real module instantiates the supabase
// client at import time. The component's type-only imports are erased at runtime.
vi.mock('@/lib/rpc', () => ({
  accountingPrepayMonths: (_dealId: string, months: number, dryRun: boolean) => {
    calls.push({ months, dryRun });
    return Promise.resolve(result.value);
  },
}));

import { PrepayDialog } from './PrepayDialog';

const wrap = (children: ReactNode) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

const PREVIEW = {
  ok: true,
  dry_run: true,
  months: 3,
  groups: [
    { group_key: 'solo:j1', services: ['local_seo'], monthly_net: 250, from: '2026-08-01', to: '2026-11-01', created: 3 },
  ],
};

describe('PrepayDialog', () => {
  beforeEach(() => {
    calls.length = 0;
    result.value = PREVIEW;
  });

  it('fetches a dry-run preview on open and shows chain + total', async () => {
    render(wrap(<PrepayDialog dealId="D1" open onClose={() => {}} />));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({ months: 3, dryRun: true });
    expect(await screen.findByText(/local_seo/i)).toBeInTheDocument();
    // total = 250 * 3
    expect(screen.getByText(/750\.00/)).toBeInTheDocument();
  });

  it('re-fetches the preview when months change', async () => {
    render(wrap(<PrepayDialog dealId="D1" open onClose={() => {}} />));
    await waitFor(() => expect(calls).toHaveLength(1));
    await userEvent.selectOptions(screen.getByRole('combobox'), '5');
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]).toEqual({ months: 5, dryRun: true });
  });

  it('confirm records the prepayment (dryRun false) and shows the result', async () => {
    render(wrap(<PrepayDialog dealId="D1" open onClose={() => {}} />));
    await waitFor(() => expect(calls).toHaveLength(1));
    result.value = { ok: true, dry_run: false, months: 3, periods_created: 3, skipped_duplicates: 0, groups: PREVIEW.groups };
    await userEvent.click(screen.getByRole('button', { name: /record|καταχώριση/i }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]).toEqual({ months: 3, dryRun: false });
    expect(await screen.findByText(/recorded .* as paid|ως πληρωμένες/i)).toBeInTheDocument();
  });

  it('shows the no-monthly-chain message when the RPC reports it', async () => {
    result.value = { ok: false, errors: ['no_monthly_chain'] };
    render(wrap(<PrepayDialog dealId="D1" open onClose={() => {}} />));
    expect(await screen.findByText(/monthly|μηνια/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/features/deals/PrepayDialog.test.tsx`
Expected: FAIL — `./PrepayDialog` module not found.

- [ ] **Step 4: Implement the dialog**

Create `src/features/deals/PrepayDialog.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { accountingPrepayMonths, type PrepayResult } from '@/lib/rpc';
import { dealPaymentsKey } from './hooks/useDealPayments';
import { jobsBillingKey } from './hooks/useJobsBilling';

const MONTH_CHOICES = [1, 2, 3, 4, 5, 6, 9, 12];

/** Records N prepaid months for every active monthly chain of the deal.
 *  The preview is SERVER-computed (RPC dry-run) so what you see is exactly
 *  what gets created; confirm re-runs the same RPC without dry-run. */
export function PrepayDialog({
  dealId,
  open,
  onClose,
}: {
  dealId: string;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation('deals');
  const qc = useQueryClient();
  const [months, setMonths] = useState(3);
  const [preview, setPreview] = useState<PrepayResult | null>(null);
  const [done, setDone] = useState<PrepayResult | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || done) return;
    let cancelled = false;
    setPreview(null);
    accountingPrepayMonths(dealId, months, true)
      .then((r) => {
        if (!cancelled) setPreview(r);
      })
      .catch((e: Error) => {
        if (!cancelled) setPreview({ ok: false, errors: [e.message] });
      });
    return () => {
      cancelled = true;
    };
  }, [dealId, months, open, done]);

  async function confirm() {
    setBusy(true);
    try {
      const r = await accountingPrepayMonths(dealId, months, false);
      setDone(r);
      void qc.invalidateQueries({ queryKey: dealPaymentsKey(dealId) });
      void qc.invalidateQueries({ queryKey: jobsBillingKey(dealId) });
      void qc.invalidateQueries({ queryKey: ['accounting-deals'] });
      void qc.invalidateQueries({ queryKey: ['accounting-ledger'] });
      void qc.invalidateQueries({ queryKey: ['accounting-pl-summary'] });
    } catch (e) {
      setDone({ ok: false, errors: [(e as Error).message] });
    } finally {
      setBusy(false);
    }
  }

  const groups = (preview?.groups ?? []).filter((g) => !g.error);
  const total = groups.reduce((s, g) => s + Number(g.monthly_net) * months, 0);
  const noChain = preview !== null && !preview.ok;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('payments.prepay_title', { defaultValue: 'Prepay months' })}</DialogTitle>
          <DialogDescription>
            {t('payments.prepay_desc', {
              defaultValue: 'Creates the future monthly periods and marks them as paid.',
            })}
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="space-y-2 text-sm">
            {done.ok ? (
              <p>
                {t('payments.prepay_done', {
                  n: done.periods_created ?? 0,
                  defaultValue: 'Recorded {{n}} period(s) as paid.',
                })}
                {(done.skipped_duplicates ?? 0) > 0 && (
                  <span className="block text-muted-foreground">
                    {t('payments.prepay_skipped', {
                      n: done.skipped_duplicates,
                      defaultValue: 'Skipped {{n}} duplicate period(s).',
                    })}
                  </span>
                )}
              </p>
            ) : (
              <p className="text-red-600">{(done.errors ?? []).join(', ')}</p>
            )}
          </div>
        ) : noChain ? (
          <p className="text-sm text-muted-foreground">
            {t('payments.prepay_no_chain', {
              defaultValue: 'This deal has no active monthly services.',
            })}
          </p>
        ) : (
          <div className="space-y-3 text-sm">
            <div>
              <Label className="text-xs">{t('payments.prepay_months', { defaultValue: 'Months' })}</Label>
              <select
                value={months}
                onChange={(e) => setMonths(Number(e.target.value))}
                className="mt-1 block w-24 rounded-md border border-input bg-background px-2 py-1 text-xs"
              >
                {MONTH_CHOICES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            {preview === null ? (
              <p className="text-muted-foreground">…</p>
            ) : (
              <>
                <ul className="space-y-1">
                  {groups.map((g) => (
                    <li key={g.group_key} className="flex justify-between gap-2">
                      <span className="min-w-0 truncate">{g.services.join(' + ')}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        €{Number(g.monthly_net).toFixed(2)}/{t('payments.prepay_mo', { defaultValue: 'mo' })} · {g.from} → {g.to}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="border-t pt-2 font-medium tabular-nums">
                  {t('payments.prepay_total', { defaultValue: 'Total to record' })}: €{total.toFixed(2)}
                </p>
              </>
            )}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            {done ? t('payments.prepay_close', { defaultValue: 'Close' }) : t('payments.prepay_cancel', { defaultValue: 'Cancel' })}
          </Button>
          {!done && !noChain && (
            <Button type="button" size="sm" onClick={() => void confirm()} disabled={busy || preview === null}>
              {t('payments.prepay_confirm', { defaultValue: 'Record prepayment' })}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 5: Wire the button into PaymentsPanel**

In `src/features/deals/PaymentsPanel.tsx`:

Add imports (after the `useDealPayments` import block):

```ts
import { PrepayDialog } from './PrepayDialog';
```

Inside `PaymentsPanel`, next to the existing `showAdd` state:

```ts
  const [showPrepay, setShowPrepay] = useState(false);
  const hasMonthly = payments.some((p) => p.billing_type === 'recurring_monthly');
```

Replace the header's single Add button block:

```tsx
        <Button type="button" size="sm" variant="outline" onClick={() => setShowAdd((v) => !v)}>
          {t('payments.add')}
        </Button>
```

with:

```tsx
        <div className="flex items-center gap-2">
          {hasMonthly && (
            <Button type="button" size="sm" variant="outline" onClick={() => setShowPrepay(true)}>
              {t('payments.prepay_button', { defaultValue: 'Prepay' })}
            </Button>
          )}
          <Button type="button" size="sm" variant="outline" onClick={() => setShowAdd((v) => !v)}>
            {t('payments.add')}
          </Button>
        </div>
```

And before the component's closing `</div>` (after the `showAdd` block), add:

```tsx
      {showPrepay && (
        <PrepayDialog dealId={dealId} open={showPrepay} onClose={() => setShowPrepay(false)} />
      )}
```

- [ ] **Step 6: Add i18n keys**

In `src/i18n/locales/en/deals.json`, inside the `"payments"` object add:

```json
    "prepay_button": "Prepay",
    "prepay_title": "Prepay months",
    "prepay_desc": "Creates the future monthly periods and marks them as paid.",
    "prepay_months": "Months",
    "prepay_mo": "mo",
    "prepay_total": "Total to record",
    "prepay_confirm": "Record prepayment",
    "prepay_cancel": "Cancel",
    "prepay_close": "Close",
    "prepay_done": "Recorded {{n}} period(s) as paid.",
    "prepay_skipped": "Skipped {{n}} duplicate period(s).",
    "prepay_no_chain": "This deal has no active monthly services."
```

In `src/i18n/locales/el/deals.json`, inside `"payments"` add:

```json
    "prepay_button": "Προπληρωμή",
    "prepay_title": "Προπληρωμή μηνών",
    "prepay_desc": "Δημιουργεί τις μελλοντικές μηνιαίες περιόδους και τις μαρκάρει πληρωμένες.",
    "prepay_months": "Μήνες",
    "prepay_mo": "μήνα",
    "prepay_total": "Σύνολο καταχώρισης",
    "prepay_confirm": "Καταχώριση προπληρωμής",
    "prepay_cancel": "Άκυρο",
    "prepay_close": "Κλείσιμο",
    "prepay_done": "Καταχωρίστηκαν {{n}} περίοδοι ως πληρωμένες.",
    "prepay_skipped": "Παραλείφθηκαν {{n}} διπλές περίοδοι.",
    "prepay_no_chain": "Το deal δεν έχει ενεργές μηνιαίες υπηρεσίες."
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run src/features/deals/PrepayDialog.test.tsx`
Expected: PASS (4/4).

- [ ] **Step 8: Commit**

```bash
git add src/lib/rpc.ts src/features/deals/PrepayDialog.tsx src/features/deals/PrepayDialog.test.tsx src/features/deals/PaymentsPanel.tsx src/i18n/locales/en/deals.json src/i18n/locales/el/deals.json
git commit -m "feat(billing): Prepay months dialog on the Payments tab"
```

---

### Task 4: Verification, push, demo smoke (CONTROLLER-heavy)

**Files:** none new.

- [ ] **Step 1: Targeted tests + strict build**

Run: `npx vitest run src/features/deals src/features/accounting_report`
Expected: PASS (all — includes the pre-existing PaymentsPanel-adjacent and report hook tests).

Run: `npm run build`
Expected: exit 0. (The RPC is called through the loose `rpcCall` — no generated-types dependency.)

- [ ] **Step 2: Commit anything outstanding and push (CONTROLLER)**

```bash
git pull --rebase origin main
git push origin main
```

- [ ] **Step 3: Demo smoke on prod (CONTROLLER)**

Create a throwaway client/deal/monthly job + first paid period via SQL; in the UI: Prepay 2 months → Payments tab shows 2 new paid chained rows; Report month filter shows each month's amount in its own month; deal stays Paid In Full; job due = new horizon. Then delete the demo rows (payments/lines/job/deal/client + activity_log leftovers).
