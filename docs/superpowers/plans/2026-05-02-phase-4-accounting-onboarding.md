# Phase 4 — Accounting Onboarding Kanban Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Full Sales→Accounting handoff machinery. After Sales locks a Won deal, it appears on a new `/accounting/onboarding` kanban with the 8 stages already seeded in Phase 2 (`new → documents_verified → invoice_issued → awaiting_payment → partial_payment → paid_in_full` plus side states `on_hold`, `refunded`). When the accounting team drags a deal to `paid_in_full`, the `complete_accounting()` RPC spawns one `jobs` row per planned service into its sub-department's kanban (visible to Phase 6 tech boards).

**Architecture:** Two new columns on `deals`: `services_planned JSONB` (array of `{service_type, billing_type, monthly_amount, one_time_amount, setup_fee}` set by sales before lock), and `accounting_stage_id UUID` (separate from `stage_id` — deal stays on Sales `Won` AND appears on Accounting kanban). `lock_deal()` (existing RPC) is modified to validate services_planned ≥ 1 and to set `accounting_stage_id` to Accounting `new`. New `complete_accounting()` RPC validates accounting fields, sets `accounting_completed_at`, and spawns `jobs` rows from `services_planned`.

**Tech Stack:** All from Phases 0–3.

**Reference spec:** `docs/superpowers/specs/2026-05-01-itdevcrm-design.md` — Sections 6.4, 6.5 (8A=ii: jobs spawned at accounting completion, 8B=i: standard accounting stages, 8C=ii: validation, 8D=iii: accounting keeps editing, 8E=ii: VAT fields), 8.2 (accounting onboarding workflow), 14 (Phase 4 plan).

**Builds on:** Phases 0–3 (all shipped to main, verified in full smoke test).

**Branch:** `main` (push directly per project memory).

---

## Sub-phase grouping

```
A. Schema (Tasks 1–3)        deals additions, lock_deal modify, complete_accounting RPC, types regen
B. Sales side (Tasks 4–5)    ServicesPlannedField in DealForm + display on Deal detail
C. Accounting side (6–11)    i18n + hooks + kanban + drag-drop + sidebar nav + card display
D. Polish (12–13)            Realtime sync + activity log polish
E. Acceptance (14–15)        e2e + acceptance pass
```

---

## File Structure (Phase 4 outcome)

```
.
├── supabase/
│   └── migrations/
│       ├── 20260502000012_phase4_deals_extension.sql
│       └── 20260502000013_complete_accounting_rpc.sql
├── src/
│   ├── lib/
│   │   ├── queryKeys.ts                     # MODIFY: accountingDeals, services keys
│   │   └── rpc.ts                           # MODIFY: completeAccounting wrapper
│   ├── features/
│   │   ├── deals/
│   │   │   ├── DealForm.tsx                 # MODIFY: add ServicesPlannedField
│   │   │   ├── ServicesPlannedField.tsx     # NEW: array editor for services_planned
│   │   │   └── DealDetailPage.tsx           # MODIFY: display services_planned read-only on Overview when locked
│   │   └── accounting/
│   │       ├── hooks/
│   │       │   ├── useAccountingDeals.ts
│   │       │   ├── useMoveAccountingStage.ts   # optimistic
│   │       │   ├── useCompleteAccounting.ts    # RPC wrapper
│   │       │   └── useAccountingKanbanRealtime.ts
│   │       ├── AccountingOnboardingKanbanPage.tsx
│   │       ├── AccountingKanbanCard.tsx
│   │       └── AccountingKanbanColumn.tsx
│   ├── app/router.tsx                       # MODIFY: add /accounting/onboarding
│   ├── components/layout/Sidebar.tsx        # MODIFY: Accounting group section
│   └── i18n/locales/{en,el}/accounting.json
└── tests/
    └── accounting-handoff.spec.ts            # NEW
```

---

## Conventions

- Every task ends in commit + push to `main`.
- **REQUIRED gate verification protocol** (per the lesson learned in Phase 3): every subagent must run `npm run format:check && npm run lint && npm run typecheck && npm run test:run` as a single chained command and confirm `exit: 0`. Auto-fix with `npm run format` if needed. Do not commit otherwise.
- Migration env vars: `SUPABASE_ACCESS_TOKEN` + `SUPABASE_DB_PASSWORD` already in shell.
- Regenerate types after every migration: `npm run types:gen`.

---

# Sub-phase A — Schema (Tasks 1–3)

## Task 1 — Migration: deals extension + modify lock_deal

**Files:**
- Create: `supabase/migrations/20260502000012_phase4_deals_extension.sql`

- [ ] **Step 1: Migration**

```sql
-- =============================================================================
-- Phase 4 migration: deals extension + lock_deal modification
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Add services_planned + accounting_stage_id columns to deals
-- ---------------------------------------------------------------------------
alter table public.deals
  add column if not exists services_planned jsonb not null default '[]'::jsonb,
  add column if not exists accounting_stage_id uuid references public.pipeline_stages(id);

create index if not exists deals_accounting_stage
  on public.deals (accounting_stage_id)
  where accounting_stage_id is not null and archived = false;

-- ---------------------------------------------------------------------------
-- 2. Update deals_update RLS to also allow accounting users to update
-- ---------------------------------------------------------------------------
drop policy if exists deals_update on public.deals;

create policy deals_update
  on public.deals for update
  to authenticated
  using (
    public.current_user_is_admin()
    or public.current_user_can('sales', 'edit')
    or (locked_at is null and public.current_user_can('sales', 'move_stage'))
    or public.current_user_can('accounting_onboarding', 'edit')
    or public.current_user_can('accounting_onboarding', 'move_stage')
    or public.current_user_can('accounting_recurring', 'edit')
  )
  with check (
    public.current_user_is_admin()
    or public.current_user_can('sales', 'edit')
    or public.current_user_can('sales', 'move_stage')
    or public.current_user_can('accounting_onboarding', 'edit')
    or public.current_user_can('accounting_onboarding', 'move_stage')
    or public.current_user_can('accounting_recurring', 'edit')
  );

-- ---------------------------------------------------------------------------
-- 3. lock_deal — modify validation (services_planned instead of jobs count)
--    and set accounting_stage_id on success.
-- ---------------------------------------------------------------------------
create or replace function public.lock_deal(target_deal_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  d record;
  c record;
  errors text[] := '{}';
  contract_count int;
  service_count int;
  won_stage_id uuid;
  acc_new_stage_id uuid;
begin
  if not (public.current_user_is_admin() or public.current_user_can('sales', 'lock_deal')) then
    return jsonb_build_object('ok', false, 'errors', array['permission_denied']);
  end if;

  select * into d from public.deals where id = target_deal_id;
  if d is null then
    return jsonb_build_object('ok', false, 'errors', array['deal_not_found']);
  end if;
  if d.locked_at is not null then
    return jsonb_build_object('ok', false, 'errors', array['already_locked']);
  end if;

  select * into c from public.clients where id = d.client_id;
  if c is null then
    errors := errors || 'client_missing';
  end if;

  if coalesce(d.one_time_value, 0) + coalesce(d.recurring_monthly_value, 0) <= 0 then
    errors := errors || 'value_required';
  end if;

  -- Phase 4: services_planned must have at least one entry.
  service_count := coalesce(jsonb_array_length(d.services_planned), 0);
  if service_count = 0 then
    errors := errors || 'at_least_one_service_required';
  end if;

  if c is not null then
    if c.email is null or c.email = '' then
      errors := errors || 'client_email_required';
    end if;
    if (c.phone is null or c.phone = '') and (c.address is null or c.address = '') then
      errors := errors || 'client_phone_or_address_required';
    end if;
  end if;

  select count(*) into contract_count
  from public.attachments
  where parent_type = 'deal' and parent_id = d.id and kind = 'contract' and archived = false;
  if contract_count = 0 then
    errors := errors || 'contract_attachment_required';
  end if;

  if array_length(errors, 1) is not null and array_length(errors, 1) > 0 then
    return jsonb_build_object('ok', false, 'errors', errors);
  end if;

  select id into won_stage_id from public.pipeline_stages where board = 'sales' and code = 'won' limit 1;
  select id into acc_new_stage_id from public.pipeline_stages where board = 'accounting_onboarding' and code = 'new' limit 1;

  update public.deals
    set
      locked_at = now(),
      locked_by = auth.uid(),
      actual_close_date = current_date,
      stage_id = coalesce(won_stage_id, stage_id),
      accounting_stage_id = coalesce(acc_new_stage_id, accounting_stage_id)
    where id = d.id;

  if d.owner_user_id is not null then
    insert into public.notifications (user_id, type, payload)
    values (
      d.owner_user_id,
      'lock_deal',
      jsonb_build_object('deal_id', d.id, 'client_id', d.client_id)
    );
  end if;

  return jsonb_build_object('ok', true, 'deal_id', d.id);
end $$;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260502000012_phase4_deals_extension.sql
git commit -m "feat(db): Phase 4 deals extension — services_planned, accounting_stage_id, lock_deal modify"
git push
```

---

## Task 2 — Migration: complete_accounting RPC

**Files:**
- Create: `supabase/migrations/20260502000013_complete_accounting_rpc.sql`

- [ ] **Step 1: Migration**

```sql
-- =============================================================================
-- Phase 4 migration: complete_accounting() RPC
-- =============================================================================

create or replace function public.complete_accounting(target_deal_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  d record;
  errors text[] := '{}';
  service jsonb;
  service_type_val text;
  billing_type_val text;
  one_time_amt numeric;
  monthly_amt numeric;
  setup_fee_val numeric;
  paid_stage_id uuid;
  group_id_val uuid;
  job_stage_id uuid;
begin
  if not (public.current_user_is_admin() or public.current_user_can('accounting_onboarding', 'complete_accounting')) then
    return jsonb_build_object('ok', false, 'errors', array['permission_denied']);
  end if;

  select * into d from public.deals where id = target_deal_id;
  if d is null then
    return jsonb_build_object('ok', false, 'errors', array['deal_not_found']);
  end if;
  if d.accounting_completed_at is not null then
    return jsonb_build_object('ok', false, 'errors', array['already_completed']);
  end if;
  if d.locked_at is null then
    return jsonb_build_object('ok', false, 'errors', array['deal_not_locked']);
  end if;

  -- Validations
  if coalesce(jsonb_array_length(d.services_planned), 0) = 0 then
    errors := errors || 'services_planned_empty';
  end if;

  if d.one_time_value is null or d.one_time_value < 0 then
    errors := errors || 'invalid_one_time_value';
  end if;

  -- VAT fields can be 0 but not null in MVP — adjust here when more validation rules emerge.

  if array_length(errors, 1) is not null and array_length(errors, 1) > 0 then
    return jsonb_build_object('ok', false, 'errors', errors);
  end if;

  -- Spawn jobs from services_planned. Each entry must have service_type and billing_type.
  for service in select * from jsonb_array_elements(d.services_planned)
  loop
    service_type_val := service->>'service_type';
    billing_type_val := service->>'billing_type';
    if service_type_val not in ('web_seo', 'local_seo', 'web_dev', 'social_media') then
      continue;
    end if;
    if billing_type_val not in ('one_time', 'recurring_monthly') then
      continue;
    end if;
    one_time_amt := nullif(service->>'one_time_amount', '')::numeric;
    monthly_amt := nullif(service->>'monthly_amount', '')::numeric;
    setup_fee_val := nullif(service->>'setup_fee', '')::numeric;

    -- Resolve assigned group + initial stage for that service.
    select id into group_id_val from public.groups where code = service_type_val;
    select id into job_stage_id
      from public.pipeline_stages
      where board = service_type_val
        and code = case service_type_val
          when 'web_dev' then 'awaiting_brief'
          else 'onboarding'
        end
      limit 1;

    insert into public.jobs (
      deal_id, client_id, service_type, billing_type,
      one_time_amount, monthly_amount, setup_fee,
      stage_id, assigned_group_id, status, started_at
    )
    values (
      d.id, d.client_id, service_type_val, billing_type_val,
      one_time_amt, monthly_amt, setup_fee_val,
      job_stage_id, group_id_val, 'active', now()
    );
  end loop;

  -- Move accounting stage to paid_in_full + set completed metadata
  select id into paid_stage_id from public.pipeline_stages
    where board = 'accounting_onboarding' and code = 'paid_in_full' limit 1;

  update public.deals
    set
      accounting_completed_at = now(),
      accounting_completed_by = auth.uid(),
      accounting_stage_id = coalesce(paid_stage_id, accounting_stage_id)
    where id = d.id;

  -- Notify deal owner
  if d.owner_user_id is not null then
    insert into public.notifications (user_id, type, payload)
    values (
      d.owner_user_id,
      'complete_accounting',
      jsonb_build_object('deal_id', d.id, 'client_id', d.client_id)
    );
  end if;

  return jsonb_build_object('ok', true, 'deal_id', d.id);
end $$;

grant execute on function public.complete_accounting(uuid) to authenticated;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260502000013_complete_accounting_rpc.sql
git commit -m "feat(db): complete_accounting RPC — spawns jobs from services_planned"
git push
```

---

## Task 3 — Apply migrations + regen types

- [ ] **Step 1: Apply**

```bash
echo y | npx -y supabase@latest db push 2>&1 | tail -8
```

- [ ] **Step 2: Verify**

```bash
URL=$(grep '^VITE_SUPABASE_URL' .env.local | cut -d= -f2-)
SVC=$(npx -y supabase@latest projects api-keys --project-ref xujlrclyzxrvxszepquy 2>/dev/null | awk '/service_role/{print $3; exit}')
echo "complete_accounting RPC:"
curl -sS -o /dev/null -w "  HTTP %{http_code}\n" -X POST "${URL}/rest/v1/rpc/complete_accounting" -H "apikey: ${SVC}" -H "Authorization: Bearer ${SVC}" -H "Content-Type: application/json" -d '{"target_deal_id":"00000000-0000-0000-0000-000000000000"}'
echo "deals.services_planned column:"
curl -sS "${URL}/rest/v1/deals?select=services_planned&limit=1" -H "apikey: ${SVC}" -H "Authorization: Bearer ${SVC}" -o /dev/null -w "  HTTP %{http_code}\n"
echo "deals.accounting_stage_id column:"
curl -sS "${URL}/rest/v1/deals?select=accounting_stage_id&limit=1" -H "apikey: ${SVC}" -H "Authorization: Bearer ${SVC}" -o /dev/null -w "  HTTP %{http_code}\n"
```

All HTTP 200.

- [ ] **Step 3: Regen types + gates**

```bash
npm run types:gen
npm run format:check && npm run lint && npm run typecheck && npm run test:run
echo "exit: $?"
```

If exit != 0, fix and re-verify.

- [ ] **Step 4: Commit**

```bash
git add src/types/supabase.ts
git commit -m "feat(types): regenerate after Phase 4 deals extension + complete_accounting RPC"
git push
```

---

# Sub-phase B — Sales side (Tasks 4–5)

## Task 4 — ServicesPlannedField component

**Files:**
- Create: `src/features/deals/ServicesPlannedField.tsx`

- [ ] **Step 1: Component**

```tsx
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export type PlannedService = {
  service_type: 'web_seo' | 'local_seo' | 'web_dev' | 'social_media';
  billing_type: 'one_time' | 'recurring_monthly';
  one_time_amount?: number;
  monthly_amount?: number;
  setup_fee?: number;
};

type Props = {
  value: PlannedService[];
  onChange: (next: PlannedService[]) => void;
  disabled?: boolean;
};

const SERVICE_TYPES: PlannedService['service_type'][] = ['web_seo', 'local_seo', 'web_dev', 'social_media'];
const BILLING_TYPES: PlannedService['billing_type'][] = ['recurring_monthly', 'one_time'];

export function ServicesPlannedField({ value, onChange, disabled }: Props) {
  const { t } = useTranslation('deals');

  function addRow() {
    onChange([...value, { service_type: 'web_seo', billing_type: 'recurring_monthly' }]);
  }

  function removeRow(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }

  function updateRow(idx: number, patch: Partial<PlannedService>) {
    onChange(value.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  }

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">{t('services.title')}</Label>
        {!disabled && (
          <Button type="button" size="sm" variant="outline" onClick={addRow}>
            {t('services.add')}
          </Button>
        )}
      </div>

      {value.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('services.empty')}</p>
      ) : (
        <ul className="space-y-2">
          {value.map((row, idx) => (
            <li key={idx} className="grid grid-cols-12 items-end gap-2">
              <div className="col-span-3">
                <Select
                  value={row.service_type}
                  disabled={disabled}
                  onValueChange={(v) =>
                    updateRow(idx, { service_type: v as PlannedService['service_type'] })
                  }
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SERVICE_TYPES.map((s) => (
                      <SelectItem key={s} value={s}>{t(`services.types.${s}`)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-3">
                <Select
                  value={row.billing_type}
                  disabled={disabled}
                  onValueChange={(v) =>
                    updateRow(idx, { billing_type: v as PlannedService['billing_type'] })
                  }
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {BILLING_TYPES.map((b) => (
                      <SelectItem key={b} value={b}>{t(`services.billing.${b}`)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {row.billing_type === 'recurring_monthly' ? (
                <>
                  <div className="col-span-2">
                    <Label className="text-xs">{t('services.monthly_amount')}</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      disabled={disabled}
                      value={row.monthly_amount ?? ''}
                      onChange={(e) =>
                        updateRow(idx, {
                          monthly_amount: e.target.value === '' ? undefined : Number(e.target.value),
                        })
                      }
                    />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs">{t('services.setup_fee')}</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      disabled={disabled}
                      value={row.setup_fee ?? ''}
                      onChange={(e) =>
                        updateRow(idx, {
                          setup_fee: e.target.value === '' ? undefined : Number(e.target.value),
                        })
                      }
                    />
                  </div>
                </>
              ) : (
                <div className="col-span-4">
                  <Label className="text-xs">{t('services.one_time_amount')}</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    disabled={disabled}
                    value={row.one_time_amount ?? ''}
                    onChange={(e) =>
                      updateRow(idx, {
                        one_time_amount: e.target.value === '' ? undefined : Number(e.target.value),
                      })
                    }
                  />
                </div>
              )}
              <div className="col-span-2 flex justify-end">
                {!disabled && (
                  <Button type="button" size="sm" variant="destructive" onClick={() => removeRow(idx)}>
                    ×
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add deals i18n keys**

Read `src/i18n/locales/en/deals.json`. Add a `services` section:

```json
"services": {
  "title": "Services",
  "add": "Add service",
  "empty": "No services planned yet — add at least one before locking the deal.",
  "monthly_amount": "Monthly €",
  "one_time_amount": "One-time €",
  "setup_fee": "Setup fee €",
  "types": {
    "web_seo": "Web SEO",
    "local_seo": "Local SEO",
    "web_dev": "Web Dev",
    "social_media": "Social Media"
  },
  "billing": {
    "recurring_monthly": "Recurring monthly",
    "one_time": "One-time"
  }
}
```

Same in `el/deals.json`:

```json
"services": {
  "title": "Υπηρεσίες",
  "add": "Προσθήκη υπηρεσίας",
  "empty": "Δεν έχουν προγραμματιστεί υπηρεσίες — προσθέστε τουλάχιστον μία πριν το κλείδωμα.",
  "monthly_amount": "Μηνιαίο €",
  "one_time_amount": "Εφάπαξ €",
  "setup_fee": "Τέλος εγκατάστασης €",
  "types": {
    "web_seo": "Web SEO",
    "local_seo": "Τοπικό SEO",
    "web_dev": "Ανάπτυξη Ιστού",
    "social_media": "Social Media"
  },
  "billing": {
    "recurring_monthly": "Επαναλαμβανόμενο μηνιαία",
    "one_time": "Εφάπαξ"
  }
}
```

Add at the same nesting level as the existing `lock`, `tabs`, etc. objects (inside the root object).

- [ ] **Step 3: Gates + commit**

```bash
npm run format:check && npm run lint && npm run typecheck && npm run test:run
echo "exit: $?"
git add -A
git commit -m "feat(deals): ServicesPlannedField component + EN/EL services i18n keys"
git push
```

---

## Task 5 — Wire ServicesPlannedField into DealForm + display read-only on locked deals

**Files:**
- Modify: `src/features/deals/DealForm.tsx`
- Modify: `src/features/deals/DealDetailPage.tsx`

- [ ] **Step 1: DealForm — add services state + render ServicesPlannedField**

Read `src/features/deals/DealForm.tsx`. Add:

```tsx
import { useState } from 'react';
import { ServicesPlannedField, type PlannedService } from './ServicesPlannedField';
import type { Json } from '@/types/supabase';
// ...
const [services, setServices] = useState<PlannedService[]>(() => {
  const raw = initial?.services_planned;
  if (Array.isArray(raw)) return raw as PlannedService[];
  return [];
});

const isLocked = !!initial?.locked_at;
```

In the JSX, add a row spanning both columns above the submit buttons:

```tsx
<div className="md:col-span-2">
  <ServicesPlannedField value={services} onChange={setServices} disabled={isLocked} />
</div>
```

In `onSubmit`, include `services_planned` in the upsert payload:

```ts
async function onSubmit(values: FormValues) {
  // ...existing cleaning logic
  const payload = {
    ...cleaned,
    client_id: values.client_id,
    title: values.title,
    stage_id: values.stage_id,
    services_planned: services as unknown as Json,
    ...(initial?.id ? { id: initial.id } : {}),
  };
  const id = await upsert.mutateAsync(payload);
  onDone?.(id);
}
```

(Add import for `Json` from `@/types/supabase` if not already present.)

- [ ] **Step 2: DealDetailPage — note the locked state**

DealDetailPage already passes `initial={deal}` to DealForm. Since `services` reads from `initial?.services_planned`, and `isLocked` is set from `locked_at`, the read-only state is automatic. No further changes needed.

- [ ] **Step 3: Gates + commit**

```bash
npm run format:check && npm run lint && npm run typecheck && npm run test:run
echo "exit: $?"
git add -A
git commit -m "feat(deals): integrate ServicesPlannedField into DealForm with locked-deal read-only"
git push
```

---

# Sub-phase C — Accounting (Tasks 6–11)

## Task 6 — i18n: accounting namespace + queryKeys + RPC wrapper

**Files:**
- Create: `src/i18n/locales/en/accounting.json`
- Create: `src/i18n/locales/el/accounting.json`
- Modify: `src/lib/i18n.ts`
- Modify: `src/lib/queryKeys.ts`
- Modify: `src/lib/rpc.ts`

- [ ] **Step 1: EN `accounting.json`**

```json
{
  "nav": {
    "onboarding": "Accounting onboarding"
  },
  "kanban": {
    "title": "Accounting onboarding",
    "empty_column": "Drop deals here"
  },
  "card": {
    "services": "Services",
    "lock_date": "Locked"
  },
  "actions": {
    "complete": "Complete accounting"
  },
  "complete": {
    "errors": {
      "permission_denied": "You do not have permission to complete accounting.",
      "deal_not_locked": "Deal must be locked by sales first.",
      "already_completed": "This deal is already completed.",
      "services_planned_empty": "No services planned on this deal — sales must add at least one service.",
      "invalid_one_time_value": "Invalid one-time value."
    }
  }
}
```

- [ ] **Step 2: EL `accounting.json`**

```json
{
  "nav": {
    "onboarding": "Λογιστήριο - Νέοι"
  },
  "kanban": {
    "title": "Λογιστήριο - Νέοι",
    "empty_column": "Σύρετε εδώ τις συμφωνίες"
  },
  "card": {
    "services": "Υπηρεσίες",
    "lock_date": "Κλειδώθηκε"
  },
  "actions": {
    "complete": "Ολοκλήρωση Λογιστηρίου"
  },
  "complete": {
    "errors": {
      "permission_denied": "Δεν έχετε δικαίωμα ολοκλήρωσης λογιστηρίου.",
      "deal_not_locked": "Η συμφωνία πρέπει πρώτα να κλειδωθεί από τις πωλήσεις.",
      "already_completed": "Η συμφωνία είναι ήδη ολοκληρωμένη.",
      "services_planned_empty": "Δεν έχουν προγραμματιστεί υπηρεσίες — οι πωλήσεις πρέπει να προσθέσουν τουλάχιστον μία.",
      "invalid_one_time_value": "Μη έγκυρο εφάπαξ ποσό."
    }
  }
}
```

- [ ] **Step 3: Register namespace in `src/lib/i18n.ts`**

```ts
import enAccounting from '@/i18n/locales/en/accounting.json';
import elAccounting from '@/i18n/locales/el/accounting.json';
// ...
ns: ['common', 'auth', 'users', 'admin', 'clients', 'deals', 'sales', 'accounting'],
resources: {
  en: { ...existing, accounting: enAccounting },
  el: { ...existing, accounting: elAccounting },
},
```

- [ ] **Step 4: queryKeys**

```ts
// Append to queryKeys:
accountingDeals: () => ['accounting-deals'] as const,
```

- [ ] **Step 5: RPC wrapper**

`src/lib/rpc.ts` — append:

```ts
export type CompleteAccountingResult =
  | { ok: true; deal_id: string }
  | { ok: false; errors: string[] };

export async function completeAccounting(dealId: string): Promise<CompleteAccountingResult> {
  const { data, error } = await supabase.rpc('complete_accounting', { target_deal_id: dealId });
  if (error) {
    return { ok: false, errors: [error.message] };
  }
  return data as CompleteAccountingResult;
}
```

- [ ] **Step 6: Gates + commit**

```bash
npm run format:check && npm run lint && npm run typecheck && npm run test:run
echo "exit: $?"
git add -A
git commit -m "feat(accounting): i18n namespace + queryKeys + completeAccounting wrapper"
git push
```

---

## Task 7 — Accounting hooks

**Files:**
- Create: `src/features/accounting/hooks/useAccountingDeals.ts`
- Create: `src/features/accounting/hooks/useMoveAccountingStage.ts`
- Create: `src/features/accounting/hooks/useCompleteAccounting.ts`

- [ ] **Step 1: useAccountingDeals**

```ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { DealRow } from '@/features/deals/hooks/useDeals';

export type AccountingDealRow = DealRow & {
  accounting_stage?: { id: string; code: string; board: string } | null;
};

export function useAccountingDeals() {
  return useQuery({
    queryKey: queryKeys.accountingDeals(),
    queryFn: async (): Promise<AccountingDealRow[]> => {
      const { data, error } = await supabase
        .from('deals')
        .select(
          '*, client:clients(id, name), accounting_stage:pipeline_stages!deals_accounting_stage_id_fkey(id, code, board)',
        )
        .not('accounting_stage_id', 'is', null)
        .is('accounting_completed_at', null)
        .eq('archived', false)
        .order('updated_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as AccountingDealRow[];
    },
  });
}
```

(Note the FK alias `deals_accounting_stage_id_fkey` — Postgres auto-generates this name when we added the column with `references public.pipeline_stages(id)`. Verify with `\d deals` if needed.)

- [ ] **Step 2: useMoveAccountingStage (optimistic)**

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { AccountingDealRow } from './useAccountingDeals';

export function useMoveAccountingStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ dealId, stageId }: { dealId: string; stageId: string }) => {
      const { error } = await supabase.from('deals').update({ accounting_stage_id: stageId }).eq('id', dealId);
      if (error) throw new Error(error.message);
    },
    onMutate: async ({ dealId, stageId }) => {
      await qc.cancelQueries({ queryKey: queryKeys.accountingDeals() });
      const previous = qc.getQueriesData<AccountingDealRow[]>({ queryKey: queryKeys.accountingDeals() });
      previous.forEach(([key, value]) => {
        if (!value) return;
        qc.setQueryData<AccountingDealRow[]>(
          key,
          value.map((d) => (d.id === dealId ? { ...d, accounting_stage_id: stageId } : d)),
        );
      });
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      ctx?.previous?.forEach(([key, value]) => qc.setQueryData(key, value));
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.accountingDeals() });
    },
  });
}
```

- [ ] **Step 3: useCompleteAccounting**

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { completeAccounting } from '@/lib/rpc';
import { queryKeys } from '@/lib/queryKeys';

export function useCompleteAccounting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dealId: string) => {
      const result = await completeAccounting(dealId);
      if (!result.ok) {
        const err = new Error(result.errors[0] ?? 'complete_failed');
        (err as Error & { errors?: string[] }).errors = result.errors;
        throw err;
      }
      return result.deal_id;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.accountingDeals() });
    },
  });
}
```

- [ ] **Step 4: Gates + commit**

```bash
npm run format:check && npm run lint && npm run typecheck && npm run test:run
echo "exit: $?"
git add src/features/accounting/
git commit -m "feat(accounting): hooks (useAccountingDeals, useMoveAccountingStage, useCompleteAccounting)"
git push
```

---

## Task 8 — AccountingKanbanCard + Column

**Files:**
- Create: `src/features/accounting/AccountingKanbanCard.tsx`
- Create: `src/features/accounting/AccountingKanbanColumn.tsx`

- [ ] **Step 1: Card**

```tsx
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Card, CardContent } from '@/components/ui/card';
import type { AccountingDealRow } from './hooks/useAccountingDeals';

export function AccountingKanbanCard({ deal }: { deal: AccountingDealRow }) {
  const { t } = useTranslation('accounting');
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: deal.id,
    data: { dealId: deal.id, currentAccountingStage: deal.accounting_stage_id },
  });
  const style = transform
    ? { transform: CSS.Translate.toString(transform), opacity: isDragging ? 0.5 : 1 }
    : undefined;

  const services = Array.isArray(deal.services_planned)
    ? (deal.services_planned as unknown as Array<{ service_type: string }>)
    : [];

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <Card className="cursor-grab active:cursor-grabbing">
        <CardContent className="space-y-1 p-3">
          <Link to={`/deals/${deal.id}`} className="block text-sm font-medium hover:underline">
            {deal.title}
          </Link>
          <div className="text-xs text-muted-foreground">{deal.client?.name}</div>
          {services.length > 0 && (
            <div className="text-xs">
              <span className="text-muted-foreground">{t('card.services')}: </span>
              {services.map((s) => s.service_type).join(', ')}
            </div>
          )}
          <div className="text-xs">
            {Number(deal.one_time_value ?? 0) > 0 && (
              <span>€{Number(deal.one_time_value).toFixed(0)} once</span>
            )}
            {Number(deal.recurring_monthly_value ?? 0) > 0 && (
              <span className="ml-2">€{Number(deal.recurring_monthly_value).toFixed(0)}/mo</span>
            )}
          </div>
          {deal.locked_at && (
            <div className="text-[10px] text-muted-foreground">
              {t('card.lock_date')}: {new Date(deal.locked_at).toLocaleDateString()}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Column**

```tsx
import { useTranslation } from 'react-i18next';
import { useDroppable } from '@dnd-kit/core';
import { AccountingKanbanCard } from './AccountingKanbanCard';
import type { AccountingDealRow } from './hooks/useAccountingDeals';

type Props = {
  stageId: string;
  stageLabel: string;
  deals: AccountingDealRow[];
};

export function AccountingKanbanColumn({ stageId, stageLabel, deals }: Props) {
  const { t } = useTranslation('accounting');
  const { setNodeRef, isOver } = useDroppable({ id: stageId });
  return (
    <div
      ref={setNodeRef}
      className={`flex w-80 shrink-0 flex-col rounded-md border ${
        isOver ? 'bg-slate-100' : 'bg-slate-50'
      }`}
    >
      <header className="border-b px-3 py-2">
        <span className="text-sm font-medium">{stageLabel}</span>
        <span className="ml-1 text-xs text-muted-foreground">({deals.length})</span>
      </header>
      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        {deals.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-muted-foreground">
            {t('kanban.empty_column')}
          </p>
        ) : (
          deals.map((d) => <AccountingKanbanCard key={d.id} deal={d} />)
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Gates + commit**

```bash
npm run format:check && npm run lint && npm run typecheck && npm run test:run
echo "exit: $?"
git add src/features/accounting/
git commit -m "feat(accounting): kanban Card + Column components"
git push
```

---

## Task 9 — AccountingOnboardingKanbanPage with drag-drop + complete-on-Paid

**Files:**
- Create: `src/features/accounting/AccountingOnboardingKanbanPage.tsx`

- [ ] **Step 1: Page**

```tsx
import { useTranslation } from 'react-i18next';
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { useAccountingDeals, type AccountingDealRow } from './hooks/useAccountingDeals';
import { useMoveAccountingStage } from './hooks/useMoveAccountingStage';
import { useCompleteAccounting } from './hooks/useCompleteAccounting';
import { usePipelineStages } from '@/features/stages/hooks/usePipelineStages';
import { AccountingKanbanColumn } from './AccountingKanbanColumn';

export function AccountingOnboardingKanbanPage() {
  const { t, i18n } = useTranslation('accounting');
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const { data: deals = [], isLoading } = useAccountingDeals();
  const { data: stages = [] } = usePipelineStages();
  const moveStage = useMoveAccountingStage();
  const complete = useCompleteAccounting();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  if (isLoading) return <div className="p-8">…</div>;

  const accStages = stages
    .filter((s) => s.board === 'accounting_onboarding' && !s.archived)
    .sort((a, b) => a.position - b.position);

  const paidStage = accStages.find((s) => s.code === 'paid_in_full');

  const dealsByStage = new Map<string, AccountingDealRow[]>();
  for (const s of accStages) dealsByStage.set(s.id, []);
  for (const d of deals) {
    const sid = d.accounting_stage_id;
    if (!sid) continue;
    const list = dealsByStage.get(sid);
    if (list) list.push(d);
  }

  async function onDragEnd(e: DragEndEvent) {
    const dealId = String(e.active.id);
    const stageId = e.over ? String(e.over.id) : null;
    if (!stageId) return;
    if (paidStage && stageId === paidStage.id) {
      try {
        await complete.mutateAsync(dealId);
      } catch (err) {
        const errors = (err as Error & { errors?: string[] }).errors ?? [(err as Error).message];
        alert(
          errors.map((er) => t(`complete.errors.${er}`, { defaultValue: er })).join('\n'),
        );
      }
    } else {
      await moveStage.mutateAsync({ dealId, stageId });
    }
  }

  return (
    <div className="space-y-4 p-6">
      <h1 className="text-2xl font-bold">{t('kanban.title')}</h1>
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="flex gap-3 overflow-x-auto pb-4">
          {accStages.map((s) => (
            <AccountingKanbanColumn
              key={s.id}
              stageId={s.id}
              stageLabel={(s.display_names as { en: string; el: string })[lang]}
              deals={dealsByStage.get(s.id) ?? []}
            />
          ))}
        </div>
      </DndContext>
    </div>
  );
}
```

- [ ] **Step 2: Gates + commit**

```bash
npm run format:check && npm run lint && npm run typecheck && npm run test:run
echo "exit: $?"
git add src/features/accounting/
git commit -m "feat(accounting): kanban page with drag-drop + complete-on-Paid_In_Full"
git push
```

---

## Task 10 — Add `/accounting/onboarding` route + Accounting sidebar group

**Files:**
- Modify: `src/app/router.tsx`
- Modify: `src/components/layout/Sidebar.tsx`

- [ ] **Step 1: Route**

Read `src/app/router.tsx`. Inside ShellLayout's children, add a sibling group similar to `sales`:

```tsx
import { AccountingOnboardingKanbanPage } from '@/features/accounting/AccountingOnboardingKanbanPage';
// ...
{
  path: 'accounting',
  children: [
    { path: 'onboarding', element: <AccountingOnboardingKanbanPage /> },
  ],
},
```

- [ ] **Step 2: Sidebar**

Read `src/components/layout/Sidebar.tsx`. Add a new conditional block alongside the existing Sales block:

```tsx
const isAccounting = groupCodes.includes('accounting');
// ...
{isAccounting && (
  <div className="space-y-1 pt-2">
    <p className="px-3 text-xs font-medium uppercase text-slate-500">Accounting</p>
    <NavLink
      to="/accounting/onboarding"
      className={({ isActive }) =>
        `block rounded px-3 py-2 ${isActive ? 'bg-slate-200 font-medium' : 'hover:bg-slate-100'}`
      }
    >
      {t('accounting:nav.onboarding')}
    </NavLink>
  </div>
)}
```

- [ ] **Step 3: Gates + commit**

```bash
npm run format:check && npm run lint && npm run typecheck && npm run test:run
echo "exit: $?"
git add -A
git commit -m "feat(accounting): /accounting/onboarding route + sidebar nav"
git push
```

---

## Task 11 — Realtime sync for accounting kanban

**Files:**
- Create: `src/features/accounting/hooks/useAccountingKanbanRealtime.ts`
- Modify: `src/features/accounting/AccountingOnboardingKanbanPage.tsx`

- [ ] **Step 1: Hook**

```ts
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export function useAccountingKanbanRealtime() {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel('accounting-kanban')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deals' }, () => {
        void qc.invalidateQueries({ queryKey: queryKeys.accountingDeals() });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc]);
}
```

- [ ] **Step 2: Invoke in page**

Add at top of AccountingOnboardingKanbanPage component body:

```tsx
import { useAccountingKanbanRealtime } from './hooks/useAccountingKanbanRealtime';
// ...inside component:
useAccountingKanbanRealtime();
```

- [ ] **Step 3: Gates + commit**

```bash
npm run format:check && npm run lint && npm run typecheck && npm run test:run
echo "exit: $?"
git add src/features/accounting/
git commit -m "feat(accounting): Realtime sync for kanban (deals table changes)"
git push
```

---

# Sub-phase D — Polish (Tasks 12–13)

## Task 12 — Sales kanban "Won (locked)" indicator polish

**Files:**
- Modify: `src/features/sales/SalesKanbanCard.tsx`

The card already shows the 🔒 emoji when `locked_at` is set. Confirm it renders nicely and add a tooltip/text label.

- [ ] **Step 1: Polish**

Optional — the existing 🔒 indicator is fine. If you want a clearer label, replace the span:

```tsx
{deal.locked_at && (
  <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
    🔒 Locked
  </span>
)}
```

If not needed, mark the task complete and skip.

- [ ] **Step 2: Gates + commit (only if changes were made)**

```bash
git status
# if modified:
npm run format:check && npm run lint && npm run typecheck && npm run test:run
git add -A && git commit -m "chore(sales): nicer locked-deal badge on kanban card" && git push
```

---

## Task 13 — Accounting smoke test

**Files:**
- Create: `tests/accounting-smoke.spec.ts`

- [ ] **Step 1: Spec**

```ts
import { test, expect, type Page } from '@playwright/test';

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD;

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(ADMIN_EMAIL!);
  await page.getByLabel(/password/i).fill(ADMIN_PASSWORD!);
  await page.getByRole('button', { name: /sign in|σύνδεση/i }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
}

test.describe('accounting smoke', () => {
  test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD, 'E2E admin credentials not set');

  test('admin can navigate to /accounting/onboarding', async ({ page }) => {
    await signIn(page);
    await page.goto('/accounting/onboarding');
    await expect(page).toHaveURL(/\/accounting\/onboarding$/);
    await expect(
      page.getByRole('heading', { name: /accounting onboarding|λογιστήριο/i }),
    ).toBeVisible();
  });
});
```

- [ ] **Step 2: Gates + commit**

```bash
npm run format:check && npm run lint && npm run typecheck && npm run test:run
echo "exit: $?"
git add tests/accounting-smoke.spec.ts
git commit -m "test(e2e): accounting smoke — onboarding kanban renders"
git push
```

---

# Sub-phase E — Acceptance (Tasks 14–15)

## Task 14 — Phase 4 acceptance pass + manual smoke

- [ ] **Step 1: Local gates**

```bash
npm run format:check && npm run lint && npm run typecheck && npm run test:run && npm run test:e2e
```

All exit 0.

- [ ] **Step 2: Phase 4 acceptance criteria**

- [ ] After Sales drags a deal to "Won" with required fields filled (services_planned ≥ 1, contract attached, value > 0), the deal:
  - Stays at Sales `Won` (locked indicator visible).
  - Appears at Accounting `New` on `/accounting/onboarding`.
- [ ] Accounting can drag the deal across stages (Documents Verified → Invoice Issued → Awaiting Payment → Partial Payment) with optimistic updates.
- [ ] Dragging the deal to `Paid In Full` triggers `complete_accounting()`:
  - On success: deal disappears from Accounting kanban (because `accounting_completed_at` is now set).
  - One `jobs` row is spawned per service in `services_planned`. Verify via DB query.
  - Deal owner gets a `complete_accounting` notification.
- [ ] Sales group user does NOT see Accounting sidebar nav. Accounting group user does.
- [ ] Greek translations work on the Accounting kanban.

- [ ] **Step 3: Manual smoke (USER ACTION)**

Login at https://itdevcrm.vercel.app as admin. Walk through the flow above. Tell me anything broken.

- [ ] **Step 4: Mark Phase 4 done**

No additional commit needed.

---

## Task 15 — (Optional) Bug-fix iteration based on manual smoke

If the user finds issues during Task 14, fix them iteratively here. Each fix = one commit.

---

## Out of scope for Phase 4 (do NOT do now)

- **Recurring billing / monthly_invoices** — Phase 5.
- **Block client mechanic** — Phase 5.
- **Tech sub-departments × 4 kanbans** — Phase 6 (jobs already get spawned at accounting completion; tech UI is Phase 6).
- **VAT/tax calculation logic** — fields exist on deals from Phase 3 schema; full calc is Phase 8.
- **Accounting recurring view (monthly billing dashboard)** — Phase 5.

If a task starts touching any of the above, stop and revisit.
