# Multiple web_dev Jobs Per Deal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a deal hold any number of web_dev jobs (one per website) via a work-only "Add website" action on the deal page, with dept-task routing fixed to surface tasks on every web_dev job.

**Architecture:** A new `add_web_dev_job` security-definer RPC creates a payment-free web_dev job (`installment_plan='custom'` + NULL schedule keeps every branch of `generate_payments_for_deal` away from it). A small inline `AddWebsiteForm` in `JobsBillingPanel` calls it. `useDealServiceJob`/`resolveTaskOpenLink` become plural so the task dialog links to all matching jobs.

**Tech Stack:** Supabase Postgres (plpgsql, RLS, security definer RPCs), React 18 + TypeScript + TanStack Query, vitest + @testing-library/react, i18next (en+el).

**Spec:** `docs/superpowers/specs/2026-07-20-multi-webdev-jobs-design.md`

## Global Constraints

- Prod Supabase project: **CRM `xujlrclyzxrvxszepquy`** — migrations are applied to prod during implementation (established workflow).
- Run SQL via the Supabase MCP (`apply_migration` / `execute_sql`) or the Management API curl recipe (env `SUPABASE_ACCESS_TOKEN`-style `sbp_` token; curl needs a UA header). Never paste literal secrets into files.
- All harness test SQL runs inside `begin; … rollback;` — zero prod rows may survive a test.
- Harness identity trick: `set_config('request.jwt.claims', …)` **before** `set local role authenticated` (established GUC recipe).
- `npm run build` (tsc -b + eslint `--max-warnings=0`) must pass — it is stricter than `tsc --noEmit`.
- vitest is configured against PROD for integration tests — run **only the named test files** in this plan (they mock all IO), never the whole suite.
- No PRs: commit per task, push directly to `main`. Vercel auto-deploys on push.
- Every migration file starts with a comment header containing spec path + explicit `ROLLBACK:` SQL.
- Before editing any existing DB function, read its **live** body via `pg_get_functiondef` (prod drifts from migration files).
- Commit messages end with `Co-Authored-By:` per repo convention (see recent `git log`).

## File Structure

- Create: `supabase/migrations/20260720120000_add_web_dev_job.sql` — the RPC (+grants). One responsibility: sanctioned creation of an extra work-only web_dev job.
- Modify: `src/lib/rpc.ts` — thin `addWebDevJob` wrapper next to `createCustomJob` (~line 201).
- Modify: `src/features/deals/hooks/useCustomJobMutations.ts` — `useAddWebsiteJob` mutation (reuses `invalidateBilling`).
- Create: `src/features/deals/AddWebsiteForm.tsx` (+ `.test.tsx`) — inline form, mirrors `AddCustomJobForm` pattern.
- Modify: `src/features/deals/JobsBillingPanel.tsx` — second header button + form mount.
- Modify: `src/i18n/locales/{en,el}/deals.json` — `jobs_billing.add_website`, `jobs_billing.website_form.*`, `jobs_billing.billing_errors.website_required`.
- Modify: `src/features/assigned_tasks/taskOpenLink.ts` (+ `.test.ts`) — plural `resolveTaskOpenLinks`.
- Modify: `src/features/assigned_tasks/hooks/useDealServiceJob.ts` — plural `useDealServiceJobs`.
- Modify: `src/features/assigned_tasks/AssignedTaskDetailDialog.tsx` (+ `.test.tsx`) — render one link per matching job.

---

### Task 1: `add_web_dev_job` RPC (migration + prod apply + harness tests)

**Files:**
- Create: `supabase/migrations/20260720120000_add_web_dev_job.sql`

**Interfaces:**
- Consumes: existing helpers `current_user_is_admin()`, `current_user_can(text,text)`, `team_lead_for_group(text)`, trigger `jobs_set_code` (BEFORE INSERT, overwrites `code` via `generate_job_code` → `-WEBDEV-2` suffixing), trigger `jobs_seed_web_dev_info` (fill-empty-only).
- Produces: `public.add_web_dev_job(p_deal_id uuid, p_website text, p_industry text default null) returns jsonb` — `{ok:true, job_id, code}` or `{ok:false, errors:[…]}` with error codes `permission_denied` | `deal_not_found` | `website_required`. Task 2 calls it via PostgREST as `add_web_dev_job`.

- [ ] **Step 1: Run the harness test to verify it fails (function absent)**

Run against prod (MCP `execute_sql`, project `xujlrclyzxrvxszepquy`):

```sql
begin;
select set_config('request.jwt.claims',
  (select jsonb_build_object('sub', id::text, 'role', 'authenticated')::text
     from auth.users where email = 'info@itdev.gr'), true);
set local role authenticated;
select public.add_web_dev_job(
  (select d.id from public.deals d
     join public.jobs j on j.deal_id = d.id and j.service_type = 'web_dev' and not j.archived
    order by d.created_at desc limit 1),
  'https://second-site-test.gr', 'technology');
rollback;
```

Expected: **ERROR: function public.add_web_dev_job(uuid, text, text) does not exist**

- [ ] **Step 2: Write the migration**

`supabase/migrations/20260720120000_add_web_dev_job.sql`:

```sql
-- 20260720120000_add_web_dev_job.sql
-- Spec: docs/superpowers/specs/2026-07-20-multi-webdev-jobs-design.md
--
-- Sanctioned path for additional websites on a deal (web_dev job = a website):
-- creates a WORK-ONLY web_dev job — no payments now or later. installment_plan
-- 'custom' with a NULL installment_schedule is skipped by every branch of
-- generate_payments_for_deal (custom branch requires schedule not null; the
-- grouped branch excludes web_dev one_time with plan in 50_50/50_25_25/custom),
-- so deal-wide payment regeneration never bills this job until accounting
-- attaches billing via update_job_billing. Code auto-suffixes (-WEBDEV-2, …)
-- via the jobs_set_code trigger; jobs_seed_web_dev_info is fill-empty-only so
-- the explicit website wins and a blank industry inherits the client's.
--
-- ROLLBACK:
--   drop function if exists public.add_web_dev_job(uuid, text, text);

create or replace function public.add_web_dev_job(
  p_deal_id uuid, p_website text, p_industry text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare d public.deals; v_job_id uuid; v_code text; v_stage uuid; v_owner uuid;
        v_group uuid; v_site text; v_details jsonb;
begin
  if not (current_user_is_admin() or current_user_can('accounting_onboarding','edit')) then
    return jsonb_build_object('ok', false, 'errors', array['permission_denied']); end if;
  select * into d from public.deals where id = p_deal_id;
  if not found then
    return jsonb_build_object('ok', false, 'errors', array['deal_not_found']); end if;
  v_site := nullif(trim(coalesce(p_website, '')), '');
  if v_site is null then
    return jsonb_build_object('ok', false, 'errors', array['website_required']); end if;

  v_details := jsonb_build_object('website', v_site);
  if nullif(trim(coalesce(p_industry, '')), '') is not null then
    v_details := v_details || jsonb_build_object('industry', trim(p_industry));
  end if;

  select id into v_stage from public.pipeline_stages
    where board = 'web_dev' and not archived order by position limit 1;
  v_owner := public.team_lead_for_group('web_dev');
  select id into v_group from public.groups where code = 'web_dev';

  insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net,
      vat_rate, setup_fee, title, is_custom, billing_only, billing_active, status,
      stage_id, assigned_group_id, owner_user_id, started_at, code, installment_plan,
      details)
    values (d.id, d.client_id, 'web_dev', 'one_time', 0, 24, 0,
      regexp_replace(regexp_replace(v_site, '^https?://', ''), '/+$', ''),
      true, false, true, 'active', v_stage, v_group, v_owner, now(), d.code,
      'custom', v_details)
    returning id, code into v_job_id, v_code;

  return jsonb_build_object('ok', true, 'job_id', v_job_id, 'code', v_code);
end $function$;

revoke all on function public.add_web_dev_job(uuid, text, text) from public, anon;
grant execute on function public.add_web_dev_job(uuid, text, text) to authenticated;
```

- [ ] **Step 3: Apply to prod**

MCP `apply_migration` (project `xujlrclyzxrvxszepquy`, name `add_web_dev_job`) with the file's SQL.
Expected: success, no errors.

- [ ] **Step 4: Run the positive harness test**

One `execute_sql` request, fully rolled back:

```sql
begin;
create temp table _t on commit drop as
  select d.id as deal_id,
         (select count(*) from public.deal_payments p where p.deal_id = d.id) as pay_before
    from public.deals d
    join public.jobs j on j.deal_id = d.id and j.service_type = 'web_dev' and not j.archived
   order by d.created_at desc limit 1;
select set_config('request.jwt.claims',
  (select jsonb_build_object('sub', id::text, 'role', 'authenticated')::text
     from auth.users where email = 'info@itdev.gr'), true);
set local role authenticated;
select public.add_web_dev_job((select deal_id from _t),
       'https://second-site-test.gr', 'technology') as result;
reset role;
select j.code, j.details->>'website' as website, j.details->>'industry' as industry,
       j.amount_net, j.installment_plan, j.installment_schedule, j.billing_active,
       j.stage_id is not null as has_stage
  from public.jobs j
 where j.deal_id = (select deal_id from _t) and j.service_type = 'web_dev'
 order by j.created_at;
select public.generate_payments_for_deal((select deal_id from _t));
select (select count(*) from public.deal_payments p where p.deal_id = (select deal_id from _t))
       - (select pay_before from _t) as new_payments;
rollback;
```

Expected: `result->>'ok' = true`; second row has code ending `-WEBDEV-2` (or next free suffix), `website = 'https://second-site-test.gr'`, `industry = 'technology'`, `amount_net = 0`, `installment_plan = 'custom'`, `installment_schedule` NULL, `billing_active = true`, `has_stage = true`; **`new_payments = 0`** (the generator regression check).

- [ ] **Step 5: Run the negative harness tests**

5a. Pick a **sales** rep's uuid — one that is neither admin nor in the `accounting` group. First read how the permission helpers check membership (their live bodies, since prod drifts):

```sql
select pg_get_functiondef('public.current_user_is_admin()'::regprocedure);
select pg_get_functiondef('public.current_user_can(text,text)'::regprocedure);
select u.id, u.email from auth.users u order by u.email;
```

Choose one of the 7 standing sales accounts (test-accounts memory) and confirm against the membership tables those bodies reference that it has neither privilege.

5b. Permission check (substitute the uuid from 5a):

```sql
begin;
select set_config('request.jwt.claims',
  jsonb_build_object('sub', '<SALES_USER_UUID>', 'role', 'authenticated')::text, true);
set local role authenticated;
select public.add_web_dev_job(
  (select id from public.deals order by created_at desc limit 1), 'https://x.gr', null);
rollback;
```

Expected: `{"ok": false, "errors": ["permission_denied"]}`.

5c. Blank-website check (as admin):

```sql
begin;
select set_config('request.jwt.claims',
  (select jsonb_build_object('sub', id::text, 'role', 'authenticated')::text
     from auth.users where email = 'info@itdev.gr'), true);
set local role authenticated;
select public.add_web_dev_job(
  (select id from public.deals order by created_at desc limit 1), '   ', null);
rollback;
```

Expected: `{"ok": false, "errors": ["website_required"]}`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260720120000_add_web_dev_job.sql
git commit -m "feat(jobs): add_web_dev_job RPC — work-only extra website job per deal

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push
```

---

### Task 2: `addWebDevJob` wrapper + `useAddWebsiteJob` mutation

**Files:**
- Modify: `src/lib/rpc.ts` (place directly below `createCustomJob`, ~line 215)
- Modify: `src/features/deals/hooks/useCustomJobMutations.ts`

**Interfaces:**
- Consumes: Task 1's RPC; existing `rpcCall`, `JobBillingResult`, `captureMutation`, `invalidateBilling`, `throwOnFailure` (all already in these two files — match their exact local idioms).
- Produces: `addWebDevJob(input: AddWebsiteJobInput): Promise<JobBillingResult>` and `useAddWebsiteJob(dealId: string)` returning a mutation whose `mutateAsync` takes `{ website: string; industry?: string | null }` and resolves to the new job id (string). Task 3's form consumes `useAddWebsiteJob`.

- [ ] **Step 1: Add the wrapper in `src/lib/rpc.ts`**

```ts
export type AddWebsiteJobInput = {
  dealId: string;
  /** New website's URL — becomes the job's Info-tab website + its title. */
  website: string;
  industry?: string | null;
};

export async function addWebDevJob(input: AddWebsiteJobInput): Promise<JobBillingResult> {
  const { data, error } = await rpcCall('add_web_dev_job', {
    p_deal_id: input.dealId,
    p_website: input.website,
    p_industry: input.industry ?? null,
  });
  if (error) throw new Error(error.message);
  return data as JobBillingResult;
}
```

(Follow the exact error-handling lines of the adjacent `createCustomJob` — if it uses a shared helper instead of `if (error) throw`, mirror that.)

- [ ] **Step 2: Add the mutation hook in `useCustomJobMutations.ts`**

Extend the import from `@/lib/rpc` with `addWebDevJob, type AddWebsiteJobInput`, then:

```ts
export function useAddWebsiteJob(dealId: string) {
  const qc = useQueryClient();
  return useMutation<string, DefaultError, Omit<AddWebsiteJobInput, 'dealId'>>({
    mutationFn: captureMutation('jobs', 'add_web_dev_job', async (input) => {
      const result = await addWebDevJob({ ...input, dealId });
      return throwOnFailure(result);
    }),
    onSuccess: () => {
      invalidateBilling(qc, dealId);
      void qc.invalidateQueries({ queryKey: ['deal-service-job', dealId, 'web_dev'] });
    },
  });
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run build`
Expected: PASS (0 errors, 0 warnings).

- [ ] **Step 4: Commit**

```bash
git add src/lib/rpc.ts src/features/deals/hooks/useCustomJobMutations.ts
git commit -m "feat(jobs): addWebDevJob rpc wrapper + useAddWebsiteJob mutation

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push
```

---

### Task 3: `AddWebsiteForm` + JobsBillingPanel button + i18n

**Files:**
- Create: `src/features/deals/AddWebsiteForm.tsx`
- Test: `src/features/deals/AddWebsiteForm.test.tsx`
- Modify: `src/features/deals/JobsBillingPanel.tsx` (header block ~lines 682-706)
- Modify: `src/i18n/locales/en/deals.json`, `src/i18n/locales/el/deals.json`

**Interfaces:**
- Consumes: `useAddWebsiteJob` (Task 2), `INDUSTRIES` from `@/lib/industries` (`{code, labels:{en,el}}[]`), shadcn `Button/Input/Label/Select` as in `AddCustomJobForm.tsx`.
- Produces: `<AddWebsiteForm dealId onDone? />`; new i18n keys under `jobs_billing`.

- [ ] **Step 1: Write the failing component test**

`src/features/deals/AddWebsiteForm.test.tsx` (mirrors `AddCustomJobForm.test.tsx`):

```tsx
import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { i18n } from '@/lib/i18n';

const mutateAsync = vi.fn().mockResolvedValue('job-1');
vi.mock('./hooks/useCustomJobMutations', () => ({
  useAddWebsiteJob: () => ({ mutateAsync, isPending: false }),
}));

import { AddWebsiteForm } from './AddWebsiteForm';

function wrap(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
    </QueryClientProvider>
  );
}

describe('AddWebsiteForm', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps submit disabled until a website URL is entered', async () => {
    const user = userEvent.setup();
    render(wrap(<AddWebsiteForm dealId="d1" />));
    const submit = screen.getByRole('button', { name: /add website/i });
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText(/website url/i), 'https://example.com');
    expect(submit).toBeEnabled();
  });

  it('submits the website (industry optional) via add_web_dev_job', async () => {
    const user = userEvent.setup();
    render(wrap(<AddWebsiteForm dealId="d1" />));
    await user.type(screen.getByLabelText(/website url/i), '  https://example.com ');
    await user.click(screen.getByRole('button', { name: /add website/i }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith({ website: 'https://example.com', industry: null });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/features/deals/AddWebsiteForm.test.tsx`
Expected: FAIL — cannot resolve `./AddWebsiteForm`.

- [ ] **Step 3: Add the i18n keys**

`src/i18n/locales/en/deals.json`, inside `jobs_billing` (next to `"add_job"`):

```json
"add_website": "+ Add website",
"website_form": {
  "website": "Website URL",
  "website_placeholder": "https://example.com",
  "industry": "Industry",
  "industry_placeholder": "—",
  "submit": "Add website",
  "submitting": "Adding…"
}
```

and inside `jobs_billing.billing_errors`: `"website_required": "Website URL is required."`

`src/i18n/locales/el/deals.json`, same positions:

```json
"add_website": "+ Προσθήκη ιστοσελίδας",
"website_form": {
  "website": "URL Ιστοσελίδας",
  "website_placeholder": "https://example.com",
  "industry": "Κλάδος",
  "industry_placeholder": "—",
  "submit": "Προσθήκη ιστοσελίδας",
  "submitting": "Προσθήκη…"
}
```

and `"website_required": "Το URL της ιστοσελίδας είναι υποχρεωτικό."`

- [ ] **Step 4: Write `src/features/deals/AddWebsiteForm.tsx`**

```tsx
import { useState } from 'react';
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
import { INDUSTRIES } from '@/lib/industries';
import { useAddWebsiteJob } from './hooks/useCustomJobMutations';

type Props = {
  dealId: string;
  onDone?: () => void;
};

/** Work-only extra website on a deal (web_dev job = a website). No billing here —
 *  accounting attaches payments later via the job's billing editor if needed. */
export function AddWebsiteForm({ dealId, onDone }: Props) {
  const { t, i18n } = useTranslation('deals');
  const add = useAddWebsiteJob(dealId);
  const [website, setWebsite] = useState('');
  const [industry, setIndustry] = useState('');

  const lang: 'en' | 'el' = i18n.language.startsWith('el') ? 'el' : 'en';
  const canSubmit = website.trim().length > 0 && !add.isPending;

  async function submit() {
    if (!canSubmit) return;
    try {
      await add.mutateAsync({ website: website.trim(), industry: industry || null });
      setWebsite('');
      setIndustry('');
      onDone?.();
    } catch (err) {
      const code = (err as Error & { errors?: string[] }).errors?.[0] ?? (err as Error).message;
      alert(t(`jobs_billing.billing_errors.${code}`, { defaultValue: code }));
    }
  }

  return (
    <div className="grid grid-cols-2 gap-3 rounded-md border bg-muted p-3 sm:grid-cols-3">
      <div className="col-span-2 sm:col-span-1">
        <Label htmlFor="aw-website" className="text-xs">
          {t('jobs_billing.website_form.website')}
        </Label>
        <Input
          id="aw-website"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          placeholder={t('jobs_billing.website_form.website_placeholder')}
        />
      </div>
      <div className="col-span-2 sm:col-span-1">
        <Label id="aw-industry-label" className="text-xs">
          {t('jobs_billing.website_form.industry')}
        </Label>
        <Select value={industry} onValueChange={setIndustry}>
          <SelectTrigger aria-labelledby="aw-industry-label">
            <SelectValue placeholder={t('jobs_billing.website_form.industry_placeholder')} />
          </SelectTrigger>
          <SelectContent>
            {INDUSTRIES.map((i) => (
              <SelectItem key={i.code} value={i.code}>
                {i.labels[lang]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="col-span-2 flex items-end sm:col-span-1">
        <Button type="button" size="sm" disabled={!canSubmit} onClick={submit}>
          {add.isPending
            ? t('jobs_billing.website_form.submitting')
            : t('jobs_billing.website_form.submit')}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/features/deals/AddWebsiteForm.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Mount in `JobsBillingPanel.tsx`**

Add `import { AddWebsiteForm } from './AddWebsiteForm';`, a `const [showAddWebsite, setShowAddWebsite] = useState(false);` next to the existing `showAdd` state, and change the header block (~line 686):

```tsx
{!readOnly && (
  <div className="flex items-center gap-1.5">
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="h-7 px-2 text-[11px]"
      onClick={() => setShowAddWebsite((v) => !v)}
    >
      {t('jobs_billing.add_website')}
    </Button>
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="h-7 px-2 text-[11px]"
      onClick={() => setShowAdd((v) => !v)}
    >
      {t('jobs_billing.add_job')}
    </Button>
  </div>
)}
```

and below the existing `{!readOnly && showAdd && (<AddCustomJobForm …/>)}` block:

```tsx
{!readOnly && showAddWebsite && (
  <AddWebsiteForm dealId={dealId} onDone={() => setShowAddWebsite(false)} />
)}
```

(`readOnly` is `!canManageBilling` = admin or accounting group — exactly the spec's access rule; `DealDetailPage.tsx:66`.)

- [ ] **Step 7: Run the panel's existing tests**

Run: `npx vitest run src/features/deals/JobsBillingPanel.test.tsx src/features/deals/AddCustomJobForm.test.tsx`
Expected: PASS. If a JobsBillingPanel test queries buttons by role/name ambiguously now that a second button exists, tighten its query (`{ name: /add job/i }`) — do not change behavior.

- [ ] **Step 8: Build + commit**

Run: `npm run build` — expected PASS.

```bash
git add src/features/deals/AddWebsiteForm.tsx src/features/deals/AddWebsiteForm.test.tsx \
        src/features/deals/JobsBillingPanel.tsx src/i18n/locales/en/deals.json src/i18n/locales/el/deals.json
git commit -m "feat(deals): Add website button — extra work-only web_dev job per deal

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push
```

---

### Task 4: Dept-task routing — link to ALL of the deal's web_dev jobs

**Files:**
- Modify: `src/features/assigned_tasks/taskOpenLink.ts`
- Test: `src/features/assigned_tasks/taskOpenLink.test.ts`
- Modify: `src/features/assigned_tasks/hooks/useDealServiceJob.ts`
- Modify: `src/features/assigned_tasks/AssignedTaskDetailDialog.tsx` (lines 16-17, 76-80, 92-100, 117-128)
- Test: `src/features/assigned_tasks/AssignedTaskDetailDialog.test.tsx` (update mocks)

**Interfaces:**
- Consumes: nothing from Tasks 1-3 (independent).
- Produces: `resolveTaskOpenLinks(params): TaskOpenLink[]` where `TaskOpenLink = { href: string; labelKey: 'open_deal' | 'open_job'; code: string }` (no longer nullable) and `params.matchingJobs: { id: string; code: string | null }[]`; `useDealServiceJobs(dealId, serviceType, enabled)` returning `{ id: string; code: string | null }[]`.
- Note: the job Tasks tab (`useAssignedTasksForSource` `deptMatch`) already matches by `(deal_id, department)` so every web_dev job shows the task — no change there.

- [ ] **Step 1: Rewrite the pure-function test first**

Replace `src/features/assigned_tasks/taskOpenLink.test.ts` body — keep the existing cases, adapted to arrays, and add the multi-job case:

```ts
import { describe, it, expect } from 'vitest';
import { resolveTaskOpenLinks } from './taskOpenLink';

describe('resolveTaskOpenLinks', () => {
  it('job-scoped task always opens its job', () => {
    expect(
      resolveTaskOpenLinks({ dealId: null, jobId: 'j1', sourceCode: '000042-WEBDEV', canOpenDeal: false, matchingJobs: [] }),
    ).toEqual([{ href: '/jobs/j1', labelKey: 'open_job', code: '000042-WEBDEV' }]);
  });

  it('deal-scoped task opens the deal when the viewer can', () => {
    expect(
      resolveTaskOpenLinks({ dealId: 'd1', jobId: null, sourceCode: '000042', canOpenDeal: true, matchingJobs: [] }),
    ).toEqual([{ href: '/deals/d1', labelKey: 'open_deal', code: '000042' }]);
  });

  it('deal-scoped task links to EVERY matching service job for technical viewers', () => {
    expect(
      resolveTaskOpenLinks({
        dealId: 'd1',
        jobId: null,
        sourceCode: '000042',
        canOpenDeal: false,
        matchingJobs: [
          { id: 'j1', code: '000042-WEBDEV' },
          { id: 'j2', code: '000042-WEBDEV-2' },
        ],
      }),
    ).toEqual([
      { href: '/jobs/j1', labelKey: 'open_job', code: '000042-WEBDEV' },
      { href: '/jobs/j2', labelKey: 'open_job', code: '000042-WEBDEV-2' },
    ]);
  });

  it('returns [] when a technical viewer has no matching job', () => {
    expect(
      resolveTaskOpenLinks({ dealId: 'd1', jobId: null, sourceCode: '000042', canOpenDeal: false, matchingJobs: [] }),
    ).toEqual([]);
  });

  it('returns [] with no deal and no job', () => {
    expect(
      resolveTaskOpenLinks({ dealId: null, jobId: null, sourceCode: null, canOpenDeal: true, matchingJobs: [] }),
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/features/assigned_tasks/taskOpenLink.test.ts`
Expected: FAIL — `resolveTaskOpenLinks` is not exported.

- [ ] **Step 3: Rewrite `taskOpenLink.ts`**

```ts
export type TaskOpenLink = { href: string; labelKey: 'open_deal' | 'open_job'; code: string };

/**
 * Where the task detail's "open" links should point, and what to label them.
 *
 * A deal-scoped task surfaces on the matching service jobs, but the technical team
 * cannot open the deal page (deals aren't readable by their groups). So for a
 * deal-scoped task, when the viewer can't open the deal, link to EVERY matching
 * service job of the deal (a deal can hold several web_dev jobs — one per website).
 * Job-scoped tasks always open their job; users who can open deals keep the deal link.
 */
export function resolveTaskOpenLinks(params: {
  dealId: string | null;
  jobId: string | null;
  sourceCode: string | null;
  canOpenDeal: boolean;
  matchingJobs: { id: string; code: string | null }[];
}): TaskOpenLink[] {
  const { dealId, jobId, sourceCode, canOpenDeal, matchingJobs } = params;
  const code = sourceCode ?? '';
  if (jobId) return [{ href: `/jobs/${jobId}`, labelKey: 'open_job', code }];
  if (dealId) {
    if (canOpenDeal) return [{ href: `/deals/${dealId}`, labelKey: 'open_deal', code }];
    return matchingJobs.map((j) => ({
      href: `/jobs/${j.id}`,
      labelKey: 'open_job' as const,
      code: j.code ?? code,
    }));
  }
  return [];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/features/assigned_tasks/taskOpenLink.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Pluralize the hook** (`hooks/useDealServiceJob.ts` — keep the filename)

```ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

/** ALL of the deal's jobs for a given service (a deal can hold several web_dev
 *  jobs — one per website) — used to send technical users to the jobs they can
 *  access instead of the deal page they can't. Oldest first. */
export function useDealServiceJobs(
  dealId: string | null,
  serviceType: string | null | undefined,
  enabled: boolean,
) {
  return useQuery<{ id: string; code: string | null }[]>({
    queryKey: ['deal-service-job', dealId, serviceType],
    enabled: enabled && !!dealId && !!serviceType,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('jobs')
        .select('id, code')
        .eq('deal_id', dealId!)
        .eq('service_type', serviceType!)
        .eq('archived', false)
        .order('created_at', { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as { id: string; code: string | null }[];
    },
  });
}
```

- [ ] **Step 6: Update `AssignedTaskDetailDialog.tsx`**

Imports (lines 16-17): `resolveTaskOpenLinks` / `useDealServiceJobs`. Replace lines 76-80:

```tsx
const { data: matchingJobs } = useDealServiceJobs(
  task?.deal_id ?? null,
  task?.department?.code ?? null,
  needJobLink,
);
```

Replace the `openLink` computation (lines 92-100):

```tsx
const openLinks = task
  ? resolveTaskOpenLinks({
      dealId: task.deal_id,
      jobId: task.job_id,
      sourceCode: task.source_code,
      canOpenDeal,
      matchingJobs: matchingJobs ?? [],
    })
  : [];
```

Replace the source row (lines 117-128):

```tsx
...(openLinks.length
  ? [{
      label: c('tasks_page.source_label'),
      value: (
        <div className="flex flex-col gap-0.5">
          {openLinks.map((l) => (
            <Link key={l.href} to={l.href} className="font-mono text-xs text-primary hover:underline">
              {l.code || task.source_code}
            </Link>
          ))}
        </div>
      ),
    }]
  : task.source_code
    ? [{ label: c('tasks_page.source_label'), value: task.source_code }]
    : []),
```

- [ ] **Step 7: Fix the dialog test's mocks and run both test files**

In `AssignedTaskDetailDialog.test.tsx`, update the `useDealServiceJob` mock to the new name/shape, e.g. `vi.mock('./hooks/useDealServiceJob', () => ({ useDealServiceJobs: () => ({ data: [] }) }))` (match the file's existing mock style; if it stubbed a single job `{id, code}`, wrap it in an array and keep the assertion).

Run: `npx vitest run src/features/assigned_tasks/taskOpenLink.test.ts src/features/assigned_tasks/AssignedTaskDetailDialog.test.tsx`
Expected: PASS.

- [ ] **Step 8: Confirm no other consumers, build, commit**

Run: `grep -rnw "resolveTaskOpenLink" src/ ; grep -rnw "useDealServiceJob" src/` — expected: zero matches for `resolveTaskOpenLink`; for `useDealServiceJob` the ONLY matches are import/`vi.mock` **path** strings (`./hooks/useDealServiceJob` — the file keeps its name). Any other match is a missed rename.
Run: `npm run build` — expected PASS.

```bash
git add src/features/assigned_tasks/taskOpenLink.ts src/features/assigned_tasks/taskOpenLink.test.ts \
        src/features/assigned_tasks/hooks/useDealServiceJob.ts \
        src/features/assigned_tasks/AssignedTaskDetailDialog.tsx src/features/assigned_tasks/AssignedTaskDetailDialog.test.tsx
git commit -m "fix(tasks): dept-task links surface EVERY matching service job, not the oldest

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push
```

---

### Task 5: End-to-end verification + spec status

**Files:**
- Modify: `docs/superpowers/specs/2026-07-20-multi-webdev-jobs-design.md` (status line)

- [ ] **Step 1: Full build + the four test files once more**

Run: `npm run build && npx vitest run src/features/deals/AddWebsiteForm.test.tsx src/features/deals/JobsBillingPanel.test.tsx src/features/assigned_tasks/taskOpenLink.test.ts src/features/assigned_tasks/AssignedTaskDetailDialog.test.tsx`
Expected: build PASS, all tests PASS.

- [ ] **Step 2: Live smoke (browser, prod after Vercel deploy)**

As admin `info@itdev.gr` (pw in test-accounts memory): open a deal that already has a web_dev job → Jobs & billing → **+ Add website** → enter `https://smoke-test-site.gr` → submit. Verify: new row in the jobs table with code `…-WEBDEV-2`, €0; job appears on the Web Dev board first column; its page shows Info tab website `https://smoke-test-site.gr` and a Client-intake link section; deal payments unchanged. Then delete the smoke job via the admin **Delete job** action (`delete_jobs`) and verify it's gone. If post-deploy chunks 404, hard-refresh first (known Vercel stale-chunk behavior).

- [ ] **Step 3: Update spec status + commit**

Change the spec's `Status:` line to `implemented 2026-07-20`.

```bash
git add docs/superpowers/specs/2026-07-20-multi-webdev-jobs-design.md
git commit -m "docs(specs): multi web_dev jobs — mark implemented

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push
```
