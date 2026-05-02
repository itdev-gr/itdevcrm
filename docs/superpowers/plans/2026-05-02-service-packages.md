# Service Packages + AI SEO + Hosting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sales fills out a lead and picks a tiered package per service (e.g. "Web SEO → Standard"), which prefills default pricing. Admin can manage packages per service via a CRUD UI. Add two new service types: `ai_seo` (2 packages) and `hosting` (no packages). Support is deferred.

**Architecture:** New `service_packages` table — admin-managed catalog of packages per service. New groups `ai_seo` and `hosting`. Drop the hardcoded check constraint on `jobs.service_type` and replace with a soft FK to a new `service_types` lookup (or just expand the constraint — go with the latter, less ceremony). `ServicesPlannedField` (used by lead form, eventually deal/job forms) gains a Package dropdown that prefills one-time + monthly amounts when picked. New stages seeded for the `ai_seo` and `hosting` boards so Phase 6 kanbans can plug in later.

**Tech Stack:** All from prior phases (no new tools).

**Reference spec:** `docs/superpowers/specs/2026-05-01-itdevcrm-design.md` — sections 5 (domain), 6.4 (jobs), 8.4 (technical sub-departments). This plan extends the catalog of service types and adds the package layer the spec didn't define.

**Branch:** `main` (push directly per project memory).

---

## Sub-phase grouping

```
A. Schema + seed (Tasks 1–4)
B. Admin packages UI (Tasks 5–6)
C. Lead form integration (Task 7)
D. Acceptance (Tasks 8–9)
```

---

## File Structure (after this plan)

```
.
├── supabase/
│   └── migrations/
│       ├── 20260502000022_service_packages_table.sql      # table + RLS
│       ├── 20260502000023_add_ai_seo_hosting_groups.sql   # groups + stages + jobs check
│       ├── 20260502000024_seed_service_packages.sql       # placeholder packages
│       └── 20260502000025_complete_accounting_extends.sql # allow new service_types in spawn
├── src/
│   ├── lib/
│   │   └── queryKeys.ts                                   # MODIFY: servicePackages
│   ├── features/
│   │   ├── service_packages/                              # NEW
│   │   │   ├── hooks/
│   │   │   │   ├── useServicePackages.ts
│   │   │   │   ├── useUpsertServicePackage.ts
│   │   │   │   └── useArchiveServicePackage.ts
│   │   │   ├── ServicePackagesPage.tsx                    # /admin/service-packages
│   │   │   └── ServicePackageDialog.tsx                   # add/edit
│   │   └── deals/
│   │       └── ServicesPlannedField.tsx                   # MODIFY: package dropdown + prefill
│   ├── components/layout/Sidebar.tsx                      # MODIFY: admin link
│   ├── app/router.tsx                                     # MODIFY: /admin/service-packages
│   └── i18n/locales/{en,el}/admin.json                    # MODIFY: service_packages keys
└── tests/
    └── service-packages-smoke.spec.ts                      # NEW
```

---

## Conventions

- Every task ends in commit + push to `main`.
- **REQUIRED gate verification protocol**: each subagent runs `npm run format:check && npm run lint && npm run typecheck && npm run test:run` as a single chained command; commit only if `exit: 0`.
- Migration env vars `SUPABASE_ACCESS_TOKEN` + `SUPABASE_DB_PASSWORD` already in shell.
- Regenerate types after every migration: `npm run types:gen`.

---

# Sub-phase A — Schema + seed (Tasks 1–4)

## Task 1 — Migration: service_packages table

**Files:**
- Create: `supabase/migrations/20260502000022_service_packages_table.sql`

- [ ] **Step 1: Migration**

```sql
-- =============================================================================
-- service_packages — admin-managed catalog of packages per service
-- =============================================================================
create table public.service_packages (
  id uuid primary key default gen_random_uuid(),
  service_type text not null check (
    service_type in ('web_seo', 'local_seo', 'web_dev', 'social_media', 'ai_seo', 'hosting')
  ),
  code text not null,
  display_names jsonb not null,           -- {"en": "...", "el": "..."}
  default_one_time_amount numeric(12,2) default 0,
  default_monthly_amount numeric(12,2) default 0,
  setup_fee numeric(12,2) default 0,
  description text,
  sort_order int not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (service_type, code)
);

create index service_packages_service on public.service_packages (service_type, sort_order)
  where archived = false;

create trigger service_packages_set_updated_at
  before update on public.service_packages
  for each row execute function public.set_updated_at();

alter table public.service_packages enable row level security;

-- Everyone authenticated reads (it's a dropdown source)
create policy service_packages_select_authenticated
  on public.service_packages for select
  to authenticated
  using (true);

-- Admin only mutates
create policy service_packages_mutate_admin
  on public.service_packages for all
  to authenticated
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260502000022_service_packages_table.sql
git commit -m "feat(db): service_packages catalog table + RLS"
git push origin main
```

---

## Task 2 — Migration: ai_seo + hosting groups, stages, expand jobs check

**Files:**
- Create: `supabase/migrations/20260502000023_add_ai_seo_hosting_groups.sql`

- [ ] **Step 1: Migration**

```sql
-- =============================================================================
-- Add ai_seo + hosting groups, pipeline_stages, expand jobs.service_type check
-- =============================================================================

-- 1. Groups
insert into public.groups (code, display_names, parent_label, position) values
  ('ai_seo',  '{"en": "AI SEO",  "el": "AI SEO"}'::jsonb,    'Technical', 70),
  ('hosting', '{"en": "Hosting", "el": "Φιλοξενία"}'::jsonb, 'Technical', 80)
on conflict (code) do nothing;

-- 2. Pipeline stages — AI SEO (parallel to web_seo)
insert into public.pipeline_stages (board, code, display_names, position, is_terminal, terminal_outcome, triggers_action) values
  ('ai_seo', 'onboarding',     '{"en": "Onboarding",     "el": "Ενσωμάτωση"}'::jsonb,         10, false, null, null),
  ('ai_seo', 'audit_strategy', '{"en": "Audit & Strategy","el": "Έλεγχος & Στρατηγική"}'::jsonb, 20, false, null, null),
  ('ai_seo', 'active',         '{"en": "Active",         "el": "Ενεργό"}'::jsonb,             30, false, null, null),
  ('ai_seo', 'on_hold',        '{"en": "On Hold",        "el": "Σε Αναμονή"}'::jsonb,         40, false, null, null),
  ('ai_seo', 'cancelled',      '{"en": "Cancelled",      "el": "Ακυρωμένο"}'::jsonb,          50, true,  'cancelled', null)
on conflict (board, code) do nothing;

-- 3. Pipeline stages — Hosting (simpler: setup → active → cancelled)
insert into public.pipeline_stages (board, code, display_names, position, is_terminal, terminal_outcome, triggers_action) values
  ('hosting', 'setup',     '{"en": "Setup",     "el": "Ρύθμιση"}'::jsonb,    10, false, null, null),
  ('hosting', 'active',    '{"en": "Active",    "el": "Ενεργό"}'::jsonb,     20, false, null, null),
  ('hosting', 'on_hold',   '{"en": "On Hold",   "el": "Σε Αναμονή"}'::jsonb, 30, false, null, null),
  ('hosting', 'cancelled', '{"en": "Cancelled", "el": "Ακυρωμένο"}'::jsonb,  40, true,  'cancelled', null)
on conflict (board, code) do nothing;

-- 4. Expand jobs.service_type check constraint
alter table public.jobs drop constraint if exists jobs_service_type_check;
alter table public.jobs add constraint jobs_service_type_check
  check (service_type in ('web_seo', 'local_seo', 'web_dev', 'social_media', 'ai_seo', 'hosting'));
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260502000023_add_ai_seo_hosting_groups.sql
git commit -m "feat(db): add ai_seo + hosting groups, pipeline stages, expand jobs check"
git push origin main
```

---

## Task 3 — Migration: seed initial service_packages (placeholders)

**Files:**
- Create: `supabase/migrations/20260502000024_seed_service_packages.sql`

User can rename / re-price later via admin UI. Hosting has no packages (single offering per Q1 of brainstorming); ai_seo gets 2 packages per spec.

- [ ] **Step 1: Migration**

```sql
-- =============================================================================
-- Seed placeholder packages. Admin can rename/re-price/archive via UI.
-- =============================================================================
insert into public.service_packages (service_type, code, display_names, default_one_time_amount, default_monthly_amount, sort_order) values
  -- Web SEO
  ('web_seo', 'basic',    '{"en": "Basic",    "el": "Βασικό"}'::jsonb,    0,   300, 10),
  ('web_seo', 'standard', '{"en": "Standard", "el": "Στάνταρ"}'::jsonb,    0,   500, 20),
  ('web_seo', 'premium',  '{"en": "Premium",  "el": "Premium"}'::jsonb,    0,   900, 30),
  -- Local SEO
  ('local_seo', 'basic',    '{"en": "Basic",    "el": "Βασικό"}'::jsonb,   0,   200, 10),
  ('local_seo', 'standard', '{"en": "Standard", "el": "Στάνταρ"}'::jsonb,   0,   350, 20),
  ('local_seo', 'premium',  '{"en": "Premium",  "el": "Premium"}'::jsonb,   0,   600, 30),
  -- Web Dev
  ('web_dev', 'starter',     '{"en": "Starter",     "el": "Starter"}'::jsonb,    1500, 0, 10),
  ('web_dev', 'business',    '{"en": "Business",    "el": "Business"}'::jsonb,   3000, 0, 20),
  ('web_dev', 'enterprise',  '{"en": "Enterprise",  "el": "Enterprise"}'::jsonb, 6000, 0, 30),
  -- Social Media
  ('social_media', 'basic',    '{"en": "Basic",    "el": "Βασικό"}'::jsonb,    0,   250, 10),
  ('social_media', 'standard', '{"en": "Standard", "el": "Στάνταρ"}'::jsonb,    0,   450, 20),
  ('social_media', 'premium',  '{"en": "Premium",  "el": "Premium"}'::jsonb,    0,   800, 30),
  -- AI SEO (2 packages per brainstorming)
  ('ai_seo', 'standard', '{"en": "Standard", "el": "Στάνταρ"}'::jsonb, 0,  600, 10),
  ('ai_seo', 'premium',  '{"en": "Premium",  "el": "Premium"}'::jsonb, 0, 1200, 20)
  -- Hosting: no packages seeded (single offering)
on conflict (service_type, code) do nothing;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260502000024_seed_service_packages.sql
git commit -m "feat(db): seed placeholder service_packages (admin can edit)"
git push origin main
```

---

## Task 4 — Migration: extend complete_accounting RPC + apply all + types

**Files:**
- Create: `supabase/migrations/20260502000025_complete_accounting_extends.sql`

`complete_accounting` filters `services_planned` entries by service_type. Need to allow `ai_seo` and `hosting` so jobs spawn for them too. Set `assigned_group_id` and `stage_id` for each.

- [ ] **Step 1: Migration**

```sql
-- =============================================================================
-- complete_accounting: allow ai_seo + hosting service types when spawning jobs
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

  if coalesce(jsonb_array_length(d.services_planned), 0) = 0 then
    errors := errors || 'services_planned_empty';
  end if;

  if d.one_time_value is null or d.one_time_value < 0 then
    errors := errors || 'invalid_one_time_value';
  end if;

  if array_length(errors, 1) is not null and array_length(errors, 1) > 0 then
    return jsonb_build_object('ok', false, 'errors', errors);
  end if;

  -- Spawn jobs from services_planned
  for service in select * from jsonb_array_elements(d.services_planned)
  loop
    service_type_val := service->>'service_type';
    billing_type_val := service->>'billing_type';
    if service_type_val not in ('web_seo', 'local_seo', 'web_dev', 'social_media', 'ai_seo', 'hosting') then
      continue;
    end if;
    if billing_type_val not in ('one_time', 'recurring_monthly') then
      continue;
    end if;
    one_time_amt := nullif(service->>'one_time_amount', '')::numeric;
    monthly_amt := nullif(service->>'monthly_amount', '')::numeric;
    setup_fee_val := nullif(service->>'setup_fee', '')::numeric;

    select id into group_id_val from public.groups where code = service_type_val;
    select id into job_stage_id
      from public.pipeline_stages
      where board = service_type_val
        and code = case service_type_val
          when 'web_dev' then 'awaiting_brief'
          when 'hosting' then 'setup'
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

  -- Move accounting stage to paid_in_full + completed metadata
  select id into paid_stage_id from public.pipeline_stages
    where board = 'accounting_onboarding' and code = 'paid_in_full' limit 1;

  update public.deals
    set
      accounting_completed_at = now(),
      accounting_completed_by = auth.uid(),
      accounting_stage_id = coalesce(paid_stage_id, accounting_stage_id)
    where id = d.id;

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

- [ ] **Step 2: Apply all migrations**

```bash
echo y | npx -y supabase@latest db push 2>&1 | tail -10
```

- [ ] **Step 3: Verify**

```bash
URL=$(grep '^VITE_SUPABASE_URL' .env.local | cut -d= -f2-)
SVC=$(npx -y supabase@latest projects api-keys --project-ref xujlrclyzxrvxszepquy 2>/dev/null | awk '/service_role/{print $3; exit}')
echo "service_packages:"
curl -sS "${URL}/rest/v1/service_packages?select=service_type,code,display_names&order=service_type.asc" -H "apikey: ${SVC}" -H "Authorization: Bearer ${SVC}" | python3 -m json.tool | head -40
echo "groups (expect 8 total):"
curl -sS "${URL}/rest/v1/groups?select=code&order=position.asc" -H "apikey: ${SVC}" -H "Authorization: Bearer ${SVC}"
echo "ai_seo stages:"
curl -sS "${URL}/rest/v1/pipeline_stages?board=eq.ai_seo&select=code,position&order=position.asc" -H "apikey: ${SVC}" -H "Authorization: Bearer ${SVC}"
echo "hosting stages:"
curl -sS "${URL}/rest/v1/pipeline_stages?board=eq.hosting&select=code,position&order=position.asc" -H "apikey: ${SVC}" -H "Authorization: Bearer ${SVC}"
```

Expect: 14 service_packages rows, 8 groups, 5 ai_seo stages, 4 hosting stages.

- [ ] **Step 4: Regen types + gates**

```bash
npm run types:gen
npm run format:check && npm run lint && npm run typecheck && npm run test:run
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260502000025_complete_accounting_extends.sql src/types/supabase.ts
git commit -m "feat(db): complete_accounting handles ai_seo + hosting; types regen"
git push origin main
```

---

# Sub-phase B — Admin packages UI (Tasks 5–6)

## Task 5 — Hooks + ServicePackagesPage + ServicePackageDialog

**Files:**
- Modify: `src/lib/queryKeys.ts` — add `servicePackages`
- Create: `src/features/service_packages/hooks/useServicePackages.ts`
- Create: `src/features/service_packages/hooks/useUpsertServicePackage.ts`
- Create: `src/features/service_packages/hooks/useArchiveServicePackage.ts`
- Create: `src/features/service_packages/ServicePackagesPage.tsx`
- Create: `src/features/service_packages/ServicePackageDialog.tsx`

- [ ] **Step 1: queryKeys**

Append to `queryKeys`:
```ts
servicePackages: () => ['service-packages'] as const,
```

- [ ] **Step 2: useServicePackages**

```ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { Database } from '@/types/supabase';

export type ServicePackageRow = Database['public']['Tables']['service_packages']['Row'];

export function useServicePackages(opts: { includeArchived?: boolean } = {}) {
  return useQuery({
    queryKey: [...queryKeys.servicePackages(), { includeArchived: !!opts.includeArchived }] as const,
    queryFn: async (): Promise<ServicePackageRow[]> => {
      let q = supabase
        .from('service_packages')
        .select('*')
        .order('service_type')
        .order('sort_order');
      if (!opts.includeArchived) q = q.eq('archived', false);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []) as ServicePackageRow[];
    },
  });
}
```

- [ ] **Step 3: useUpsertServicePackage**

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { Database } from '@/types/supabase';

type Insert = Database['public']['Tables']['service_packages']['Insert'];
type Update = Database['public']['Tables']['service_packages']['Update'];

export function useUpsertServicePackage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: { id?: string } & (Insert | Update),
    ): Promise<string> => {
      if (input.id) {
        const { id, ...patch } = input;
        const { error } = await supabase
          .from('service_packages')
          .update(patch as Update)
          .eq('id', id);
        if (error) throw new Error(error.message);
        return id;
      }
      const { data, error } = await supabase
        .from('service_packages')
        .insert(input as Insert)
        .select('id')
        .single();
      if (error || !data) throw new Error(error?.message ?? 'insert_failed');
      return data.id;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.servicePackages() });
    },
  });
}
```

- [ ] **Step 4: useArchiveServicePackage**

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export function useArchiveServicePackage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, archived }: { id: string; archived: boolean }) => {
      const { error } = await supabase
        .from('service_packages')
        .update({ archived })
        .eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.servicePackages() });
    },
  });
}
```

- [ ] **Step 5: ServicePackageDialog (add/edit)**

```tsx
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useUpsertServicePackage } from './hooks/useUpsertServicePackage';
import type { ServicePackageRow } from './hooks/useServicePackages';

const SERVICE_TYPES = [
  'web_seo',
  'local_seo',
  'web_dev',
  'social_media',
  'ai_seo',
  'hosting',
] as const;

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial?: ServicePackageRow | null;
};

export function ServicePackageDialog({ open, onOpenChange, initial }: Props) {
  const { t } = useTranslation('admin');
  const upsert = useUpsertServicePackage();

  const [serviceType, setServiceType] = useState<(typeof SERVICE_TYPES)[number]>('web_seo');
  const [code, setCode] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [nameEl, setNameEl] = useState('');
  const [oneTime, setOneTime] = useState('0');
  const [monthly, setMonthly] = useState('0');
  const [setupFee, setSetupFee] = useState('0');
  const [sortOrder, setSortOrder] = useState('0');
  const [description, setDescription] = useState('');

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setServiceType(initial.service_type as (typeof SERVICE_TYPES)[number]);
      setCode(initial.code);
      const dn = initial.display_names as { en?: string; el?: string };
      setNameEn(dn?.en ?? '');
      setNameEl(dn?.el ?? '');
      setOneTime(String(initial.default_one_time_amount ?? 0));
      setMonthly(String(initial.default_monthly_amount ?? 0));
      setSetupFee(String(initial.setup_fee ?? 0));
      setSortOrder(String(initial.sort_order ?? 0));
      setDescription(initial.description ?? '');
    } else {
      setServiceType('web_seo');
      setCode('');
      setNameEn('');
      setNameEl('');
      setOneTime('0');
      setMonthly('0');
      setSetupFee('0');
      setSortOrder('0');
      setDescription('');
    }
  }, [open, initial]);

  function toNum(v: string) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!code.trim() || !nameEn.trim()) return;
    try {
      const payload = {
        service_type: serviceType,
        code: code.trim(),
        display_names: { en: nameEn.trim(), el: nameEl.trim() || nameEn.trim() },
        default_one_time_amount: toNum(oneTime),
        default_monthly_amount: toNum(monthly),
        setup_fee: toNum(setupFee),
        sort_order: Math.trunc(toNum(sortOrder)),
        description: description.trim() || null,
      };
      if (initial?.id) {
        await upsert.mutateAsync({ id: initial.id, ...payload });
      } else {
        await upsert.mutateAsync(payload);
      }
      onOpenChange(false);
    } catch (err) {
      alert((err as Error).message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {initial
              ? t('service_packages.edit_title')
              : t('service_packages.add_title')}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <Label htmlFor="st">{t('service_packages.fields.service_type')}</Label>
            <select
              id="st"
              value={serviceType}
              onChange={(e) =>
                setServiceType(e.target.value as (typeof SERVICE_TYPES)[number])
              }
              className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              disabled={!!initial}
            >
              {SERVICE_TYPES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="cd">{t('service_packages.fields.code')}</Label>
              <Input
                id="cd"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                disabled={!!initial}
              />
            </div>
            <div>
              <Label htmlFor="so">{t('service_packages.fields.sort_order')}</Label>
              <Input
                id="so"
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="ne">{t('service_packages.fields.name_en')}</Label>
              <Input id="ne" value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="nl">{t('service_packages.fields.name_el')}</Label>
              <Input id="nl" value={nameEl} onChange={(e) => setNameEl(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="ot">{t('service_packages.fields.default_one_time')}</Label>
              <Input
                id="ot"
                inputMode="decimal"
                value={oneTime}
                onChange={(e) => setOneTime(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="mo">{t('service_packages.fields.default_monthly')}</Label>
              <Input
                id="mo"
                inputMode="decimal"
                value={monthly}
                onChange={(e) => setMonthly(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="sf">{t('service_packages.fields.setup_fee')}</Label>
              <Input
                id="sf"
                inputMode="decimal"
                value={setupFee}
                onChange={(e) => setSetupFee(e.target.value)}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="ds">{t('service_packages.fields.description')}</Label>
            <textarea
              id="ds"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1 block min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('service_packages.cancel')}
            </Button>
            <Button type="submit" disabled={upsert.isPending}>
              {t('service_packages.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 6: ServicePackagesPage**

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  useServicePackages,
  type ServicePackageRow,
} from './hooks/useServicePackages';
import { useArchiveServicePackage } from './hooks/useArchiveServicePackage';
import { ServicePackageDialog } from './ServicePackageDialog';

export function ServicePackagesPage() {
  const { t, i18n } = useTranslation('admin');
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const [includeArchived, setIncludeArchived] = useState(false);
  const [editing, setEditing] = useState<ServicePackageRow | null>(null);
  const [open, setOpen] = useState(false);
  const { data: packages = [], isLoading } = useServicePackages({ includeArchived });
  const archive = useArchiveServicePackage();

  if (isLoading) return <div className="p-8">…</div>;

  const grouped = new Map<string, ServicePackageRow[]>();
  for (const p of packages) {
    const list = grouped.get(p.service_type) ?? [];
    list.push(p);
    grouped.set(p.service_type, list);
  }

  return (
    <div className="space-y-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t('service_packages.title')}</h1>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-sm">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(e) => setIncludeArchived(e.target.checked)}
            />
            {t('service_packages.show_archived')}
          </label>
          <Button
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            {t('service_packages.add')}
          </Button>
        </div>
      </div>

      {[...grouped.entries()].map(([serviceType, rows]) => (
        <section key={serviceType} className="space-y-2">
          <h2 className="text-lg font-semibold">{serviceType}</h2>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-2 pr-4">{t('service_packages.fields.code')}</th>
                <th className="py-2 pr-4">{t('service_packages.fields.name')}</th>
                <th className="py-2 pr-4">€ {t('service_packages.fields.default_one_time')}</th>
                <th className="py-2 pr-4">€ {t('service_packages.fields.default_monthly')}</th>
                <th className="py-2 pr-4">{t('service_packages.fields.sort_order')}</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className={`border-b ${p.archived ? 'opacity-50' : ''}`}>
                  <td className="py-2 pr-4 font-mono text-xs">{p.code}</td>
                  <td className="py-2 pr-4">
                    {(p.display_names as { en?: string; el?: string })[lang]}
                  </td>
                  <td className="py-2 pr-4">
                    €{Number(p.default_one_time_amount ?? 0).toFixed(0)}
                  </td>
                  <td className="py-2 pr-4">
                    €{Number(p.default_monthly_amount ?? 0).toFixed(0)}
                  </td>
                  <td className="py-2 pr-4">{p.sort_order}</td>
                  <td className="py-2 space-x-2">
                    <Button
                      size="sm"
                      variant="link"
                      onClick={() => {
                        setEditing(p);
                        setOpen(true);
                      }}
                    >
                      {t('service_packages.edit')}
                    </Button>
                    <Button
                      size="sm"
                      variant="link"
                      onClick={() =>
                        archive.mutate({ id: p.id, archived: !p.archived })
                      }
                    >
                      {p.archived
                        ? t('service_packages.restore')
                        : t('service_packages.archive')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      <ServicePackageDialog
        open={open}
        onOpenChange={setOpen}
        initial={editing}
      />
    </div>
  );
}
```

- [ ] **Step 7: Gates + commit**

```bash
npm run format:check && npm run lint && npm run typecheck && npm run test:run
git add src/features/service_packages/ src/lib/queryKeys.ts
git commit -m "feat(service_packages): admin CRUD page + hooks + dialog"
git push origin main
```

---

## Task 6 — Route + sidebar + i18n EN/EL

**Files:**
- Modify: `src/app/router.tsx` — add `/admin/service-packages`
- Modify: `src/components/layout/Sidebar.tsx` — add admin link
- Modify: `src/i18n/locales/en/admin.json` — append `service_packages` keys
- Modify: `src/i18n/locales/el/admin.json` — append `service_packages` keys

- [ ] **Step 1: Router**

Add import:
```tsx
import { ServicePackagesPage } from '@/features/service_packages/ServicePackagesPage';
```

Add inside the `admin` route's children, after `stages`:
```tsx
{ path: 'service-packages', element: <ServicePackagesPage /> },
```

- [ ] **Step 2: Sidebar admin link**

Add inside the `{isAdmin && ( ... )}` chain, after the Stages NavLink:

```tsx
<NavLink
  to="/admin/service-packages"
  className={({ isActive }) =>
    `block rounded px-3 py-2 ${isActive ? 'bg-slate-200 font-medium' : 'hover:bg-slate-100'}`
  }
>
  {t('admin:nav.service_packages')}
</NavLink>
```

- [ ] **Step 3: i18n EN — append to admin.json**

Inside `nav` object:
```json
"service_packages": "Service packages"
```

Add a new top-level key:
```json
"service_packages": {
  "title": "Service packages",
  "add": "Add package",
  "add_title": "Add package",
  "edit": "Edit",
  "edit_title": "Edit package",
  "archive": "Archive",
  "restore": "Restore",
  "save": "Save",
  "cancel": "Cancel",
  "show_archived": "Show archived",
  "fields": {
    "service_type": "Service",
    "code": "Code",
    "name": "Name",
    "name_en": "Name (English)",
    "name_el": "Name (Greek)",
    "default_one_time": "One-time price",
    "default_monthly": "Monthly price",
    "setup_fee": "Setup fee",
    "sort_order": "Sort",
    "description": "Description"
  }
}
```

- [ ] **Step 4: i18n EL — append to admin.json**

Inside `nav` object:
```json
"service_packages": "Πακέτα υπηρεσιών"
```

Add a new top-level key:
```json
"service_packages": {
  "title": "Πακέτα υπηρεσιών",
  "add": "Προσθήκη πακέτου",
  "add_title": "Προσθήκη πακέτου",
  "edit": "Επεξεργασία",
  "edit_title": "Επεξεργασία πακέτου",
  "archive": "Αρχειοθέτηση",
  "restore": "Επαναφορά",
  "save": "Αποθήκευση",
  "cancel": "Άκυρο",
  "show_archived": "Εμφάνιση αρχειοθετημένων",
  "fields": {
    "service_type": "Υπηρεσία",
    "code": "Κωδικός",
    "name": "Όνομα",
    "name_en": "Όνομα (Αγγλικά)",
    "name_el": "Όνομα (Ελληνικά)",
    "default_one_time": "Εφάπαξ τιμή",
    "default_monthly": "Μηνιαία τιμή",
    "setup_fee": "Τέλος ρύθμισης",
    "sort_order": "Σειρά",
    "description": "Περιγραφή"
  }
}
```

- [ ] **Step 5: Gates + commit**

```bash
npm run format:check && npm run lint && npm run typecheck && npm run test:run
git add -A
git commit -m "feat(admin): /admin/service-packages route + sidebar link + EN/EL i18n"
git push origin main
```

---

# Sub-phase C — Lead form integration (Task 7)

## Task 7 — ServicesPlannedField with package dropdown + auto-prefill

**Files:**
- Modify: `src/features/deals/ServicesPlannedField.tsx`

- [ ] **Step 1: Replace ServicesPlannedField**

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
import { useServicePackages } from '@/features/service_packages/hooks/useServicePackages';

export type PlannedService = {
  service_type: 'web_seo' | 'local_seo' | 'web_dev' | 'social_media' | 'ai_seo' | 'hosting';
  billing_type: 'one_time' | 'recurring_monthly';
  package_id?: string | null;
  one_time_amount?: number;
  monthly_amount?: number;
  setup_fee?: number;
};

type Props = {
  value: PlannedService[];
  onChange: (next: PlannedService[]) => void;
  disabled?: boolean;
};

const SERVICE_TYPES: PlannedService['service_type'][] = [
  'web_seo',
  'local_seo',
  'web_dev',
  'social_media',
  'ai_seo',
  'hosting',
];
const BILLING_TYPES: PlannedService['billing_type'][] = ['recurring_monthly', 'one_time'];

function patchRow(row: PlannedService, patch: Partial<PlannedService>): PlannedService {
  return { ...row, ...patch } as PlannedService;
}

export function ServicesPlannedField({ value, onChange, disabled }: Props) {
  const { t, i18n } = useTranslation('deals');
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const isDisabled = !!disabled;
  const { data: packages = [] } = useServicePackages();

  function addRow() {
    onChange([...value, { service_type: 'web_seo', billing_type: 'recurring_monthly' }]);
  }

  function removeRow(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }

  function updateRow(idx: number, patch: Partial<PlannedService>) {
    onChange(value.map((row, i) => (i === idx ? patchRow(row, patch) : row)));
  }

  function pickPackage(idx: number, packageId: string) {
    const pkg = packages.find((p) => p.id === packageId);
    if (!pkg) {
      updateRow(idx, { package_id: null });
      return;
    }
    updateRow(idx, {
      package_id: pkg.id,
      one_time_amount: Number(pkg.default_one_time_amount ?? 0),
      monthly_amount: Number(pkg.default_monthly_amount ?? 0),
      setup_fee: Number(pkg.setup_fee ?? 0),
    });
  }

  return (
    <div className="space-y-3">
      {value.map((row, idx) => {
        const rowPackages = packages.filter((p) => p.service_type === row.service_type);
        const hasPackages = rowPackages.length > 0;
        return (
          <div key={idx} className="grid grid-cols-12 items-end gap-2 rounded-md border p-3">
            <div className="col-span-3">
              <Label>{t('services.service_type')}</Label>
              <Select
                value={row.service_type}
                onValueChange={(v) =>
                  updateRow(idx, {
                    service_type: v as PlannedService['service_type'],
                    package_id: null,
                  })
                }
                disabled={isDisabled}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SERVICE_TYPES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-3">
              <Label>{t('services.package')}</Label>
              <Select
                value={row.package_id ?? '__none__'}
                onValueChange={(v) =>
                  v === '__none__' ? updateRow(idx, { package_id: null }) : pickPackage(idx, v)
                }
                disabled={isDisabled || !hasPackages}
              >
                <SelectTrigger>
                  <SelectValue placeholder={hasPackages ? t('services.pick_package') : '—'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t('services.no_package')}</SelectItem>
                  {rowPackages.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {(p.display_names as { en?: string; el?: string })[lang] ?? p.code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <Label>{t('services.billing_type')}</Label>
              <Select
                value={row.billing_type}
                onValueChange={(v) =>
                  updateRow(idx, { billing_type: v as PlannedService['billing_type'] })
                }
                disabled={isDisabled}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BILLING_TYPES.map((b) => (
                    <SelectItem key={b} value={b}>
                      {b}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-1">
              <Label>€/once</Label>
              <Input
                inputMode="decimal"
                value={String(row.one_time_amount ?? 0)}
                onChange={(e) =>
                  updateRow(idx, { one_time_amount: Number(e.target.value) || 0 })
                }
                disabled={isDisabled}
              />
            </div>
            <div className="col-span-1">
              <Label>€/mo</Label>
              <Input
                inputMode="decimal"
                value={String(row.monthly_amount ?? 0)}
                onChange={(e) =>
                  updateRow(idx, { monthly_amount: Number(e.target.value) || 0 })
                }
                disabled={isDisabled}
              />
            </div>
            <div className="col-span-1">
              <Label>setup</Label>
              <Input
                inputMode="decimal"
                value={String(row.setup_fee ?? 0)}
                onChange={(e) => updateRow(idx, { setup_fee: Number(e.target.value) || 0 })}
                disabled={isDisabled}
              />
            </div>
            <div className="col-span-1 text-right">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => removeRow(idx)}
                disabled={isDisabled}
              >
                ✕
              </Button>
            </div>
          </div>
        );
      })}
      <Button type="button" variant="outline" size="sm" onClick={addRow} disabled={isDisabled}>
        {t('services.add')}
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Add new i18n keys to `src/i18n/locales/en/deals.json` and `el/deals.json`**

EN, inside the existing `services` object (likely already has `service_type`, `billing_type`, `add`):
```json
"package": "Package",
"pick_package": "Pick a package",
"no_package": "(no package)"
```

EL:
```json
"package": "Πακέτο",
"pick_package": "Επιλογή πακέτου",
"no_package": "(χωρίς πακέτο)"
```

(If the keys don't exist in `services`, add the parent `services` object with all four: `service_type`, `billing_type`, `add`, `package`, `pick_package`, `no_package`. Read the file first to know what's there.)

- [ ] **Step 3: Gates + commit**

```bash
npm run format:check && npm run lint && npm run typecheck && npm run test:run
git add src/features/deals/ServicesPlannedField.tsx src/i18n/
git commit -m "feat(services): package dropdown in ServicesPlannedField; auto-prefill amounts"
git push origin main
```

---

# Sub-phase D — Acceptance (Tasks 8–9)

## Task 8 — E2E smoke

**Files:**
- Create: `tests/service-packages-smoke.spec.ts`

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

test.describe('service packages smoke', () => {
  test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD, 'E2E admin credentials not set');

  test('admin can navigate to /admin/service-packages and see the catalog', async ({ page }) => {
    await signIn(page);
    await page.goto('/admin/service-packages');
    await expect(
      page.getByRole('heading', { name: /service packages|πακέτα/i }),
    ).toBeVisible();
    // Seeded service-type sections (5 of 6 — hosting has no packages)
    await expect(page.getByRole('heading', { name: 'web_seo' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'ai_seo' })).toBeVisible();
  });
});
```

- [ ] **Step 2: Gates + commit**

```bash
npm run format:check && npm run lint && npm run typecheck && npm run test:run
git add tests/service-packages-smoke.spec.ts
git commit -m "test(e2e): service-packages admin page renders"
git push origin main
```

---

## Task 9 — Acceptance + manual smoke

- [ ] **Step 1: Local + e2e**

```bash
npm run format:check && npm run lint && npm run typecheck && npm run test:run && \
  PLAYWRIGHT_BASE_URL=https://itdevcrm.vercel.app E2E_ADMIN_EMAIL=info@itdev.gr E2E_ADMIN_PASSWORD=<your admin password> npm run test:e2e
```

- [ ] **Step 2: Manual acceptance** (USER ACTION)

- [ ] Navigate to `/admin/service-packages` → see grouped sections per service type (web_seo / local_seo / web_dev / social_media / ai_seo). Each shows seeded placeholder packages with prices.
- [ ] Click **Add package** → fill in service_type=hosting, code=basic, name=Basic, monthly=10 → save → row appears under hosting section.
- [ ] Edit any package → change price → save → list reflects.
- [ ] Archive a package → row dims out → toggle "Show archived" → it shows again.
- [ ] On a lead's services panel, add a row with service_type=web_seo → Package dropdown lists Basic/Standard/Premium → pick "Standard" → one-time and monthly fields populate with seeded defaults.
- [ ] Switch the row's service_type to `hosting` → Package dropdown shows "(no package)" only (since you didn't add hosting packages yet, or shows the one you just added).
- [ ] EL toggle → translations appear on the admin packages page and dropdown labels.

- [ ] **Step 3: No commit needed.**

---

## Out of scope for this plan (do NOT do now)

- **Phase 6 tech kanbans for ai_seo + hosting** — separate plan
- **Per-job package metadata** — `jobs.package_id` not added; spawned jobs only carry the resolved amounts. Add later if reporting needs it.
- **Support service** — deferred per user.
- **Translations of service_type display labels** — currently shown as raw codes (`web_seo`). A `service_types` lookup table with display_names is a clean follow-up but not blocking.

If a task starts touching any of the above, stop and revisit.
