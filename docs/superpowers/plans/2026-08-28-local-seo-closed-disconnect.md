# Local SEO "Closed → Disconnect" Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a Local SEO job sits in the **Closed** lane, the kanban card and the job page show a **red "Disconnect" indicator** reminding the Local SEO team to disconnect from the client's Google Business Profile; a **Disconnect** button on the job page flips it to a **green "Disconnected"** state (with the date and who did it).

**Architecture:** Two nullable columns on `jobs` (`disconnected_at`, `disconnected_by`) hold the state — NOT `jobs.details`, because `JobInfoPanel` autosaves the *whole* `details` object and would wipe any extra key. A pure helper `disconnectStatus(job)` decides `needs_disconnect | disconnected | null` from `service_type`, `stage.code` and `disconnected_at`; one badge component renders the red/green pill on the kanban card AND in the job-page header; one banner card at the top of the job page's Overview tab carries the **Disconnect** button (confirm dialog) and the green "Disconnected on …" state with an **Undo**. A small mutation hook writes the two columns and invalidates the job + board queries; the existing `useJobsRealtime` subscription refreshes other viewers' boards.

**Tech Stack:** React 19 + TypeScript, TanStack Query, Supabase (PostgREST update under the existing `jobs_mutate_admin_or_service` RLS policy), react-i18next (`jobs` namespace), lucide-react icons, Vitest + Testing Library.

## Global Constraints

- Repo: `/Users/marios/Desktop/Projects/itdevcrm-main`. Work on `main` (team norm: atomic commits straight to `main`, rebase before push). The tree is clean at plan time; `git add` only the files each task names.
- **`npm run build` is the strict gate** (`tsc -b` → `eslint . --max-warnings=0` → `vite build`). Run it before every commit that touches `src/`. Prettier is configured — run `npx prettier --write <files>` on files you create.
- **Migrations are the source of truth.** No supabase CLI / psql on this machine: production DDL is applied by POSTing the migration file to the Management API (`POST https://api.supabase.com/v1/projects/xujlrclyzxrvxszepquy/database/query`, body `{"query": "<file>"}`, header `Authorization: Bearer $SUPABASE_ACCESS_TOKEN`, **curl only**). The agent prepares the script; **the owner runs it** with `! bash <script>` because the permission classifier blocks token-bearing calls. Every migration carries a `-- ROLLBACK:` section. Never paste a token into a file that gets committed.
- `src/types/supabase.ts` is hand-edited for new columns (`npm run types:gen` needs the CLI). Add the two columns to `jobs.Row`, `jobs.Insert` and `jobs.Update`.
- Scope is **Local SEO only** (`service_type === 'local_seo'`). The Web SEO board also has a `closed` lane but the owner asked for Local SEO; the helper is written so extending it later is a one-line change. AI SEO cards (`service_type === 'ai_seo'`) that appear on the Local SEO board never show the indicator.
- The Local SEO **Closed** stage is `pipeline_stages(board='local_seo', code='closed')` — terminal, outcome `completed` (migration `20260618000010_local_seo_closed_lane.sql`). Match on `stage.code === 'closed'`, never on the display name.
- Who may click **Disconnect / Undo**: admins and members of the `local_seo` group (`useAuthStore` → `isAdmin || groupCodes.includes('local_seo')`). RLS already lets those users update `jobs` rows (`jobs_mutate_admin_or_service` = admin OR `current_user_can(service_type,'edit')`), so no new policy/RPC is needed. Accounting can also update jobs (policy `jobs_update_accounting`) but the button is hidden for them — this is the Local SEO team's action.
- Copy (EN / EL), exact strings — used in i18n and tests:
  - red pill: **Disconnect** / **Αποσύνδεση**
  - green pill: **Disconnected** / **Αποσυνδέθηκε**
  - banner red title: **Client closed — disconnect from the Google Business Profile** / **Ο πελάτης έκλεισε — αποσυνδεθείτε από το Google Business Profile**
  - banner red body: **Remove our agency access from the client's GBP, then press Disconnect.** / **Αφαιρέστε την πρόσβαση του γραφείου μας από το GBP του πελάτη και μετά πατήστε Αποσύνδεση.**
  - button: **Disconnect** / **Αποσύνδεση**
  - confirm title: **Mark as disconnected?** / **Σήμανση ως αποσυνδεδεμένο;**
  - confirm body: **Confirm that our access to the client's Google Business Profile has been removed.** / **Επιβεβαιώστε ότι η πρόσβασή μας στο Google Business Profile του πελάτη έχει αφαιρεθεί.**
  - banner green title: **Disconnected on {{date}}** / **Αποσυνδέθηκε στις {{date}}**
  - banner green by-line: **by {{name}}** / **από {{name}}**
  - undo: **Undo** / **Αναίρεση**
  - error: **Could not update: {{msg}}** / **Αποτυχία ενημέρωσης: {{msg}}**
- Red indicator rule: `service_type === 'local_seo'` AND `stage.code === 'closed'` AND `disconnected_at IS NULL`. Green rule: `service_type === 'local_seo'` AND `disconnected_at IS NOT NULL` — green stays visible even if the job is later dragged out of Closed (the team must know the profile is still disconnected; **Undo** clears it when they reconnect). Otherwise no indicator.

## File Structure

| File | Responsibility |
| --- | --- |
| `supabase/migrations/20260828200000_jobs_disconnected.sql` (create) | Adds `jobs.disconnected_at timestamptz`, `jobs.disconnected_by uuid` |
| `src/types/supabase.ts` (modify) | Hand-add the two columns to `jobs` Row/Insert/Update |
| `src/features/jobs/disconnectStatus.ts` (create) + `.test.ts` | Pure rule: job → `'needs_disconnect' \| 'disconnected' \| null`; permission helper `canToggleDisconnect` |
| `src/features/jobs/hooks/useJobDisconnect.ts` (create) + `.test.tsx` | Mutation writing `disconnected_at/_by`, invalidating `job(id)` + `['jobs']` |
| `src/features/jobs/JobDisconnectBadge.tsx` (create) | Red/green pill (kanban card + job header) |
| `src/features/jobs/JobDisconnectCard.tsx` (create) + `.test.tsx` | Overview banner with Disconnect (confirm) / Disconnected + Undo |
| `src/features/jobs/JobsKanbanCard.tsx` (modify) | Render the badge in the card's top-right action group |
| `src/features/jobs/JobDetailPage.tsx` (modify) | Badge in header; card at the top of the Overview column |
| `src/i18n/locales/{en,el}/jobs.json` (modify) | `disconnect.*` keys |
| `docs/boards/local-seo.md` (modify) | Document the Closed → Disconnect step |

---

### Task 1: Database columns + generated types

**Files:**
- Create: `supabase/migrations/20260828200000_jobs_disconnected.sql`
- Modify: `src/types/supabase.ts` (the `jobs` table block — Row at ~`completed_at`, Insert, Update)
- Create (scratch, NOT committed): `/private/tmp/claude-501/-Users-marios-Desktop-Projects-itdevcrm-main/e9172216-432a-4f2b-aecc-f7124ac58afa/scratchpad/apply-disconnect-migration.sh`

**Interfaces:**
- Consumes: nothing.
- Produces: columns `public.jobs.disconnected_at timestamptz null`, `public.jobs.disconnected_by uuid null`; TypeScript `Database['public']['Tables']['jobs']['Row']` gains `disconnected_at: string | null` and `disconnected_by: string | null` (Insert/Update: optional). Tasks 2–5 read/write these exact names.

- [ ] **Step 1: Write the migration**

```sql
-- Local SEO "Closed → Disconnect" reminder (owner request 2026-08-28).
-- When a Local SEO job reaches the Closed lane the team must remove the agency's
-- access from the client's Google Business Profile. These two columns record
-- that it was done (who/when) so the kanban card + job page can flip the red
-- "Disconnect" indicator to green "Disconnected". Lives on jobs (not jobs.details)
-- because JobInfoPanel autosaves the whole details object and would wipe it.
-- Additive + nullable; safe on production.
alter table public.jobs add column if not exists disconnected_at timestamptz;
alter table public.jobs add column if not exists disconnected_by uuid references auth.users(id) on delete set null;

comment on column public.jobs.disconnected_at is
  'Local SEO: when the team removed our access from the client''s GBP after the job closed. NULL = not yet.';
comment on column public.jobs.disconnected_by is
  'Local SEO: auth.users id of the staff member who pressed Disconnect.';

-- ROLLBACK:
-- alter table public.jobs
--   drop column if exists disconnected_by,
--   drop column if exists disconnected_at;
```

- [ ] **Step 2: Hand-edit the generated types**

In `src/types/supabase.ts`, inside `jobs: { Row: { … } }` add after the `details: Json` line:

```ts
          disconnected_at: string | null
          disconnected_by: string | null
```

Inside `jobs: { Insert: { … } }` add after `details?: Json`:

```ts
          disconnected_at?: string | null
          disconnected_by?: string | null
```

Inside `jobs: { Update: { … } }` add after `details?: Json`:

```ts
          disconnected_at?: string | null
          disconnected_by?: string | null
```

Find the three insertion points with: `grep -n "details?: Json\|details: Json" src/types/supabase.ts` (the three hits inside the `jobs:` block — check the surrounding lines mention `deal_id`, which only `jobs` has next to `details`).

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: exit 0 (no consumer uses the columns yet).

- [ ] **Step 4: Prepare the apply script for the owner**

Write `/private/tmp/claude-501/-Users-marios-Desktop-Projects-itdevcrm-main/e9172216-432a-4f2b-aecc-f7124ac58afa/scratchpad/apply-disconnect-migration.sh`:

```bash
#!/usr/bin/env bash
# Applies supabase/migrations/20260828200000_jobs_disconnected.sql to the CRM prod project.
# Usage (from the repo root, in the Claude session):  ! SUPABASE_ACCESS_TOKEN=sbp_... bash <this file>
set -euo pipefail
: "${SUPABASE_ACCESS_TOKEN:?set SUPABASE_ACCESS_TOKEN=sbp_... first}"
REF=xujlrclyzxrvxszepquy
FILE=supabase/migrations/20260828200000_jobs_disconnected.sql
BODY=$(node -e 'process.stdout.write(JSON.stringify({query: require("fs").readFileSync(process.argv[1], "utf8")}))' "$FILE")
curl -sS -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  --data "$BODY"
echo
# Verify
curl -sS -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"query":"select column_name, data_type from information_schema.columns where table_schema=''public'' and table_name=''jobs'' and column_name in (''disconnected_at'',''disconnected_by'') order by 1"}'
echo
```

Tell the owner: run `! SUPABASE_ACCESS_TOKEN=sbp_… bash /private/tmp/claude-501/-Users-marios-Desktop-Projects-itdevcrm-main/e9172216-432a-4f2b-aecc-f7124ac58afa/scratchpad/apply-disconnect-migration.sh` — expected output ends with two rows (`disconnected_at | timestamp with time zone`, `disconnected_by | uuid`). The frontend tasks can be built and unit-tested before this is applied, but do **not** push to `main` (Vercel auto-deploys) until the columns exist, otherwise the `useJobs` `select('*')` still works but the Disconnect update would 400.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260828200000_jobs_disconnected.sql src/types/supabase.ts
git commit -m "feat(jobs): disconnected_at/_by columns for the Local SEO closed-disconnect reminder"
```

---

### Task 2: Pure status + permission helpers

**Files:**
- Create: `src/features/jobs/disconnectStatus.ts`
- Test: `src/features/jobs/disconnectStatus.test.ts`

**Interfaces:**
- Consumes: `JobRow` from `./hooks/useJobs` (fields `service_type`, `stage?.code`, `disconnected_at`).
- Produces:
  - `export type DisconnectStatus = 'needs_disconnect' | 'disconnected' | null;`
  - `export function disconnectStatus(job: Pick<JobRow, 'service_type' | 'stage' | 'disconnected_at'>): DisconnectStatus`
  - `export function canToggleDisconnect(isAdmin: boolean, groupCodes: string[]): boolean`
  - `export const DISCONNECT_BOARDS: ReadonlySet<string>` (currently `{'local_seo'}`)

- [ ] **Step 1: Write the failing tests**

```ts
// src/features/jobs/disconnectStatus.test.ts
import { describe, it, expect } from 'vitest';
import { canToggleDisconnect, disconnectStatus } from './disconnectStatus';

function job(over: Partial<Parameters<typeof disconnectStatus>[0]> = {}) {
  return {
    service_type: 'local_seo',
    stage: { id: 's-closed', code: 'closed', board: 'local_seo', display_names: {} },
    disconnected_at: null,
    ...over,
  };
}

describe('disconnectStatus', () => {
  it('local_seo job in Closed and not disconnected → needs_disconnect (red)', () => {
    expect(disconnectStatus(job())).toBe('needs_disconnect');
  });

  it('local_seo job with disconnected_at → disconnected (green), even outside Closed', () => {
    expect(disconnectStatus(job({ disconnected_at: '2026-08-28T10:00:00Z' }))).toBe('disconnected');
    expect(
      disconnectStatus(
        job({
          disconnected_at: '2026-08-28T10:00:00Z',
          stage: { id: 's-opt', code: 'optimize', board: 'local_seo', display_names: {} },
        }),
      ),
    ).toBe('disconnected');
  });

  it('local_seo job in another stage and not disconnected → null', () => {
    expect(
      disconnectStatus(
        job({ stage: { id: 's-done', code: 'done', board: 'local_seo', display_names: {} } }),
      ),
    ).toBeNull();
  });

  it('non-local_seo jobs never show the indicator (web_seo closed, ai_seo on the local board)', () => {
    expect(
      disconnectStatus(
        job({
          service_type: 'web_seo',
          stage: { id: 'w-closed', code: 'closed', board: 'web_seo', display_names: {} },
        }),
      ),
    ).toBeNull();
    expect(disconnectStatus(job({ service_type: 'ai_seo' }))).toBeNull();
    expect(
      disconnectStatus(job({ service_type: 'web_seo', disconnected_at: '2026-08-28T10:00:00Z' })),
    ).toBeNull();
  });

  it('missing stage join → null (never crashes)', () => {
    expect(disconnectStatus(job({ stage: null }))).toBeNull();
    expect(disconnectStatus(job({ stage: undefined }))).toBeNull();
  });
});

describe('canToggleDisconnect', () => {
  it('admins and local_seo members may toggle; accounting/others may not', () => {
    expect(canToggleDisconnect(true, [])).toBe(true);
    expect(canToggleDisconnect(false, ['local_seo'])).toBe(true);
    expect(canToggleDisconnect(false, ['accounting'])).toBe(false);
    expect(canToggleDisconnect(false, ['web_seo'])).toBe(false);
    expect(canToggleDisconnect(false, [])).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/features/jobs/disconnectStatus.test.ts`
Expected: FAIL — `Failed to resolve import "./disconnectStatus"`.

- [ ] **Step 3: Write the implementation**

```ts
// src/features/jobs/disconnectStatus.ts
import type { JobRow } from './hooks/useJobs';

/** Boards whose Closed lane asks the team to disconnect from the client's
 *  Google profile. Owner request 2026-08-28 is Local SEO (GBP) only; add
 *  'web_seo' here if GSC ever needs the same reminder. */
export const DISCONNECT_BOARDS: ReadonlySet<string> = new Set(['local_seo']);

/** Stage code of the terminal "Closed" lane (migration 20260618000010). */
const CLOSED_STAGE_CODE = 'closed';

export type DisconnectStatus = 'needs_disconnect' | 'disconnected' | null;

/**
 * Single source of truth for the red/green disconnect indicator.
 * - 'needs_disconnect' (red): board job sitting in Closed, not yet disconnected.
 * - 'disconnected' (green): disconnected_at is stamped — shown in ANY stage so
 *   the team knows the profile is still disconnected if the job is re-opened
 *   (Undo clears it once they reconnect).
 * - null: nothing to show.
 */
export function disconnectStatus(
  job: Pick<JobRow, 'service_type' | 'stage' | 'disconnected_at'>,
): DisconnectStatus {
  if (!DISCONNECT_BOARDS.has(job.service_type)) return null;
  if (job.disconnected_at) return 'disconnected';
  if (job.stage?.code === CLOSED_STAGE_CODE) return 'needs_disconnect';
  return null;
}

/** Disconnecting is the Local SEO team's call (plus admins). Accounting can
 *  edit jobs via RLS but does not own this step, so the button hides for them. */
export function canToggleDisconnect(isAdmin: boolean, groupCodes: string[]): boolean {
  return isAdmin || groupCodes.includes('local_seo');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/features/jobs/disconnectStatus.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/features/jobs/disconnectStatus.ts src/features/jobs/disconnectStatus.test.ts
git add src/features/jobs/disconnectStatus.ts src/features/jobs/disconnectStatus.test.ts
git commit -m "feat(jobs): disconnectStatus rule for the Local SEO closed-disconnect indicator"
```

---

### Task 3: Mutation hook `useSetJobDisconnected`

**Files:**
- Create: `src/features/jobs/hooks/useJobDisconnect.ts`
- Test: `src/features/jobs/hooks/useJobDisconnect.test.tsx`

**Interfaces:**
- Consumes: `supabase` client, `queryKeys.job(id)`, `captureMutation`, `useAuthStore` (`user.id`), columns from Task 1.
- Produces: `export function useSetJobDisconnected(jobId: string)` → TanStack `useMutation<void, DefaultError, { disconnected: boolean }>`. `mutate({ disconnected: true })` writes `{ disconnected_at: <now ISO>, disconnected_by: <current user id> }`; `mutate({ disconnected: false })` writes both `null`. On success invalidates `queryKeys.job(jobId)` and `['jobs']` (the prefix of every board query, same as `useBlockJob`).

- [ ] **Step 1: Write the failing tests**

```tsx
// src/features/jobs/hooks/useJobDisconnect.test.tsx
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { update, from, eq } = vi.hoisted(() => {
  const eq = vi.fn().mockResolvedValue({ error: null });
  const update = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ update });
  return { update, from, eq };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from } }));

import { useSetJobDisconnected } from './useJobDisconnect';
import { useAuthStore } from '@/lib/stores/authStore';
import { queryKeys } from '@/lib/queryKeys';

function wrap(c: ReactNode, qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return <QueryClientProvider client={qc}>{c}</QueryClientProvider>;
}

describe('useSetJobDisconnected', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ user: { id: 'u-1' } as never });
  });

  it('disconnected: true stamps disconnected_at (ISO) and disconnected_by (current user)', async () => {
    const { result } = renderHook(() => useSetJobDisconnected('j1'), {
      wrapper: ({ children }) => wrap(children),
    });
    result.current.mutate({ disconnected: true });
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(from).toHaveBeenCalledWith('jobs');
    const payload = update.mock.calls[0]?.[0] as { disconnected_at: string; disconnected_by: string };
    expect(typeof payload.disconnected_at).toBe('string');
    expect(Number.isNaN(Date.parse(payload.disconnected_at))).toBe(false);
    expect(payload.disconnected_by).toBe('u-1');
    expect(eq).toHaveBeenCalledWith('id', 'j1');
  });

  it('disconnected: false clears both columns (Undo)', async () => {
    const { result } = renderHook(() => useSetJobDisconnected('j1'), {
      wrapper: ({ children }) => wrap(children),
    });
    result.current.mutate({ disconnected: false });
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0]?.[0]).toEqual({ disconnected_at: null, disconnected_by: null });
  });

  it('invalidates the job query and every board query on success', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useSetJobDisconnected('j1'), {
      wrapper: ({ children }) => wrap(children, qc),
    });
    result.current.mutate({ disconnected: true });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.job('j1') });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['jobs'] });
  });

  it('surfaces a PostgREST error as a thrown Error', async () => {
    eq.mockResolvedValueOnce({ error: { message: 'permission denied for table jobs' } });
    const { result } = renderHook(() => useSetJobDisconnected('j1'), {
      wrapper: ({ children }) => wrap(children),
    });
    result.current.mutate({ disconnected: true });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe('permission denied for table jobs');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/features/jobs/hooks/useJobDisconnect.test.tsx`
Expected: FAIL — `Failed to resolve import "./useJobDisconnect"`.

- [ ] **Step 3: Write the implementation**

```ts
// src/features/jobs/hooks/useJobDisconnect.ts
import { useMutation, useQueryClient, type DefaultError } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { captureMutation } from '@/lib/sentry/captureMutation';
import { useAuthStore } from '@/lib/stores/authStore';

type Vars = { disconnected: boolean };

/**
 * Flip the Local SEO "disconnected from the client's GBP" flag on a job.
 * true  → stamps disconnected_at = now, disconnected_by = current user.
 * false → clears both (Undo). Plain row update: RLS jobs_mutate_admin_or_service
 * already allows admins + the owning service team.
 */
export function useSetJobDisconnected(jobId: string) {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  return useMutation<void, DefaultError, Vars>({
    mutationFn: captureMutation('jobs', 'set_disconnected', async ({ disconnected }: Vars) => {
      const patch = disconnected
        ? { disconnected_at: new Date().toISOString(), disconnected_by: userId }
        : { disconnected_at: null, disconnected_by: null };
      const { error } = await supabase.from('jobs').update(patch).eq('id', jobId);
      if (error) throw new Error(error.message);
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.job(jobId) });
      // Prefix of every board query (queryKeys.jobsByService) — same as useBlockJob.
      void qc.invalidateQueries({ queryKey: ['jobs'] });
    },
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/features/jobs/hooks/useJobDisconnect.test.tsx`
Expected: PASS (4 tests). If `tsc` complains that `disconnected_at` is not a known `jobs` Update column, Task 1 Step 2 was not applied — fix that, do not cast with `as never`.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/features/jobs/hooks/useJobDisconnect.ts src/features/jobs/hooks/useJobDisconnect.test.tsx
git add src/features/jobs/hooks/useJobDisconnect.ts src/features/jobs/hooks/useJobDisconnect.test.tsx
git commit -m "feat(jobs): useSetJobDisconnected mutation"
```

---

### Task 4: i18n keys + `JobDisconnectBadge` pill on the kanban card and job header

**Files:**
- Modify: `src/i18n/locales/en/jobs.json` (add a top-level `"disconnect"` block after `"view_billing_record"`)
- Modify: `src/i18n/locales/el/jobs.json` (same position)
- Create: `src/features/jobs/JobDisconnectBadge.tsx`
- Modify: `src/features/jobs/JobsKanbanCard.tsx` (top-right action group, lines ~150-175: the `<div className="flex shrink-0 items-center gap-1">` holding the open-task count / Blocked pill / ✓)
- Modify: `src/features/jobs/JobDetailPage.tsx` (header, right after `<JobFollowupButton job={job} />` at ~line 291)
- Test: covered by Task 5's component test (the badge is pure presentation over `disconnectStatus`, which Task 2 tested); Task 4 verifies via build + a manual board check.

**Interfaces:**
- Consumes: `disconnectStatus(job)` from Task 2; i18n namespace `jobs`.
- Produces: `export function JobDisconnectBadge({ job }: { job: JobRow }): JSX.Element | null` — renders nothing when status is `null`. The red pill has `title` = `jobs:disconnect.pill_needs_title`, the green pill `title` = `jobs:disconnect.pill_done_title`. Exposes `data-disconnect-status="needs_disconnect" | "disconnected"` on the pill for tests/e2e. Task 5 reuses the same i18n keys.

- [ ] **Step 1: Add the i18n keys**

`src/i18n/locales/en/jobs.json` — insert after the `"view_billing_record": "View billing record",` line:

```json
  "disconnect": {
    "pill_needs": "Disconnect",
    "pill_needs_title": "Client closed — disconnect from the Google Business Profile",
    "pill_done": "Disconnected",
    "pill_done_title": "Disconnected from the Google Business Profile on {{date}}",
    "card_title": "Client closed — disconnect from the Google Business Profile",
    "card_body": "Remove our agency access from the client's GBP, then press Disconnect.",
    "button": "Disconnect",
    "confirm_title": "Mark as disconnected?",
    "confirm_body": "Confirm that our access to the client's Google Business Profile has been removed.",
    "done_title": "Disconnected on {{date}}",
    "done_by": "by {{name}}",
    "undo": "Undo",
    "error": "Could not update: {{msg}}"
  },
```

`src/i18n/locales/el/jobs.json` — same position:

```json
  "disconnect": {
    "pill_needs": "Αποσύνδεση",
    "pill_needs_title": "Ο πελάτης έκλεισε — αποσυνδεθείτε από το Google Business Profile",
    "pill_done": "Αποσυνδέθηκε",
    "pill_done_title": "Αποσυνδέθηκε από το Google Business Profile στις {{date}}",
    "card_title": "Ο πελάτης έκλεισε — αποσυνδεθείτε από το Google Business Profile",
    "card_body": "Αφαιρέστε την πρόσβαση του γραφείου μας από το GBP του πελάτη και μετά πατήστε Αποσύνδεση.",
    "button": "Αποσύνδεση",
    "confirm_title": "Σήμανση ως αποσυνδεδεμένο;",
    "confirm_body": "Επιβεβαιώστε ότι η πρόσβασή μας στο Google Business Profile του πελάτη έχει αφαιρεθεί.",
    "done_title": "Αποσυνδέθηκε στις {{date}}",
    "done_by": "από {{name}}",
    "undo": "Αναίρεση",
    "error": "Αποτυχία ενημέρωσης: {{msg}}"
  },
```

Check both files still parse: `node -e "JSON.parse(require('fs').readFileSync('src/i18n/locales/en/jobs.json','utf8')); JSON.parse(require('fs').readFileSync('src/i18n/locales/el/jobs.json','utf8')); console.log('ok')"` → `ok`.

- [ ] **Step 2: Create the badge**

```tsx
// src/features/jobs/JobDisconnectBadge.tsx
import { useTranslation } from 'react-i18next';
import { PlugZap, Unplug } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/datetime';
import { disconnectStatus } from './disconnectStatus';
import type { JobRow } from './hooks/useJobs';

/**
 * Red "Disconnect" / green "Disconnected" pill for Local SEO jobs. Shown on the
 * kanban card (top-right action group) and in the job-page header. Pure
 * presentation — the rule lives in disconnectStatus(); the action lives in
 * JobDisconnectCard on the job page.
 */
export function JobDisconnectBadge({ job, className }: { job: JobRow; className?: string }) {
  const { t } = useTranslation('jobs');
  const status = disconnectStatus(job);
  if (!status) return null;

  const needs = status === 'needs_disconnect';
  return (
    <span
      data-disconnect-status={status}
      title={
        needs
          ? t('disconnect.pill_needs_title')
          : t('disconnect.pill_done_title', { date: formatDate(job.disconnected_at ?? '') })
      }
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[9px] font-semibold',
        needs
          ? 'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-200'
          : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200',
        className,
      )}
    >
      {needs ? <Unplug className="size-3" /> : <PlugZap className="size-3" />}
      {needs ? t('disconnect.pill_needs') : t('disconnect.pill_done')}
    </span>
  );
}
```

- [ ] **Step 3: Render it on the kanban card**

In `src/features/jobs/JobsKanbanCard.tsx`:

1. Add the import next to `JobEmailStatusBadge`:

```tsx
import { JobDisconnectBadge } from './JobDisconnectBadge';
```

2. Inside `<div className="flex shrink-0 items-center gap-1">`, place the badge **before** the `{job.is_blocked && (` block (so the red pill sits left of ✓, matching the screenshot's top-right corner):

```tsx
              <JobDisconnectBadge job={job} />
```

- [ ] **Step 4: Render it in the job-page header**

In `src/features/jobs/JobDetailPage.tsx`:

1. Add the import next to `JobFollowupButton`:

```tsx
import { JobDisconnectBadge } from './JobDisconnectBadge';
```

2. Right after `<JobFollowupButton job={job} />` add:

```tsx
            <JobDisconnectBadge job={job} className="text-[10px]" />
```

- [ ] **Step 5: Build gate**

Run: `npm run build`
Expected: exit 0. (ESLint runs with `--max-warnings=0`; unused imports fail the build.)

- [ ] **Step 6: Manual check on the board**

Run `npm run dev`, open `/tech/local-seo`, find a card in **Closed** (e.g. the screenshot's `005877-LOCALSEO`): a red **Disconnect** pill appears next to the green ✓. Cards in other lanes show nothing. Open the job: the same pill sits in the header after the follow-up button. Switch language to EL: **Αποσύνδεση**.

- [ ] **Step 7: Commit**

```bash
npx prettier --write src/features/jobs/JobDisconnectBadge.tsx
git add src/i18n/locales/en/jobs.json src/i18n/locales/el/jobs.json src/features/jobs/JobDisconnectBadge.tsx src/features/jobs/JobsKanbanCard.tsx src/features/jobs/JobDetailPage.tsx
git commit -m "feat(local-seo): red Disconnect / green Disconnected pill on closed cards and the job header"
```

---

### Task 5: `JobDisconnectCard` banner with the Disconnect button (job page Overview)

**Files:**
- Create: `src/features/jobs/JobDisconnectCard.tsx`
- Test: `src/features/jobs/JobDisconnectCard.test.tsx`
- Modify: `src/features/jobs/JobDetailPage.tsx` (Overview column — insert **above** `<JobNotesCard` at ~line 451; import next to `JobBillingPauseCard`)

**Interfaces:**
- Consumes: `disconnectStatus`, `canToggleDisconnect` (Task 2); `useSetJobDisconnected(jobId)` (Task 3); `useAuthStore` (`isAdmin`, `groupCodes`); `useMentionableUsers()` (`{ user_id, full_name, email }[]`) to name who disconnected; `ConfirmDialog` from `@/components/ui/confirm-dialog`; i18n keys from Task 4.
- Produces: `export function JobDisconnectCard({ job }: { job: JobRow }): JSX.Element | null` — returns `null` when `disconnectStatus(job) === null`. Red state: `<section role="alert">` with title/body and a **Disconnect** button (hidden when `!canToggleDisconnect`) that opens `ConfirmDialog`; confirm → `mutateAsync({ disconnected: true })`. Green state: `<section>` "Disconnected on {date}" + "by {name}" + **Undo** button (hidden when `!canToggleDisconnect`) → `mutateAsync({ disconnected: false })` (no confirm — it is itself the undo). Errors → `alert(t('disconnect.error', { msg }))`, matching the page's existing error style.

- [ ] **Step 1: Write the failing tests**

```tsx
// src/features/jobs/JobDisconnectCard.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { i18n } from '@/lib/i18n';
import { useAuthStore } from '@/lib/stores/authStore';

const mutateAsync = vi.fn().mockResolvedValue(undefined);
vi.mock('./hooks/useJobDisconnect', () => ({
  useSetJobDisconnected: () => ({ mutateAsync, isPending: false }),
}));

vi.mock('@/features/comments/hooks/useMentionableUsers', () => ({
  useMentionableUsers: () => ({
    data: [{ user_id: 'u-1', full_name: 'Dimitris Tzouvaras', email: 'd@example.com' }],
  }),
}));

import { JobDisconnectCard } from './JobDisconnectCard';
import type { JobRow } from './hooks/useJobs';

const closedJob = {
  id: 'j1',
  service_type: 'local_seo',
  stage: { id: 's-closed', code: 'closed', board: 'local_seo', display_names: {} },
  disconnected_at: null,
  disconnected_by: null,
} as unknown as JobRow;

const disconnectedJob = {
  ...closedJob,
  disconnected_at: '2026-08-28T10:00:00Z',
  disconnected_by: 'u-1',
} as unknown as JobRow;

function wrap(node: React.ReactNode) {
  return <I18nextProvider i18n={i18n}>{node}</I18nextProvider>;
}

describe('JobDisconnectCard', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await i18n.changeLanguage('en');
    useAuthStore.setState({ isAdmin: false, groupCodes: ['local_seo'] });
  });

  it('renders nothing for a local_seo job that is not closed', () => {
    const { container } = render(
      wrap(
        <JobDisconnectCard
          job={{ ...closedJob, stage: { ...closedJob.stage!, code: 'optimize' } } as JobRow}
        />,
      ),
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('red state: alert with the reminder and a Disconnect button for local_seo members', () => {
    render(wrap(<JobDisconnectCard job={closedJob} />));
    expect(screen.getByRole('alert')).toHaveTextContent(
      /client closed — disconnect from the google business profile/i,
    );
    expect(screen.getByRole('button', { name: /^disconnect$/i })).toBeInTheDocument();
  });

  it('Disconnect → confirm dialog → mutate({ disconnected: true })', async () => {
    const user = userEvent.setup();
    render(wrap(<JobDisconnectCard job={closedJob} />));
    await user.click(screen.getByRole('button', { name: /^disconnect$/i }));
    expect(await screen.findByText(/mark as disconnected\?/i)).toBeInTheDocument();
    // The trigger and the dialog's confirm button share the label; the dialog's is last in DOM order.
    await user.click(screen.getAllByRole('button', { name: /^disconnect$/i }).at(-1)!);
    expect(mutateAsync).toHaveBeenCalledWith({ disconnected: true });
  });

  it('green state: shows the date, who did it, and an Undo that clears the flag', async () => {
    const user = userEvent.setup();
    render(wrap(<JobDisconnectCard job={disconnectedJob} />));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText(/disconnected on/i)).toBeInTheDocument();
    expect(screen.getByText(/by dimitris tzouvaras/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /undo/i }));
    expect(mutateAsync).toHaveBeenCalledWith({ disconnected: false });
  });

  it('hides the buttons for users outside local_seo (accounting), but still shows the state', () => {
    useAuthStore.setState({ isAdmin: false, groupCodes: ['accounting'] });
    render(wrap(<JobDisconnectCard job={closedJob} />));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^disconnect$/i })).not.toBeInTheDocument();
  });

  it('admins may toggle', () => {
    useAuthStore.setState({ isAdmin: true, groupCodes: [] });
    render(wrap(<JobDisconnectCard job={closedJob} />));
    expect(screen.getByRole('button', { name: /^disconnect$/i })).toBeInTheDocument();
  });

  it('Greek copy', async () => {
    await i18n.changeLanguage('el');
    render(wrap(<JobDisconnectCard job={closedJob} />));
    expect(screen.getByRole('alert')).toHaveTextContent(/ο πελάτης έκλεισε/i);
    expect(screen.getByRole('button', { name: /^αποσύνδεση$/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/features/jobs/JobDisconnectCard.test.tsx`
Expected: FAIL — `Failed to resolve import "./JobDisconnectCard"`.

- [ ] **Step 3: Write the component**

```tsx
// src/features/jobs/JobDisconnectCard.tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PlugZap, Unplug } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { formatDate } from '@/lib/datetime';
import { useAuthStore } from '@/lib/stores/authStore';
import { useMentionableUsers } from '@/features/comments/hooks/useMentionableUsers';
import { canToggleDisconnect, disconnectStatus } from './disconnectStatus';
import { useSetJobDisconnected } from './hooks/useJobDisconnect';
import type { JobRow } from './hooks/useJobs';

/**
 * Job-page banner for the Local SEO "Closed → Disconnect" step. Red while the
 * closed job still has our GBP access; the Disconnect button (confirm) flips it
 * to green "Disconnected on <date> by <name>" with an Undo for mis-clicks or
 * re-opened jobs. Sits at the top of the Overview column so it is the first
 * thing the team sees when opening a closed card from the kanban.
 */
export function JobDisconnectCard({ job }: { job: JobRow }) {
  const { t } = useTranslation('jobs');
  const status = disconnectStatus(job);
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const groupCodes = useAuthStore((s) => s.groupCodes);
  const canToggle = canToggleDisconnect(isAdmin, groupCodes);
  const { data: users = [] } = useMentionableUsers();
  const setDisconnected = useSetJobDisconnected(job.id);
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (!status) return null;

  async function run(disconnected: boolean) {
    try {
      await setDisconnected.mutateAsync({ disconnected });
      setConfirmOpen(false);
    } catch (err) {
      alert(t('disconnect.error', { msg: (err as Error).message }));
    }
  }

  if (status === 'needs_disconnect') {
    return (
      <section
        role="alert"
        className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-900 shadow-sm dark:border-red-800/60 dark:bg-red-950/40 dark:text-red-200"
      >
        <div className="flex items-start gap-3">
          <Unplug className="mt-0.5 size-5 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{t('disconnect.card_title')}</p>
            <p className="mt-1 text-xs text-red-900/80 dark:text-red-200/80">
              {t('disconnect.card_body')}
            </p>
          </div>
          {canToggle && (
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={() => setConfirmOpen(true)}
              disabled={setDisconnected.isPending}
            >
              <Unplug className="size-3.5" />
              {t('disconnect.button')}
            </Button>
          )}
        </div>
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title={t('disconnect.confirm_title')}
          description={t('disconnect.confirm_body')}
          confirmLabel={t('disconnect.button')}
          pending={setDisconnected.isPending}
          onConfirm={() => run(true)}
        />
      </section>
    );
  }

  const by = job.disconnected_by ? users.find((u) => u.user_id === job.disconnected_by) : null;
  return (
    <section className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900 shadow-sm dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-200">
      <div className="flex items-start gap-3">
        <PlugZap className="mt-0.5 size-5 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">
            {t('disconnect.done_title', { date: formatDate(job.disconnected_at ?? '') })}
          </p>
          {by && (
            <p className="mt-1 text-xs text-emerald-900/80 dark:text-emerald-200/80">
              {t('disconnect.done_by', { name: by.full_name || by.email })}
            </p>
          )}
        </div>
        {canToggle && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => run(false)}
            disabled={setDisconnected.isPending}
          >
            {t('disconnect.undo')}
          </Button>
        )}
      </div>
    </section>
  );
}
```

If `MentionableUser` has no `email` field (check `src/features/comments/hooks/useMentionableUsers.ts` lines 1-10), drop `|| by.email` and use `by.full_name` only.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/features/jobs/JobDisconnectCard.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 5: Mount it on the job page**

In `src/features/jobs/JobDetailPage.tsx`:

1. Import next to `JobBillingPauseCard`:

```tsx
import { JobDisconnectCard } from './JobDisconnectCard';
```

2. In the Overview `TabsContent`, inside `<div className="min-w-0 space-y-3 lg:h-full lg:min-h-0 lg:overflow-y-auto lg:pr-1">`, insert as the **first child** (above `<JobNotesCard`):

```tsx
              <JobDisconnectCard job={job} />
```

- [ ] **Step 6: Build gate + full test run**

Run: `npm run build && npx vitest run src/features/jobs`
Expected: build exit 0; all `src/features/jobs` tests pass.

- [ ] **Step 7: Manual end-to-end check (needs Task 1's migration applied)**

`npm run dev` → `/tech/local-seo` → open a **Closed** card (e.g. `005877-LOCALSEO`) → red banner at the top of Overview + red pill in the header → **Disconnect** → confirm → banner turns green "Disconnected on 28/08/2026 · by <you>", header pill turns green; go back to the board → card pill is green **Disconnected** without a reload (query invalidation) and on a second browser/tab via realtime. **Undo** → back to red. Log in as an accounting user: the banner shows, no button.

- [ ] **Step 8: Commit**

```bash
npx prettier --write src/features/jobs/JobDisconnectCard.tsx src/features/jobs/JobDisconnectCard.test.tsx
git add src/features/jobs/JobDisconnectCard.tsx src/features/jobs/JobDisconnectCard.test.tsx src/features/jobs/JobDetailPage.tsx
git commit -m "feat(local-seo): Disconnect button on closed jobs flips the indicator to Disconnected"
```

---

### Task 6: Board documentation

**Files:**
- Modify: `docs/boards/local-seo.md` (Stages table — add a row for Closed; "Payment & closing automations" bullet)

**Interfaces:** none (docs only).

- [ ] **Step 1: Document the Closed lane and the Disconnect step**

The Stages table currently stops at row 10 (Verification) + the virtual Blocked row, and never lists **Closed**. Insert this row between **Verification** and **🔒 Blocked**:

```markdown
| 11  | **Closed**             | Κλειστό                 | **Terminal.** Accounting closed the deal — the engagement is over. The card shows a red **Disconnect** pill: remove our agency access from the client's Google Business Profile, then open the job and press **Disconnect** in the red banner at the top of Overview. The pill and banner turn green **Disconnected** (date + who). **Undo** is there for mis-clicks or if the client comes back and you reconnect. |
```

Renumber the Blocked row to 12. Then extend the **Deal Closed → Closed** bullet under "Payment & closing automations":

```markdown
- **Deal Closed → Closed:** when accounting closes the deal, all of its jobs move
  to **Closed** as the permanent end of the work. A closed Local SEO job carries
  a red **Disconnect** reminder (card + job page) until the team removes our GBP
  access and presses **Disconnect** on the job page; it then reads green
  **Disconnected**.
```

- [ ] **Step 2: Commit**

```bash
git add docs/boards/local-seo.md
git commit -m "docs(boards): Local SEO Closed lane and the Disconnect step"
```

---

## Self-review

- **Spec coverage.** Red indicator on the Local SEO kanban card when a client is in Closed → Task 4 (`JobDisconnectBadge` on `JobsKanbanCard`, rule in Task 2). Text on the indicator ("if it writes") → the pill reads **Disconnect** and its tooltip spells out the full reminder; the job page banner repeats it in full. Disconnect button inside the job opened from the kanban → Task 5 (`JobDisconnectCard`, top of Overview, plus the header pill so it is visible on every tab). Red → green **Disconnected** after pressing → Task 3 + 5, board updates via invalidation/realtime. Persistence → Task 1.
- **Placeholder scan.** None — every step has its code, command and expected result.
- **Type consistency.** `disconnectStatus` / `canToggleDisconnect` / `DISCONNECT_BOARDS` (Task 2) are the names imported in Tasks 4–5; `useSetJobDisconnected(jobId).mutateAsync({ disconnected })` (Task 3) matches the Task 5 mock and calls; columns `disconnected_at` / `disconnected_by` (Task 1) are the ones read by Task 2 and written by Task 3; i18n keys `disconnect.pill_needs|pill_needs_title|pill_done|pill_done_title|card_title|card_body|button|confirm_title|confirm_body|done_title|done_by|undo|error` are defined once in Task 4 and used verbatim in Tasks 4–5.
