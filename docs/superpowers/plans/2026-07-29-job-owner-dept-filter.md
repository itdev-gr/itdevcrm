# Department-Filtered Assigned (Owner) Dropdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Owner dropdown on the job detail page offers only the job's department members (plus admins and the current owner) instead of every active user.

**Architecture:** A pure helper `filterAssignableOwners` in `src/features/jobs/` (flat, colocated test — house convention) filters the `mentionable_users` list client-side by matching the user's `group_codes` against the job's `service_type`. `JobDetailPage.tsx` applies it to the `<option>` list only. No DB/RPC changes.

**Tech Stack:** React + TypeScript, Vitest, TanStack Query (untouched), Supabase RPC `mentionable_users` (untouched).

**Spec:** `docs/superpowers/specs/2026-07-29-job-owner-dept-filter-design.md`

## Global Constraints

- Frontend-only: no migrations, no RPC changes, no data changes.
- `ai_seo` jobs accept members of `ai_seo`, `local_seo`, `web_seo`; every other service type accepts only its own code.
- Empty department after mapping → fall back to the full owner list.
- Admins (`is_admin`) and the current owner are always included; result preserves the input ordering and contains no duplicates.
- Verify with `npm run build` (stricter than `tsc --noEmit` in this repo), not just tests.
- Run ONLY the targeted vitest file — `npx vitest run src/features/jobs/assignableOwners.test.ts` — never the whole suite (some suites in this repo hit production).
- Commit per task; do not push (the main session pushes after review).

---

### Task 1: `filterAssignableOwners` pure helper (TDD)

**Files:**
- Create: `src/features/jobs/assignableOwners.ts`
- Test: `src/features/jobs/assignableOwners.test.ts`

**Interfaces:**
- Consumes: `MentionableUser` type from `@/features/comments/hooks/useMentionableUsers` — `{ user_id: string; full_name: string; email: string; is_admin: boolean; group_codes: string[] }`.
- Produces: `filterAssignableOwners(owners: MentionableUser[], serviceType: string, currentOwnerId: string | null): MentionableUser[]` — Task 2 imports it from `./assignableOwners`.

- [ ] **Step 1: Write the failing test**

Create `src/features/jobs/assignableOwners.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { filterAssignableOwners } from './assignableOwners';
import type { MentionableUser } from '@/features/comments/hooks/useMentionableUsers';

function user(
  user_id: string,
  group_codes: string[],
  is_admin = false,
): MentionableUser {
  return { user_id, full_name: user_id, email: `${user_id}@itdev.gr`, is_admin, group_codes };
}

const admin = user('admin', ['sales'], true);
const webdev = user('webdev', ['web_dev']);
const localSeo = user('local-seo', ['local_seo']);
const webSeo = user('web-seo', ['web_seo']);
const salesRep = user('sales-rep', ['sales']);
const all = [admin, webdev, localSeo, webSeo, salesRep];

describe('filterAssignableOwners', () => {
  it('keeps only department members and admins for web_dev', () => {
    const r = filterAssignableOwners(all, 'web_dev', null);
    expect(r.map((o) => o.user_id)).toEqual(['admin', 'webdev']);
  });

  it('keeps a current owner who is outside the department', () => {
    const r = filterAssignableOwners(all, 'web_dev', 'sales-rep');
    expect(r.map((o) => o.user_id)).toEqual(['admin', 'webdev', 'sales-rep']);
  });

  it('accepts ai_seo, local_seo and web_seo members for ai_seo jobs', () => {
    const r = filterAssignableOwners(all, 'ai_seo', null);
    expect(r.map((o) => o.user_id)).toEqual(['admin', 'local-seo', 'web-seo']);
  });

  it('falls back to the full list when the department has no members', () => {
    const r = filterAssignableOwners(all, 'hosting', null);
    expect(r).toEqual(all);
  });

  it('does not duplicate a current owner who is also a department member', () => {
    const r = filterAssignableOwners(all, 'web_dev', 'webdev');
    expect(r.map((o) => o.user_id)).toEqual(['admin', 'webdev']);
  });

  it('preserves the input ordering', () => {
    const reordered = [salesRep, webSeo, localSeo, webdev, admin];
    const r = filterAssignableOwners(reordered, 'local_seo', null);
    expect(r.map((o) => o.user_id)).toEqual(['local-seo', 'admin']);
  });

  it('tolerates missing group_codes', () => {
    const noGroups = { ...user('no-groups', []), group_codes: undefined as unknown as string[] };
    const r = filterAssignableOwners([noGroups, webdev], 'web_dev', null);
    expect(r.map((o) => o.user_id)).toEqual(['webdev']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/jobs/assignableOwners.test.ts`
Expected: FAIL — cannot resolve `./assignableOwners`.

- [ ] **Step 3: Write the implementation**

Create `src/features/jobs/assignableOwners.ts`:

```ts
import type { MentionableUser } from '@/features/comments/hooks/useMentionableUsers';

// ai_seo work is done by the SEO owners; the ai_seo group itself is empty.
const SERVICE_GROUP_CODES: Record<string, string[]> = {
  ai_seo: ['ai_seo', 'local_seo', 'web_seo'],
};

/**
 * Options for the job Owner dropdown: department members for the job's
 * service_type, always including admins and the current owner. Falls back to
 * the full list when the department group has no members (spec 2026-07-29).
 */
export function filterAssignableOwners(
  owners: MentionableUser[],
  serviceType: string,
  currentOwnerId: string | null,
): MentionableUser[] {
  const accepted = SERVICE_GROUP_CODES[serviceType] ?? [serviceType];
  const dept = owners.filter((o) => (o.group_codes ?? []).some((c) => accepted.includes(c)));
  if (dept.length === 0) return owners;
  const deptIds = new Set(dept.map((o) => o.user_id));
  return owners.filter(
    (o) => deptIds.has(o.user_id) || o.is_admin || o.user_id === currentOwnerId,
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/jobs/assignableOwners.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/jobs/assignableOwners.ts src/features/jobs/assignableOwners.test.ts
git commit -m "feat(jobs): filterAssignableOwners helper for department-scoped owner list"
```

---

### Task 2: Apply the filter in `JobDetailPage`

**Files:**
- Modify: `src/features/jobs/JobDetailPage.tsx` (imports block; owner `<select>` at ~lines 313–325)

**Interfaces:**
- Consumes: `filterAssignableOwners(owners, serviceType, currentOwnerId)` from `./assignableOwners` (Task 1).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the import**

In `src/features/jobs/JobDetailPage.tsx`, next to the other local `./` imports, add:

```ts
import { filterAssignableOwners } from './assignableOwners';
```

- [ ] **Step 2: Compute the filtered list and use it in the dropdown**

Directly after the existing line

```ts
  const owner = job.owner_user_id ? owners.find((o) => o.user_id === job.owner_user_id) : null;
```

add:

```ts
  const assignableOwners = filterAssignableOwners(owners, job.service_type, job.owner_user_id);
```

Then in the Owner `FilterSelect` (the `canEditBilling` branch), change only the map source:

```tsx
                  {assignableOwners.map((o) => (
                    <option key={o.user_id} value={o.user_id}>
                      {o.full_name || o.email}
                    </option>
                  ))}
```

The `<option value="">Unassigned</option>` line, the read-only `owner` span, and the `owner` name resolution stay on the unfiltered list — do not touch them.

- [ ] **Step 3: Verify build and targeted tests**

Run: `npm run build`
Expected: succeeds with no type errors.

Run: `npx vitest run src/features/jobs/assignableOwners.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/features/jobs/JobDetailPage.tsx
git commit -m "feat(jobs): department-filtered Owner dropdown on job detail page"
```

---

## Verification after both tasks

- `npm run build` green.
- Live check (main session, after push/deploy): a Web Dev job's Owner dropdown lists only the web_dev member + admins (+ current owner); a Local SEO job lists only the local_seo member + admins; a hosting job still lists everyone (fallback).

## Revert

`git revert` of the two implementation commits. No data touched.
