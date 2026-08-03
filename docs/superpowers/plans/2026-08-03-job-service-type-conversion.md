# Job Service-Type Conversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins/accounting convert a standalone job between service types (v1: within a billing-cadence group, no AI SEO) via one safe, atomic RPC that realigns board/stage, code, owner, tasks, service-specific info, and the billing linkage — without changing any amounts.

**Architecture:** A `SECURITY DEFINER` Postgres function `convert_job_service_type(job_id, target)` does everything atomically and self-checks admin-or-accounting (RLS keys on service_type, so the caller can't be trusted to have rights on both boards). Code generation is first extracted into a shared `compute_job_code()` helper so the INSERT trigger and the RPC never drift. A small React dialog on the Job detail page drives it.

**Tech Stack:** Postgres/Supabase (plpgsql, RLS, RPC), supabase-js v2 `rpc`, React + TS + Vite, TanStack Query v5, shadcn/ui dialog+select, Vitest.

## Global Constraints (from spec, verbatim values)

- Supabase client import: `import { supabase } from '@/lib/supabase'`; admin predicate `current_user_is_admin()`; accounting predicate `current_user_can('accounting_onboarding','edit')`.
- **v1 allowed conversions only:** Group A = `web_seo, local_seo, social_media, ads` (any↔any); Group B = `hosting, domains` (any↔any). Same group only. Source & target ∉ `{ai_seo, web_dev, franchise, maintenance, other}`. Job must have NO `parent_job_id` and NO child jobs. `src ≠ dst`.
- **Money is preserved.** Never change amounts/`billing_type`/dates. Only relabel `service_type` on `jobs`, matching `deal_payments`, `deal_payment_lines`, and the matching `deals.services_planned` entry.
- **Reset on convert (Q3):** regenerate `code`, re-derive owner/`assigned_group_id`, reset `monthly_tasks` from the target template, migrate `details` (keep keys shared by both services per `src/features/jobs/serviceInfoFields.ts`, drop source-only, seed target defaults).
- `service_type` canonical union: `src/features/jobs/hooks/useJobs.ts:6`. Board == service_type for `pipeline_stages.board`.
- Migrations: `supabase/migrations/YYYYMMDDHHMMSS_<name>.sql` ending with a `-- ROLLBACK:` block. Apply to prod via the project's standard path (see `reference_supabase_mgmt_api`); regen types with `npm run types:gen` **only** if no concurrent schema drift, else hand-add.
- Tests: `npm run test:run` (Vitest, hits PROD — seeded/disposable rows, clean up after). Core matchers only (no jest-dom). Lint `--max-warnings=0` inside `npm run build`; no `any`, no unused.
- This feature adds only NEW functions + a component + i18n. No table/column changes.

## File Structure

- `supabase/migrations/<ts>_compute_job_code_helper.sql` — **create**: extract `set_job_code` body into `compute_job_code(j public.jobs) returns text`; rewire the trigger to call it (behavior-preserving).
- `supabase/migrations/<ts+1>_convert_job_service_type.sql` — **create**: the `convert_job_service_type(uuid, text)` RPC + a `job.service_type_converted` activity type.
- `src/features/jobs/serviceConversion.ts` — **create**: `CONVERT_GROUP_A`, `CONVERT_GROUP_B`, `convertibleTargets(job)`, `canConvert(job)`.
- `src/features/jobs/serviceConversion.test.ts` — **create**.
- `src/features/jobs/hooks/useConvertJobService.ts` — **create**: mutation hook.
- `src/features/jobs/ConvertServiceDialog.tsx` — **create**: dialog UI.
- `src/features/jobs/ConvertServiceDialog.test.tsx` — **create**.
- `src/features/jobs/JobDetailPage.tsx` — **modify** (~`:469-472`): add the Convert action next to the service badge (admin/accounting only).
- `src/i18n/locales/{el,en}/jobs.json` — **modify**: `convert.*` strings.

---

### Task 1: DB — extract `compute_job_code()` and rewire the code trigger

**Files:**
- Create: `supabase/migrations/<ts>_compute_job_code_helper.sql`

**Interfaces:**
- Produces: `public.compute_job_code(j public.jobs) returns text` — pure, deterministic code generator; `set_job_code` trigger now delegates to it.

- [ ] **Step 1: Read the live definition (do not reconstruct from memory)**

Run: `pg_get_functiondef('public.set_job_code'::regproc)` (via the Management API SQL endpoint) AND read `supabase/migrations/20260618130000_job_unique_codes.sql` + `20260624020000_ai_seo_child_job_codes.sql`. Capture the exact body, including the ai_seo child branch (`-AISEOWEB`/`-AISEOLOC`) and the uniqueness suffix logic.

- [ ] **Step 2: Write the migration — helper + rewire, behavior-preserving**

Create `supabase/migrations/<ts>_compute_job_code_helper.sql`. Move the trigger's computation into `compute_job_code(j public.jobs) returns text language plpgsql stable`, returning the SAME string the trigger currently assigns to `NEW.code`. Then redefine the trigger function to `NEW.code := public.compute_job_code(NEW); return NEW;` (preserving the existing `before insert` timing and any existing guards, e.g. only-set-when-null). Keep the ai_seo child branch intact. End with a `-- ROLLBACK:` block restoring the inlined trigger body.

- [ ] **Step 3: Apply to prod and verify existing behavior is unchanged**

Apply the migration. Verify: `select public.compute_job_code(j.*) = j.code as ok from public.jobs j where j.parent_job_id is null limit 50;` → expect all `ok = true` for a representative sample of existing jobs (the helper reproduces stored codes). Insert one throwaway test job via the normal path and confirm its code matches `compute_job_code`; delete it.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/<ts>_compute_job_code_helper.sql
git commit -m "refactor(jobs): extract compute_job_code() from set_job_code trigger"
```

---

### Task 2: DB — `convert_job_service_type` RPC

**Files:**
- Create: `supabase/migrations/<ts+1>_convert_job_service_type.sql`

**Interfaces:**
- Consumes: `compute_job_code(jobs)` (Task 1); existing `team_lead_for_group(text)`, `service_monthly_task_templates`, `current_user_is_admin()`, `current_user_can(text,text)`.
- Produces: `public.convert_job_service_type(p_job_id uuid, p_target text) returns public.jobs`.

- [ ] **Step 1: Read the live owner + details-seed logic**

Read the owner-forcing triggers `jobs_local_seo_owner` (`20260619000001`), `jobs_web_seo_owner` (`20260623160000`/`20260624000000`), the general `team_lead_for_group` usage (`release_jobs_for_deal`), and the seed triggers `jobs_seed_web_website`, `jobs_seed_local_business_profile`, `jobs_seed_local_profile_url`. Capture: how each resolves the owner user (hardcoded id vs lookup) and which `details.*` keys they seed from the deal/client. You will replicate these for the UPDATE path.

- [ ] **Step 2: Write the failing verification (seeded rows + expected outcomes)**

Because DB tests here run through SQL (Vitest hits prod), write the check as a repeatable SQL script `scratch/convert_verify.sql` that: seeds a disposable web_seo job on a test deal, calls the RPC to `local_seo`, and asserts board/stage/code/owner/tasks/details/payments. First run must FAIL (function absent). Keep the seed keyed to a test deal you clean up.

- [ ] **Step 3: Write the migration — the RPC**

Create `supabase/migrations/<ts+1>_convert_job_service_type.sql`:

```sql
create or replace function public.convert_job_service_type(p_job_id uuid, p_target text)
returns public.jobs
language plpgsql security definer set search_path = public as $$
declare j public.jobs; new_stage uuid; grpA text[] := array['web_seo','local_seo','social_media','ads'];
        grpB text[] := array['hosting','domains']; same_group boolean;
begin
  -- AuthZ
  if not (current_user_is_admin() or current_user_can('accounting_onboarding','edit')) then
    raise exception 'convert: not authorized';
  end if;
  select * into j from public.jobs where id = p_job_id;
  if not found then raise exception 'convert: job % not found', p_job_id; end if;
  -- Validate v1 scope
  if j.parent_job_id is not null then raise exception 'convert: cannot convert an AI SEO child job'; end if;
  if exists (select 1 from public.jobs c where c.parent_job_id = j.id) then
    raise exception 'convert: cannot convert a parent (AI SEO) job'; end if;
  if j.service_type in ('ai_seo','web_dev','franchise','maintenance','other') then
    raise exception 'convert: % conversions are not supported yet', j.service_type; end if;
  if p_target in ('ai_seo','web_dev','franchise','maintenance','other') then
    raise exception 'convert: target % not supported yet', p_target; end if;
  if p_target = j.service_type then raise exception 'convert: same service_type'; end if;
  same_group := (j.service_type = any(grpA) and p_target = any(grpA))
             or (j.service_type = any(grpB) and p_target = any(grpB));
  if not same_group then raise exception 'convert: % -> % crosses billing-cadence group', j.service_type, p_target; end if;

  -- 1) Billing realignment (amounts untouched)
  update public.deal_payments set service_type = p_target
    where deal_id = j.deal_id and service_type = j.service_type and amount_net = j.amount_net;
  update public.deal_payment_lines dl set service_type = p_target
    where dl.job_id = j.id;                         -- lines already resolved to this job
  update public.deals d
     set services_planned = (
       select jsonb_agg(case when (elem->>'service_type') = j.service_type
                              and (elem->>'amount_net')::numeric = j.amount_net
                             then jsonb_set(elem,'{service_type}', to_jsonb(p_target))
                             else elem end)
       from jsonb_array_elements(coalesce(d.services_planned,'[]'::jsonb)) elem)
   where d.id = j.deal_id and d.services_planned is not null;

  -- 2) service_type + 3) stage remap
  select id into new_stage from public.pipeline_stages where board = p_target order by position limit 1;
  update public.jobs set service_type = p_target, stage_id = new_stage where id = p_job_id;

  -- 4) code  5) owner/group  6) monthly tasks  (re-read row after service_type change)
  select * into j from public.jobs where id = p_job_id;
  update public.jobs set code = public.compute_job_code(j) where id = p_job_id;
  -- owner: replicate the target's rule captured in Step 1
  --   local_seo -> <dtzouvaras uid>, web_seo -> <pefstathiadis uid>, else team_lead_for_group(p_target)
  --   assigned_group_id -> group whose code = p_target
  update public.jobs set owner_user_id = <resolved>, assigned_group_id =
     (select id from public.groups where code = p_target) where id = p_job_id;
  update public.jobs set monthly_tasks =
     (select tasks from public.service_monthly_task_templates where service_type = p_target),
     monthly_tasks_period = null where id = p_job_id;

  -- 7) details migration: keep shared keys, drop source-only, seed target defaults
  --   (implement per serviceInfoFields.ts field sets captured in Step 1)
  update public.jobs set details = public.convert_job_details(j.details, j.service_type, p_target, j.deal_id, j.client_id)
    where id = p_job_id;

  -- 8) business-profile mirror reconciled by existing sync when local_seo is involved (no-op otherwise)
  -- 9) audit
  insert into public.activity_log(entity_type, entity_id, action, meta, actor_user_id)
    values ('job', p_job_id, 'service_type_converted',
            jsonb_build_object('from', j.service_type, 'to', p_target), auth.uid());

  select * into j from public.jobs where id = p_job_id;
  return j;
end $$;

revoke all on function public.convert_job_service_type(uuid, text) from public;
grant execute on function public.convert_job_service_type(uuid, text) to authenticated;

-- ROLLBACK: drop function if exists public.convert_job_service_type(uuid, text);
```

> Replace the `<resolved>` owner expression and implement `convert_job_details(...)` using the exact rules read in Step 1 (owner uids and per-service `details.*` key sets). If `activity_log`'s column names differ, match the live schema (read one recent insert). Keep everything inside the single function so it is one transaction.

- [ ] **Step 4: Apply + run the verification; confirm PASS, then clean up seed**

Apply the migration; run `scratch/convert_verify.sql` → all assertions pass; delete the seeded test rows.

- [ ] **Step 5: RLS + guard checks (live, two roles)**

As `akotzampasakis@itdev.gr` / `123456789` (non-admin non-accounting sales) call the RPC → expect `not authorized`. As admin (`info@itdev.gr`) convert a seeded hosting→domains → success; try hosting→web_seo → `crosses billing-cadence group`; try an ai_seo job → `not supported yet`. Clean up.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/<ts+1>_convert_job_service_type.sql
git commit -m "feat(jobs): convert_job_service_type RPC (admin/accounting, money-preserving)"
```

---

### Task 3: Frontend — convertibility helper

**Files:**
- Create: `src/features/jobs/serviceConversion.ts`, `src/features/jobs/serviceConversion.test.ts`

**Interfaces:**
- Produces: `convertibleTargets(job: { service_type: string; parent_job_id: string | null; hasChildren?: boolean }): string[]` and `canConvert(job): boolean`.

- [ ] **Step 1: Write the failing test**

Create `src/features/jobs/serviceConversion.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { convertibleTargets, canConvert } from './serviceConversion';

describe('convertibleTargets', () => {
  it('offers same-group peers for group A', () => {
    expect(convertibleTargets({ service_type: 'web_seo', parent_job_id: null }).sort())
      .toEqual(['ads', 'local_seo', 'social_media']);
  });
  it('offers domains for hosting (group B)', () => {
    expect(convertibleTargets({ service_type: 'hosting', parent_job_id: null })).toEqual(['domains']);
  });
  it('offers nothing for ai_seo / web_dev / children', () => {
    expect(convertibleTargets({ service_type: 'ai_seo', parent_job_id: null })).toEqual([]);
    expect(convertibleTargets({ service_type: 'web_dev', parent_job_id: null })).toEqual([]);
    expect(convertibleTargets({ service_type: 'web_seo', parent_job_id: 'x' })).toEqual([]);
    expect(convertibleTargets({ service_type: 'web_seo', parent_job_id: null, hasChildren: true })).toEqual([]);
  });
  it('canConvert reflects target availability', () => {
    expect(canConvert({ service_type: 'web_seo', parent_job_id: null })).toBe(true);
    expect(canConvert({ service_type: 'web_dev', parent_job_id: null })).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:run -- src/features/jobs/serviceConversion.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement**

Create `src/features/jobs/serviceConversion.ts`:

```ts
export const CONVERT_GROUP_A = ['web_seo', 'local_seo', 'social_media', 'ads'] as const;
export const CONVERT_GROUP_B = ['hosting', 'domains'] as const;

function group(s: string): readonly string[] | null {
  if ((CONVERT_GROUP_A as readonly string[]).includes(s)) return CONVERT_GROUP_A;
  if ((CONVERT_GROUP_B as readonly string[]).includes(s)) return CONVERT_GROUP_B;
  return null;
}

export function convertibleTargets(job: {
  service_type: string; parent_job_id: string | null; hasChildren?: boolean;
}): string[] {
  if (job.parent_job_id || job.hasChildren) return [];
  const g = group(job.service_type);
  if (!g) return [];
  return g.filter((s) => s !== job.service_type);
}

export function canConvert(job: {
  service_type: string; parent_job_id: string | null; hasChildren?: boolean;
}): boolean {
  return convertibleTargets(job).length > 0;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm run test:run -- src/features/jobs/serviceConversion.test.ts` → PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/jobs/serviceConversion.ts src/features/jobs/serviceConversion.test.ts
git commit -m "feat(jobs): service-conversion eligibility helper"
```

---

### Task 4: Frontend — dialog, hook, JobDetailPage button, i18n

**Files:**
- Create: `src/features/jobs/hooks/useConvertJobService.ts`, `src/features/jobs/ConvertServiceDialog.tsx`, `src/features/jobs/ConvertServiceDialog.test.tsx`
- Modify: `src/features/jobs/JobDetailPage.tsx` (~`:469-472`), `src/i18n/locales/el/jobs.json`, `src/i18n/locales/en/jobs.json`

**Interfaces:**
- Consumes: `convertibleTargets` (Task 3); `supabase.rpc('convert_job_service_type', { p_job_id, p_target })` (Task 2).
- Produces: `useConvertJobService()` mutation; `<ConvertServiceDialog job=... open=... onOpenChange=... />`.

- [ ] **Step 1: Implement the mutation hook**

Create `src/features/jobs/hooks/useConvertJobService.ts`:

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export function useConvertJobService() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ jobId, target }: { jobId: string; target: string }) => {
      const { data, error } = await supabase.rpc('convert_job_service_type', {
        p_job_id: jobId, p_target: target,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jobs'] });
      qc.invalidateQueries({ queryKey: ['deal'] });
    },
  });
}
```

- [ ] **Step 2: Add i18n strings**

In `src/i18n/locales/el/jobs.json` add:
```json
  "convert": {
    "action": "Μετατροπή υπηρεσίας",
    "title": "Μετατροπή υπηρεσίας job",
    "target": "Νέα υπηρεσία",
    "warning": "Το job θα μετακινηθεί σε νέο board· owner, μηνιαία tasks και code θα ανανεωθούν, και άσχετα info-πεδία θα καθαριστούν. Τα ποσά/πληρωμές μένουν ίδια.",
    "none": "Αυτό το job δεν μπορεί να μετατραπεί (AI SEO / web dev / ειδική υπηρεσία).",
    "confirm": "Μετατροπή",
    "success": "Η υπηρεσία μετατράπηκε.",
    "error": "Αποτυχία μετατροπής: {{msg}}"
  }
```
In `src/i18n/locales/en/jobs.json` add the English equivalents (same keys).

- [ ] **Step 3: Write the failing dialog test**

Create `src/features/jobs/ConvertServiceDialog.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? _k }) }));
const mutate = vi.fn();
vi.mock('./hooks/useConvertJobService', () => ({ useConvertJobService: () => ({ mutate, isPending: false }) }));
import { ConvertServiceDialog } from './ConvertServiceDialog';

describe('ConvertServiceDialog', () => {
  it('lists valid targets for a web_seo job', () => {
    render(<ConvertServiceDialog job={{ id: 'j1', service_type: 'web_seo', parent_job_id: null }} open onOpenChange={() => {}} />);
    expect(screen.getByText('local_seo')).toBeTruthy();
    expect(screen.queryByText('web_dev')).toBeNull();
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npm run test:run -- src/features/jobs/ConvertServiceDialog.test.tsx` → FAIL (component missing).

- [ ] **Step 5: Implement the dialog**

Create `src/features/jobs/ConvertServiceDialog.tsx` using the existing shadcn `Dialog` + `Select` (follow an existing dialog in `src/features/jobs/` for imports/pattern). It: reads `convertibleTargets(job)`; if empty shows `convert.none`; else a target `<Select>` + the `convert.warning` + a confirm button calling `useConvertJobService().mutate({ jobId: job.id, target })`, closing on success (toast `convert.success`) and toasting `convert.error` with the message on failure. Labels for targets via the existing `SERVICE_LABELS`/i18n `services.types.*`.

- [ ] **Step 6: Run it to verify it passes**

Run: `npm run test:run -- src/features/jobs/ConvertServiceDialog.test.tsx` → PASS.

- [ ] **Step 7: Wire the button into JobDetailPage**

In `src/features/jobs/JobDetailPage.tsx` near the service badge (~`:469-472`), render a **«Μετατροπή υπηρεσίας»** button that opens `ConvertServiceDialog`, gated so it only shows when the viewer is admin or accounting AND `canConvert(job)`. Use the existing role/permission hook in this file (match how other admin-only affordances are gated here — do not invent a new predicate).

- [ ] **Step 8: Typecheck / lint / full build**

Run: `npm run build` → green.

- [ ] **Step 9: Commit**

```bash
git add src/features/jobs/hooks/useConvertJobService.ts src/features/jobs/ConvertServiceDialog.tsx src/features/jobs/ConvertServiceDialog.test.tsx src/features/jobs/JobDetailPage.tsx src/i18n/locales/el/jobs.json src/i18n/locales/en/jobs.json
git commit -m "feat(jobs): Convert-service dialog + button (admin/accounting)"
```

---

## Self-Review

- **Spec coverage:** allowed-conversion rule → Task 3 helper + Task 2 guards ✓; money-preserving billing realign → Task 2 Step 3 ✓; stage remap/code/owner/tasks/details reset → Task 2 ✓; permissions (admin/accounting, SECURITY DEFINER) → Task 2 guard + Task 4 Step 7 ✓; UX dialog → Task 4 ✓; audit → Task 2 activity insert ✓; no-drift code helper → Task 1 ✓. AI SEO / web_dev / cross-group explicitly blocked → Task 2 guards + Task 3 ✓.
- **Known read-required steps (not placeholders — refactor of existing code):** Task 1 Step 1 and Task 2 Step 1 direct the implementer to read live function bodies (`set_job_code`, owner triggers, seed triggers, `activity_log` columns) before writing, because faithfully preserving existing behavior requires the live definition. The `<resolved>` owner expression and `convert_job_details` body are specified by contract and filled from those reads.
- **Type consistency:** `convertibleTargets`/`canConvert` signatures match across Tasks 3–4; RPC name/args `convert_job_service_type(p_job_id, p_target)` identical in Tasks 2 and 4.
- **Open design items (from spec §9) still pending owner confirmation:** Q2 billing = keep-money (assumed); Q3 = reset (assumed); cross-group excluded; button on Job detail page; AI SEO deferred. If the owner changes Q2/Q3, Task 2 Steps 3/§4–7 adjust accordingly.
