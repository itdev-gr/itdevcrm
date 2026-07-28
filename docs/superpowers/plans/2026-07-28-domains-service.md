# Domains Service Category Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `domains` service type that mirrors `hosting` end-to-end: yearly-only billing, never payment-blocked, releases on partial payment, 2-stage board, hosting-style list at `/tech/domains`, plus a `Domain` Info-tab field.

**Architecture:** Frontend tasks (1–3) add `domains` to every hand-maintained service list, wire the list page/sidebar/router, and land as local commits. Task 4 (MAIN SESSION ONLY) authors + applies the DB migration with live-drift-checked RPC bodies. Task 5 pushes and live-verifies. DB applies BEFORE the frontend push.

**Tech Stack:** React+TS, TanStack Query, react-router, i18next, Supabase (Postgres RPCs, RLS), vitest.

**Spec:** `docs/superpowers/specs/2026-07-28-domains-service-design.md`

## Global Constraints

- `npm run build` (tsc -b + eslint `--max-warnings=0`) must pass after every task.
- vitest hits PROD env — run ONLY the specific test files named in each task, never the whole suite.
- Commit per task on `main`, no push until Task 5. Trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- A parallel session may be committing to this repo: stage files by explicit path only (never `git add -A`); locate edit points by content, not line number.
- Labels: `Domains` in BOTH en and el, everywhere.
- Billing: domains is `recurring_yearly` ONLY (mirror hosting's locks exactly).
- Blocked: domains is NEVER blocked (frontend by omission; DB in Task 4).
- DB: Task 4 runs in the main session only; RPC bodies come from live `pg_get_functiondef` at apply time, never from repo copies.

---

### Task 1: Core type + service pickers + billing locks

**Files:**
- Modify: `src/features/jobs/hooks/useJobs.ts` (ServiceType union, line ~6)
- Modify: `src/lib/rpc.ts` (JobDepartment union, ~line 172)
- Modify: `src/features/deals/ServicesPlannedField.tsx` (SERVICE_TYPES ~44; billingOptionsFor ~56; defaultBillingFor ~66; billing Select disabled ~213)
- Modify: `src/features/deals/AddCustomJobForm.tsx` (DEPARTMENTS ~24; cadences ~61; onValueChange force ~150; cadence Select disabled ~174)
- Modify: `src/features/deals/PaymentsPanel.tsx` (SERVICE_OPTIONS ~29)
- Modify: `src/features/service_packages/ServicePackageDialog.tsx` (SERVICE_TYPES ~19)
- Test: `src/features/deals/ServicesPlannedField.billing.test.ts`

**Interfaces:**
- Produces: `'domains'` as a member of `ServiceType` (useJobs.ts) and `JobDepartment` (rpc.ts) — Tasks 2–3 rely on the union accepting `'domains'`.
- `billingOptionsFor('domains')` → `['recurring_yearly']`; `defaultBillingFor('domains')` → `'recurring_yearly'`.

- [ ] **Step 1: Write the failing test**

In `src/features/deals/ServicesPlannedField.billing.test.ts`, directly under the `restricts hosting to yearly only` test, add:

```ts
  it('restricts domains to yearly only (hosting mirror)', () => {
    expect(billingOptionsFor('domains')).toEqual(['recurring_yearly']);
    expect(defaultBillingFor('domains')).toBe('recurring_yearly');
  });
```

If the file does not already import `defaultBillingFor`, extend its import from `./ServicesPlannedField` to include it.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/deals/ServicesPlannedField.billing.test.ts`
Expected: FAIL — `'domains'` is not assignable to the service_type parameter (type error) / wrong return.

- [ ] **Step 3: Implement**

(a) `src/features/jobs/hooks/useJobs.ts` — extend the union:

```ts
export type ServiceType = 'web_seo' | 'local_seo' | 'web_dev' | 'social_media' | 'ai_seo' | 'hosting' | 'ads' | 'maintenance' | 'franchise' | 'domains';
```

(b) `src/lib/rpc.ts` — add `| 'domains'` as the last member of `JobDepartment` (after `| 'franchise'`).

(c) `src/features/deals/ServicesPlannedField.tsx` — three edits:

Add `'domains',` after `'franchise',` in `SERVICE_TYPES`.

Replace the two hosting conditionals so domains behaves identically (keep the comment, update it):

```ts
export function billingOptionsFor(
  serviceType: PlannedService['service_type'],
): PlannedService['billing_type'][] {
  // Hosting and domains are sold yearly only; franchise is sold one-time only.
  // Every other service supports monthly + one-time.
  if (serviceType === 'hosting' || serviceType === 'domains') return ['recurring_yearly'];
  if (serviceType === 'franchise') return ['one_time'];
  return ['recurring_monthly', 'one_time'];
}

export function defaultBillingFor(
  serviceType: PlannedService['service_type'],
): PlannedService['billing_type'] {
  if (serviceType === 'hosting' || serviceType === 'domains') return 'recurring_yearly';
  if (serviceType === 'franchise') return 'one_time';
  return 'recurring_monthly';
}
```

Billing Select disabled condition (locate by content):

```tsx
disabled={isDisabled || row.service_type === 'hosting' || row.service_type === 'domains' || row.service_type === 'franchise'}
```

(d) `src/features/deals/AddCustomJobForm.tsx` — four edits:

Add `'domains',` after `'franchise',` in `DEPARTMENTS`.

```ts
  // Hosting and domains are billed yearly only; franchise is billed one-time only.
  const cadences: BillingType[] =
    department === 'hosting' || department === 'domains'
      ? ['recurring_yearly']
      : department === 'franchise'
        ? ['one_time']
        : CADENCES;
```

In the department `onValueChange`, change the hosting line to:

```ts
            if (dep === 'hosting' || dep === 'domains') setCadence('recurring_yearly');
```

Cadence Select: `disabled={department === 'hosting' || department === 'domains'}`.

(e) `src/features/deals/PaymentsPanel.tsx` — add `'domains',` after `'franchise',` in `SERVICE_OPTIONS`.

(f) `src/features/service_packages/ServicePackageDialog.tsx` — add `'domains',` after `'franchise',` in `SERVICE_TYPES`.

- [ ] **Step 4: Run test + build**

Run: `npx vitest run src/features/deals/ServicesPlannedField.billing.test.ts` → PASS.
Run: `npm run build` → exit 0. (This surfaces every OTHER exhaustive `Record<ServiceType, …>` that now misses `domains` — if it flags `JobsTab.tsx`'s `SERVICE_TO_KANBAN`, add the Task 2 entry `domains: '/tech/domains',` now and note it in your report; all other Task 2/3 maps are `Record<string, …>` and won't error.)

- [ ] **Step 5: Commit**

```bash
git add src/features/jobs/hooks/useJobs.ts src/lib/rpc.ts src/features/deals/ServicesPlannedField.tsx src/features/deals/ServicesPlannedField.billing.test.ts src/features/deals/AddCustomJobForm.tsx src/features/deals/PaymentsPanel.tsx src/features/service_packages/ServicePackageDialog.tsx src/features/jobs/JobsTab.tsx
git commit -m "feat(domains): service type + pickers with yearly-only billing lock

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

(Drop `JobsTab.tsx` from the `git add` if Step 4 didn't require touching it.)

---

### Task 2: Labels, i18n, Info-tab Domain field, list Domain precedence

**Files:**
- Modify: `src/features/tech/TechMyClientsPage.tsx` (SERVICE_LABELS ~12, URL_TO_SERVICE ~24)
- Modify: `src/features/jobs/JobsTab.tsx` (SERVICE_TO_KANBAN ~13 — skip if done in Task 1)
- Modify: `src/components/ServiceTypeBadge.tsx` (SERVICE_BADGE_CLASS ~4)
- Modify: `src/features/activity/format.ts` (ENUM_LABELS.service_type ~74)
- Modify: `src/features/offers/OfferBuilderPage.tsx` (CATEGORY_LABELS ~27)
- Modify: `src/features/proformas/ProFormaBuilderPage.tsx` (CATEGORY_LABELS ~29)
- Modify: `src/features/jobs/JobsKanbanPage.tsx` (SERVICE_LABELS ~30)
- Modify: `src/i18n/locales/en/deals.json` + `src/i18n/locales/el/deals.json` (services.types, line ~151)
- Modify: `src/features/jobs/serviceInfoFields.ts` (SERVICE_INFO_FIELDS)
- Modify: `src/features/jobs/jobsList.ts` (jobListDomain)
- Test: `src/features/jobs/serviceInfoFields.test.ts`, `src/features/jobs/jobsList.test.ts`

**Interfaces:**
- Consumes: `'domains'` in the `ServiceType` union (Task 1).
- Produces: `infoFieldsFor('domains')` → `[{ key: 'domain', … }]`; `jobListDomain` prefers `details.domain` over all other candidates. URL slug `domains` ⇄ service `domains`.

- [ ] **Step 1: Write the failing tests**

`src/features/jobs/serviceInfoFields.test.ts` — add directly under the `returns [] for a service without an Info tab` test:

```ts
  it('domains has a single Domain text field', () => {
    expect(infoFieldsFor('domains').map((f) => f.key)).toEqual(['domain']);
    expect(infoFieldsFor('domains')[0]?.type).toBe('text');
  });
```

`src/features/jobs/jobsList.test.ts` — inside `describe('jobListDomain', …)` add:

```ts
  it('prefers details.domain over every other candidate', () => {
    expect(jobListDomain(mk({ details: { domain: 'shop.gr', live_url: 'a.gr' } }))).toBe('shop.gr');
    expect(jobListDomain(mk({ details: { domain: '  ' , live_url: 'a.gr' } }))).toBe('a.gr');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/jobs/serviceInfoFields.test.ts src/features/jobs/jobsList.test.ts`
Expected: both new tests FAIL (empty fields; 'a.gr' picked over 'shop.gr').

- [ ] **Step 3: Implement**

(a) `src/features/jobs/serviceInfoFields.ts` — above the `withSection` helper add:

```ts
const DOMAINS: InfoField[] = [
  { key: 'domain', labelEn: 'Domain', labelEl: 'Domain', type: 'text' },
];
```

and add `domains: DOMAINS,` to the `SERVICE_INFO_FIELDS` object (after `social_media: SOCIAL,`).

(b) `src/features/jobs/jobsList.ts` — in `jobListDomain` change the candidates line to:

```ts
  const candidates = [d.domain, d.live_url, d.hosting, job.client?.website];
```

and update the function's doc comment to `/** The job's site: details.domain → details.live_url → details.hosting → client.website → ''. */`

(c) Label maps — add one entry each (after the `franchise` entry unless noted):
- `TechMyClientsPage.tsx` `SERVICE_LABELS`: `domains: { en: 'Domains', el: 'Domains' },`
- `TechMyClientsPage.tsx` `URL_TO_SERVICE`: `domains: 'domains',`
- `JobsTab.tsx` `SERVICE_TO_KANBAN`: `domains:      '/tech/domains',` (skip if added in Task 1)
- `ServiceTypeBadge.tsx` `SERVICE_BADGE_CLASS`: `domains: 'bg-lime-100 text-lime-800 dark:bg-lime-950/50 dark:text-lime-200',`
- `activity/format.ts` `ENUM_LABELS.service_type`: `domains: 'Domains',`
- `OfferBuilderPage.tsx` + `ProFormaBuilderPage.tsx` `CATEGORY_LABELS`: `domains: { en: 'Domains', el: 'Domains' },`
- `JobsKanbanPage.tsx` `SERVICE_LABELS`: `domains: { en: 'Domains', el: 'Domains' },`

(d) i18n — in BOTH `src/i18n/locales/en/deals.json` and `src/i18n/locales/el/deals.json`, inside `services.types`, change the last line `"franchise": "Franchise"` to:

```json
      "franchise": "Franchise",
      "domains": "Domains"
```

(watch the JSON comma).

- [ ] **Step 4: Run tests + build**

Run: `npx vitest run src/features/jobs/serviceInfoFields.test.ts src/features/jobs/jobsList.test.ts` → PASS.
Run: `npm run build` → exit 0 (also validates the JSON edits).

- [ ] **Step 5: Commit**

```bash
git add src/features/tech/TechMyClientsPage.tsx src/features/jobs/JobsTab.tsx src/components/ServiceTypeBadge.tsx src/features/activity/format.ts src/features/offers/OfferBuilderPage.tsx src/features/proformas/ProFormaBuilderPage.tsx src/features/jobs/JobsKanbanPage.tsx src/i18n/locales/en/deals.json src/i18n/locales/el/deals.json src/features/jobs/serviceInfoFields.ts src/features/jobs/serviceInfoFields.test.ts src/features/jobs/jobsList.ts src/features/jobs/jobsList.test.ts
git commit -m "feat(domains): labels, i18n, Info-tab Domain field, list domain precedence

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: DomainsListPage, sidebar, router, task-group + enum tests

**Files:**
- Create: `src/features/domains/DomainsListPage.tsx`
- Modify: `src/components/layout/Sidebar.tsx` (TECH_GROUPS ~72 + 4 record maps + nested block ~262-307)
- Modify: `src/app/router.tsx` (lazy import block; RequireGroup groups array; tech children routes)
- Modify: `src/features/assigned_tasks/canCreateAssignedTask.ts` (ALLOWED_GROUPS)
- Test: `src/features/assigned_tasks/canCreateAssignedTask.test.ts`, `src/features/accounting/closeTargets.test.ts`, `src/features/jobs/kanbanGrouping.test.ts`, `src/features/jobs/seoAccessButton.test.ts`

**Interfaces:**
- Consumes: `JobsListPage` from `@/features/jobs/JobsListPage` with props `{ serviceType, title, description, dueColumnLabel, doneStageCodes, showBlocked }`; `'domains'` in `ServiceType` (Task 1).
- Produces: `DomainsListPage` (named + default export) rendered at `/tech/domains`.

- [ ] **Step 1: Extend the enum tests (they document the domains contract)**

`canCreateAssignedTask.test.ts` — in the `allows any tech group member` loop array, append `'domains'` after `'franchise'`.

`closeTargets.test.ts` — after the `closeTargetCode('hosting')` expectation add:

```ts
    expect(closeTargetCode('domains')).toBe('closed');
```

`kanbanGrouping.test.ts` — in the `is off for the website and hosting…` test add:

```ts
    expect(hasBlockedColumn('domains')).toBe(false);
```

`seoAccessButton.test.ts` — in `returns null for services without an access email` add:

```ts
    expect(seoAccessConfig('domains')).toBeNull();
```

- [ ] **Step 2: Run tests to verify current state**

Run: `npx vitest run src/features/assigned_tasks/canCreateAssignedTask.test.ts src/features/accounting/closeTargets.test.ts src/features/jobs/kanbanGrouping.test.ts src/features/jobs/seoAccessButton.test.ts`
Expected: `canCreateAssignedTask` FAILS (domains not in ALLOWED_GROUPS yet); the other three already PASS (generic fallbacks) — they are regression pins, keep them.

- [ ] **Step 3: Implement**

(a) `src/features/assigned_tasks/canCreateAssignedTask.ts` — add `'domains',` after `'franchise',` in `ALLOWED_GROUPS`.

(b) Create `src/features/domains/DomainsListPage.tsx`:

```tsx
// src/features/domains/DomainsListPage.tsx
// The Domains board (service_type 'domains') as a hosting-style list.
// Mirrors HostingListPage: 2-stage board, never payment-blocked.
import { JobsListPage } from '@/features/jobs/JobsListPage';

export function DomainsListPage() {
  return (
    <JobsListPage
      serviceType="domains"
      title="Domains"
      description="Yearly domain renewals — Active & Done."
      dueColumnLabel="Renewal due"
      doneStageCodes={['closed']}
      showBlocked={false}
    />
  );
}

export default DomainsListPage;
```

(c) `src/components/layout/Sidebar.tsx`:
- Import `AtSign` from `lucide-react` (extend the existing lucide import).
- `TECH_GROUPS`: append `'domains'` after `'franchise'`.
- `TECH_LABELS`: `domains: 'Domains',` — `TECH_ICONS`: `domains: AtSign,` — `TECH_ROUTES`: `domains: '/tech/domains',` — `TECH_CLIENTS_ROUTES`: `domains: '/tech/domains/clients',` (all four are `Record<(typeof TECH_GROUPS)[number], …>` so the compiler enforces them).
- Top-level filter becomes: `.filter((g) => g !== 'hosting' && g !== 'maintenance' && g !== 'domains')`
- Update the nesting comment to `{/* Hosting + Support + Domains are sub-categories of Web Dev — nested here, not top-level boards. */}` and add a third nested block after the maintenance one:

```tsx
                  {g === 'web_dev' && (
                    <NavLink
                      to={TECH_ROUTES.domains}
                      end
                      className={({ isActive }) => sidebarLinkClass(isActive, true)}
                    >
                      {TECH_LABELS.domains}
                    </NavLink>
                  )}
```

(d) `src/app/router.tsx`:
- Below the `SupportListPage` lazyPage declaration add:

```tsx
const DomainsListPage = lazyPage(
  () => import('@/features/domains/DomainsListPage'),
  'DomainsListPage',
);
```

- In the `/tech` `RequireGroup` `groups={[…]}` array, add `'domains',` after `'franchise',`.
- In the tech children, directly under the hosting route line add:

```tsx
              { path: 'domains', element: <DomainsListPage /> },
```

- [ ] **Step 4: Run tests + build**

Run: `npx vitest run src/features/assigned_tasks/canCreateAssignedTask.test.ts src/features/accounting/closeTargets.test.ts src/features/jobs/kanbanGrouping.test.ts src/features/jobs/seoAccessButton.test.ts` → all PASS.
Run: `npm run build` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/features/domains/DomainsListPage.tsx src/components/layout/Sidebar.tsx src/app/router.tsx src/features/assigned_tasks/canCreateAssignedTask.ts src/features/assigned_tasks/canCreateAssignedTask.test.ts src/features/accounting/closeTargets.test.ts src/features/jobs/kanbanGrouping.test.ts src/features/jobs/seoAccessButton.test.ts
git commit -m "feat(domains): /tech/domains list page, sidebar nesting, router, task groups

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: DB migration — author, drift-check, apply to prod (MAIN SESSION ONLY)

**Files:**
- Create: `supabase/migrations/20260728120000_domains_service.sql`

This task runs in the controlling session with Supabase access (MCP OAuth or owner-provided sbp token). Do NOT delegate to a subagent.

- [ ] **Step 1: Fetch live bodies + pre-hashes for the 7 RPCs**

```sql
select p.proname, md5(pg_get_functiondef(p.oid)) as pre_md5, pg_get_functiondef(p.oid) as body
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in (
  'release_billing_jobs_for_deal','release_jobs_for_deal','seed_deal_payments',
  'block_deal_jobs','reconcile_offboard_jobs','accounting_integrity_alerts','release_deal_jobs');
```

Also fetch the `tech_my_clients` view: `select pg_get_viewdef('public.tech_my_clients'::regclass, true);` — if it enumerates service types (the ads migration `20260511000001` recreated it per-service), the migration must re-emit it with `domains` passed through 1:1; if it is generic, note that and skip.

Save each body to the scratchpad. Drift-check: compare against the repo's last emissions (`20260722120000_franchise_service.sql` for the release/reconcile/alerts fns; `20260626000019_block_excludes_done.sql` for `block_deal_jobs`; `20260503000012_hosting_yearly_only.sql`/later for `seed_deal_payments`). Differences beyond the franchise additions = parallel-session drift → STOP and re-base the edits on the live body (the live body is ALWAYS the base).

- [ ] **Step 2: Author `supabase/migrations/20260728120000_domains_service.sql`**

Header comment: purpose, owner decisions (hosting mirror + Domain info field), pre-change md5 of each function, and the ROLLBACK section (below). Then, in order:

```sql
-- 1. CHECK constraints (+ 'domains') --------------------------------------
alter table public.jobs drop constraint if exists jobs_service_type_check;
alter table public.jobs add constraint jobs_service_type_check
  check (service_type = any (array['web_seo','local_seo','web_dev','social_media','ai_seo','hosting','ads','other','maintenance','franchise','domains']));

alter table public.service_packages drop constraint if exists service_packages_service_type_check;
alter table public.service_packages add constraint service_packages_service_type_check
  check (service_type = any (array['web_seo','local_seo','web_dev','social_media','ai_seo','hosting','ads','maintenance','franchise','domains']));

alter table public.service_monthly_task_templates drop constraint if exists service_monthly_task_templates_service_type_check;
alter table public.service_monthly_task_templates add constraint service_monthly_task_templates_service_type_check
  check (service_type = any (array['web_seo','local_seo','web_dev','social_media','ai_seo','hosting','ads','maintenance','franchise','domains']));

-- 2. 'domains' group + board permissions (corrected hosting pattern) ------
insert into public.groups (code, display_names, parent_label, position)
values ('domains', '{"en":"Domains","el":"Domains"}'::jsonb, 'Technical',
        (select coalesce(max(position),0)+10 from public.groups))
on conflict (code) do nothing;

insert into public.group_permissions (group_id, board, action, scope, allowed)
select g.id, 'domains', a.action, 'group', true
  from public.groups g
  cross join (values ('view'),('edit'),('move_stage'),('complete_job'),
                     ('comment'),('attach_file'),('assign_owner')) as a(action)
 where g.code = 'domains'
on conflict (group_id, board, action) do nothing;

-- 3. pipeline_stages: 2-stage board mirroring hosting's live shape --------
insert into public.pipeline_stages (board, code, display_names, position, is_terminal, terminal_outcome)
select 'domains', v.code, v.display_names::jsonb, v.position, v.is_terminal, v.terminal_outcome
from (values
  ('active', '{"en":"Active","el":"Ενεργό"}',        10, false, null::text),
  ('closed', '{"en":"Done","el":"Ολοκληρωμένο"}',    20, true,  'completed')
) as v(code, display_names, position, is_terminal, terminal_outcome)
where not exists (select 1 from public.pipeline_stages where board = 'domains');

-- 4. (no service_monthly_task_templates row — hosting mirror)

-- 5. RPCs: LIVE bodies re-emitted with ONLY these deltas ------------------
```

RPC deltas (apply to the live body fetched in Step 1; each is a full `CREATE OR REPLACE FUNCTION …` emission):
1. `release_billing_jobs_for_deal` — in its service allow-list `('web_seo',…,'franchise')` append `,'domains'`.
2. `release_jobs_for_deal` — allow-list append `,'domains'`; BOTH `not in ('web_dev','hosting')` occurrences (partial-payment continue + `should_block`) become `not in ('web_dev','hosting','domains')`.
3. `seed_deal_payments` — the hosting coercion (`if st = 'hosting' then bt := 'recurring_yearly'; end if;` or its live equivalent) becomes `if st in ('hosting','domains') then bt := 'recurring_yearly'; end if;`.
4. `block_deal_jobs` — `j.service_type not in ('web_dev','hosting')` becomes `not in ('web_dev','hosting','domains')`.
5. `reconcile_offboard_jobs` — its `j.service_type in (…)` list appends `,'domains'`.
6. `accounting_integrity_alerts` — the `off_board_job` check's `j.service_type in (…)` list appends `,'domains'`.
7. `release_deal_jobs` — its service allow-list appends `,'domains'`.
8. `tech_my_clients` view — ONLY if Step 1 found it service-enumerating: `create or replace view` with the `domains` case added 1:1 (mirror how `hosting` flows through).

ROLLBACK section (header comment, maintenance-style):

```sql
-- ROLLBACK:
--   delete from group_permissions where board='domains';
--   delete from groups where code='domains';                       -- only while no members
--   delete from pipeline_stages where board='domains';             -- only while no domains jobs exist
--   restore the three CHECK constraints without 'domains' (bodies above, minus 'domains')
--   re-emit the 7 RPCs from the pre-change pg_get_functiondef snapshots (md5s in this header)
```

- [ ] **Step 3: Apply to prod + verify**

Apply the migration SQL to prod (Supabase MCP `execute_sql` / Mgmt API per session access). Then verify:

```sql
select count(*) from pg_constraint where conname='jobs_service_type_check';                      -- 1
select code, position, is_terminal, terminal_outcome from pipeline_stages where board='domains' order by position;  -- active/10, closed/20 completed
select count(*) from group_permissions gp join groups g on g.id=gp.group_id where g.code='domains';                 -- 7
select proname, md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('release_billing_jobs_for_deal','release_jobs_for_deal','seed_deal_payments','block_deal_jobs','reconcile_offboard_jobs','accounting_integrity_alerts','release_deal_jobs'); -- post-md5s ≠ pre, record in header
```

Record post-md5s in the migration header comment.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260728120000_domains_service.sql
git commit -m "feat(domains): DB — service type, group+perms, 2-stage board, 7 RPCs (APPLIED to prod)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Verify, final review, push, live E2E

**Files:** none.

- [ ] **Step 1: Full check**

```bash
npx vitest run src/features/deals/ServicesPlannedField.billing.test.ts src/features/jobs/serviceInfoFields.test.ts src/features/jobs/jobsList.test.ts src/features/assigned_tasks/canCreateAssignedTask.test.ts src/features/accounting/closeTargets.test.ts src/features/jobs/kanbanGrouping.test.ts src/features/jobs/seoAccessButton.test.ts && npm run build
```

Expected: all PASS, build exit 0.

- [ ] **Step 2: Final whole-branch review** (subagent, most capable model) over the feature-scoped diff; fix Critical/Important before push.

- [ ] **Step 3: Push to main** (re-check `git log origin/main..HEAD` first — parallel session; push only up to this feature's last commit if unrelated in-progress commits sit above it). Vercel auto-deploys.

- [ ] **Step 4: Live E2E (needs owner go-ahead for prod test data)**

Playwright against the deployed app (or local dev server): login admin → sidebar shows Domains under Web Dev → `/tech/domains` renders empty list ("No domains jobs match."). With owner approval: create a throwaway deal with a Domains service in accounting → verify job code `-DOMAINS` lands on `/tech/domains`, yearly payment row exists, Domain Info field editable, list status flip Active→Done→Active works → delete test data (`delete_jobs` RPC + deal cleanup). Also verify `/tech/hosting` still renders (regression).

- [ ] **Step 5: Update ledger + memory** with outcomes.
