# Lead Intake Bug Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close two duplicate-handling foot-guns on `/sales/lead-intake` found in the 2026-06-22 smoke test — (1) per-row **Release** silently creates a duplicate lead with no re-check or confirm, and (2) the **Merge** picker offers dead-end / not-interested targets whose selection silently *discards* the row — and remove the type-safety gap by regenerating Supabase types.

**Architecture:** Two small Postgres functions plus thin React wiring.
- **Bug #1:** Give `release_lead_intake` the same defense-in-depth duplicate re-check that `bulk_release_intake` already has (re-evaluate `find_lead_duplicates` at release time, refresh the stored `matches`, refuse unless an explicit `p_force` flag is passed). The client shows a confirm whenever the row is visibly flagged and passes `force = true`; for a row that *looked* clean but the server re-flags, the mutation surfaces a "re-flagged" alert and the refreshed flags appear.
- **Bug #2:** Add a batched `lead_dead_end_ids(uuid[])` lookup so the page can mark dead-end merge targets and show a distinct confirm *before* sending (the existing `merge_lead_intake` dead-end discard + post-hoc alert stays as the backstop).
- **Bug #3:** Run `npm run types:gen` to replace the `as unknown as` RPC casts with generated types.

**Tech Stack:** React + TypeScript, TanStack Query, react-i18next, Vitest + React Testing Library, Supabase Postgres (SQL migrations applied to prod via the Supabase Management API / MCP).

**Smoke-test context (verified live 2026-06-22, admin `info@itdev.gr`):** 79 pending rows, all with 2+ lead matches; `Bulk release (0)`/`Bulk merge (0)` is *correct*; every per-row `Release` is enabled on flagged rows; the picker offered `Vaso Kastiza (Not Interested)` as a target; zero console errors; all data RPCs returned 200. Auto-merge is currently **ON** in prod.

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `supabase/migrations/20260622180000_release_lead_intake_recheck.sql` | Re-checking, force-gated `release_lead_intake(uuid, boolean)` | Create |
| `supabase/migrations/20260622180100_lead_dead_end_ids.sql` | Batched dead-end lookup `lead_dead_end_ids(uuid[])` | Create |
| `src/i18n/locales/en/leads.json` | New intake strings (4 keys) | Modify |
| `src/i18n/locales/el/leads.json` | New intake strings (4 keys) | Modify |
| `src/lib/rpc.ts` | `releaseLeadIntake(id, force)` signature; new `deadEndLeadIds(ids)` | Modify |
| `src/features/leads/hooks/useReleaseLeadIntake.ts` | `{ id, force }` input + re-flag alert + settle-invalidate | Modify |
| `src/features/leads/hooks/useDeadEndLeads.ts` | Query hook returning a `Set<string>` of dead-end lead ids | Create |
| `src/features/leads/LeadIntakePage.tsx` | Release confirm wiring; dead-end picker marking + confirm | Modify |
| `src/features/leads/LeadIntakePage.test.tsx` | Updated release tests + new dead-end / confirm tests | Modify |
| `src/types/supabase.ts` | Regenerated types (Bug #3) | Modify (generated) |

---

## Task 1: Add the four new i18n strings (en + el)

**Files:**
- Modify: `src/i18n/locales/en/leads.json:52` (inside the `intake` object, after `bulk_release_done`)
- Modify: `src/i18n/locales/el/leads.json:52` (inside the `intake` object, after `bulk_release_done`)

- [ ] **Step 1: Add the English keys**

In `src/i18n/locales/en/leads.json`, change the end of the `intake` block from:

```json
    "bulk_release_confirm": "Release {{count}} clean (non-duplicate) leads onto the sales board?",
    "bulk_release_done": "Released {{released}} leads."
  },
```

to:

```json
    "bulk_release_confirm": "Release {{count}} clean (non-duplicate) leads onto the sales board?",
    "bulk_release_done": "Released {{released}} leads.",
    "release_confirm_dup": "This lead matches {{count}} existing record(s). Releasing it will create a NEW lead on the sales board anyway. Continue?",
    "release_reflagged": "This lead now matches existing records and was not released — review the duplicate flags, then Release again to override.",
    "merge_dead_end_tag": "dead-end",
    "merge_dead_end_confirm": "That lead is marked dead-end / not interested. Merging into it will DISCARD this new submission instead of keeping it. Continue?"
  },
```

- [ ] **Step 2: Add the Greek keys**

In `src/i18n/locales/el/leads.json`, change the end of the `intake` block from:

```json
    "bulk_release_confirm": "Να απελευθερωθούν {{count}} καθαρά leads (χωρίς διπλότυπο) στον πίνακα πωλήσεων;",
    "bulk_release_done": "Απελευθερώθηκαν {{released}} leads."
  },
```

to:

```json
    "bulk_release_confirm": "Να απελευθερωθούν {{count}} καθαρά leads (χωρίς διπλότυπο) στον πίνακα πωλήσεων;",
    "bulk_release_done": "Απελευθερώθηκαν {{released}} leads.",
    "release_confirm_dup": "Αυτό το lead ταιριάζει με {{count}} υπάρχουσες εγγραφές. Η απελευθέρωση θα δημιουργήσει ΝΕΟ lead στον πίνακα πωλήσεων ούτως ή άλλως. Συνέχεια;",
    "release_reflagged": "Αυτό το lead ταιριάζει πλέον με υπάρχουσες εγγραφές και δεν απελευθερώθηκε — ελέγξτε τα διπλότυπα και πατήστε ξανά Απελευθέρωση για παράκαμψη.",
    "merge_dead_end_tag": "αδιέξοδο",
    "merge_dead_end_confirm": "Αυτό το lead είναι σε αδιέξοδο / μη ενδιαφέρον. Η συγχώνευση θα ΑΠΟΡΡΙΨΕΙ τη νέα υποβολή αντί να την κρατήσει. Συνέχεια;"
  },
```

- [ ] **Step 3: Verify the JSON still parses**

Run: `node -e "JSON.parse(require('fs').readFileSync('src/i18n/locales/en/leads.json','utf8')); JSON.parse(require('fs').readFileSync('src/i18n/locales/el/leads.json','utf8')); console.log('ok')"`
Expected: prints `ok` (no syntax error).

- [ ] **Step 4: Commit**

```bash
git add src/i18n/locales/en/leads.json src/i18n/locales/el/leads.json
git commit -m "i18n(leads): add intake release-confirm + dead-end-merge strings"
```

---

## Task 2: Bug #1 server — re-checking, force-gated `release_lead_intake`

**Files:**
- Create: `supabase/migrations/20260622180000_release_lead_intake_recheck.sql`

**Why:** The current `release_lead_intake` (migration `20260622120100`) inserts a new lead with no duplicate re-check, while `bulk_release_intake` (`20260622170000`) re-evaluates duplicates at release time. This task gives the single-row path the same protection, but lets an admin override via `p_force` after confirming.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260622180000_release_lead_intake_recheck.sql`:

```sql
-- Bug #1: single-row Release must re-check duplicates at release time, like
-- bulk_release_intake (20260622170000) already does. Change of signature
-- (added p_force) means we must DROP the old (uuid) overload first.
--
-- Behaviour:
--   * Re-evaluate find_lead_duplicates(email, phone) NOW, excluding the row itself.
--   * Always refresh the stored matches/matched_on so the UI shows current flags.
--   * If duplicates exist and p_force is false -> refuse with 'has_duplicates'
--     (+ duplicate_count). The client confirms, then retries with p_force = true.
--   * Otherwise insert into leads (Unique Lead) and mark the intake row released.
drop function if exists public.release_lead_intake(uuid);

create or replace function public.release_lead_intake(p_id uuid, p_force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.lead_intake;
  v_lead_id uuid;
  v_unique_stage uuid;
  v_live int;
begin
  if not public.current_user_is_admin() then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array('not_authorized'));
  end if;

  select * into r from public.lead_intake where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array('not_found'));
  end if;
  if r.status <> 'pending' then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array('already_' || r.status));
  end if;

  -- Defense-in-depth: re-evaluate duplicates NOW (excluding self), refresh flags.
  select count(*) into v_live
    from public.find_lead_duplicates(r.email, r.phone) x
   where not (x.match_type = 'queued' and x.record_id = r.id);

  if v_live > 0 then
    update public.lead_intake li set
      matches = coalesce((
        select jsonb_agg(to_jsonb(x)) from public.find_lead_duplicates(r.email, r.phone) x
        where not (x.match_type = 'queued' and x.record_id = r.id)), '[]'::jsonb),
      matched_on = coalesce((
        select array_agg(distinct x.matched_field) from public.find_lead_duplicates(r.email, r.phone) x
        where not (x.match_type = 'queued' and x.record_id = r.id)), '{}')
    where li.id = r.id;

    if not p_force then
      return jsonb_build_object(
        'ok', false,
        'errors', jsonb_build_array('has_duplicates'),
        'duplicate_count', v_live
      );
    end if;
  end if;

  select id into v_unique_stage
    from public.pipeline_stages
   where board = 'sales' and code = 'unique_lead'
   limit 1;

  perform set_config('app.intake_release', 'on', true);

  insert into public.leads (
    source, source_data, title, contact_first_name, contact_last_name,
    email, phone, website, company_name, notes, stage_id
  ) values (
    r.source, r.source_data, r.title, r.contact_first_name, r.contact_last_name,
    r.email, r.phone, r.website, r.company_name, r.contact_info, v_unique_stage
  )
  returning id into v_lead_id;

  update public.lead_intake
     set status = 'released', released_lead_id = v_lead_id,
         reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_id;

  return jsonb_build_object('ok', true, 'lead_id', v_lead_id);
end;
$$;

grant execute on function public.release_lead_intake(uuid, boolean) to authenticated, service_role;

-- ROLLBACK:
--   drop function if exists public.release_lead_intake(uuid, boolean);
--   then re-apply the body from 20260622120100_release_intake_notes_to_lead_info.sql
--   (single-arg release_lead_intake(uuid), no re-check).
```

- [ ] **Step 2: Apply the migration to prod**

Apply via the Supabase Management API / MCP (see memory `reference_supabase_mgmt_api.md`; DDL must go through MCP after `/mcp` reconnect — Bash/API is safety-blocked for DDL). Execute the full file contents as one statement batch.

Expected: `DROP FUNCTION` + `CREATE FUNCTION` + `GRANT` all succeed.

- [ ] **Step 3: Verify the function exists with the new signature and refuses unforced**

Run this read-only check via MCP / SQL editor against prod (pick any currently-flagged pending row id from `lead_intake`):

```sql
-- 1) signature present
select proname, pg_get_function_identity_arguments(oid)
from pg_proc where proname = 'release_lead_intake';
-- expect exactly one row: release_lead_intake | p_id uuid, p_force boolean

-- 2) dry behaviour check WITHOUT mutating: confirm a flagged row reports has_duplicates.
-- (Run inside a transaction you ROLL BACK so nothing is released.)
begin;
select public.release_lead_intake(
  (select id from public.lead_intake where status='pending' and jsonb_array_length(matches) > 0 limit 1),
  false
);
rollback;
-- expect: {"ok": false, "errors": ["has_duplicates"], "duplicate_count": <n>}
```

Expected: one signature row `p_id uuid, p_force boolean`; the call returns `ok:false` / `has_duplicates`. `ROLLBACK` leaves data untouched.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260622180000_release_lead_intake_recheck.sql
git commit -m "fix(leads): release_lead_intake re-checks duplicates + force gate"
```

---

## Task 3: Bug #1 client — `releaseLeadIntake(id, force)` + hook

**Files:**
- Modify: `src/lib/rpc.ts:219-225` (`releaseLeadIntake`)
- Modify: `src/features/leads/hooks/useReleaseLeadIntake.ts`

- [ ] **Step 1: Update the rpc wrapper to pass `p_force`**

In `src/lib/rpc.ts`, replace the `releaseLeadIntake` function (lines 219-225):

```ts
export async function releaseLeadIntake(id: string): Promise<LeadIntakeActionResult> {
  const { data, error } = await rpcCall('release_lead_intake', { p_id: id });
  if (error) return { ok: false, errors: [error.message] };
  const r = data as { ok: boolean; lead_id?: string; errors?: string[] };
  if (!r.ok) return { ok: false, errors: r.errors ?? ['release_failed'] };
  return r.lead_id ? { ok: true, lead_id: r.lead_id } : { ok: true };
}
```

with:

```ts
export async function releaseLeadIntake(
  id: string,
  force = false,
): Promise<LeadIntakeActionResult> {
  const { data, error } = await rpcCall('release_lead_intake', { p_id: id, p_force: force });
  if (error) return { ok: false, errors: [error.message] };
  const r = data as { ok: boolean; lead_id?: string; errors?: string[] };
  if (!r.ok) return { ok: false, errors: r.errors ?? ['release_failed'] };
  return r.lead_id ? { ok: true, lead_id: r.lead_id } : { ok: true };
}
```

- [ ] **Step 2: Update the hook to take `{ id, force }`, surface re-flag, and invalidate on settle**

Replace the entire contents of `src/features/leads/hooks/useReleaseLeadIntake.ts` with:

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { releaseLeadIntake } from '@/lib/rpc';
import { captureMutation } from '@/lib/sentry/captureMutation';

export function useReleaseLeadIntake() {
  const qc = useQueryClient();
  const { t } = useTranslation();
  return useMutation({
    mutationFn: captureMutation('lead_intake', 'release', async (input: { id: string; force?: boolean }) => {
      const r = await releaseLeadIntake(input.id, input.force ?? false);
      if (!r.ok) throw new Error(r.errors.join(', '));
      return r;
    }),
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      window.alert(msg.includes('has_duplicates') ? t('leads:intake.release_reflagged') : msg);
    },
    onSettled: () => {
      // Invalidate regardless of outcome: a `has_duplicates` refusal refreshes
      // the stored matches server-side, so re-fetching reveals the new flags.
      void qc.invalidateQueries({ queryKey: ['lead_intake'] });
      void qc.invalidateQueries({ queryKey: ['leads'] });
    },
  });
}
```

- [ ] **Step 3: Typecheck the two files**

Run: `npx tsc --noEmit`
Expected: PASS (no errors). Note: `LeadIntakePage.tsx` still calls `release.mutate(r.id)` at this point — it expects a string, but we changed the input type to an object, so this step is **expected to FAIL with a type error in `LeadIntakePage.tsx`** (`Argument of type 'string' is not assignable to '{ id: string; force?: boolean }'`). That error is fixed in Task 4. If any *other* file errors, fix it here.

- [ ] **Step 4: Commit**

```bash
git add src/lib/rpc.ts src/features/leads/hooks/useReleaseLeadIntake.ts
git commit -m "fix(leads): releaseLeadIntake takes force flag + re-flag alert"
```

---

## Task 4: Bug #1 page wiring + tests

**Files:**
- Modify: `src/features/leads/LeadIntakePage.tsx:252-259` (per-row Release button) and the `rows.map` body
- Modify: `src/features/leads/LeadIntakePage.test.tsx`

- [ ] **Step 1: Write/repoint the failing release tests**

In `src/features/leads/LeadIntakePage.test.tsx`, replace the test `'renders a held lead with its match and fires release'` (lines 55-89) with these two tests:

```ts
  it('confirms before releasing a flagged (duplicate) lead, then forces release', () => {
    useLeadIntake.mockReturnValue({
      data: [
        {
          id: 'i1',
          title: 'AI SEO form',
          contact_first_name: 'Xenia',
          contact_last_name: 'Kara',
          email: 'x@kara.gr',
          phone: '+306900000001',
          created_at: '2026-06-19T10:00:00Z',
          matched_on: ['email'],
          matches: [
            {
              match_type: 'lead',
              record_id: 'L1',
              display_name: 'Old Lead',
              context: 'Won',
              matched_field: 'email',
              matched_email: 'old@kara.gr',
              matched_phone: '6900000099',
            },
          ],
        },
      ],
      isLoading: false,
    });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<LeadIntakePage />);
    expect(screen.getByText('x@kara.gr')).toBeInTheDocument();
    expect(screen.getByText('Old Lead')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'leads:intake.release' }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(release).toHaveBeenCalledWith({ id: 'i1', force: true });
  });

  it('does not release a flagged lead when the confirm is dismissed', () => {
    useLeadIntake.mockReturnValue({
      data: [
        {
          id: 'i1',
          title: 'AI SEO form',
          email: 'x@kara.gr',
          phone: '+306900000001',
          created_at: '2026-06-19T10:00:00Z',
          matched_on: ['email'],
          matches: [
            {
              match_type: 'lead',
              record_id: 'L1',
              display_name: 'Old Lead',
              context: 'Won',
              matched_field: 'email',
              matched_email: 'old@kara.gr',
              matched_phone: null,
            },
          ],
        },
      ],
      isLoading: false,
    });
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<LeadIntakePage />);
    fireEvent.click(screen.getByRole('button', { name: 'leads:intake.release' }));
    expect(release).not.toHaveBeenCalled();
  });
```

Then in the test `'shows a clean (no-duplicate) lead with the clean indicator'` (lines 91-113), change the final assertion from:

```ts
    fireEvent.click(screen.getByRole('button', { name: 'leads:intake.release' }));
    expect(release).toHaveBeenCalledWith('i2');
```

to:

```ts
    fireEvent.click(screen.getByRole('button', { name: 'leads:intake.release' }));
    expect(release).toHaveBeenCalledWith({ id: 'i2', force: false });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/features/leads/LeadIntakePage.test.tsx`
Expected: FAIL — the page still calls `release.mutate(r.id)` (string), so `confirm` is never called and the args don't match `{ id, force }`.

- [ ] **Step 3: Wire the Release confirm into the page**

In `src/features/leads/LeadIntakePage.tsx`, inside the `rows.map((r) => { ... })` body, just after the existing `onMerge` function definition (after line 194), add an `onRelease` helper:

```ts
            function onRelease() {
              if (matches.length > 0) {
                if (!window.confirm(t('leads:intake.release_confirm_dup', { count: matches.length }))) return;
                release.mutate({ id: r.id, force: true });
              } else {
                release.mutate({ id: r.id, force: false });
              }
            }
```

Then change the Release button's handler (line 256) from:

```tsx
                      onClick={() => release.mutate(r.id)}
```

to:

```tsx
                      onClick={onRelease}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/features/leads/LeadIntakePage.test.tsx`
Expected: PASS (all tests, including the two new release tests and the updated clean-release test).

- [ ] **Step 5: Commit**

```bash
git add src/features/leads/LeadIntakePage.tsx src/features/leads/LeadIntakePage.test.tsx
git commit -m "fix(leads): confirm before releasing a flagged duplicate lead"
```

---

## Task 5: Bug #2 server — `lead_dead_end_ids(uuid[])`

**Files:**
- Create: `supabase/migrations/20260622180100_lead_dead_end_ids.sql`

**Why:** The merge picker needs to know, for the lead targets it shows, which are dead-end/not-interested — for all rows including ones queued before any flag was stored. A batched lookup avoids N round-trips and needs no backfill of stored `matches`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260622180100_lead_dead_end_ids.sql`:

```sql
-- Bug #2: batched dead-end lookup for the merge picker. Returns the subset of the
-- given lead ids whose sales-board stage is dead_end / not_interested — the same
-- predicate lead_is_dead_end() uses (20260622100000), but for many ids at once.
create or replace function public.lead_dead_end_ids(p_ids uuid[])
returns table (id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select l.id
  from public.leads l
  join public.pipeline_stages ps on ps.id = l.stage_id
  where l.id = any(p_ids)
    and ps.board = 'sales'
    and ps.code in ('dead_end', 'not_interested');
$$;

grant execute on function public.lead_dead_end_ids(uuid[]) to authenticated, service_role;

-- ROLLBACK:
--   drop function if exists public.lead_dead_end_ids(uuid[]);
```

- [ ] **Step 2: Apply the migration to prod**

Apply via the Supabase Management API / MCP (DDL through MCP, per memory).
Expected: `CREATE FUNCTION` + `GRANT` succeed.

- [ ] **Step 3: Verify it returns only dead-end ids**

Run read-only against prod:

```sql
-- Pick one known dead-end lead and one non-dead-end lead, confirm the filter.
with sample as (
  select l.id, ps.code
  from public.leads l join public.pipeline_stages ps on ps.id = l.stage_id
  where ps.board = 'sales' order by l.created_at desc limit 50
)
select * from public.lead_dead_end_ids(array(select id from sample))
order by id;
```

Expected: returns only ids whose stage code is `dead_end` or `not_interested` (cross-check against the `sample` CTE).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260622180100_lead_dead_end_ids.sql
git commit -m "feat(leads): lead_dead_end_ids batched lookup for merge picker"
```

---

## Task 6: Bug #2 client — `deadEndLeadIds` wrapper + `useDeadEndLeads` hook

**Files:**
- Modify: `src/lib/rpc.ts` (add `deadEndLeadIds` near the lead-intake exports, after `mergeLeadIntake`, around line 255)
- Create: `src/features/leads/hooks/useDeadEndLeads.ts`

- [ ] **Step 1: Add the rpc wrapper**

In `src/lib/rpc.ts`, immediately after the `mergeLeadIntake` function (after line 255), add:

```ts
// Returns the subset of the given lead ids that are dead-end / not-interested,
// so the intake merge picker can warn before merging into one (which discards
// the new submission). Loose `rpcCall` (not in generated types). Read-only.
export async function deadEndLeadIds(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const { data, error } = await rpcCall('lead_dead_end_ids', { p_ids: ids });
  if (error) return [];
  return ((data as { id: string }[]) ?? []).map((row) => row.id);
}
```

- [ ] **Step 2: Write the failing hook test**

Create `src/features/leads/hooks/useDeadEndLeads.test.tsx`:

```tsx
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';

const deadEndLeadIds = vi.fn();
vi.mock('@/lib/rpc', () => ({ deadEndLeadIds }));

import { useDeadEndLeads } from './useDeadEndLeads';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useDeadEndLeads', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns an empty set and does not query when there are no ids', () => {
    const { result } = renderHook(() => useDeadEndLeads([]), { wrapper });
    expect(result.current.size).toBe(0);
    expect(deadEndLeadIds).not.toHaveBeenCalled();
  });

  it('returns a set of the dead-end ids the rpc reports', async () => {
    deadEndLeadIds.mockResolvedValue(['L1']);
    const { result } = renderHook(() => useDeadEndLeads(['L1', 'L2']), { wrapper });
    await waitFor(() => expect(result.current.has('L1')).toBe(true));
    expect(result.current.has('L2')).toBe(false);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/features/leads/hooks/useDeadEndLeads.test.tsx`
Expected: FAIL with "Failed to resolve import './useDeadEndLeads'".

- [ ] **Step 4: Implement the hook**

Create `src/features/leads/hooks/useDeadEndLeads.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { deadEndLeadIds } from '@/lib/rpc';

/**
 * Given the lead-target ids visible in the intake queue, returns the subset that
 * are dead-end / not-interested as a Set, so the merge picker can mark them and
 * warn before merging (a dead-end merge discards the new submission).
 */
export function useDeadEndLeads(ids: string[]): Set<string> {
  const sorted = [...new Set(ids)].sort();
  const { data } = useQuery({
    queryKey: ['lead_dead_end_ids', sorted],
    queryFn: () => deadEndLeadIds(sorted),
    enabled: sorted.length > 0,
    staleTime: 30_000,
  });
  return new Set(data ?? []);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/features/leads/hooks/useDeadEndLeads.test.tsx`
Expected: PASS (both tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/rpc.ts src/features/leads/hooks/useDeadEndLeads.ts src/features/leads/hooks/useDeadEndLeads.test.tsx
git commit -m "feat(leads): useDeadEndLeads hook + deadEndLeadIds rpc"
```

---

## Task 7: Bug #2 page wiring — mark dead-end targets + confirm

**Files:**
- Modify: `src/features/leads/LeadIntakePage.tsx`
- Modify: `src/features/leads/LeadIntakePage.test.tsx`

- [ ] **Step 1: Write the failing dead-end tests**

In `src/features/leads/LeadIntakePage.test.tsx`, add the mock for the new hook alongside the other `vi.mock` calls (after the `useMergeLeadIntake` mock, near line 19):

```ts
const { useDeadEndLeads } = vi.hoisted(() => ({ useDeadEndLeads: vi.fn() }));
vi.mock('./hooks/useDeadEndLeads', () => ({ useDeadEndLeads }));
```

In the `beforeEach` (after line 52), default it to empty:

```ts
    useDeadEndLeads.mockReturnValue(new Set());
```

Then add these two tests inside the `describe` block:

```ts
  it('warns before merging into a dead-end target and merges only on confirm', () => {
    useDeadEndLeads.mockReturnValue(new Set(['L1']));
    useLeadIntake.mockReturnValue({
      data: [
        {
          id: 'i9',
          title: 'Form',
          email: 'd@x.gr',
          phone: '+306900000009',
          created_at: '2026-06-19T13:00:00Z',
          matched_on: ['phone'],
          matches: [
            { match_type: 'lead', record_id: 'L1', display_name: 'Lead One', context: 'Not Interested', matched_field: 'phone', matched_email: null, matched_phone: '6900000009' },
            { match_type: 'lead', record_id: 'L2', display_name: 'Lead Two', context: 'New', matched_field: 'phone', matched_email: null, matched_phone: '6900000009' },
          ],
        },
      ],
      isLoading: false,
    });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<LeadIntakePage />);
    fireEvent.click(screen.getByRole('button', { name: 'leads:intake.merge' })); // opens picker
    fireEvent.click(screen.getByRole('button', { name: /Lead One/ })); // dead-end target
    expect(confirmSpy).toHaveBeenCalled();
    expect(merge).toHaveBeenCalledWith({ id: 'i9', targetLeadId: 'L1' });
  });

  it('does not direct-merge a single dead-end match when confirm is dismissed', () => {
    useDeadEndLeads.mockReturnValue(new Set(['L1']));
    useLeadIntake.mockReturnValue({
      data: [
        {
          id: 'i1',
          title: 'AI SEO form',
          email: 'x@kara.gr',
          phone: '+306900000001',
          created_at: '2026-06-19T10:00:00Z',
          matched_on: ['email'],
          matches: [
            { match_type: 'lead', record_id: 'L1', display_name: 'Old Lead', context: 'Dead End', matched_field: 'email', matched_email: 'old@kara.gr', matched_phone: null },
          ],
        },
      ],
      isLoading: false,
    });
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<LeadIntakePage />);
    fireEvent.click(screen.getByRole('button', { name: 'leads:intake.merge' }));
    expect(merge).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/features/leads/LeadIntakePage.test.tsx`
Expected: FAIL — the page does not import/use `useDeadEndLeads` yet, so no confirm fires and the single dead-end match merges without a guard (`merge` is called even though confirm returned false).

- [ ] **Step 3: Import the hook and compute the dead-end set**

In `src/features/leads/LeadIntakePage.tsx`:

Add the import after line 13 (`import { leadMatchesOf } from './intakeMatches';`):

```ts
import { useDeadEndLeads } from './hooks/useDeadEndLeads';
```

Inside the component, after `const rows = data ?? [];` (line 135), add:

```ts
  const deadEndSet = useDeadEndLeads(
    rows.flatMap((r) =>
      leadMatchesOf((r.matches as unknown as LeadIntakeMatch[]) ?? []).map((m) => m.record_id),
    ),
  );
```

- [ ] **Step 4: Guard the direct (single-match) merge**

In the `rows.map` body, replace the existing `onMerge` function (lines 187-194):

```ts
            function onMerge() {
              const only = leadMatches[0];
              if (leadMatches.length === 1 && only) {
                merge.mutate({ id: r.id, targetLeadId: only.record_id });
              } else {
                setPickFor(r.id);
              }
            }
```

with:

```ts
            function mergeInto(targetLeadId: string) {
              if (deadEndSet.has(targetLeadId) && !window.confirm(t('leads:intake.merge_dead_end_confirm'))) {
                return;
              }
              merge.mutate({ id: r.id, targetLeadId });
            }
            function onMerge() {
              const only = leadMatches[0];
              if (leadMatches.length === 1 && only) {
                mergeInto(only.record_id);
              } else {
                setPickFor(r.id);
              }
            }
```

- [ ] **Step 5: Mark dead-end targets in the picker and route their click through the guard**

In the picker block, replace the target-button map (lines 276-289):

```tsx
                      {leadMatches.map((m) => (
                        <button
                          key={m.record_id}
                          type="button"
                          className="rounded border bg-card px-2 py-1 text-xs"
                          onClick={() => {
                            merge.mutate({ id: r.id, targetLeadId: m.record_id });
                            setPickFor(null);
                          }}
                        >
                          {m.display_name}
                          {m.context ? ` (${m.context})` : ''}
                        </button>
                      ))}
```

with:

```tsx
                      {leadMatches.map((m) => {
                        const isDead = deadEndSet.has(m.record_id);
                        return (
                          <button
                            key={m.record_id}
                            type="button"
                            className={
                              'rounded border bg-card px-2 py-1 text-xs ' +
                              (isDead ? 'border-amber-400 text-amber-700 dark:text-amber-300' : '')
                            }
                            onClick={() => {
                              mergeInto(m.record_id);
                              setPickFor(null);
                            }}
                          >
                            {m.display_name}
                            {m.context ? ` (${m.context})` : ''}
                            {isDead ? ` ⚠ ${t('leads:intake.merge_dead_end_tag')}` : ''}
                          </button>
                        );
                      })}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/features/leads/LeadIntakePage.test.tsx`
Expected: PASS — all tests, including the two new dead-end tests, the existing picker test (`opens the picker and merges...`, target `L2` not in the empty default set → no confirm → merges), and `merges directly when there is exactly one lead match` (target `L1` not dead-end by default → merges).

- [ ] **Step 7: Commit**

```bash
git add src/features/leads/LeadIntakePage.tsx src/features/leads/LeadIntakePage.test.tsx
git commit -m "fix(leads): mark dead-end merge targets + confirm before discarding"
```

---

## Task 8: Bug #3 — regenerate Supabase types

**Files:**
- Modify: `src/types/supabase.ts` (generated)

**Why:** `release_lead_intake`, `merge_lead_intake`, `bulk_merge_intake(_preview)`, `bulk_release_intake(_preview)`, `import_leads_to_intake`, and the new `lead_dead_end_ids` are called through the loose `rpcCall` cast because the generated types predate them. Regenerate so the function signatures are typed.

- [ ] **Step 1: Regenerate types**

Run: `npm run types:gen`
Expected: `src/types/supabase.ts` updates; its `Functions` block now lists `release_lead_intake`, `lead_dead_end_ids`, and the bulk/merge/import intake RPCs.

If `types:gen` cannot authenticate (no project link / token), fall back to manually adding the function rows to the `Functions` section of `src/types/supabase.ts` matching the signatures in this plan, and note in the commit that a full regen is still pending. (Per memory, types are a known temp stub — do not block the bug fixes on this.)

- [ ] **Step 2: Verify nothing regressed**

Run: `npx tsc --noEmit`
Expected: PASS. (The `rpcCall` casts keep working even after regen; this step just confirms the regenerated file is consistent.)

- [ ] **Step 3: Commit**

```bash
git add src/types/supabase.ts
git commit -m "chore(types): regenerate Supabase types incl. lead-intake RPCs"
```

---

## Task 9: Full verification + push

- [ ] **Step 1: Run the full leads test suite**

Run: `npx vitest run src/features/leads`
Expected: PASS (all leads tests green).

- [ ] **Step 2: Typecheck, lint, build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: all PASS (no type errors, no lint errors, production build succeeds).

- [ ] **Step 3: Live re-verify on prod after deploy**

After Vercel deploys (hard-refresh to dodge stale chunks — see memory `reference_vercel_stale_chunk_404`), as admin `info@itdev.gr` on `/sales/lead-intake`:
1. Click **Release** on a flagged row → a confirm appears quoting the duplicate count; dismiss → nothing happens; accept → row releases.
2. Click **Merge** on a row whose targets include a Not-Interested/Dead-End lead → that target shows the `⚠ dead-end` tag; clicking it shows the discard-warning confirm; dismiss → row stays.
3. Console shows zero errors; `lead_dead_end_ids` and `release_lead_intake` calls return 200.

Expected: all three behave as described.

- [ ] **Step 4: Push to main**

```bash
git push origin main
```

---

## Changes / Revert

**New DB objects (prod, via MCP):**
- `release_lead_intake(uuid)` → dropped, replaced by `release_lead_intake(uuid, boolean)` with duplicate re-check + force gate (migration `20260622180000`).
- `lead_dead_end_ids(uuid[])` added (migration `20260622180100`).

**Revert (DB):**
```sql
-- Bug #2
drop function if exists public.lead_dead_end_ids(uuid[]);
-- Bug #1
drop function if exists public.release_lead_intake(uuid, boolean);
-- then re-apply release_lead_intake(uuid) body from
-- supabase/migrations/20260622120100_release_intake_notes_to_lead_info.sql
```

**Revert (code):** `git revert` the commits from Tasks 1, 3, 4, 6, 7, 8 (each is atomic and scoped). No data migration/backfill was performed, so no data revert is needed.

**Out of scope (noted, not fixed):**
- The dominant backlog state — 100% of pending rows have 2+ matches, so neither bulk action nor auto-merge applies; each needs manual handling. Product decision (a future "bulk discard dead-end-only dupes" or per-row quick action could help).
- Per-row "Received" date uses the browser locale (`toLocaleString`) while merge blocks use Europe/Athens — cosmetic inconsistency.
- Sentry envelope POSTs returned `net::ERR_ABORTED` from the test browser (client-side blocking, not an app bug) — only relevant if prod error capture looks sparse.

---

## Self-Review

- **Spec coverage:** Bug #1 (re-check + confirm) → Tasks 2–4. Bug #2 (warn + confirm, mark dead-end) → Tasks 5–7. Bug #3 (types:gen) → Task 8. Verification → Task 9. ✅
- **Placeholder scan:** every code/SQL step shows full content; no TBD/"handle errors"/"similar to". ✅
- **Type consistency:** `releaseLeadIntake(id, force=false)` (rpc) ↔ `release.mutate({ id, force })` (hook input `{ id: string; force?: boolean }`) ↔ page `onRelease`. `deadEndLeadIds(ids): Promise<string[]>` ↔ `useDeadEndLeads(ids): Set<string>` ↔ page `deadEndSet.has(...)`. `merge.mutate({ id, targetLeadId })` unchanged. i18n keys `release_confirm_dup`, `release_reflagged`, `merge_dead_end_tag`, `merge_dead_end_confirm` defined in Task 1 and used in Tasks 3/4/7. ✅
