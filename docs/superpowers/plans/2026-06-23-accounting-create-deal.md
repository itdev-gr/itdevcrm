# Accounting Create Deal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the accounting team create a new deal directly from the Accounting Onboarding board — for an existing or a brand-new client — landing it in the **New** column, and also create a matching converted "won" lead so future lead-intake dedup catches the same customer.

**Architecture:** One `security definer` RPC `accounting_create_deal` does all DB work atomically (optional client → deal → linked won lead, sharing one code). The frontend adds a capability-gated "New Deal" button to the board header that opens a dialog; a pure validator/param-builder module is unit-tested; a thin react-query mutation hook calls the RPC through the existing loose `rpcCall` wrapper.

**Tech Stack:** React + Vite + TypeScript, @tanstack/react-query, react-i18next, shadcn/ui (Dialog/Input/Label/Button), Supabase Postgres (plpgsql RPC), Vitest. Spec: `docs/superpowers/specs/2026-06-23-accounting-create-deal-design.md`.

**Prod DB apply note:** Migration **files** live in `supabase/migrations/`. Apply them to prod (project `xujlrclyzxrvxszepquy`) with the Supabase MCP `apply_migration` tool — per project history, Bash/curl DDL is blocked by the safety classifier; `apply_migration` is the supported path. Run SQL verification with the Supabase MCP `execute_sql` tool.

---

## File Structure

**Create:**
- `supabase/migrations/20260623170000_accounting_create_deal_permission.sql` — seed `accounting_onboarding.create` capability for the accounting group.
- `supabase/migrations/20260623170100_accounting_create_deal_rpc.sql` — the `accounting_create_deal` RPC.
- `src/features/accounting/newDeal.ts` — pure `validateNewDeal` + `buildCreateDealParams` (+ shared types).
- `src/features/accounting/newDeal.test.ts` — unit tests for the above.
- `src/features/accounting/hooks/useCreateAccountingDeal.ts` — mutation hook.
- `src/features/accounting/NewDealDialog.tsx` — the create dialog.

**Modify:**
- `src/lib/rpc.ts` — add `accountingCreateDeal()` wrapper + result type.
- `src/features/accounting/AccountingOnboardingKanbanPage.tsx` — add the gated button + render the dialog.
- `src/i18n/locales/en/accounting.json` and `src/i18n/locales/el/accounting.json` — add the `new_deal` key block.

---

## Task 1: Permission seed migration

**Files:**
- Create: `supabase/migrations/20260623170000_accounting_create_deal_permission.sql`

- [ ] **Step 1: Write the migration**

```sql
-- =============================================================================
-- accounting_onboarding.create capability — lets accounting members create deals
-- from the board (admins are always allowed via current_user_is_admin()).
-- =============================================================================
insert into public.group_permissions (group_id, board, action, scope, allowed)
select id, 'accounting_onboarding', 'create', 'all', true
from public.groups
where code = 'accounting'
on conflict (group_id, board, action) do nothing;

-- Rollback:
-- delete from public.group_permissions
--  where board = 'accounting_onboarding' and action = 'create'
--    and group_id in (select id from public.groups where code = 'accounting');
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260623170000_accounting_create_deal_permission.sql
git commit -m "feat(accounting): seed accounting_onboarding.create capability"
```

---

## Task 2: `accounting_create_deal` RPC migration

**Files:**
- Create: `supabase/migrations/20260623170100_accounting_create_deal_rpc.sql`

- [ ] **Step 1: Write the migration**

```sql
-- =============================================================================
-- accounting_create_deal: accounting creates a deal (existing or new client)
-- directly on the onboarding board, landing in the 'new' stage. Also creates a
-- matching converted 'won' lead (source='import', automations off) so lead-intake
-- dedup catches the same customer later. Deal + lead (+ new client) share one code.
-- =============================================================================
create or replace function public.accounting_create_deal(
  p_client_id uuid default null,
  p_new_client jsonb default null,
  p_title text default null,
  p_one_time numeric default 0,
  p_monthly numeric default 0,
  p_payment_method text default null,
  p_description text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  errors text[] := '{}';
  v_title text;
  v_pm text;
  v_code text;
  v_client_id uuid;
  v_client record;
  won_stage_id uuid;
  acc_new_stage_id uuid;
  v_deal_id uuid;
begin
  -- permission: admin OR accounting_onboarding.create
  if not (public.current_user_is_admin()
          or public.current_user_can('accounting_onboarding', 'create')) then
    return jsonb_build_object('ok', false, 'errors', array['not_authorized']);
  end if;

  -- validate
  if p_client_id is null and p_new_client is null then
    errors := array_append(errors, 'missing_client');
  end if;
  if p_client_id is not null and p_new_client is not null then
    errors := array_append(errors, 'ambiguous_client');
  end if;

  v_title := nullif(trim(coalesce(p_title, '')), '');
  if v_title is null then
    errors := array_append(errors, 'missing_title');
  end if;

  if p_new_client is not null
     and nullif(trim(coalesce(p_new_client->>'name', '')), '') is null then
    errors := array_append(errors, 'missing_client_name');
  end if;

  if coalesce(p_one_time, 0) < 0 or coalesce(p_monthly, 0) < 0 then
    errors := array_append(errors, 'invalid_amount');
  end if;

  v_pm := nullif(trim(coalesce(p_payment_method, '')), '');
  if v_pm is not null and v_pm not in ('cash', 'online') then
    errors := array_append(errors, 'invalid_payment_method');
  end if;

  if array_length(errors, 1) is not null and array_length(errors, 1) > 0 then
    return jsonb_build_object('ok', false, 'errors', errors);
  end if;

  -- one shared code for deal + won lead (+ new client)
  v_code := public.generate_lead_code();

  -- resolve / create client
  if p_new_client is not null then
    insert into public.clients (
      name, contact_first_name, contact_last_name, email, phone, address,
      industry, country, vat_number, website, assigned_owner_id, code, start_date
    ) values (
      trim(p_new_client->>'name'),
      nullif(trim(coalesce(p_new_client->>'contact_first_name', '')), ''),
      nullif(trim(coalesce(p_new_client->>'contact_last_name', '')), ''),
      nullif(trim(coalesce(p_new_client->>'email', '')), ''),
      nullif(trim(coalesce(p_new_client->>'phone', '')), ''),
      nullif(trim(coalesce(p_new_client->>'address', '')), ''),
      nullif(trim(coalesce(p_new_client->>'industry', '')), ''),
      nullif(trim(coalesce(p_new_client->>'country', '')), ''),
      nullif(trim(coalesce(p_new_client->>'vat_number', '')), ''),
      nullif(trim(coalesce(p_new_client->>'website', '')), ''),
      null, v_code, current_date
    ) returning id into v_client_id;
  else
    select id into v_client_id from public.clients where id = p_client_id;
    if v_client_id is null then
      return jsonb_build_object('ok', false, 'errors', array['client_not_found']);
    end if;
  end if;

  -- load client row for the lead's contact fields (existing or just-created)
  select * into v_client from public.clients where id = v_client_id;

  -- stages
  select id into won_stage_id
    from public.pipeline_stages where board = 'sales' and code = 'won' limit 1;
  select id into acc_new_stage_id
    from public.pipeline_stages where board = 'accounting_onboarding' and code = 'new' limit 1;

  -- deal (owner_user_id / won_by_user_id default null; currency/services_planned use defaults)
  insert into public.deals (
    client_id, title, description,
    one_time_value, recurring_monthly_value, payment_method,
    stage_id, accounting_stage_id,
    locked_at, locked_by, actual_close_date, code
  ) values (
    v_client_id, v_title, nullif(trim(coalesce(p_description, '')), ''),
    coalesce(p_one_time, 0), coalesce(p_monthly, 0), v_pm,
    won_stage_id, acc_new_stage_id,
    now(), auth.uid(), current_date, v_code
  ) returning id into v_deal_id;

  -- matching converted 'won' lead (dedup record). source='import' => no welcome
  -- email; automations_enabled=false => no won emails if ever updated;
  -- owner_user_id non-null => round-robin trigger is a no-op; phone_normalized
  -- auto-stamps from phone.
  insert into public.leads (
    source, title, code, stage_id, automations_enabled,
    converted_at, converted_deal_id, converted_client_id,
    company_name, contact_first_name, contact_last_name, email, phone,
    address, industry, country, vat_number, website,
    estimated_one_time_value, estimated_monthly_value, owner_user_id
  ) values (
    'import', v_title, v_code, won_stage_id, false,
    now(), v_deal_id, v_client_id,
    v_client.name, v_client.contact_first_name, v_client.contact_last_name,
    v_client.email, v_client.phone,
    v_client.address, v_client.industry, v_client.country, v_client.vat_number, v_client.website,
    coalesce(p_one_time, 0), coalesce(p_monthly, 0), auth.uid()
  );

  return jsonb_build_object('ok', true, 'deal_id', v_deal_id, 'code', v_code);
end $$;

grant execute on function public.accounting_create_deal(
  uuid, jsonb, text, numeric, numeric, text, text
) to authenticated;

-- Rollback:
-- drop function if exists public.accounting_create_deal(uuid, jsonb, text, numeric, numeric, text, text);
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260623170100_accounting_create_deal_rpc.sql
git commit -m "feat(accounting): accounting_create_deal RPC (deal + linked won lead)"
```

---

## Task 3: Apply migrations to prod + verify

**Files:** none (uses Supabase MCP against project `xujlrclyzxrvxszepquy`).

- [ ] **Step 1: Apply the permission seed**

Call the Supabase MCP `apply_migration` with `name: "accounting_create_deal_permission"` and the SQL body from Task 1 Step 1.

- [ ] **Step 2: Apply the RPC**

Call `apply_migration` with `name: "accounting_create_deal_rpc"` and the SQL body from Task 2 Step 1.

- [ ] **Step 3: Confirm the capability is live**

Run via `execute_sql`:

```sql
select g.code, gp.board, gp.action, gp.allowed
from public.group_permissions gp
join public.groups g on g.id = gp.group_id
where g.code = 'accounting' and gp.action = 'create' and gp.board = 'accounting_onboarding';
```
Expected: one row, `allowed = true`.

- [ ] **Step 4: Functional verification with a simulated accounting user, rolled back**

`auth.uid()` is null under the service role, so the permission guard would reject the call. Simulate a real accounting member and roll everything back so no prod data persists. Run as a single `execute_sql` call:

```sql
begin;
-- pick a non-admin accounting member
select set_config(
  'request.jwt.claims',
  json_build_object('sub', (
    select ug.user_id
    from public.user_groups ug
    join public.groups g on g.id = ug.group_id
    join public.profiles p on p.user_id = ug.user_id
    where g.code = 'accounting' and coalesce(p.is_admin, false) = false
    limit 1
  ))::text,
  true
);
set local role authenticated;

-- existing-client branch: use any existing client
select public.accounting_create_deal(
  (select id from public.clients where archived = false limit 1),
  null, 'PLAN TEST existing', 0, 49, 'online', 'plan verify'
) as existing_result;

-- new-client branch
select public.accounting_create_deal(
  null,
  '{"name":"PLAN TEST New Co","email":"plan@example.com","phone":"2101234567"}'::jsonb,
  'PLAN TEST new', 500, 0, 'cash', null
) as new_result;

-- inspect what would have been created (won leads linked to the just-made deals)
select l.code, l.source, l.automations_enabled, l.converted_at is not null as converted,
       l.phone, l.phone_normalized, ps.code as stage_code
from public.leads l
join public.pipeline_stages ps on ps.id = l.stage_id
where l.title like 'PLAN TEST%';
rollback;
```
Expected: both `accounting_create_deal` calls return `{"ok": true, "deal_id": "...", "code": "..."}`. The leads rows show `source = import`, `automations_enabled = false`, `converted = true`, `stage_code = won`, and `phone_normalized` populated (e.g. `2101234567`) for the new-client one. The `rollback` discards all of it.

- [ ] **Step 5: Permission-denial check, rolled back**

```sql
begin;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', (
    select ug.user_id
    from public.user_groups ug
    join public.groups g on g.id = ug.group_id
    join public.profiles p on p.user_id = ug.user_id
    where g.code = 'sales' and coalesce(p.is_admin, false) = false
    limit 1
  ))::text,
  true
);
set local role authenticated;
select public.accounting_create_deal(null, '{"name":"x"}'::jsonb, 'x', 0, 0, null, null) as denied;
rollback;
```
Expected: `{"ok": false, "errors": ["not_authorized"]}`.

- [ ] **Step 6: No commit** (DB-only task; migration files were committed in Tasks 1–2).

---

## Task 4: Pure validator + param builder (TDD)

**Files:**
- Create: `src/features/accounting/newDeal.ts`
- Test: `src/features/accounting/newDeal.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/features/accounting/newDeal.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { validateNewDeal, buildCreateDealParams, type NewDealInput } from './newDeal';

const base: NewDealInput = {
  mode: 'existing',
  existingClientId: 'c-1',
  newClientName: '',
  newClientEmail: '',
  newClientPhone: '',
  title: 'My deal',
  oneTime: 0,
  monthly: 0,
  paymentMethod: '',
  description: '',
};

describe('validateNewDeal', () => {
  it('passes for a valid existing-client deal', () => {
    expect(validateNewDeal(base)).toEqual([]);
  });

  it('requires an existing client when mode=existing', () => {
    expect(validateNewDeal({ ...base, existingClientId: null })).toEqual(['missing_client']);
  });

  it('requires a name when mode=new', () => {
    const input = { ...base, mode: 'new' as const, existingClientId: null, newClientName: '  ' };
    expect(validateNewDeal(input)).toEqual(['missing_client_name']);
  });

  it('passes for a valid new-client deal', () => {
    const input = { ...base, mode: 'new' as const, existingClientId: null, newClientName: 'Acme' };
    expect(validateNewDeal(input)).toEqual([]);
  });

  it('requires a non-blank title', () => {
    expect(validateNewDeal({ ...base, title: '   ' })).toEqual(['missing_title']);
  });

  it('rejects negative amounts', () => {
    expect(validateNewDeal({ ...base, oneTime: -1 })).toEqual(['invalid_amount']);
  });
});

describe('buildCreateDealParams', () => {
  it('maps an existing-client deal to RPC params', () => {
    expect(buildCreateDealParams({ ...base, paymentMethod: 'online', monthly: 49 })).toEqual({
      p_client_id: 'c-1',
      p_new_client: null,
      p_title: 'My deal',
      p_one_time: 0,
      p_monthly: 49,
      p_payment_method: 'online',
      p_description: null,
    });
  });

  it('maps a new-client deal, omitting blank optional contact fields', () => {
    const input = {
      ...base,
      mode: 'new' as const,
      existingClientId: null,
      newClientName: '  Acme  ',
      newClientEmail: 'a@b.gr',
      newClientPhone: '',
      title: '  Deal  ',
      description: '  note ',
    };
    expect(buildCreateDealParams(input)).toEqual({
      p_client_id: null,
      p_new_client: { name: 'Acme', email: 'a@b.gr' },
      p_title: 'Deal',
      p_one_time: 0,
      p_monthly: 0,
      p_payment_method: null,
      p_description: 'note',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/features/accounting/newDeal.test.ts`
Expected: FAIL — cannot resolve `./newDeal` / functions not defined.

- [ ] **Step 3: Write the implementation**

Create `src/features/accounting/newDeal.ts`:

```ts
export type NewDealClientMode = 'existing' | 'new';

export type NewDealInput = {
  mode: NewDealClientMode;
  existingClientId: string | null;
  newClientName: string;
  newClientEmail: string;
  newClientPhone: string;
  title: string;
  oneTime: number;
  monthly: number;
  paymentMethod: '' | 'cash' | 'online';
  description: string;
};

export type NewDealError =
  | 'missing_client'
  | 'missing_client_name'
  | 'missing_title'
  | 'invalid_amount';

export type CreateDealParams = {
  p_client_id: string | null;
  p_new_client: Record<string, string> | null;
  p_title: string;
  p_one_time: number;
  p_monthly: number;
  p_payment_method: string | null;
  p_description: string | null;
};

export function validateNewDeal(input: NewDealInput): NewDealError[] {
  const errors: NewDealError[] = [];
  if (input.mode === 'existing' && !input.existingClientId) errors.push('missing_client');
  if (input.mode === 'new' && input.newClientName.trim() === '') errors.push('missing_client_name');
  if (input.title.trim() === '') errors.push('missing_title');
  if (input.oneTime < 0 || input.monthly < 0) errors.push('invalid_amount');
  return errors;
}

export function buildCreateDealParams(input: NewDealInput): CreateDealParams {
  const newClient =
    input.mode === 'new'
      ? {
          name: input.newClientName.trim(),
          ...(input.newClientEmail.trim() ? { email: input.newClientEmail.trim() } : {}),
          ...(input.newClientPhone.trim() ? { phone: input.newClientPhone.trim() } : {}),
        }
      : null;
  return {
    p_client_id: input.mode === 'existing' ? input.existingClientId : null,
    p_new_client: newClient,
    p_title: input.title.trim(),
    p_one_time: input.oneTime,
    p_monthly: input.monthly,
    p_payment_method: input.paymentMethod === '' ? null : input.paymentMethod,
    p_description: input.description.trim() ? input.description.trim() : null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/features/accounting/newDeal.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/accounting/newDeal.ts src/features/accounting/newDeal.test.ts
git commit -m "feat(accounting): validateNewDeal + buildCreateDealParams (tested)"
```

---

## Task 5: RPC wrapper + mutation hook

**Files:**
- Modify: `src/lib/rpc.ts`
- Create: `src/features/accounting/hooks/useCreateAccountingDeal.ts`

- [ ] **Step 1: Add the wrapper to `src/lib/rpc.ts`**

Add this import near the top (after the existing `ImportedLeadRow` import on line 2):

```ts
import type { CreateDealParams } from '@/features/accounting/newDeal';
```

Append at the end of the file (it uses the existing module-private `rpcCall`):

```ts
// --- Accounting: create deal (+ linked won lead) -----------------------------
export type AccountingCreateDealResult =
  | { ok: true; deal_id: string; code: string }
  | { ok: false; errors: string[] };

// Accounting creates a deal directly on the onboarding board. Not in the
// generated types → loose `rpcCall`. The RPC enforces the capability server-side.
export async function accountingCreateDeal(
  params: CreateDealParams,
): Promise<AccountingCreateDealResult> {
  const { data, error } = await rpcCall('accounting_create_deal', params);
  if (error) return { ok: false, errors: [error.message] };
  const r = data as { ok: boolean; deal_id?: string; code?: string; errors?: string[] };
  if (!r.ok || !r.deal_id) return { ok: false, errors: r.errors ?? ['create_failed'] };
  return { ok: true, deal_id: r.deal_id, code: r.code ?? '' };
}
```

- [ ] **Step 2: Create the hook**

Create `src/features/accounting/hooks/useCreateAccountingDeal.ts`:

```ts
import { useMutation, useQueryClient, type DefaultError } from '@tanstack/react-query';
import { accountingCreateDeal } from '@/lib/rpc';
import type { CreateDealParams } from '../newDeal';
import { queryKeys } from '@/lib/queryKeys';
import { captureMutation } from '@/lib/sentry/captureMutation';

export function useCreateAccountingDeal() {
  const qc = useQueryClient();
  return useMutation<{ deal_id: string; code: string }, DefaultError, CreateDealParams>({
    mutationFn: captureMutation('accounting', 'create_deal', async (params: CreateDealParams) => {
      const r = await accountingCreateDeal(params);
      if (!r.ok) {
        const err = new Error(r.errors[0] ?? 'create_failed');
        (err as Error & { errors?: string[] }).errors = r.errors;
        throw err;
      }
      return { deal_id: r.deal_id, code: r.code };
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.accountingDeals() });
      void qc.invalidateQueries({ queryKey: queryKeys.clients() });
    },
  });
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npm run typecheck`
Expected: PASS (no type errors).

- [ ] **Step 4: Commit**

```bash
git add src/lib/rpc.ts src/features/accounting/hooks/useCreateAccountingDeal.ts
git commit -m "feat(accounting): accountingCreateDeal wrapper + useCreateAccountingDeal hook"
```

---

## Task 6: i18n keys

**Files:**
- Modify: `src/i18n/locales/en/accounting.json`
- Modify: `src/i18n/locales/el/accounting.json`

- [ ] **Step 1: Add the English block**

In `src/i18n/locales/en/accounting.json`, insert this as a new top-level key (e.g. immediately before the `"card": {` line). Ensure the preceding block ends with a comma and this block ends with `},`:

```json
  "new_deal": {
    "button": "New deal",
    "title": "New deal",
    "description": "Create a deal directly in accounting. It lands in the New column.",
    "existing_client": "Existing client",
    "new_client": "New client",
    "client_name": "Client / company name",
    "client_email": "Email",
    "client_phone": "Phone",
    "deal_title": "Deal title",
    "one_time": "One-time (€)",
    "monthly": "Monthly (€)",
    "payment_method": "Payment method",
    "payment_none": "—",
    "payment_cash": "Cash",
    "payment_online": "Online",
    "notes": "Notes",
    "cancel": "Cancel",
    "submit": "Create deal",
    "submitting": "Creating…",
    "errors": {
      "missing_client": "Pick a client.",
      "missing_client_name": "Enter the client / company name.",
      "missing_title": "Enter a deal title.",
      "invalid_amount": "Amounts can't be negative.",
      "not_authorized": "You don't have permission to create deals.",
      "client_not_found": "That client no longer exists.",
      "invalid_payment_method": "Invalid payment method.",
      "ambiguous_client": "Choose either an existing or a new client, not both.",
      "create_failed": "Could not create the deal. Try again."
    }
  },
```

- [ ] **Step 2: Add the Greek block**

In `src/i18n/locales/el/accounting.json`, insert the matching block (same placement/comma rules):

```json
  "new_deal": {
    "button": "Νέα συμφωνία",
    "title": "Νέα συμφωνία",
    "description": "Δημιουργία συμφωνίας απευθείας στο λογιστήριο. Εμφανίζεται στη στήλη «Νέα».",
    "existing_client": "Υπάρχων πελάτης",
    "new_client": "Νέος πελάτης",
    "client_name": "Όνομα πελάτη / εταιρείας",
    "client_email": "Email",
    "client_phone": "Τηλέφωνο",
    "deal_title": "Τίτλος συμφωνίας",
    "one_time": "Εφάπαξ (€)",
    "monthly": "Μηνιαία (€)",
    "payment_method": "Τρόπος πληρωμής",
    "payment_none": "—",
    "payment_cash": "Μετρητά",
    "payment_online": "Online",
    "notes": "Σημειώσεις",
    "cancel": "Άκυρο",
    "submit": "Δημιουργία",
    "submitting": "Δημιουργία…",
    "errors": {
      "missing_client": "Επίλεξε πελάτη.",
      "missing_client_name": "Συμπλήρωσε το όνομα πελάτη / εταιρείας.",
      "missing_title": "Συμπλήρωσε τίτλο συμφωνίας.",
      "invalid_amount": "Τα ποσά δεν μπορεί να είναι αρνητικά.",
      "not_authorized": "Δεν έχεις δικαίωμα δημιουργίας συμφωνιών.",
      "client_not_found": "Ο πελάτης δεν υπάρχει πλέον.",
      "invalid_payment_method": "Μη έγκυρος τρόπος πληρωμής.",
      "ambiguous_client": "Διάλεξε υπάρχοντα ή νέο πελάτη, όχι και τα δύο.",
      "create_failed": "Αδυναμία δημιουργίας. Δοκίμασε ξανά."
    }
  },
```

- [ ] **Step 3: Verify the JSON parses**

Run: `node -e "require('./src/i18n/locales/en/accounting.json'); require('./src/i18n/locales/el/accounting.json'); console.log('json ok')"`
Expected: prints `json ok` (no SyntaxError).

- [ ] **Step 4: Commit**

```bash
git add src/i18n/locales/en/accounting.json src/i18n/locales/el/accounting.json
git commit -m "i18n(accounting): new_deal dialog strings (en + el)"
```

---

## Task 7: NewDealDialog + board button

**Files:**
- Create: `src/features/accounting/NewDealDialog.tsx`
- Modify: `src/features/accounting/AccountingOnboardingKanbanPage.tsx`

- [ ] **Step 1: Create the dialog**

Create `src/features/accounting/NewDealDialog.tsx`:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ClientPicker, type PickedClient } from '@/features/clients/ClientPicker';
import { useCreateAccountingDeal } from './hooks/useCreateAccountingDeal';
import {
  validateNewDeal,
  buildCreateDealParams,
  type NewDealInput,
  type NewDealClientMode,
} from './newDeal';

type Props = { open: boolean; onClose: () => void };

export function NewDealDialog({ open, onClose }: Props) {
  const { t } = useTranslation('accounting');
  const navigate = useNavigate();
  const create = useCreateAccountingDeal();

  const [mode, setMode] = useState<NewDealClientMode>('existing');
  const [client, setClient] = useState<PickedClient | null>(null);
  const [newClientName, setNewClientName] = useState('');
  const [newClientEmail, setNewClientEmail] = useState('');
  const [newClientPhone, setNewClientPhone] = useState('');
  const [title, setTitle] = useState('');
  const [oneTime, setOneTime] = useState('');
  const [monthly, setMonthly] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'' | 'cash' | 'online'>('');
  const [description, setDescription] = useState('');

  function reset() {
    setMode('existing');
    setClient(null);
    setNewClientName('');
    setNewClientEmail('');
    setNewClientPhone('');
    setTitle('');
    setOneTime('');
    setMonthly('');
    setPaymentMethod('');
    setDescription('');
  }

  function close() {
    reset();
    onClose();
  }

  function buildInput(): NewDealInput {
    return {
      mode,
      existingClientId: client?.id ?? null,
      newClientName,
      newClientEmail,
      newClientPhone,
      title,
      oneTime: Number(oneTime) || 0,
      monthly: Number(monthly) || 0,
      paymentMethod,
      description,
    };
  }

  function showErrors(keys: string[]) {
    alert(keys.map((k) => t(`new_deal.errors.${k}`, { defaultValue: k })).join('\n'));
  }

  function onSubmit() {
    const input = buildInput();
    const errs = validateNewDeal(input);
    if (errs.length > 0) {
      showErrors(errs);
      return;
    }
    create.mutate(buildCreateDealParams(input), {
      onSuccess: (r) => {
        reset();
        onClose();
        navigate(`/deals/${r.deal_id}`);
      },
      onError: (err) => {
        const errors = (err as Error & { errors?: string[] }).errors ?? [(err as Error).message];
        showErrors(errors);
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('new_deal.title')}</DialogTitle>
          <DialogDescription>{t('new_deal.description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant={mode === 'existing' ? 'default' : 'outline'}
              onClick={() => setMode('existing')}
            >
              {t('new_deal.existing_client')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mode === 'new' ? 'default' : 'outline'}
              onClick={() => setMode('new')}
            >
              {t('new_deal.new_client')}
            </Button>
          </div>

          {mode === 'existing' ? (
            <ClientPicker value={client} onChange={setClient} id="new-deal-client" />
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="nc-name">{t('new_deal.client_name')}</Label>
                <Input
                  id="nc-name"
                  value={newClientName}
                  onChange={(e) => setNewClientName(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="nc-email">{t('new_deal.client_email')}</Label>
                  <Input
                    id="nc-email"
                    value={newClientEmail}
                    onChange={(e) => setNewClientEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="nc-phone">{t('new_deal.client_phone')}</Label>
                  <Input
                    id="nc-phone"
                    value={newClientPhone}
                    onChange={(e) => setNewClientPhone(e.target.value)}
                  />
                </div>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="nd-title">{t('new_deal.deal_title')}</Label>
            <Input id="nd-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="nd-onetime">{t('new_deal.one_time')}</Label>
              <Input
                id="nd-onetime"
                type="number"
                min="0"
                value={oneTime}
                onChange={(e) => setOneTime(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nd-monthly">{t('new_deal.monthly')}</Label>
              <Input
                id="nd-monthly"
                type="number"
                min="0"
                value={monthly}
                onChange={(e) => setMonthly(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="nd-pm">{t('new_deal.payment_method')}</Label>
            <select
              id="nd-pm"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as '' | 'cash' | 'online')}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
            >
              <option value="">{t('new_deal.payment_none')}</option>
              <option value="cash">{t('new_deal.payment_cash')}</option>
              <option value="online">{t('new_deal.payment_online')}</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="nd-desc">{t('new_deal.notes')}</Label>
            <Input id="nd-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={create.isPending}>
            {t('new_deal.cancel')}
          </Button>
          <Button onClick={onSubmit} disabled={create.isPending}>
            {create.isPending ? t('new_deal.submitting') : t('new_deal.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Wire it into the board page**

In `src/features/accounting/AccountingOnboardingKanbanPage.tsx`:

Add these imports after the existing import block (the `Button` path is the shadcn button used elsewhere):

```tsx
import { Button } from '@/components/ui/button';
import { NewDealDialog } from './NewDealDialog';
import { useEffectivePermission } from '@/features/permissions/hooks/useEffectivePermission';
import { useAuthStore } from '@/lib/stores/authStore';
```

Inside the component, with the other hooks (before the `if (isLoading)` early return — e.g. right after the `markPaid` line), add:

```tsx
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const { allowed: canCreate } = useEffectivePermission('accounting_onboarding', 'create');
  const canCreateDeal = isAdmin || canCreate;
  const [openNewDeal, setOpenNewDeal] = useState(false);
```

Replace the header line:

```tsx
      <PageHeader title={t('kanban.title')} />
```

with:

```tsx
      <PageHeader title={t('kanban.title')}>
        {canCreateDeal ? (
          <Button onClick={() => setOpenNewDeal(true)}>+ {t('new_deal.button')}</Button>
        ) : null}
      </PageHeader>
```

Add the dialog right before the closing `</div>` of the page (after the `<CloseDealDialog ... />` block):

```tsx
      <NewDealDialog open={openNewDeal} onClose={() => setOpenNewDeal(false)} />
```

- [ ] **Step 3: Build (strict)**

Run: `npm run build`
Expected: PASS — `tsc -b` clean, `eslint --max-warnings=0` clean, vite build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/features/accounting/NewDealDialog.tsx src/features/accounting/AccountingOnboardingKanbanPage.tsx
git commit -m "feat(accounting): New Deal button + dialog on onboarding board"
```

---

## Task 8: Live smoke test

**Files:** none.

**Precondition:** Tasks 1–3 applied to prod; frontend running (`npm run dev`) or the deployed app, logged in as an accounting member or admin.

- [ ] **Step 1: Existing-client deal**

Open `/accounting/onboarding`. Click **New deal** → keep "Existing client", search and pick a client, set a title, monthly = 30, payment = Online, submit. Expect: redirect to `/deals/<id>`; a copyable deal code is shown.

- [ ] **Step 2: Confirm it's in the New column**

Go back to `/accounting/onboarding`. Expect a card for the new deal in the **New** column.

- [ ] **Step 3: New-client deal**

Click **New deal** → "New client", enter a name + phone, title, one-time = 200, submit. Expect: redirect to the deal; a new client created.

- [ ] **Step 4: Verify the linked won lead (read-only)**

Via Supabase MCP `execute_sql`:

```sql
select d.code, d.title, l.source, l.automations_enabled,
       l.converted_at is not null as lead_converted, l.phone_normalized,
       ps.code as lead_stage
from public.deals d
join public.leads l on l.converted_deal_id = d.id
join public.pipeline_stages ps on ps.id = l.stage_id
where d.code = '<code from Step 1 or 3>';
```
Expected: one row — `source = import`, `automations_enabled = false`, `lead_converted = true`, `lead_stage = won`, `phone_normalized` populated for the new-client case.

- [ ] **Step 5: Confirm no welcome/won email enqueued**

```sql
select * from public.email_log
where lead_id = (select id from public.leads where converted_deal_id =
  (select id from public.deals where code = '<code>'))
order by created_at desc;
```
Expected: no `lead_welcome` / `won_welcome` / `won_next_steps` rows for that lead.

- [ ] **Step 6: Confirm the won lead is NOT on the active sales kanban**

Open `/sales/kanban`. The new customer should NOT appear as an active lead (it's converted). Optionally toggle "Include won/converted" on `/sales/leads` to see it listed as converted.

- [ ] **Step 7: No commit** (verification only).

---

## Self-Review (completed during planning)

**Spec coverage:**
- Existing-or-new client → Task 2 RPC (both branches) + Task 7 dialog modes. ✓
- Deal shell only (no jobs) → RPC creates no jobs. ✓
- Permissions = accounting members + admins → Task 1 capability seed + Task 2 guard + Task 7 button gate. ✓
- Lightweight validation (client + title) → Task 4 validator + Task 2 guard. ✓
- Matching won lead (source=import, automations off, converted/won, owner non-null, phone_normalized) → Task 2 leads insert; verified Tasks 3/8. ✓
- One shared code → Task 2 `v_code`. ✓
- Deal defaults (stage=won, accounting=new, owner null, locked, actual_close_date today, invoiced_date untouched) → Task 2. ✓

**Placeholder scan:** `<code ...>` / the user-id subselects in Task 3/8 are runtime values fetched by the shown queries, not unfilled placeholders. No TBD/TODO. ✓

**Type consistency:** `CreateDealParams` / `NewDealInput` / `NewDealClientMode` defined in `newDeal.ts` (Task 4) and imported consistently by `rpc.ts` (Task 5), `useCreateAccountingDeal.ts` (Task 5), and `NewDealDialog.tsx` (Task 7). RPC param names (`p_client_id`, `p_new_client`, …) match between `buildCreateDealParams`, the wrapper, and the SQL signature. ✓
