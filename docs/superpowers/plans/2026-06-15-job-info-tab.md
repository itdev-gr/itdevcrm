# Per-Service Job Info Tab + Deal-Overview Summary — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Local SEO / Web SEO / AI SEO / Web Dev jobs a service-specific **Info** tab (URLs, credentials, notes), replacing the monthly checklist where one exists, and surface each job's Notes + Report URLs read-only on the parent deal's Overview for accounting.

**Architecture:** One `jobs.details` JSONB column holds the values; field definitions live in a code config (`serviceInfoFields.ts`) keyed by service type (AI SEO = Local + Web sections, distinct keys). A `JobInfoPanel` renders/edits the fields (autosave); the deal Overview renders only the `sharedWithDeal` fields via a helper.

**Tech Stack:** Supabase Postgres, Vite + React 19 + TS strict, TanStack Query, Vitest + Testing Library, Tailwind.

**Spec:** `docs/superpowers/specs/2026-06-15-job-info-tab-design.md`

**Note:** Task 1 is **ops** (apply migration with the Supabase token). Tasks 2–5 are **code** (TDD). The new `jobs.details` column won't be in the generated supabase types, so writes cast the payload (`as never`) and `JobRow` is extended locally — no type regen needed.

---

## File Structure

| File | Responsibility | New/Modify |
| --- | --- | --- |
| `supabase/migrations/20260615000005_job_details.sql` | add `jobs.details` + clear monthly templates for local_seo/web_seo/ai_seo | Create |
| `src/features/jobs/serviceInfoFields.ts` | field config + `infoFieldsFor` + `sharedDealFields` | Create |
| `src/features/jobs/serviceInfoFields.test.ts` | config + helper tests | Create |
| `src/features/jobs/hooks/useUpdateJobDetails.ts` | mutation to save `jobs.details` | Create |
| `src/features/jobs/JobInfoPanel.tsx` | the Info tab content (renders + autosaves fields) | Create |
| `src/features/jobs/JobInfoPanel.test.tsx` | component test | Create |
| `src/features/jobs/hooks/useJobs.ts` | add `details` to `JobRow` | Modify |
| `src/features/jobs/JobDetailPage.tsx` | add Info tab; drop MonthlyTasksPanel for replaced services | Modify |
| `src/features/deals/hooks/useDealJobs.ts` | fetch a deal's jobs (id, service_type, details) | Create |
| `src/features/deals/DealServiceInfo.tsx` | read-only shared-fields summary | Create |
| `src/features/deals/DealServiceInfo.test.tsx` | component test | Create |
| `src/features/deals/DealDetailPage.tsx` | render `DealServiceInfo` in Overview | Modify |

---

## Task 1: Migration — `jobs.details` + clear replaced monthly templates (ops)

**Files:** Create `supabase/migrations/20260615000005_job_details.sql`. No unit test; verified by SQL.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260615000005_job_details.sql
-- Per-service job Info tab: a JSONB bag of service-specific fields on each job.
alter table public.jobs add column details jsonb not null default '{}'::jsonb;

-- Replaced by the Info tab: stop the monthly checklist regenerating for these services.
update public.service_monthly_task_templates
   set tasks = '[]'::jsonb, updated_at = now()
 where service_type in ('local_seo', 'web_seo', 'ai_seo');

-- ---------------------------------------------------------------------------
-- ROLLBACK:
--   alter table public.jobs drop column if exists details;
--   -- restore the three templates by re-running their rows from
--   -- supabase/migrations/20260509000001_monthly_task_templates.sql
-- ---------------------------------------------------------------------------
```

- [ ] **Step 2: Apply it** (controller, Management API query endpoint) and record version `20260615000005` (name `job_details`) in `supabase_migrations.schema_migrations`.

- [ ] **Step 3: Verify**

```sql
select (select count(*) from information_schema.columns where table_name='jobs' and column_name='details') as has_col,
       (select jsonb_array_length(tasks) from public.service_monthly_task_templates where service_type='local_seo') as local_tasks;
```
Expected: `has_col = 1`, `local_tasks = 0`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260615000005_job_details.sql
git commit -m "feat(jobs): add jobs.details + clear monthly templates for Info-tab services"
```

---

## Task 2: Field config + helpers

**Files:** Create `src/features/jobs/serviceInfoFields.ts`, `src/features/jobs/serviceInfoFields.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// src/features/jobs/serviceInfoFields.test.ts
import { describe, it, expect } from 'vitest';
import { infoFieldsFor, sharedDealFields, SERVICE_INFO_FIELDS } from './serviceInfoFields';

describe('SERVICE_INFO_FIELDS', () => {
  it('ai_seo combines local + web seo with distinct keys', () => {
    const keys = SERVICE_INFO_FIELDS.ai_seo.map((f) => f.key);
    expect(keys).toEqual([
      'profile_url', 'local_report_url', 'local_notes',
      'website_username', 'website_password', 'web_report_url', 'seo_notes',
    ]);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it('web_dev has its six fields', () => {
    expect(infoFieldsFor('web_dev').map((f) => f.key)).toEqual([
      'webdev_notes', 'hosting', 'supabase_name', 'temp_url', 'live_url', 'email',
    ]);
  });
  it('returns [] for a service without an Info tab', () => {
    expect(infoFieldsFor('social_media')).toEqual([]);
  });
});

describe('sharedDealFields', () => {
  it('returns only populated notes + report urls, never credentials', () => {
    const out = sharedDealFields('web_seo', {
      website_username: 'u', website_password: 'p',
      web_report_url: 'https://r', seo_notes: 'hello',
    });
    expect(out.map((f) => f.key)).toEqual(['web_report_url', 'seo_notes']);
  });
  it('skips empty values', () => {
    expect(sharedDealFields('local_seo', { local_notes: '' })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run src/features/jobs/serviceInfoFields.test.ts`
Expected: FAIL — cannot resolve `./serviceInfoFields`.

- [ ] **Step 3: Implement**

```ts
// src/features/jobs/serviceInfoFields.ts
export type InfoFieldType = 'url' | 'text' | 'textarea' | 'password';
export type InfoField = {
  key: string;
  labelEn: string;
  labelEl: string;
  type: InfoFieldType;
  section?: string;
  sharedWithDeal?: boolean;
};

const LOCAL: InfoField[] = [
  { key: 'profile_url', labelEn: 'Profile URL', labelEl: 'URL Προφίλ', type: 'url' },
  { key: 'local_report_url', labelEn: 'Report URL', labelEl: 'URL Report', type: 'url', sharedWithDeal: true },
  { key: 'local_notes', labelEn: 'Local SEO Notes', labelEl: 'Σημειώσεις Local SEO', type: 'textarea', sharedWithDeal: true },
];

const WEB_SEO: InfoField[] = [
  { key: 'website_username', labelEn: 'Website username', labelEl: 'Username ιστοσελίδας', type: 'text' },
  { key: 'website_password', labelEn: 'Website password', labelEl: 'Password ιστοσελίδας', type: 'password' },
  { key: 'web_report_url', labelEn: 'Web SEO report URL', labelEl: 'URL Report Web SEO', type: 'url', sharedWithDeal: true },
  { key: 'seo_notes', labelEn: 'SEO Notes', labelEl: 'Σημειώσεις SEO', type: 'textarea', sharedWithDeal: true },
];

const WEB_DEV: InfoField[] = [
  { key: 'webdev_notes', labelEn: 'Web Dev Notes', labelEl: 'Σημειώσεις Web Dev', type: 'textarea', sharedWithDeal: true },
  { key: 'hosting', labelEn: 'Hosting', labelEl: 'Hosting', type: 'text' },
  { key: 'supabase_name', labelEn: 'Supabase name', labelEl: 'Όνομα Supabase', type: 'text' },
  { key: 'temp_url', labelEn: 'Temp Website URL', labelEl: 'Προσωρινό URL', type: 'url' },
  { key: 'live_url', labelEn: 'Live Website URL', labelEl: 'Live URL', type: 'url' },
  { key: 'email', labelEn: 'Email', labelEl: 'Email', type: 'text' },
];

const withSection = (fields: InfoField[], section: string): InfoField[] =>
  fields.map((f) => ({ ...f, section }));

export const SERVICE_INFO_FIELDS: Record<string, InfoField[]> = {
  local_seo: LOCAL,
  web_seo: WEB_SEO,
  ai_seo: [...withSection(LOCAL, 'Local SEO'), ...withSection(WEB_SEO, 'Web SEO')],
  web_dev: WEB_DEV,
};

export function infoFieldsFor(serviceType: string): InfoField[] {
  return SERVICE_INFO_FIELDS[serviceType] ?? [];
}

export type SharedField = { key: string; label: string; type: InfoFieldType; value: string };

// The notes + report URLs to show on the deal Overview — never credentials.
export function sharedDealFields(
  serviceType: string,
  details: Record<string, unknown> | null | undefined,
): SharedField[] {
  const d = details ?? {};
  const seen = new Set<string>();
  const out: SharedField[] = [];
  for (const f of infoFieldsFor(serviceType)) {
    if (!f.sharedWithDeal || seen.has(f.key)) continue;
    seen.add(f.key);
    const v = d[f.key];
    if (v == null || v === '') continue;
    out.push({ key: f.key, label: f.labelEn, type: f.type, value: String(v) });
  }
  return out;
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run src/features/jobs/serviceInfoFields.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/jobs/serviceInfoFields.ts src/features/jobs/serviceInfoFields.test.ts
git commit -m "feat(jobs): per-service Info field config + shared-deal helper"
```

---

## Task 3: Save hook + JobInfoPanel

**Files:** Create `src/features/jobs/hooks/useUpdateJobDetails.ts`, `src/features/jobs/JobInfoPanel.tsx`, `src/features/jobs/JobInfoPanel.test.tsx`; Modify `src/features/jobs/hooks/useJobs.ts` (add `details` to `JobRow`).

- [ ] **Step 1: Add `details` to `JobRow`**

In `src/features/jobs/hooks/useJobs.ts`, inside the `JobRow` extension object (after the `stage?:` line, before the closing `};`), add:

```ts
  details?: Record<string, unknown> | null;
```

- [ ] **Step 2: Implement the save hook**

```ts
// src/features/jobs/hooks/useUpdateJobDetails.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export function useUpdateJobDetails(jobId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (details: Record<string, string>) => {
      // `details` isn't in the generated jobs Update type yet — cast the payload.
      const { error } = await supabase.from('jobs').update({ details } as never).eq('id', jobId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.job(jobId) }),
  });
}
```

- [ ] **Step 3: Write the failing component test**

```tsx
// src/features/jobs/JobInfoPanel.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { JobInfoPanel } from './JobInfoPanel';

function renderPanel(serviceType: string, details: Record<string, unknown> = {}) {
  const qc = new QueryClient();
  render(
    <QueryClientProvider client={qc}>
      <JobInfoPanel jobId="j1" serviceType={serviceType} initialDetails={details} />
    </QueryClientProvider>,
  );
}

describe('JobInfoPanel', () => {
  it('renders a web_seo password input masked by default', () => {
    renderPanel('web_seo', { website_password: 'secret' });
    const input = screen.getByDisplayValue('secret') as HTMLInputElement;
    expect(input.type).toBe('password');
  });
  it('shows both sections for ai_seo', () => {
    renderPanel('ai_seo');
    expect(screen.getByText('Local SEO')).toBeInTheDocument();
    expect(screen.getByText('Web SEO')).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run — expect FAIL**

Run: `npx vitest run src/features/jobs/JobInfoPanel.test.tsx`
Expected: FAIL — cannot resolve `./JobInfoPanel`.

- [ ] **Step 5: Implement the panel**

```tsx
// src/features/jobs/JobInfoPanel.tsx
import { useState } from 'react';
import { infoFieldsFor, type InfoField } from './serviceInfoFields';
import { useUpdateJobDetails } from './hooks/useUpdateJobDetails';
import { useAutoSave } from '@/lib/autosave';

function FieldInput({
  field, value, onChange,
}: { field: InfoField; value: string; onChange: (v: string) => void }) {
  const [reveal, setReveal] = useState(false);
  if (field.type === 'textarea') {
    return (
      <textarea className="w-full rounded border px-2 py-1 text-sm" rows={4}
        value={value} onChange={(e) => onChange(e.target.value)} />
    );
  }
  if (field.type === 'password') {
    return (
      <div className="flex items-center gap-2">
        <input type={reveal ? 'text' : 'password'} className="w-full rounded border px-2 py-1 text-sm"
          value={value} onChange={(e) => onChange(e.target.value)} />
        <button type="button" className="text-xs text-slate-500"
          onClick={() => setReveal((r) => !r)} aria-label={reveal ? 'Hide' : 'Reveal'}>
          {reveal ? '🙈' : '👁'}
        </button>
      </div>
    );
  }
  return (
    <input type={field.type === 'url' ? 'url' : 'text'} className="w-full rounded border px-2 py-1 text-sm"
      value={value} onChange={(e) => onChange(e.target.value)} />
  );
}

export function JobInfoPanel({
  jobId, serviceType, initialDetails,
}: { jobId: string; serviceType: string; initialDetails: Record<string, unknown> }) {
  const fields = infoFieldsFor(serviceType);
  const [values, setValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {};
    for (const f of fields) v[f.key] = initialDetails[f.key] != null ? String(initialDetails[f.key]) : '';
    return v;
  });
  const update = useUpdateJobDetails(jobId);
  const status = useAutoSave(values, async (next) => { await update.mutateAsync(next); });

  const sections = Array.from(new Set(fields.map((f) => f.section ?? '')));
  return (
    <div className="max-w-2xl space-y-6">
      {sections.map((section) => (
        <div key={section} className="space-y-3">
          {section && <h3 className="text-sm font-semibold text-slate-700">{section}</h3>}
          {fields.filter((f) => (f.section ?? '') === section).map((f) => (
            <div key={f.key}>
              <label className="mb-1 block text-xs text-slate-500">{f.labelEn}</label>
              <FieldInput field={f} value={values[f.key] ?? ''}
                onChange={(val) => setValues((p) => ({ ...p, [f.key]: val }))} />
            </div>
          ))}
        </div>
      ))}
      <p className="h-4 text-xs text-slate-400">
        {status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : status === 'error' ? 'Save failed' : ''}
      </p>
    </div>
  );
}
```

- [ ] **Step 6: Run — expect PASS**

Run: `npx vitest run src/features/jobs/JobInfoPanel.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add src/features/jobs/hooks/useUpdateJobDetails.ts src/features/jobs/JobInfoPanel.tsx src/features/jobs/JobInfoPanel.test.tsx src/features/jobs/hooks/useJobs.ts
git commit -m "feat(jobs): JobInfoPanel + useUpdateJobDetails"
```

---

## Task 4: Wire the Info tab into the job page

**Files:** Modify `src/features/jobs/JobDetailPage.tsx`.

- [ ] **Step 1: Add imports**

Near the other imports add:

```tsx
import { JobInfoPanel } from './JobInfoPanel';
import { infoFieldsFor } from './serviceInfoFields';
```

- [ ] **Step 2: Add the Info tab trigger**

In the `<TabsList>`, after the `overview` trigger, add:

```tsx
          {infoFieldsFor(job.service_type).length > 0 && (
            <TabsTrigger value="info">Info</TabsTrigger>
          )}
```

- [ ] **Step 3: Drop the monthly checklist for Info-tab services**

Change the MonthlyTasksPanel guard from:

```tsx
              {job.billing_type === 'recurring_monthly' && (
                <MonthlyTasksPanel
                  jobId={job.id}
                  serviceType={job.service_type}
                  isBlocked={!!job.is_blocked}
                />
              )}
```

to (only show it for recurring services that do NOT have an Info tab — i.e. social_media / hosting / ads keep theirs):

```tsx
              {job.billing_type === 'recurring_monthly' && infoFieldsFor(job.service_type).length === 0 && (
                <MonthlyTasksPanel
                  jobId={job.id}
                  serviceType={job.service_type}
                  isBlocked={!!job.is_blocked}
                />
              )}
```

- [ ] **Step 4: Add the Info TabsContent**

After the `overview` `</TabsContent>` (before the `tasks` TabsContent), add:

```tsx
        {infoFieldsFor(job.service_type).length > 0 && (
          <TabsContent value="info" className="pt-4">
            <JobInfoPanel
              jobId={job.id}
              serviceType={job.service_type}
              initialDetails={(job.details ?? {}) as Record<string, unknown>}
            />
          </TabsContent>
        )}
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npx vitest run src/features/jobs`
Expected: typecheck clean; job tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/jobs/JobDetailPage.tsx
git commit -m "feat(jobs): Info tab on job page, replacing the monthly checklist where applicable"
```

---

## Task 5: Deal Overview service-info summary

**Files:** Create `src/features/deals/hooks/useDealJobs.ts`, `src/features/deals/DealServiceInfo.tsx`, `src/features/deals/DealServiceInfo.test.tsx`; Modify `src/features/deals/DealDetailPage.tsx`.

- [ ] **Step 1: Implement the deal-jobs hook**

```ts
// src/features/deals/hooks/useDealJobs.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export type DealJob = { id: string; service_type: string; details: Record<string, unknown> | null };

export function useDealJobs(dealId: string) {
  return useQuery({
    queryKey: ['deal-jobs', dealId] as const,
    enabled: !!dealId,
    queryFn: async (): Promise<DealJob[]> => {
      const { data, error } = await supabase
        .from('jobs')
        .select('id, service_type, details')
        .eq('deal_id', dealId)
        .eq('archived', false);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as DealJob[];
    },
  });
}
```

- [ ] **Step 2: Write the failing component test**

```tsx
// src/features/deals/DealServiceInfo.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DealServiceInfo } from './DealServiceInfo';

vi.mock('./hooks/useDealJobs', () => ({
  useDealJobs: () => ({
    data: [
      {
        id: 'j1', service_type: 'web_seo',
        details: { website_password: 'secret', web_report_url: 'https://report', seo_notes: 'looks good' },
      },
    ],
  }),
}));

describe('DealServiceInfo', () => {
  it('shows shared notes + report, never credentials', () => {
    render(<DealServiceInfo dealId="d1" />);
    expect(screen.getByText('looks good')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'https://report' })).toBeInTheDocument();
    expect(screen.queryByText('secret')).toBeNull();
  });
});
```

- [ ] **Step 3: Run — expect FAIL**

Run: `npx vitest run src/features/deals/DealServiceInfo.test.tsx`
Expected: FAIL — cannot resolve `./DealServiceInfo`.

- [ ] **Step 4: Implement**

```tsx
// src/features/deals/DealServiceInfo.tsx
import { useDealJobs } from './hooks/useDealJobs';
import { sharedDealFields } from '@/features/jobs/serviceInfoFields';

export function DealServiceInfo({ dealId }: { dealId: string }) {
  const { data: jobs = [] } = useDealJobs(dealId);
  const rows = jobs
    .map((j) => ({ serviceType: j.service_type, fields: sharedDealFields(j.service_type, j.details) }))
    .filter((r) => r.fields.length > 0);
  if (rows.length === 0) return null;
  return (
    <div className="mt-6 rounded-md border bg-slate-50 p-4">
      <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-slate-500">Service info</h2>
      <div className="space-y-4">
        {rows.map((r) => (
          <div key={r.serviceType}>
            <div className="text-xs font-semibold text-slate-600">{r.serviceType}</div>
            <dl className="mt-1 space-y-1 text-sm">
              {r.fields.map((f) => (
                <div key={f.key} className="flex gap-2">
                  <dt className="text-slate-500">{f.label}:</dt>
                  <dd className="min-w-0 break-words">
                    {f.type === 'url' ? (
                      <a href={f.value} target="_blank" rel="noreferrer" className="text-blue-700 underline">{f.value}</a>
                    ) : (
                      f.value
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run — expect PASS**

Run: `npx vitest run src/features/deals/DealServiceInfo.test.tsx`
Expected: PASS.

- [ ] **Step 6: Wire into the deal Overview**

In `src/features/deals/DealDetailPage.tsx`, add the import near the others:

```tsx
import { DealServiceInfo } from './DealServiceInfo';
```

In the Overview `TabsContent`, inside the left column, render it right after `<DealForm initial={deal} />`:

```tsx
              <DealForm initial={deal} />
              <DealServiceInfo dealId={dealId} />
```

- [ ] **Step 7: Verify**

Run: `npm run typecheck && npx vitest run src/features/deals`
Expected: typecheck clean; deals tests PASS.

- [ ] **Step 8: Commit**

```bash
git add src/features/deals/hooks/useDealJobs.ts src/features/deals/DealServiceInfo.tsx src/features/deals/DealServiceInfo.test.tsx src/features/deals/DealDetailPage.tsx
git commit -m "feat(deals): read-only service-info (notes + reports) on deal Overview"
```

---

## Task 6: Gate, push, verify

- [ ] **Step 1: Full suite**

Run: `npm run typecheck && npx vitest run && npm run lint`
Expected: all green, 0 lint warnings.

- [ ] **Step 2: Push**

```bash
git push origin main
```

- [ ] **Step 3: Production verify** — as admin (`test@test.gr`): open a Local SEO job → **Info** tab shows Profile/Report/Notes, no monthly checklist; an AI SEO job → both Local + Web SEO sections; a Web SEO job → password field masked with reveal toggle. Open that job's **deal** → Overview shows a "Service info" block with the notes + report (no password). Edit a field → reload → value persists.

---

## Changes / Revert
- **New:** migration `20260615000005`; `serviceInfoFields.ts`, `useUpdateJobDetails.ts`, `JobInfoPanel.tsx`, `useDealJobs.ts`, `DealServiceInfo.tsx` (+ tests).
- **Modified:** `useJobs.ts` (JobRow), `JobDetailPage.tsx`, `DealDetailPage.tsx`.
- **Revert:** migration ROLLBACK (drop `jobs.details`; restore the 3 templates from `20260509000001`); remove the new files + the JobDetailPage/DealDetailPage edits + the JobRow field.
