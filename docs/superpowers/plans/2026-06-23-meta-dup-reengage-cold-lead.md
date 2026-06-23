# Re-engage Cold Lead from Meta Intake Duplicate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When **Release** is pressed on a Meta intake row whose duplicate is an existing lead in a cold stage (`dead_end`, `not_interested`, `no_answer`, `constant_na`), re-engage that lead — move it to **Unique Lead**, append the new submission to its `intake_log`, resolve the intake row — instead of creating a duplicate.

**Architecture:** A new `reengage_lead_intake` RPC does the move + append + resolve (GUC bypass for the restricted Unique Lead stage; welcome resend handled idempotently). A `lead_cold_ids` helper (4 stages) drives the UI decision and the RPC validation. The intake page's Release handler branches to re-engage for Meta + cold-lead rows. An auto-merge guard keeps such rows reachable.

**Tech Stack:** Postgres/Supabase, React + TypeScript, React-Query, Vitest.

## Spec

`docs/superpowers/specs/2026-06-23-meta-dup-reengage-cold-lead-design.md`. Verified facts:
- `format_intake_merge_block(r lead_intake) returns text` — reuse to build the appended block.
- `enqueue_lead_email(target_lead_id uuid, tpl_key text, dkey text)` — dedupes on `email_log`(sent) + `email_outbox`(pending/sent); returns false if `not automations_enabled` / opted out / no email.
- Welcome fires automatically on UPDATE into `unique_lead` (`leads_email_automations`, key `lead_welcome:<id>`). `email_log` has `dedupe_key`,`status`.
- Unique Lead stage is restricted (`restricted_to_user_id`); bypass via `set_config('app.intake_release','on',true)`.
- `lead_intake.matches` is a JSONB array of `{match_type, record_id, ...}`; `match_type` ∈ `lead`/`deal_client`/`queued`.
- `lead_intake_auto_merge` discards `deal_client` matches always; only auto-merges when `auto_merge_enabled` (currently **off**). `lead_distribution_state.auto_merge_enabled = false`.
- rpc client pattern: loose `rpcCall` in `src/lib/rpc.ts`; `deadEndLeadIds`/`mergeLeadIntake` to mirror.

## File map
- Create migration `supabase/migrations/20260623130000_reengage_cold_lead_intake.sql` (`lead_cold_ids`, `reengage_lead_intake`, `lead_intake_auto_merge` guard + rollback).
- Modify `src/lib/rpc.ts` (add `coldLeadIds`, `reengageLeadIntake`).
- Create `src/features/leads/hooks/useColdLeads.ts`, `src/features/leads/hooks/useReengageLeadIntake.ts`.
- Modify `src/features/leads/intakeMatches.ts` (+ test) — add `coldLeadMatchesOf`.
- Modify `src/features/leads/LeadIntakePage.tsx` (+ test) — Release branch + cold-lead picker.
- Modify `src/i18n/locales/{en,el}/leads.json` (intake re-engage strings).

---

### Task 1: Migration — `lead_cold_ids`, `reengage_lead_intake`, auto-merge guard

**Files:** Create `supabase/migrations/20260623130000_reengage_cold_lead_intake.sql`

- [ ] **Step 1: Write the migration** with exactly:

```sql
-- 20260623130000_reengage_cold_lead_intake.sql
-- =============================================================================
-- Re-engage an existing COLD lead from a Meta intake duplicate, instead of
-- creating a new lead. Moves the cold lead to Unique Lead, appends the new
-- submission to its intake_log, resolves the intake row. Adds no accounting.
-- =============================================================================

-- Which of the given lead ids are currently in a COLD stage (4 stages).
create or replace function public.lead_cold_ids(p_ids uuid[])
returns table(id uuid)
language sql stable security definer set search_path = public as $$
  select l.id
  from public.leads l
  join public.pipeline_stages ps on ps.id = l.stage_id
  where l.id = any(p_ids)
    and ps.board = 'sales'
    and ps.code in ('dead_end', 'not_interested', 'no_answer', 'constant_na');
$$;

create or replace function public.reengage_lead_intake(p_id uuid, p_target_lead_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.lead_intake;
  v_unique uuid;
begin
  select * into r from public.lead_intake where id = p_id;
  if r is null then return jsonb_build_object('ok', false, 'errors', array['not_found']); end if;
  if r.status <> 'pending' then return jsonb_build_object('ok', false, 'errors', array['not_pending']); end if;

  -- target must be one of this row's LEAD matches
  if not exists (
    select 1 from jsonb_array_elements(r.matches) m
    where m->>'match_type' = 'lead' and (m->>'record_id')::uuid = p_target_lead_id
  ) then
    return jsonb_build_object('ok', false, 'errors', array['not_a_match']);
  end if;

  -- target must currently be in a cold stage
  if not exists (select 1 from public.lead_cold_ids(array[p_target_lead_id])) then
    return jsonb_build_object('ok', false, 'errors', array['not_cold']);
  end if;

  select id into v_unique from public.pipeline_stages where board = 'sales' and code = 'unique_lead' limit 1;

  -- bypass the restricted-stage trigger (same mechanism as release_lead_intake)
  perform set_config('app.intake_release', 'on', true);
  update public.leads
     set stage_id = v_unique,
         intake_log = case
           when coalesce(intake_log, '') = '' then public.format_intake_merge_block(r)
           else intake_log || E'\n' || public.format_intake_merge_block(r)
         end,
         updated_at = now()
   where id = p_target_lead_id;

  -- Welcome: the stage move auto-enqueues lead_welcome:<id> (deduped if already
  -- sent). To honour "resend" for an already-welcomed lead, enqueue once more with
  -- a re-engage key, but ONLY when the standard welcome was already SENT — so a
  -- never-welcomed lead still gets exactly one (from the stage move).
  if exists (
    select 1 from public.email_log where dedupe_key = 'lead_welcome:' || p_target_lead_id and status = 'sent'
  ) then
    perform public.enqueue_lead_email(
      p_target_lead_id, 'lead_welcome',
      'lead_welcome:' || p_target_lead_id || ':reengage:' || r.id);
  end if;

  update public.lead_intake
     set status = 'released', released_lead_id = p_target_lead_id,
         reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_id;

  return jsonb_build_object('ok', true, 'lead_id', p_target_lead_id);
end $$;

-- Auto-merge guard: keep Meta rows matching a cold lead PENDING (so the admin can
-- re-engage on Release), even if auto-merge is turned on. Full body re-stated with
-- the one new guard inserted after the single-target existence check.
create or replace function public.lead_intake_auto_merge()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  enabled boolean;
  lead_matches jsonb;
  target uuid;
begin
  if NEW.status <> 'pending' then return NEW; end if;

  if exists (
    select 1 from jsonb_array_elements(NEW.matches) m where m->>'match_type' = 'deal_client'
  ) then
    NEW.status := 'discarded';
    NEW.reviewed_at := now();
    return NEW;
  end if;

  select auto_merge_enabled into enabled from public.lead_distribution_state where id = true;
  if not coalesce(enabled, false) then return NEW; end if;

  select coalesce(jsonb_agg(m), '[]'::jsonb) into lead_matches
    from jsonb_array_elements(NEW.matches) m where m->>'match_type' = 'lead';
  if jsonb_array_length(lead_matches) <> 1 then return NEW; end if;
  target := (lead_matches->0->>'record_id')::uuid;
  if not exists (select 1 from public.leads where id = target) then return NEW; end if;

  -- NEW: Meta re-submission matching a cold lead is handled by manual re-engage
  -- on Release; leave it pending so the admin sees it.
  if NEW.source = 'meta' and exists (select 1 from public.lead_cold_ids(array[target])) then
    return NEW;
  end if;

  if public.lead_is_dead_end(target) then
    NEW.status := 'discarded';
    NEW.reviewed_at := now();
    return NEW;
  end if;

  perform public.apply_intake_merge(target, NEW);
  NEW.status := 'merged';
  NEW.merged_into_lead_id := target;
  NEW.reviewed_at := now();
  return NEW;
end $$;

-- ---------------------------------------------------------------------------
-- Rollback:
--   drop function if exists public.reengage_lead_intake(uuid, uuid);
--   drop function if exists public.lead_cold_ids(uuid[]);
--   -- restore the previous lead_intake_auto_merge body (without the Meta/cold guard):
--   create or replace function public.lead_intake_auto_merge() returns trigger
--   language plpgsql security definer set search_path = public as $$
--   declare enabled boolean; lead_matches jsonb; target uuid;
--   begin
--     if NEW.status <> 'pending' then return NEW; end if;
--     if exists (select 1 from jsonb_array_elements(NEW.matches) m where m->>'match_type'='deal_client')
--       then NEW.status:='discarded'; NEW.reviewed_at:=now(); return NEW; end if;
--     select auto_merge_enabled into enabled from public.lead_distribution_state where id=true;
--     if not coalesce(enabled,false) then return NEW; end if;
--     select coalesce(jsonb_agg(m),'[]'::jsonb) into lead_matches
--       from jsonb_array_elements(NEW.matches) m where m->>'match_type'='lead';
--     if jsonb_array_length(lead_matches)<>1 then return NEW; end if;
--     target := (lead_matches->0->>'record_id')::uuid;
--     if not exists (select 1 from public.leads where id=target) then return NEW; end if;
--     if public.lead_is_dead_end(target) then NEW.status:='discarded'; NEW.reviewed_at:=now(); return NEW; end if;
--     perform public.apply_intake_merge(target, NEW);
--     NEW.status:='merged'; NEW.merged_into_lead_id:=target; NEW.reviewed_at:=now(); return NEW;
--   end $$;
-- ---------------------------------------------------------------------------
```

- [ ] **Step 2: Sanity-check** the SQL references only existing objects (`format_intake_merge_block`, `enqueue_lead_email`, `email_log`, `lead_is_dead_end`, `apply_intake_merge`, `pipeline_stages`, `lead_distribution_state`). No local apply (prod apply is Task 7).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260623130000_reengage_cold_lead_intake.sql
git commit -m "feat(lead-intake): reengage_lead_intake RPC + lead_cold_ids + auto-merge guard"
```

---

### Task 2: RPC client wrappers

**Files:** Modify `src/lib/rpc.ts`

- [ ] **Step 1: Add the wrappers** at the end of the "Lead intake" section (after `deadEndLeadIds`, ~line 268):

```ts
// Returns the subset of the given lead ids that are in a COLD stage (dead_end /
// not_interested / no_answer / constant_na) — drives the Meta re-engage path.
export async function coldLeadIds(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const { data, error } = await rpcCall('lead_cold_ids', { p_ids: ids });
  if (error) return [];
  return ((data as { id: string }[]) ?? []).map((row) => row.id);
}

// Admin-only. Re-engage a cold lead from a Meta intake duplicate: move it to
// Unique Lead, append the submission, resolve the intake row. Loose `rpcCall`.
// Errors: not_found, not_pending, not_a_match, not_cold.
export async function reengageLeadIntake(
  id: string,
  targetLeadId: string,
): Promise<LeadIntakeActionResult> {
  const { data, error } = await rpcCall('reengage_lead_intake', {
    p_id: id,
    p_target_lead_id: targetLeadId,
  });
  if (error) return { ok: false, errors: [error.message] };
  const r = data as { ok: boolean; lead_id?: string; errors?: string[] };
  if (!r.ok) return { ok: false, errors: r.errors ?? ['reengage_failed'] };
  return r.lead_id ? { ok: true, lead_id: r.lead_id } : { ok: true };
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
npm run typecheck
git add src/lib/rpc.ts
git commit -m "feat(lead-intake): rpc wrappers coldLeadIds + reengageLeadIntake"
```

---

### Task 3: Pure helper `coldLeadMatchesOf`

**Files:** Modify `src/features/leads/intakeMatches.ts`; Test `src/features/leads/intakeMatches.test.ts`

- [ ] **Step 1: Write the failing test** `src/features/leads/intakeMatches.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { leadMatchesOf, coldLeadMatchesOf } from './intakeMatches';
import type { LeadIntakeMatch } from './hooks/useLeadIntake';

const m = (o: Partial<LeadIntakeMatch>): LeadIntakeMatch =>
  ({ match_type: 'lead', record_id: 'x', display_name: 'X', ...o } as LeadIntakeMatch);

describe('intakeMatches', () => {
  it('leadMatchesOf keeps only lead matches', () => {
    const out = leadMatchesOf([m({ record_id: 'a' }), m({ match_type: 'deal_client', record_id: 'c' })]);
    expect(out.map((x) => x.record_id)).toEqual(['a']);
  });

  it('coldLeadMatchesOf keeps lead matches whose id is in the cold set', () => {
    const matches = [m({ record_id: 'cold1' }), m({ record_id: 'warm1' }), m({ match_type: 'deal_client', record_id: 'cold1' })];
    const out = coldLeadMatchesOf(matches, new Set(['cold1']));
    expect(out.map((x) => x.record_id)).toEqual(['cold1']); // warm excluded, deal_client excluded
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:run -- src/features/leads/intakeMatches.test.ts`
Expected: FAIL — `coldLeadMatchesOf` not exported.

- [ ] **Step 3: Add the helper** to `src/features/leads/intakeMatches.ts` (after `leadMatchesOf`):

```ts
/** Lead matches whose target lead is currently in a cold stage (the re-engage
 *  candidates). `coldIds` comes from the `lead_cold_ids` RPC via useColdLeads. */
export function coldLeadMatchesOf(
  matches: LeadIntakeMatch[],
  coldIds: Set<string>,
): LeadIntakeMatch[] {
  return leadMatchesOf(matches).filter((m) => coldIds.has(m.record_id));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:run -- src/features/leads/intakeMatches.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/leads/intakeMatches.ts src/features/leads/intakeMatches.test.ts
git commit -m "feat(lead-intake): coldLeadMatchesOf helper"
```

---

### Task 4: Hooks `useColdLeads` + `useReengageLeadIntake`

**Files:** Create `src/features/leads/hooks/useColdLeads.ts`, `src/features/leads/hooks/useReengageLeadIntake.ts`

- [ ] **Step 1: Write `useColdLeads.ts`** (mirror `useDeadEndLeads`):

```ts
import { useQuery } from '@tanstack/react-query';
import { coldLeadIds } from '@/lib/rpc';

/**
 * Given the lead-target ids visible in the intake queue, returns the subset in a
 * COLD stage (dead_end / not_interested / no_answer / constant_na) as a Set, so a
 * Meta re-submission matching one can be re-engaged on Release.
 */
export function useColdLeads(ids: string[]): Set<string> {
  const sorted = [...new Set(ids)].sort();
  const { data } = useQuery({
    queryKey: ['lead_cold_ids', sorted],
    queryFn: () => coldLeadIds(sorted),
    enabled: sorted.length > 0,
    staleTime: 30_000,
  });
  return new Set(data ?? []);
}
```

- [ ] **Step 2: Write `useReengageLeadIntake.ts`** (mirror `useMergeLeadIntake`/`useReleaseLeadIntake`):

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { reengageLeadIntake } from '@/lib/rpc';
import { captureMutation } from '@/lib/sentry/captureMutation';

export function useReengageLeadIntake() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: captureMutation('lead_intake', 'reengage', async (input: { id: string; targetLeadId: string }) => {
      const r = await reengageLeadIntake(input.id, input.targetLeadId);
      if (!r.ok) throw new Error(r.errors.join(', '));
      return r;
    }),
    onError: (e: unknown) => window.alert(e instanceof Error ? e.message : String(e)),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['lead_intake'] });
      void qc.invalidateQueries({ queryKey: ['leads'] });
    },
  });
}
```

- [ ] **Step 3: Typecheck + commit**

```bash
npm run typecheck
git add src/features/leads/hooks/useColdLeads.ts src/features/leads/hooks/useReengageLeadIntake.ts
git commit -m "feat(lead-intake): useColdLeads + useReengageLeadIntake hooks"
```

---

### Task 5: Intake page — Release branches to re-engage

**Files:** Modify `src/features/leads/LeadIntakePage.tsx`; Test `src/features/leads/LeadIntakePage.test.tsx`

- [ ] **Step 1: Write the failing test.** Read `LeadIntakePage.test.tsx` first to match its mock setup, then add mocks for the new hooks and this case:

```tsx
// mock additions (mirror the file's existing vi.mock style)
vi.mock('./hooks/useColdLeads', () => ({ useColdLeads: () => new Set(['cold-lead-1']) }));
const reengageMutate = vi.fn();
vi.mock('./hooks/useReengageLeadIntake', () => ({ useReengageLeadIntake: () => ({ mutate: reengageMutate, isPending: false }) }));

it('Release on a Meta row matching a cold lead re-engages instead of releasing', () => {
  // intake row: source 'meta', one lead match whose record_id is the cold lead
  mockIntakeRows([{ id: 'row1', source: 'meta', matches: [{ match_type: 'lead', record_id: 'cold-lead-1', display_name: 'Old Lead' }] }]);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  render(<LeadIntakePage />);
  fireEvent.click(screen.getByRole('button', { name: 'leads:intake.release' }));
  expect(reengageMutate).toHaveBeenCalledWith({ id: 'row1', targetLeadId: 'cold-lead-1' });
  expect(releaseMutate).not.toHaveBeenCalled();
});
```

(Use the file's existing helpers/mocks for `useLeadIntake` and `useReleaseLeadIntake` — `mockIntakeRows`/`releaseMutate` above are placeholders for whatever the file already uses.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:run -- src/features/leads/LeadIntakePage.test.tsx`
Expected: FAIL — Release calls release, not reengage.

- [ ] **Step 3: Implement.** In `src/features/leads/LeadIntakePage.tsx`:

Add imports:
```tsx
import { coldLeadMatchesOf, leadMatchesOf } from './intakeMatches';
import { useColdLeads } from './hooks/useColdLeads';
import { useReengageLeadIntake } from './hooks/useReengageLeadIntake';
```
Add the hook + cold set near the other hooks (after `useDeadEndLeads`, ~line 141):
```tsx
  const reengage = useReengageLeadIntake();
  const [reengageFor, setReengageFor] = useState<string | null>(null);
  const coldSet = useColdLeads(
    rows.flatMap((r) =>
      leadMatchesOf((r.matches as unknown as LeadIntakeMatch[]) ?? []).map((m) => m.record_id),
    ),
  );
```
Replace the `onRelease` function (lines 208-215) with:
```tsx
            const coldMatches = r.source === 'meta' ? coldLeadMatchesOf(matches, coldSet) : [];
            function reengageInto(targetLeadId: string, name: string) {
              if (!window.confirm(t('leads:intake.reengage_confirm', { name }))) return;
              reengage.mutate({ id: r.id, targetLeadId });
            }
            function onRelease() {
              // Meta re-submission matching a cold lead → re-engage that lead.
              if (coldMatches.length === 1 && coldMatches[0]) {
                reengageInto(coldMatches[0].record_id, coldMatches[0].display_name);
                return;
              }
              if (coldMatches.length > 1) {
                setReengageFor(r.id);
                return;
              }
              if (matches.length > 0) {
                if (!window.confirm(t('leads:intake.release_confirm_dup', { count: matches.length }))) return;
                release.mutate({ id: r.id, force: true });
              } else {
                release.mutate({ id: r.id, force: false });
              }
            }
```
After the existing merge-picker block (the `pickFor === r.id` block, ~line 293-326), add a cold-lead re-engage picker:
```tsx
                {reengageFor === r.id && coldMatches.length > 1 ? (
                  <div className="mt-2 rounded border border-emerald-300 bg-emerald-50 p-2 text-sm dark:border-emerald-900/50 dark:bg-emerald-900/20">
                    <div className="mb-1 font-medium">{t('leads:intake.reengage_pick')}</div>
                    <div className="flex flex-wrap gap-2">
                      {coldMatches.map((m) => (
                        <button
                          key={m.record_id}
                          type="button"
                          className="rounded border bg-card px-2 py-1 text-xs"
                          onClick={() => {
                            reengageInto(m.record_id, m.display_name);
                            setReengageFor(null);
                          }}
                        >
                          {m.display_name}
                          {m.context ? ` (${m.context})` : ''}
                        </button>
                      ))}
                      <button type="button" className="rounded px-2 py-1 text-xs underline" onClick={() => setReengageFor(null)}>
                        {t('leads:intake.merge_cancel')}
                      </button>
                    </div>
                  </div>
                ) : null}
```

- [ ] **Step 4: Add i18n keys** in `src/i18n/locales/en/leads.json` and `el/leads.json` under `intake`:
  - en: `"reengage_confirm": "Re-engage {{name}} — move to Unique Lead and append this submission?"`, `"reengage_pick": "Which cold lead to re-engage?"`
  - el: `"reengage_confirm": "Επανενεργοποίηση {{name}} — μετακίνηση σε Μοναδικό Πελάτη και προσθήκη αυτής της υποβολής;"`, `"reengage_pick": "Ποιον ανενεργό lead να επανενεργοποιήσω;"`

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test:run -- src/features/leads/LeadIntakePage.test.tsx`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

```bash
npm run typecheck
git add src/features/leads/LeadIntakePage.tsx src/features/leads/LeadIntakePage.test.tsx src/i18n/locales/en/leads.json src/i18n/locales/el/leads.json
git commit -m "feat(lead-intake): Release re-engages a Meta dup matching a cold lead"
```

---

### Task 6: Full verification

- [ ] **Step 1:** `npm run test:run` → all pass.
- [ ] **Step 2:** `npm run build` → tsc + lint + vite build clean.

---

### Task 7: Apply migration to prod, verify, push

**Files:** none (deploy)

- [ ] **Step 1: Apply** `20260623130000_reengage_cold_lead_intake.sql` via the Management API (requires user go-ahead).
- [ ] **Step 2: Verify** the functions exist: `select proname from pg_proc where proname in ('reengage_lead_intake','lead_cold_ids');` → 2 rows. Confirm `lead_intake_auto_merge` updated (`select pg_get_functiondef('public.lead_intake_auto_merge()'::regprocedure)` contains the Meta/cold guard).
- [ ] **Step 3: Push** `git push origin main`.
- [ ] **Step 4: Live smoke** (hard-refresh): the existing pending Meta+cold intake row → **Release** moves the old lead to Unique Lead (welcome enqueued for an already-welcomed lead via the re-engage key), appends to its `intake_log`, marks the intake row released, and creates **no** new lead. A normal Meta row with no cold match still Releases a new lead. Verify on `/sales/lead-intake` + the target lead's detail (`stage = Unique Lead`, new `intake_log` block).

---

## Self-Review

**Spec coverage:** on-Release re-engage → Task 5; append-only (no field overwrite) → Task 1 (intake_log only); resend welcome (idempotent) → Task 1 email_log conditional; 4 cold stages → Task 1 `lead_cold_ids`; meta-only + single/picker → Task 5; auto-merge guard → Task 1; won deal_client out of scope (auto-discarded by existing trigger) → unchanged. ✓

**Placeholder scan:** the Task-5 test uses `mockIntakeRows`/`releaseMutate` placeholders explicitly flagged to match the existing test file's helpers — the implementer wires them to the real mocks. All SQL/hooks/wrappers are concrete.

**Type consistency:** `coldLeadIds`/`reengageLeadIntake` return types match `string[]` / `LeadIntakeActionResult`; `useColdLeads` returns `Set<string>`; `coldLeadMatchesOf(matches, Set)` consistent across Tasks 3 & 5.

## Changes / Revert
- **DB:** two new functions + one function-body change. Rollback SQL (drop the two; restore the prior `lead_intake_auto_merge` body) is in the migration footer. No tables/columns/data touched.
- **Frontend:** revert Tasks 2–5 commits. Non-meta / non-cold Release, Merge, Discard, and bulk flows are unchanged.
