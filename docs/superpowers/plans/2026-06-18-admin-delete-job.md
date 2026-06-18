# Admin Delete on Job Detail Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin-only **Delete job** button on `JobDetailPage` that permanently deletes the job (warning first if it's linked to billing lines).

**Architecture:** Mirror the existing admin lead-delete exactly: a `SECURITY DEFINER` Postgres RPC enforces admin server-side and does the delete; a thin `lib/rpc.ts` wrapper + a React-Query mutation hook call it; the detail page renders an admin-gated destructive button that opens the shared `ConfirmDialog`. A second tiny RPC returns the job's billing-line count to drive the dialog warning.

**Tech Stack:** Supabase/Postgres (plpgsql RPC), React 19, TanStack Query, react-i18next, Vitest + Testing Library.

**Already done (do NOT touch):** The **lead** delete button already exists on `LeadDetailPage.tsx` (admin-gated, won/converted hidden, `delete_leads` RPC). This plan only adds the **job** equivalent. Deals are out of scope.

---

## File Structure

- **Create** `supabase/migrations/20260618000030_delete_jobs_rpc.sql` — `delete_jobs(uuid[])` + `job_billing_ref_count(uuid)`.
- **Modify** `src/lib/rpc.ts` — add `deleteJobs()` + `jobBillingRefCount()` wrappers.
- **Create** `src/features/jobs/hooks/useDeleteJobs.ts` (+ `useDeleteJobs.test.tsx`) — delete mutation.
- **Create** `src/features/jobs/hooks/useJobBillingRefCount.ts` — billing-count query.
- **Modify** `src/lib/queryKeys.ts` — add `jobBillingRefCount` key.
- **Modify** `src/i18n/locales/en/jobs.json`, `src/i18n/locales/el/jobs.json` — `delete.*` keys.
- **Modify** `src/features/jobs/JobDetailPage.tsx` — admin delete button + confirm dialog + navigation.

---

## Task 1: Database RPCs (`delete_jobs` + `job_billing_ref_count`)

**Files:**
- Create: `supabase/migrations/20260618000030_delete_jobs_rpc.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260618000030_delete_jobs_rpc.sql`:

```sql
-- Admin-only PERMANENT delete of jobs. Verifies the caller is an admin, then
-- hard-deletes the jobs. assigned_tasks cascade; monthly_invoice_items.job_id and
-- deal_payment_lines.job_id are nulled by existing ON DELETE SET NULL FKs (the
-- billing lines + their amounts are kept, just unlinked). Polymorphic job comments
-- and attachments have no FK to jobs, so they are removed explicitly here. The jobs
-- after-delete trigger already records each delete in activity_log.
-- Used by src/lib/rpc.ts deleteJobs() / src/features/jobs/hooks/useDeleteJobs.ts.

create or replace function public.delete_jobs(p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  if not public.current_user_is_admin() then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array('not_admin'));
  end if;

  -- Polymorphic comments/attachments (parent_type='job') have no FK => delete explicitly.
  delete from public.comments where parent_type = 'job' and parent_id = any(p_ids);
  delete from public.attachments where parent_type = 'job' and parent_id = any(p_ids);

  -- assigned_tasks cascade; monthly_invoice_items + deal_payment_lines set null (existing FKs).
  delete from public.jobs where id = any(p_ids);
  get diagnostics v_count = row_count;

  return jsonb_build_object('ok', true, 'deleted_count', v_count);
end;
$$;

grant execute on function public.delete_jobs(uuid[]) to authenticated;

-- Count of billing lines (invoice + payment) referencing a job, for the delete
-- confirmation warning. Admin-only; returns 0 for non-admins.
create or replace function public.job_billing_ref_count(p_job_id uuid)
returns integer
language sql
security definer
set search_path = public
as $$
  select case when not public.current_user_is_admin() then 0 else (
    (select count(*) from public.monthly_invoice_items where job_id = p_job_id)
    + (select count(*) from public.deal_payment_lines where job_id = p_job_id)
  )::int end;
$$;

grant execute on function public.job_billing_ref_count(uuid) to authenticated;

-- ROLLBACK:
-- drop function if exists public.delete_jobs(uuid[]);
-- drop function if exists public.job_billing_ref_count(uuid);
```

> If `20260618000030_` collides with an existing migration filename, bump to the next free same-day number.

- [ ] **Step 2: Apply the migration to the database**

Apply it via the Supabase MCP `apply_migration` tool (or the Management API). This is a deploy action — confirm it succeeds.

- [ ] **Step 3: Smoke-check the functions exist and the admin gate works**

Run via the Supabase MCP `execute_sql` (or SQL editor), where there is no `auth.uid()` so the caller is treated as non-admin:

```sql
select public.delete_jobs('{}'::uuid[]);
select public.job_billing_ref_count(gen_random_uuid());
```
Expected: first returns `{"ok": false, "errors": ["not_admin"]}` (proves the function compiles and the admin gate fires); second returns `0`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260618000030_delete_jobs_rpc.sql
git commit -m "feat(jobs): admin-only delete_jobs + job_billing_ref_count RPCs"
```

---

## Task 2: `lib/rpc.ts` wrappers

**Files:**
- Modify: `src/lib/rpc.ts`

- [ ] **Step 1: Add the wrappers**

In `src/lib/rpc.ts`, immediately after the `deleteLeads` function (after the line `}` that closes it, currently line 88), insert:

```ts
export type DeleteJobsResult =
  | { ok: true; deletedCount: number }
  | { ok: false; errors: string[] };

// Admin-only permanent delete via the `delete_jobs` RPC. Mirrors deleteLeads and
// goes through the loose `rpcCall`. The RPC enforces the admin check server-side.
export async function deleteJobs(ids: string[]): Promise<DeleteJobsResult> {
  if (ids.length === 0) return { ok: true, deletedCount: 0 };
  const { data, error } = await rpcCall('delete_jobs', { p_ids: ids });
  if (error) return { ok: false, errors: [error.message] };
  const r = data as { ok: boolean; deleted_count?: number; errors?: string[] };
  if (!r.ok) return { ok: false, errors: r.errors ?? ['delete_failed'] };
  return { ok: true, deletedCount: r.deleted_count ?? 0 };
}

// Count of billing lines (invoice + payment) referencing a job, for the
// delete-confirmation warning. Returns 0 on error or for non-admins.
export async function jobBillingRefCount(jobId: string): Promise<number> {
  const { data, error } = await rpcCall('job_billing_ref_count', { p_job_id: jobId });
  if (error) return 0;
  return typeof data === 'number' ? data : 0;
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npm run typecheck`
Expected: PASS (exit 0).

- [ ] **Step 3: Commit**

```bash
git add src/lib/rpc.ts
git commit -m "feat(jobs): deleteJobs + jobBillingRefCount rpc wrappers"
```

---

## Task 3: `useDeleteJobs` hook (TDD)

**Files:**
- Create: `src/features/jobs/hooks/useDeleteJobs.ts`
- Test: `src/features/jobs/hooks/useDeleteJobs.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/features/jobs/hooks/useDeleteJobs.test.tsx`:

```tsx
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { deleteJobs } = vi.hoisted(() => ({ deleteJobs: vi.fn() }));
vi.mock('@/lib/rpc', () => ({ deleteJobs }));

import { useDeleteJobs } from './useDeleteJobs';

function wrap(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe('useDeleteJobs', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls deleteJobs and invalidates job lists on success', async () => {
    deleteJobs.mockResolvedValue({ ok: true, deletedCount: 1 });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useDeleteJobs(), { wrapper: wrap(qc) });

    result.current.mutate(['j1']);

    await waitFor(() => expect(deleteJobs).toHaveBeenCalledWith(['j1']));
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ['jobs'] })),
    );
  });

  it('throws when the RPC reports failure', async () => {
    deleteJobs.mockResolvedValue({ ok: false, errors: ['not_admin'] });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useDeleteJobs(), { wrapper: wrap(qc) });

    result.current.mutate(['j1']);

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toContain('not_admin');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/jobs/hooks/useDeleteJobs.test.tsx`
Expected: FAIL — `Failed to resolve import './useDeleteJobs'`.

- [ ] **Step 3: Write the hook**

Create `src/features/jobs/hooks/useDeleteJobs.ts`:

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { deleteJobs } from '@/lib/rpc';
import { captureMutation } from '@/lib/sentry/captureMutation';

export function useDeleteJobs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: captureMutation('jobs', 'delete', async (ids: string[]) => {
      const r = await deleteJobs(ids);
      if (!r.ok) throw new Error(r.errors.join(', '));
      return r; // { ok: true, deletedCount }
    }),
    onSuccess: () => {
      // ['jobs'] prefix refreshes every board/list query:
      // ['jobs','service',…], ['jobs','deal',…], ['jobs','client',…].
      void qc.invalidateQueries({ queryKey: ['jobs'] });
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/jobs/hooks/useDeleteJobs.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/jobs/hooks/useDeleteJobs.ts src/features/jobs/hooks/useDeleteJobs.test.tsx
git commit -m "feat(jobs): useDeleteJobs mutation hook"
```

---

## Task 4: `useJobBillingRefCount` hook + query key

**Files:**
- Modify: `src/lib/queryKeys.ts`
- Create: `src/features/jobs/hooks/useJobBillingRefCount.ts`

- [ ] **Step 1: Add the query key**

In `src/lib/queryKeys.ts`, after the `job:` line (currently `job: (id: string) => ['job', id] as const,`), add:

```ts
  jobBillingRefCount: (id: string) => ['job-billing-ref-count', id] as const,
```

- [ ] **Step 2: Create the hook**

Create `src/features/jobs/hooks/useJobBillingRefCount.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { jobBillingRefCount } from '@/lib/rpc';
import { queryKeys } from '@/lib/queryKeys';

/**
 * Count of invoice/payment lines referencing this job — drives the delete-confirm
 * warning. `enabled` is wired to "is the confirm dialog open" so we only fetch on demand.
 */
export function useJobBillingRefCount(jobId: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.jobBillingRefCount(jobId),
    queryFn: () => jobBillingRefCount(jobId),
    enabled: enabled && !!jobId,
    staleTime: 30_000,
  });
}
```

- [ ] **Step 3: Verify it typechecks**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/queryKeys.ts src/features/jobs/hooks/useJobBillingRefCount.ts
git commit -m "feat(jobs): useJobBillingRefCount query hook"
```

---

## Task 5: i18n delete keys

**Files:**
- Modify: `src/i18n/locales/en/jobs.json`
- Modify: `src/i18n/locales/el/jobs.json`

- [ ] **Step 1: Add the English keys**

In `src/i18n/locales/en/jobs.json`, change the opening:

```json
{
  "monthly_tasks": {
```
to:
```json
{
  "delete": {
    "button": "Delete",
    "title": "Delete this job?",
    "confirm": "Permanently delete this job and its tasks and comments. This cannot be undone.",
    "billing_warning": "This job is on {{count}} billing line(s) — they will be unlinked (their amounts are kept)."
  },
  "monthly_tasks": {
```

- [ ] **Step 2: Add the Greek keys**

In `src/i18n/locales/el/jobs.json`, change the opening:

```json
{
  "monthly_tasks": {
```
to:
```json
{
  "delete": {
    "button": "Διαγραφή",
    "title": "Διαγραφή αυτής της εργασίας;",
    "confirm": "Μόνιμη διαγραφή της εργασίας και των tasks και σχολίων της. Δεν αναιρείται.",
    "billing_warning": "Η εργασία υπάρχει σε {{count}} γραμμές χρέωσης — θα αποσυνδεθούν (τα ποσά παραμένουν)."
  },
  "monthly_tasks": {
```

- [ ] **Step 3: Verify JSON is valid**

Run: `node -e "require('./src/i18n/locales/en/jobs.json'); require('./src/i18n/locales/el/jobs.json'); console.log('valid')"`
Expected: prints `valid`.

- [ ] **Step 4: Commit**

```bash
git add src/i18n/locales/en/jobs.json src/i18n/locales/el/jobs.json
git commit -m "feat(jobs): i18n for delete button + billing warning"
```

---

## Task 6: Wire the delete button into `JobDetailPage`

**Files:**
- Modify: `src/features/jobs/JobDetailPage.tsx`

- [ ] **Step 1: Update the imports**

At the very top of `src/features/jobs/JobDetailPage.tsx`, the first line is:

```tsx
import { Link, useParams } from 'react-router-dom';
```
Replace it with these two lines:
```tsx
import { useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
```

Then, after the existing line `import { useAuthStore } from '@/lib/stores/authStore';`, add:

```tsx
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useDeleteJobs } from './hooks/useDeleteJobs';
import { useJobBillingRefCount } from './hooks/useJobBillingRefCount';
```

- [ ] **Step 2: Add the namespace `t`, navigation, state, and hooks**

Change this line:
```tsx
  const { i18n } = useTranslation();
```
to:
```tsx
  const { t, i18n } = useTranslation('jobs');
```

Then, immediately after the line `const canBlockJob = isAdmin || groupCodes.includes('accounting');`, add:

```tsx
  const navigate = useNavigate();
  const del = useDeleteJobs();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const billingRefs = useJobBillingRefCount(jobId, confirmDelete);
```

> These hooks sit above the `if (isLoading)` / `if (error || !job)` early returns, so they're always called in the same order (React rules-of-hooks safe).

- [ ] **Step 3: Add the admin-only Delete button**

In the header action area, the owner block ends with:
```tsx
          {owner && (
            <div className="flex items-center gap-2">
              <Label className="text-sm">Owner:</Label>
              <span className="rounded-md border border-input bg-muted px-2 py-1 text-sm text-muted-foreground">
                {owner.full_name || owner.email}
              </span>
            </div>
          )}
        </div>
```
Insert the button between the `{owner && (…)}` block and its closing `</div>`:
```tsx
          {owner && (
            <div className="flex items-center gap-2">
              <Label className="text-sm">Owner:</Label>
              <span className="rounded-md border border-input bg-muted px-2 py-1 text-sm text-muted-foreground">
                {owner.full_name || owner.email}
              </span>
            </div>
          )}
          {isAdmin && (
            <Button variant="destructive" size="sm" onClick={() => setConfirmDelete(true)}>
              🗑 {t('delete.button')}
            </Button>
          )}
        </div>
```

- [ ] **Step 4: Add the ConfirmDialog**

The component's outer JSX ends with `</Tabs>` followed by the final `</div>`:
```tsx
      </Tabs>
    </div>
  );
}
```
Insert the dialog between `</Tabs>` and the final `</div>`:
```tsx
      </Tabs>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('delete.title')}
        description={
          (billingRefs.data ?? 0) > 0
            ? `${t('delete.confirm')} ${t('delete.billing_warning', { count: billingRefs.data })}`
            : t('delete.confirm')
        }
        confirmLabel={t('delete.button')}
        pending={del.isPending}
        onConfirm={async () => {
          try {
            await del.mutateAsync([job.id]);
            setConfirmDelete(false);
            navigate(-1);
          } catch (e) {
            alert((e as Error).message);
          }
        }}
      />
    </div>
  );
}
```

> `job` is non-null here — the `if (error || !job) return …` guard above narrows it for the whole returned JSX.

- [ ] **Step 5: Verify typecheck + lint + full test run**

Run: `npm run typecheck && npm run lint && npm run test:run`
Expected: all PASS (exit 0; the new `useDeleteJobs` test green, nothing else broken).

- [ ] **Step 6: Commit**

```bash
git add src/features/jobs/JobDetailPage.tsx
git commit -m "feat(jobs): admin delete button on job detail page"
```

---

## Task 7: Full verification

- [ ] **Step 1: Build gate**

Run: `npm run build`
Expected: PASS (`tsc -b` + `eslint --max-warnings=0` + `vite build`).

- [ ] **Step 2: Live verification (admin)**

With the dev server running, sign in as the admin test account **`info@itdev.gr` / `123456789`** (the only standing admin test login — `test@test.gr`/`test@itdev.gr` were deleted). Then:
- Open a (throwaway) job's detail page → confirm a red **Delete** button shows in the header.
- Click it → the confirm dialog appears; if the job is on billing lines it shows the "on N billing line(s)" warning.
- Confirm → you're returned to the previous screen and the job's card is gone from the board.
- In SQL (`execute_sql`), verify for that job id: `jobs` row gone, its `assigned_tasks` gone, its `comments`/`attachments` (parent_type='job') gone, and any `deal_payment_lines`/`monthly_invoice_items` rows **still exist with `job_id` now NULL**.

Expected: all of the above hold.

- [ ] **Step 3: Live verification (non-admin)**

Sign in as a sales user (e.g. `ekitsakis@itdev.gr` / `123456789`), open a job detail page → confirm **no** Delete button is shown.

Expected: button absent for non-admins.

---

## Self-Review

- **Spec coverage:** Admin-only job delete button ✓ (Task 6); server-side admin enforcement ✓ (Task 1 `current_user_is_admin()`); any job deletable ✓ (no guard in `delete_jobs`); billing warning ✓ (Tasks 1/4/6); permanent hard delete with polymorphic cleanup + automatic SET NULL on billing lines ✓ (Task 1); post-delete navigation `navigate(-1)` ✓ (Task 6); rollback SQL ✓ (Task 1). Lead delete already shipped — intentionally untouched.
- **Type consistency:** `deleteJobs` returns `{ ok, deletedCount }` (no `skipped`, unlike leads) — used consistently by `useDeleteJobs`. `jobBillingRefCount` returns `number`; `useJobBillingRefCount(jobId, enabled)` and the dialog read `billingRefs.data` as a number. `queryKeys.jobBillingRefCount(id)` defined in Task 4 and used in Task 4's hook. RPC names `delete_jobs` / `job_billing_ref_count` match between SQL (Task 1) and wrappers (Task 2).
- **Placeholder scan:** none — every step has concrete code/commands/expected output.

---

## Changes / Revert

**New files:** `supabase/migrations/20260618000030_delete_jobs_rpc.sql`, `src/features/jobs/hooks/useDeleteJobs.ts` (+ test), `src/features/jobs/hooks/useJobBillingRefCount.ts`.
**Modified:** `src/lib/rpc.ts`, `src/lib/queryKeys.ts`, `src/i18n/locales/{en,el}/jobs.json`, `src/features/jobs/JobDetailPage.tsx`.

**Revert:**
- Each task is an atomic commit — `git revert <sha>` per piece.
- DB: run the migration's ROLLBACK (`drop function delete_jobs`, `drop function job_billing_ref_count`). No tables/columns added.
- Reverting the `JobDetailPage` commit removes the button; the lead delete and everything else are untouched.
