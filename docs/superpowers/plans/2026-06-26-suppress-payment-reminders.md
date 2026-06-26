# Per-deal "pause payment reminders" toggle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-deal toggle that stops the three automated payment-reminder emails for that deal; editable by accounting + admins, visible (read-only) to everyone else.

**Architecture:** One boolean column `deals.suppress_payment_reminders` (default `false`). The daily `enqueue_payment_reminders()` cron gets one extra predicate so suppressed deals are skipped. A focused React component (`PaymentRemindersToggle`) renders a shadcn `Checkbox` in the deal's Payment tab, gated by the existing `canManageBilling` check and saved through the project's `useAutoSave` pattern.

**Tech Stack:** Postgres (Supabase migration + `security definer` pl/pgsql), React + TypeScript + Vite, TanStack Query, react-i18next, shadcn `Checkbox`.

**Spec:** `docs/superpowers/specs/2026-06-26-suppress-payment-reminders-design.md`

---

## File Map

- **Create** `supabase/migrations/20260626000000_deals_suppress_payment_reminders.sql` — add column + recreate cron with the predicate (+ rollback notes).
- **Modify** `src/types/supabase.ts` — add `suppress_payment_reminders` to the `deals` Row/Insert/Update types.
- **Create** `src/features/deals/PaymentRemindersToggle.tsx` — the toggle component (self-contained: reads/writes the one column).
- **Modify** `src/i18n/locales/en/deals.json` + `src/i18n/locales/el/deals.json` — label + hint strings.
- **Modify** `src/features/deals/DealDetailPage.tsx` — render the toggle at the top of the Payment tab.

> **Note on prod DB:** This project applies migrations directly to the production Supabase project (`CRM`, ref `xujlrclyzxrvxszepquy`) via the Supabase MCP (`apply_migration` / `execute_sql`), because there is no local DB stack. The migration here is additive and reversible (drop column / restore function). **Confirm with the user before the prod `apply_migration` step.**

---

## Task 1: Migration — add column + recreate cron predicate

**Files:**
- Create: `supabase/migrations/20260626000000_deals_suppress_payment_reminders.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- Per-deal "pause payment reminders" toggle.
-- When deals.suppress_payment_reminders = true, enqueue_payment_reminders() skips
-- that deal entirely (all 3 reminders: due_soon -7d / overdue +1d / final_notice +7d).
-- Editable from the deal Payment tab by accounting + admins (UI-gated, same as the
-- other billing fields). Default false => no behaviour change for existing deals.

alter table public.deals
  add column if not exists suppress_payment_reminders boolean not null default false;

comment on column public.deals.suppress_payment_reminders is
  'When true, enqueue_payment_reminders() skips this deal (no payment-reminder emails to the client).';

-- Recreate the reminder enqueuer with one added predicate on the deal join.
-- (Identical to 20260616000005 except for the `and d.suppress_payment_reminders = false` line.)
create or replace function public.enqueue_payment_reminders()
returns int
language plpgsql security definer set search_path = public as $$
declare
  r record;
  tkey text;
  dkey text;
  prefix text;
  created int := 0;
begin
  for r in
    select dp.id as payment_id, dp.service_type, dp.amount_gross, dp.start_date as due_date,
           dp.deal_id, c.name as client_name, c.email as to_email
      from public.deal_payments dp
      join public.deals d on d.id = dp.deal_id
                         and d.archived = false
                         and d.suppress_payment_reminders = false   -- NEW: skip paused deals
      join public.clients c on c.id = d.client_id
     where dp.status in ('pending', 'overdue')
       and c.email is not null and c.email <> ''
       and dp.start_date in (current_date + 7, current_date - 1, current_date - 7)
  loop
    if r.due_date = current_date + 7 then
      tkey := 'payment_due_soon'; prefix := 'pay_soon';
    elsif r.due_date = current_date - 1 then
      tkey := 'payment_overdue'; prefix := 'pay_overdue';
    else
      tkey := 'payment_final_notice'; prefix := 'pay_final';
    end if;

    dkey := prefix || ':' || r.payment_id;

    if exists (select 1 from public.email_log where dedupe_key = dkey and status = 'sent') then
      continue;
    end if;
    if exists (select 1 from public.email_outbox where dedupe_key = dkey and status in ('pending','sent')) then
      continue;
    end if;

    insert into public.email_outbox (identity, to_email, template_key, data, dedupe_key)
    values ('accounting', r.to_email, tkey,
            jsonb_build_object('client_name', r.client_name, 'service_type', r.service_type,
                               'amount_gross', r.amount_gross, 'due_date', to_char(r.due_date, 'DD/MM/YYYY'),
                               'deal_id', r.deal_id),
            dkey);
    created := created + 1;
  end loop;
  return created;
end $$;

-- ROLLBACK:
--   alter table public.deals drop column if exists suppress_payment_reminders;
--   -- then `create or replace function public.enqueue_payment_reminders()` restoring the
--   -- version in 20260616000005 (remove the `and d.suppress_payment_reminders = false` line).
```

- [ ] **Step 2: Commit the migration file**

```bash
git add supabase/migrations/20260626000000_deals_suppress_payment_reminders.sql
git commit -m "feat(deals): migration for suppress_payment_reminders flag + cron predicate"
```

- [ ] **Step 3: Apply to prod** (confirm with the user first)

Use Supabase MCP `apply_migration` with name `deals_suppress_payment_reminders` and the SQL body above (the `alter table` + `create or replace function`). Project ref `xujlrclyzxrvxszepquy`.

- [ ] **Step 4: Verify the column shipped**

Run via Supabase MCP `execute_sql`:

```sql
select column_name, data_type, column_default, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'deals'
  and column_name = 'suppress_payment_reminders';
```

Expected: exactly one row — `boolean`, `column_default` = `false`, `is_nullable` = `NO`.

- [ ] **Step 5: Verify the cron predicate shipped (deterministic function test)**

Run via Supabase MCP `execute_sql`:

```sql
select position('suppress_payment_reminders = false'
       in pg_get_functiondef('public.enqueue_payment_reminders'::regprocedure)) > 0 as has_predicate;
```

Expected: `has_predicate` = `true`.

---

## Task 2: Behavioral smoke — suppressed deal is skipped (rolled-back transaction)

This proves runtime behaviour end-to-end without persisting anything. Run the whole block via Supabase MCP `execute_sql` as a single statement; it ends in `rollback` so no rows (including the test outbox inserts) survive.

**Files:** none (live verification only).

- [ ] **Step 1: Run the rolled-back behavioral test**

```sql
do $$
declare
  v_control_deal uuid;
  v_suppressed_deal uuid;
  v_control_pay uuid;
  v_suppressed_pay uuid;
  v_control_rows int;
  v_suppressed_rows int;
begin
  -- Pick two distinct real, non-archived deals whose client has a usable email.
  select d.id into v_control_deal
    from public.deals d join public.clients c on c.id = d.client_id
   where d.archived = false and c.email is not null and c.email <> ''
   order by d.created_at desc limit 1;

  select d.id into v_suppressed_deal
    from public.deals d join public.clients c on c.id = d.client_id
   where d.archived = false and c.email is not null and c.email <> ''
     and d.id <> v_control_deal
   order by d.created_at desc limit 1;

  -- Control deal: reminders ON. Suppressed deal: reminders OFF.
  update public.deals set suppress_payment_reminders = false where id = v_control_deal;
  update public.deals set suppress_payment_reminders = true  where id = v_suppressed_deal;

  -- Give each an overdue payment dated in the window (current_date - 1 => payment_overdue).
  insert into public.deal_payments (deal_id, service_type, billing_type, amount, amount_gross, start_date, status)
  values (v_control_deal, 'web_seo', 'one_time', 100, 124, current_date - 1, 'overdue')
  returning id into v_control_pay;

  insert into public.deal_payments (deal_id, service_type, billing_type, amount, amount_gross, start_date, status)
  values (v_suppressed_deal, 'web_seo', 'one_time', 100, 124, current_date - 1, 'overdue')
  returning id into v_suppressed_pay;

  perform public.enqueue_payment_reminders();

  select count(*) into v_control_rows
    from public.email_outbox where dedupe_key = 'pay_overdue:' || v_control_pay;
  select count(*) into v_suppressed_rows
    from public.email_outbox where dedupe_key = 'pay_overdue:' || v_suppressed_pay;

  raise notice 'control_rows=% (expect 1)  suppressed_rows=% (expect 0)', v_control_rows, v_suppressed_rows;
  if v_control_rows <> 1 or v_suppressed_rows <> 0 then
    raise exception 'FAIL: control=% suppressed=%', v_control_rows, v_suppressed_rows;
  end if;
  raise notice 'PASS';

  rollback;
end $$;
```

Expected: a `PASS` notice (control = 1, suppressed = 0). If the `deal_payments` insert errors on a column name (schema has evolved since the original table def), inspect the live columns with `select column_name from information_schema.columns where table_name = 'deal_payments'` and align the insert column list — the assertion logic stays the same. The `rollback` guarantees nothing persists either way.

> Note: `do $$ ... rollback ... $$` rolls back the surrounding transaction. If the MCP wraps statements in an outer transaction that makes `rollback` inside `do` invalid, run the body as a top-level `begin; ... rollback;` script instead (same statements, no `do` wrapper, with `select` assertions).

---

## Task 3: Add the column to generated Supabase types

`DealRow` is `Database['public']['Tables']['deals']['Row'] & {…}`, so adding the field to the `deals` Row type makes it available on `deal` everywhere with no other type changes. Insert alphabetically between `stage_id` and `temp_deal_amount` in all three blocks.

**Files:**
- Modify: `src/types/supabase.ts`

- [ ] **Step 1: Add to the Row block**

Replace:

```ts
          stage_id: string
          temp_deal_amount: string | null
```

with:

```ts
          stage_id: string
          suppress_payment_reminders: boolean
          temp_deal_amount: string | null
```

- [ ] **Step 2: Add to the Insert block**

Replace:

```ts
          stage_id: string
          temp_deal_amount?: string | null
```

with:

```ts
          stage_id: string
          suppress_payment_reminders?: boolean
          temp_deal_amount?: string | null
```

- [ ] **Step 3: Add to the Update block**

Replace:

```ts
          stage_id?: string
          temp_deal_amount?: string | null
```

with:

```ts
          stage_id?: string
          suppress_payment_reminders?: boolean
          temp_deal_amount?: string | null
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc -b`
Expected: no errors (additive change).

- [ ] **Step 5: Commit**

```bash
git add src/types/supabase.ts
git commit -m "types(deals): add suppress_payment_reminders column"
```

---

## Task 4: Toggle component + i18n + wire into the Payment tab

**Files:**
- Create: `src/features/deals/PaymentRemindersToggle.tsx`
- Modify: `src/i18n/locales/en/deals.json`
- Modify: `src/i18n/locales/el/deals.json`
- Modify: `src/features/deals/DealDetailPage.tsx`

- [ ] **Step 1: Add i18n strings (English)**

In `src/i18n/locales/en/deals.json`, replace:

```json
  "new_deal": "New deal",
```

with:

```json
  "new_deal": "New deal",
  "reminders": {
    "suppress_label": "Pause payment reminders",
    "suppress_hint": "No payment-reminder emails will be sent to the client for this deal."
  },
```

- [ ] **Step 2: Add i18n strings (Greek)**

In `src/i18n/locales/el/deals.json`, replace:

```json
  "new_deal": "Νέα συμφωνία",
```

with:

```json
  "new_deal": "Νέα συμφωνία",
  "reminders": {
    "suppress_label": "Παύση υπενθυμίσεων πληρωμής",
    "suppress_hint": "Δεν θα αποστέλλονται emails υπενθύμισης πληρωμής στον πελάτη για αυτή τη συμφωνία."
  },
```

- [ ] **Step 3: Create the component**

Create `src/features/deals/PaymentRemindersToggle.tsx`:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { autoSaveLabel, useAutoSave } from '@/lib/autosave';

type Props = {
  dealId: string;
  initial: boolean;
  canEdit: boolean;
};

export function PaymentRemindersToggle({ dealId, initial, canEdit }: Props) {
  const { t, i18n } = useTranslation('deals');
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const qc = useQueryClient();
  const [suppress, setSuppress] = useState(initial);

  const status = useAutoSave(suppress, async (next) => {
    const { error } = await supabase
      .from('deals')
      .update({ suppress_payment_reminders: next })
      .eq('id', dealId);
    if (error) throw new Error(error.message);
    void qc.invalidateQueries({ queryKey: queryKeys.deal(dealId) });
    void qc.invalidateQueries({ queryKey: queryKeys.deals() });
    void qc.invalidateQueries({ queryKey: queryKeys.accountingDeals() });
  });

  return (
    <div className="flex items-start gap-3">
      <Checkbox
        id="suppress-payment-reminders"
        checked={suppress}
        disabled={!canEdit}
        onCheckedChange={(v) => setSuppress(v === true)}
        className="mt-0.5"
      />
      <div className="min-w-0 space-y-1">
        <Label htmlFor="suppress-payment-reminders" className="font-medium">
          {t('reminders.suppress_label')}
        </Label>
        <p className="text-xs text-muted-foreground">{t('reminders.suppress_hint')}</p>
        <div className="h-4 text-xs text-muted-foreground">{autoSaveLabel(status, lang)}</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Wire it into the Payment tab**

In `src/features/deals/DealDetailPage.tsx`, add the import near the other `./` imports (after the `DealNotesArea` import on line 37):

```tsx
import { PaymentRemindersToggle } from './PaymentRemindersToggle';
```

Then, in the `payment` tab, replace:

```tsx
        <TabsContent value="payment" className="mt-3 space-y-4 outline-none lg:min-h-0 lg:overflow-y-auto">
          {canManageBilling && (
```

with:

```tsx
        <TabsContent value="payment" className="mt-3 space-y-4 outline-none lg:min-h-0 lg:overflow-y-auto">
          <div className="rounded-xl border border-border/60 bg-card p-5 shadow-sm">
            <PaymentRemindersToggle
              dealId={dealId}
              initial={!!deal.suppress_payment_reminders}
              canEdit={canManageBilling}
            />
          </div>
          {canManageBilling && (
```

(The toggle card sits above the billing panel and is rendered for every user; `canEdit={canManageBilling}` disables the checkbox for non-accounting/admin so they see the state read-only.)

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: PASS (tsc -b + eslint `--max-warnings=0` both clean). If lint flags an unused var or index access, fix per `reference_build_strictness`.

- [ ] **Step 6: Commit**

```bash
git add src/features/deals/PaymentRemindersToggle.tsx src/features/deals/DealDetailPage.tsx src/i18n/locales/en/deals.json src/i18n/locales/el/deals.json
git commit -m "feat(deals): pause-payment-reminders toggle on the deal Payment tab"
```

---

## Task 5: UI smoke verification

**Files:** none (verification only).

- [ ] **Step 1: Verify as accounting/admin**

Open a deal's Payment tab (logged in as `info@itdev.gr` admin). Confirm: the toggle is enabled; flipping it ON shows "saving…/saved"; reload the page → it stays ON. Flip back OFF → persists.

- [ ] **Step 2: Verify as a non-billing user**

Logged in as a sales rep (pw `123456789`), open the same deal's Payment tab. Confirm the toggle is visible but disabled (cannot change it), and reflects the current state.

- [ ] **Step 3: Report**

Summarise the verification outcome (with the function-definition test result from Task 1 Step 5 and the behavioral PASS from Task 2). Do not claim success without the evidence.

---

## Changes / Revert

| Change | Revert |
| --- | --- |
| Migration adds `deals.suppress_payment_reminders` (default `false`) | `alter table public.deals drop column if exists suppress_payment_reminders;` |
| Migration recreates `enqueue_payment_reminders()` with the suppress predicate | `create or replace function` restoring the `20260616000005` body (predicate line removed) |
| `src/types/supabase.ts` — 3 added type lines | revert the commit |
| `PaymentRemindersToggle.tsx` + `DealDetailPage.tsx` + 2 locale files | revert the commit |

All DB changes are a single migration with inline `-- ROLLBACK:` notes; all frontend changes are atomic commits.
