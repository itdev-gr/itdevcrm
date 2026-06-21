# Lead Intake — Merge Duplicate Leads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a **Merge** action (manual button + cautious auto toggle) to the Lead Intake queue that appends a new duplicate lead's info onto an existing pipeline lead — never overwriting — and records the new info in a dedicated append-only field on the lead.

**Architecture:** A new append-only `leads.intake_log` text column holds dated blocks built by a SQL helper `format_intake_merge_block`. A `merge_lead_intake(p_id, p_target_lead_id)` RPC (admin-only, `security definer`) appends the block to a chosen lead and marks the intake row `merged`. A cautious `before insert` trigger on `lead_intake` auto-merges only unambiguous single-lead matches when `lead_distribution_state.auto_merge_enabled` is on. Frontend mirrors the existing auto-distribute toggle + Release/Discard button patterns.

**Tech Stack:** Postgres (Supabase migrations, applied via Supabase MCP — DDL is blocked from Bash by the project's safety classifier), React + TypeScript, @tanstack/react-query, react-i18next, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-06-21-lead-intake-merge-duplicates-design.md`

---

## File Structure

**Database (new migration files):**
- `supabase/migrations/20260621120000_lead_intake_merge_schema.sql` — columns + status constraint + toggle column
- `supabase/migrations/20260621120100_format_intake_merge_block.sql` — block formatter
- `supabase/migrations/20260621120200_merge_lead_intake.sql` — manual merge RPC
- `supabase/migrations/20260621120300_lead_intake_auto_merge.sql` — auto-merge trigger

**Frontend:**
- Create: `src/features/leads/intakeMatches.ts` — pure helper `leadMatchesOf`
- Create: `src/features/leads/intakeMatches.test.ts`
- Create: `src/features/leads/hooks/useMergeLeadIntake.ts`
- Create: `src/features/leads/hooks/useAutoMerge.ts`
- Create: `src/features/leads/hooks/useAutoMerge.test.tsx`
- Modify: `src/lib/rpc.ts` — add `mergeLeadIntake` wrapper
- Modify: `src/features/leads/LeadIntakePage.tsx` — Merge button + chooser + auto-merge toggle
- Modify: `src/features/leads/LeadIntakePage.test.tsx` — mock new hooks + cover Merge
- Modify: `src/features/leads/LeadDetailPage.tsx` — read-only `intake_log` display
- Modify: `src/i18n/locales/el/leads.json`, `src/i18n/locales/en/leads.json` — labels
- Modify: `src/types/supabase.ts` — regenerated for new columns

**Conventions to follow (verified in the codebase):**
- supabase-js `from`/`rpc` MUST be `.bind(supabase)` when captured into a const, or it silently no-ops (`reference_supabase_from_binding`). The existing `rpcCall` const in `rpc.ts:65` and the `from` const in `useLeadDistribution.ts:20` already do this — reuse them.
- RPCs return `{ ok: boolean; lead_id?; errors? }`; wrappers in `rpc.ts` normalise to `{ ok: true, ... } | { ok: false, errors }`.
- DDL migrations are applied via Supabase MCP `apply_migration` (project ref `xujlrclyzxrvxszepquy`). Read-only verification SQL can run through the Management API query endpoint with an `$SBP_TOKEN` env var (never paste the token into files — `feedback_no_secrets_in_docs`).

---

## Task 1: DB schema additions (columns, status constraint, toggle)

**Files:**
- Create: `supabase/migrations/20260621120000_lead_intake_merge_schema.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Lead-intake merge: schema additions (all additive).
-- 1. Append-only field on leads that holds merged duplicate info.
alter table public.leads
  add column if not exists intake_log text;

-- 2. Allow a new terminal intake status 'merged'.
alter table public.lead_intake
  drop constraint if exists lead_intake_status_check;
alter table public.lead_intake
  add constraint lead_intake_status_check
  check (status in ('pending','released','discarded','merged'));

-- 3. Audit pointer: which lead an intake row was merged into.
alter table public.lead_intake
  add column if not exists merged_into_lead_id uuid
  references public.leads(id) on delete set null;

-- 4. Auto-merge toggle, reusing the admin-only singleton settings row.
alter table public.lead_distribution_state
  add column if not exists auto_merge_enabled boolean not null default false;
```

- [ ] **Step 2: Apply the migration**

Apply via Supabase MCP `apply_migration` (name: `lead_intake_merge_schema`, body: the SQL above) against project `xujlrclyzxrvxszepquy`. (DDL via Bash is blocked by the safety classifier — use MCP or the dashboard SQL editor.)

- [ ] **Step 3: Verify the schema landed**

Run:
```bash
curl -s -X POST "https://api.supabase.com/v1/projects/xujlrclyzxrvxszepquy/database/query" \
  -H "Authorization: Bearer $SBP_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"select (select count(*) from information_schema.columns where table_name='\''leads'\'' and column_name='\''intake_log'\'') as has_intake_log, (select count(*) from information_schema.columns where table_name='\''lead_intake'\'' and column_name='\''merged_into_lead_id'\'') as has_merged_into, (select count(*) from information_schema.columns where table_name='\''lead_distribution_state'\'' and column_name='\''auto_merge_enabled'\'') as has_toggle;"}'
```
Expected: JSON with `has_intake_log:1`, `has_merged_into:1`, `has_toggle:1`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260621120000_lead_intake_merge_schema.sql
git commit -m "feat(leads): schema for merging duplicate intake leads (intake_log, merged status, auto_merge toggle)"
```

---

## Task 2: `format_intake_merge_block` SQL helper

**Files:**
- Create: `supabase/migrations/20260621120100_format_intake_merge_block.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Builds the human-readable block appended to a lead's intake_log from one
-- lead_intake row. Skips noisy Meta system keys; lists campaign + form answers.
create or replace function public.format_intake_merge_block(r public.lead_intake)
returns text
language plpgsql
stable
as $$
declare
  block text;
  rec record;
  src_label text;
  skip_keys text[] := array[
    'leadgen_id','form_id','form_name','campaign_id',
    'ad_id','adset_id','platform','is_organic','created_time'
  ];
begin
  src_label := case r.source
                 when 'meta' then 'Meta lead'
                 when 'import' then 'Excel/CSV import'
                 else coalesce(r.source, 'lead')
               end;
  block := '--- ' || to_char(coalesce(r.created_at, now()), 'DD/MM/YYYY')
           || ' · ' || src_label || ' ---' || E'\n';
  if coalesce(r.title, '') <> '' then
    block := block || 'Campaign / form: ' || r.title || E'\n';
  end if;
  if coalesce(r.contact_info, '') <> '' then
    block := block || 'Notes: ' || r.contact_info || E'\n';
  end if;
  if r.source_data is not null and jsonb_typeof(r.source_data) = 'object' then
    for rec in
      select key, value
      from jsonb_each_text(r.source_data)
      where key <> all (skip_keys) and coalesce(value, '') <> ''
      order by key
    loop
      block := block || rec.key || ': ' || rec.value || E'\n';
    end loop;
  end if;
  return block;
end;
$$;
```

- [ ] **Step 2: Apply the migration**

Apply via Supabase MCP `apply_migration` (name: `format_intake_merge_block`).

- [ ] **Step 3: Verify formatting + system-key skipping**

Run:
```bash
curl -s -X POST "https://api.supabase.com/v1/projects/xujlrclyzxrvxszepquy/database/query" \
  -H "Authorization: Bearer $SBP_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"select public.format_intake_merge_block(row(gen_random_uuid(), '\''2026-06-21T09:00:00Z'\''::timestamptz, '\''pending'\'', '\''import'\'', '\''{\"Budget\":\"2000-5000\",\"leadgen_id\":\"99\",\"When\":\"ASAP\"}'\''::jsonb, '\''Spring Promo'\'', null, null, null, null, null, null, null, null, '\''has notes'\'', null, null::text[], '\''[]'\''::jsonb, null, null, null, null)::public.lead_intake) as block;"}'
```
Expected: a `block` string containing `--- 21/06/2026 · Excel/CSV import ---`, `Campaign / form: Spring Promo`, `Notes: has notes`, `Budget: 2000-5000`, `When: ASAP`, and **no** `leadgen_id` line.

> Note: the `row(...)` positional cast must match the current `lead_intake` column order. If the column order differs, adjust the positional values (or use an `insert ... returning` into a temp row instead). Column order after Task 1: `id, created_at, status, source, source_data, title, contact_first_name, contact_last_name, email, phone, phone_normalized, website, company_name, contact_info, matched_on, matches, reviewed_by, reviewed_at, released_lead_id, merged_into_lead_id`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260621120100_format_intake_merge_block.sql
git commit -m "feat(leads): format_intake_merge_block helper for merged intake info"
```

---

## Task 3: `merge_lead_intake` RPC

**Files:**
- Create: `supabase/migrations/20260621120200_merge_lead_intake.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Admin-only: append an intake row's info onto an existing pipeline lead and
-- mark the row 'merged'. Never overwrites any existing lead field.
create or replace function public.merge_lead_intake(p_id uuid, p_target_lead_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.lead_intake;
  v_block text;
  v_is_lead_match boolean;
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

  -- Safety: target must be one of this row's matched *leads*.
  select exists (
    select 1 from jsonb_array_elements(r.matches) m
    where m->>'match_type' = 'lead'
      and (m->>'record_id')::uuid = p_target_lead_id
  ) into v_is_lead_match;
  if not v_is_lead_match then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array('target_not_a_match'));
  end if;

  if not exists (select 1 from public.leads where id = p_target_lead_id) then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array('target_lead_missing'));
  end if;

  v_block := public.format_intake_merge_block(r);

  update public.leads
     set intake_log = case
           when coalesce(intake_log, '') = '' then v_block
           else intake_log || E'\n' || v_block
         end,
         updated_at = now()
   where id = p_target_lead_id;

  update public.lead_intake
     set status = 'merged',
         merged_into_lead_id = p_target_lead_id,
         reviewed_by = auth.uid(),
         reviewed_at = now()
   where id = p_id;

  return jsonb_build_object('ok', true, 'lead_id', p_target_lead_id);
end;
$$;

grant execute on function public.merge_lead_intake(uuid, uuid) to authenticated;
```

- [ ] **Step 2: Apply the migration**

Apply via Supabase MCP `apply_migration` (name: `merge_lead_intake`).

- [ ] **Step 3: Verify append + guards on a throwaway row**

Run (creates a temp lead + intake row, merges, asserts append + status, then cleans up):
```bash
curl -s -X POST "https://api.supabase.com/v1/projects/xujlrclyzxrvxszepquy/database/query" \
  -H "Authorization: Bearer $SBP_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"do $$ declare v_lead uuid; v_intake uuid; v_log text; v_status text; begin insert into public.leads (source, title, stage_id) select '\''import'\'', '\''ZZ merge test'\'', id from public.pipeline_stages where board='\''sales'\'' and code='\''new_lead'\'' limit 1 returning id into v_lead; insert into public.lead_intake (status, source, title, source_data, matches) values ('\''pending'\'', '\''import'\'', '\''Test Campaign'\'', '\''{\"Budget\":\"5000\"}'\''::jsonb, jsonb_build_array(jsonb_build_object('\''match_type'\'','\''lead'\'','\''record_id'\'', v_lead::text))) returning id into v_intake; perform public.merge_lead_intake(v_intake, v_lead); select intake_log into v_log from public.leads where id=v_lead; select status into v_status from public.lead_intake where id=v_intake; raise notice '\''log=%, status=%'\'', v_log, v_status; delete from public.lead_intake where id=v_intake; delete from public.leads where id=v_lead; end $$;"}'
```
Expected: the `notice` shows `log=` containing `Test Campaign` and `Budget: 5000`, and `status=merged`. (Note: `current_user_is_admin()` runs as service-role here; if it returns false under the Management API, instead verify by calling the RPC from the app while logged in as an admin in Step of Task 9.)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260621120200_merge_lead_intake.sql
git commit -m "feat(leads): merge_lead_intake RPC (append duplicate info to existing lead)"
```

---

## Task 4: `lead_intake_auto_merge` trigger

**Files:**
- Create: `supabase/migrations/20260621120300_lead_intake_auto_merge.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Cautious auto-merge: when the toggle is on AND a new intake row matches
-- exactly one pipeline lead, append its info to that lead and mark it merged
-- before it ever appears as 'pending'. Anything ambiguous stays pending.
create or replace function public.lead_intake_auto_merge()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  enabled boolean;
  lead_matches jsonb;
  target uuid;
  v_block text;
begin
  if NEW.status <> 'pending' then
    return NEW;
  end if;

  select auto_merge_enabled into enabled
    from public.lead_distribution_state where id = true;
  if not coalesce(enabled, false) then
    return NEW;
  end if;

  select coalesce(jsonb_agg(m), '[]'::jsonb)
    into lead_matches
    from jsonb_array_elements(NEW.matches) m
   where m->>'match_type' = 'lead';

  if jsonb_array_length(lead_matches) <> 1 then
    return NEW;  -- 0 or 2+ lead matches → leave for manual review
  end if;

  target := (lead_matches->0->>'record_id')::uuid;
  if not exists (select 1 from public.leads where id = target) then
    return NEW;
  end if;

  v_block := public.format_intake_merge_block(NEW);
  update public.leads
     set intake_log = case
           when coalesce(intake_log, '') = '' then v_block
           else intake_log || E'\n' || v_block
         end,
         updated_at = now()
   where id = target;

  NEW.status := 'merged';
  NEW.merged_into_lead_id := target;
  NEW.reviewed_at := now();  -- reviewed_by stays NULL → "System"
  return NEW;
end;
$$;

drop trigger if exists lead_intake_auto_merge_trg on public.lead_intake;
create trigger lead_intake_auto_merge_trg
  before insert on public.lead_intake
  for each row execute function public.lead_intake_auto_merge();
```

- [ ] **Step 2: Apply the migration**

Apply via Supabase MCP `apply_migration` (name: `lead_intake_auto_merge`).

- [ ] **Step 3: Verify the toggle gates auto-merge**

Run (toggle ON → single-match row lands as `merged`; two-match row stays `pending`; then toggle OFF and clean up):
```bash
curl -s -X POST "https://api.supabase.com/v1/projects/xujlrclyzxrvxszepquy/database/query" \
  -H "Authorization: Bearer $SBP_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"do $$ declare v_lead uuid; v_one uuid; v_two uuid; s1 text; s2 text; begin update public.lead_distribution_state set auto_merge_enabled=true where id=true; insert into public.leads (source, title, stage_id) select '\''import'\'', '\''ZZ auto test'\'', id from public.pipeline_stages where board='\''sales'\'' and code='\''new_lead'\'' limit 1 returning id into v_lead; insert into public.lead_intake (status, source, title, matches) values ('\''pending'\'','\''import'\'','\''one'\'', jsonb_build_array(jsonb_build_object('\''match_type'\'','\''lead'\'','\''record_id'\'',v_lead::text))) returning id into v_one; insert into public.lead_intake (status, source, title, matches) values ('\''pending'\'','\''import'\'','\''two'\'', jsonb_build_array(jsonb_build_object('\''match_type'\'','\''lead'\'','\''record_id'\'',v_lead::text), jsonb_build_object('\''match_type'\'','\''lead'\'','\''record_id'\'',gen_random_uuid()::text))) returning id into v_two; select status into s1 from public.lead_intake where id=v_one; select status into s2 from public.lead_intake where id=v_two; raise notice '\''single=% double=%'\'', s1, s2; update public.lead_distribution_state set auto_merge_enabled=false where id=true; delete from public.lead_intake where id in (v_one, v_two); delete from public.leads where id=v_lead; end $$;"}'
```
Expected: `single=merged double=pending`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260621120300_lead_intake_auto_merge.sql
git commit -m "feat(leads): cautious auto-merge trigger for single-match intake duplicates"
```

---

## Task 5: Regenerate TypeScript types

**Files:**
- Modify: `src/types/supabase.ts`

- [ ] **Step 1: Regenerate from the live schema**

Run: `npm run types:gen`
Expected: command writes `src/types/supabase.ts` with no error.

- [ ] **Step 2: Verify the new fields are present**

Run: `grep -nE "intake_log|merged_into_lead_id|auto_merge_enabled" src/types/supabase.ts`
Expected: matches for all three (in `leads`, `lead_intake`, `lead_distribution_state` blocks respectively).

> Fallback if `types:gen` can't authenticate: manually add `intake_log: string | null` to the `leads` Row/Insert/Update, `merged_into_lead_id: string | null` to `lead_intake` Row/Insert/Update, and `auto_merge_enabled: boolean` to `lead_distribution_state` Row (and `?: boolean` in Insert/Update).

- [ ] **Step 3: Commit**

```bash
git add src/types/supabase.ts
git commit -m "chore(types): regenerate supabase types for intake merge fields"
```

---

## Task 6: `leadMatchesOf` pure helper (TDD)

**Files:**
- Create: `src/features/leads/intakeMatches.ts`
- Test: `src/features/leads/intakeMatches.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { leadMatchesOf } from './intakeMatches';
import type { LeadIntakeMatch } from './hooks/useLeadIntake';

const m = (over: Partial<LeadIntakeMatch>): LeadIntakeMatch => ({
  match_type: 'lead',
  record_id: 'L1',
  display_name: 'X',
  context: null,
  matched_field: 'email',
  matched_email: null,
  matched_phone: null,
  ...over,
});

describe('leadMatchesOf', () => {
  it('keeps only pipeline-lead matches', () => {
    const out = leadMatchesOf([
      m({ match_type: 'lead', record_id: 'L1' }),
      m({ match_type: 'deal_client', record_id: 'C1' }),
      m({ match_type: 'queued', record_id: 'Q1' }),
      m({ match_type: 'lead', record_id: 'L2' }),
    ]);
    expect(out.map((x) => x.record_id)).toEqual(['L1', 'L2']);
  });

  it('returns empty when there are no lead matches', () => {
    expect(leadMatchesOf([m({ match_type: 'deal_client' })])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/leads/intakeMatches.test.ts`
Expected: FAIL — cannot find module `./intakeMatches`.

- [ ] **Step 3: Write the implementation**

```ts
import type { LeadIntakeMatch } from './hooks/useLeadIntake';

/**
 * The subset of duplicate matches that point at an existing pipeline lead —
 * the only records the Merge action can append to (v1; customers are out of
 * scope). Count of 1 → direct merge; 2+ → the admin picks; 0 → Merge disabled.
 */
export function leadMatchesOf(matches: LeadIntakeMatch[]): LeadIntakeMatch[] {
  return matches.filter((m) => m.match_type === 'lead');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/leads/intakeMatches.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/leads/intakeMatches.ts src/features/leads/intakeMatches.test.ts
git commit -m "feat(leads): leadMatchesOf helper for intake merge targeting"
```

---

## Task 7: `mergeLeadIntake` RPC wrapper

**Files:**
- Modify: `src/lib/rpc.ts` (add after `discardLeadIntake`, around line 233)

- [ ] **Step 1: Add the wrapper**

Insert after the `discardLeadIntake` function (after `rpc.ts:233`):

```ts
// Admin-only. Appends a held duplicate's info onto an existing pipeline lead
// (chosen by the admin) and marks the intake row merged. Loose `rpcCall` (not in
// generated types). Errors: not_authorized, not_found, already_<status>,
// target_not_a_match, target_lead_missing.
export async function mergeLeadIntake(
  id: string,
  targetLeadId: string,
): Promise<LeadIntakeActionResult> {
  const { data, error } = await rpcCall('merge_lead_intake', {
    p_id: id,
    p_target_lead_id: targetLeadId,
  });
  if (error) return { ok: false, errors: [error.message] };
  const r = data as { ok: boolean; lead_id?: string; errors?: string[] };
  if (!r.ok) return { ok: false, errors: r.errors ?? ['merge_failed'] };
  return r.lead_id ? { ok: true, lead_id: r.lead_id } : { ok: true };
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: no new errors referencing `rpc.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/rpc.ts
git commit -m "feat(leads): mergeLeadIntake rpc wrapper"
```

---

## Task 8: `useMergeLeadIntake` hook

**Files:**
- Create: `src/features/leads/hooks/useMergeLeadIntake.ts`

- [ ] **Step 1: Write the hook** (mirrors `useReleaseLeadIntake.ts`)

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { mergeLeadIntake } from '@/lib/rpc';
import { captureMutation } from '@/lib/sentry/captureMutation';

export function useMergeLeadIntake() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: captureMutation(
      'lead_intake',
      'merge',
      async (input: { id: string; targetLeadId: string }) => {
        const r = await mergeLeadIntake(input.id, input.targetLeadId);
        if (!r.ok) throw new Error(r.errors.join(', '));
        return r;
      },
    ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['lead_intake'] });
      void qc.invalidateQueries({ queryKey: ['leads'] });
    },
  });
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/features/leads/hooks/useMergeLeadIntake.ts
git commit -m "feat(leads): useMergeLeadIntake hook"
```

---

## Task 9: `useAutoMerge` toggle hook (TDD)

**Files:**
- Create: `src/features/leads/hooks/useAutoMerge.ts`
- Test: `src/features/leads/hooks/useAutoMerge.test.tsx`

- [ ] **Step 1: Write the failing test** (mirrors `useLeadDistribution.test.tsx`)

```tsx
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { restFrom } = vi.hoisted(() => ({ restFrom: vi.fn() }));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rest: { from: restFrom },
    from(table: string) {
      return this.rest.from(table);
    },
  },
}));

import { useAutoMerge } from './useAutoMerge';

function builder(enabled: boolean) {
  return {
    select: () => ({
      eq: () => ({
        single: () =>
          Promise.resolve({ data: { auto_merge_enabled: enabled }, error: null }),
      }),
    }),
    update: () => ({ eq: () => Promise.resolve({ error: null }) }),
  };
}

function wrap(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

describe('useAutoMerge', () => {
  beforeEach(() => {
    restFrom.mockReset();
    restFrom.mockReturnValue(builder(true));
  });

  it('reads auto_merge_enabled without losing the supabase `this` binding', async () => {
    const { result } = renderHook(() => useAutoMerge(), { wrapper: wrap(makeClient()) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.autoEnabled).toBe(true);
    expect(restFrom).toHaveBeenCalledWith('lead_distribution_state');
  });

  it('setEnabled persists the toggle', async () => {
    const { result } = renderHook(() => useAutoMerge(), { wrapper: wrap(makeClient()) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    restFrom.mockClear();
    await result.current.setEnabled.mutateAsync(true);
    expect(restFrom).toHaveBeenCalledWith('lead_distribution_state');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/leads/hooks/useAutoMerge.test.tsx`
Expected: FAIL — cannot find module `./useAutoMerge`.

- [ ] **Step 3: Write the hook**

```ts
import { useMutation, useQuery, useQueryClient, type DefaultError } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

const KEY = ['lead-auto-merge'] as const;

type FromAny = (table: string) => {
  select: (cols: string) => {
    eq: (c: string, v: unknown) => {
      single: () => Promise<{
        data: { auto_merge_enabled: boolean } | null;
        error: { message: string } | null;
      }>;
    };
  };
  update: (patch: Record<string, unknown>) => {
    eq: (c: string, v: unknown) => Promise<{ error: { message: string } | null }>;
  };
};
// `.bind(supabase)` is required — see useLeadDistribution.ts for the full why.
const from = supabase.from.bind(supabase) as unknown as FromAny;

export function useAutoMerge() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<{ auto_merge_enabled: boolean }> => {
      const { data, error } = await from('lead_distribution_state')
        .select('auto_merge_enabled')
        .eq('id', true)
        .single();
      if (error) throw new Error(error.message);
      return { auto_merge_enabled: data?.auto_merge_enabled ?? false };
    },
  });
  const setEnabled = useMutation<void, DefaultError, boolean>({
    mutationFn: async (enabled: boolean) => {
      const { error } = await from('lead_distribution_state')
        .update({ auto_merge_enabled: enabled, updated_at: new Date().toISOString() })
        .eq('id', true);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEY });
    },
  });
  return {
    autoEnabled: query.data?.auto_merge_enabled ?? false,
    isLoading: query.isLoading,
    setEnabled,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/leads/hooks/useAutoMerge.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/leads/hooks/useAutoMerge.ts src/features/leads/hooks/useAutoMerge.test.tsx
git commit -m "feat(leads): useAutoMerge toggle hook"
```

---

## Task 10: i18n labels (Greek + English)

**Files:**
- Modify: `src/i18n/locales/el/leads.json`
- Modify: `src/i18n/locales/en/leads.json`

- [ ] **Step 1: Add keys to the `intake` block in `el/leads.json`**

Add these keys inside the existing `"intake": { ... }` object (e.g. after `"discard"`):

```json
    "merge": "Συγχώνευση",
    "merge_disabled": "Δεν ταιριάζει με υπάρχον lead — διαθέσιμο μόνο Απελευθέρωση/Απόρριψη",
    "merge_pick": "Σε ποιο lead να προστεθούν;",
    "merge_cancel": "Άκυρο",
    "auto_merge_label": "Αυτόματη συγχώνευση διπλότυπων",
```

And add a new top-level key in `el/leads.json` (sibling of `"intake"`):

```json
  "intake_log": {
    "label": "Νέες πληροφορίες από διπλότυπα"
  },
```

- [ ] **Step 2: Add the matching keys to `en/leads.json`**

Inside the `"intake"` object:

```json
    "merge": "Merge",
    "merge_disabled": "No matching existing lead — only Release/Discard available",
    "merge_pick": "Add to which lead?",
    "merge_cancel": "Cancel",
    "auto_merge_label": "Auto-merge duplicates",
```

Sibling of `"intake"`:

```json
  "intake_log": {
    "label": "New info from duplicates"
  },
```

- [ ] **Step 3: Verify both files are valid JSON**

Run: `node -e "require('./src/i18n/locales/el/leads.json'); require('./src/i18n/locales/en/leads.json'); console.log('ok')"`
Expected: prints `ok`.

- [ ] **Step 4: Commit**

```bash
git add src/i18n/locales/el/leads.json src/i18n/locales/en/leads.json
git commit -m "i18n(leads): labels for intake merge button, picker, toggle, log"
```

---

## Task 11: Lead Intake page — Merge button, picker, auto-merge toggle (TDD)

**Files:**
- Modify: `src/features/leads/LeadIntakePage.tsx`
- Test: `src/features/leads/LeadIntakePage.test.tsx`

- [ ] **Step 1: Update the test mocks + add Merge coverage**

In `LeadIntakePage.test.tsx`, add these mocks alongside the existing ones (after the `useDiscardLeadIntake` mock, before the `react-i18next` mock):

```tsx
const merge = vi.fn();
vi.mock('./hooks/useMergeLeadIntake', () => ({
  useMergeLeadIntake: () => ({ mutate: merge, isPending: false }),
}));
const setAutoMerge = vi.fn();
vi.mock('./hooks/useAutoMerge', () => ({
  useAutoMerge: () => ({
    autoEnabled: false,
    isLoading: false,
    setEnabled: { mutate: setAutoMerge, isPending: false },
  }),
}));
```

Then add two tests inside `describe('LeadIntakePage', ...)`:

```tsx
  it('merges directly when there is exactly one lead match', () => {
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
    render(<LeadIntakePage />);
    fireEvent.click(screen.getByRole('button', { name: 'leads:intake.merge' }));
    expect(merge).toHaveBeenCalledWith({ id: 'i1', targetLeadId: 'L1' });
  });

  it('disables Merge when there is no lead match', () => {
    useLeadIntake.mockReturnValue({
      data: [
        {
          id: 'i3',
          title: 'Contact',
          email: 'c@x.gr',
          phone: '+306900000003',
          created_at: '2026-06-19T12:00:00Z',
          matched_on: ['email'],
          matches: [
            {
              match_type: 'deal_client',
              record_id: 'C1',
              display_name: 'Existing Customer',
              context: 'D-1',
              matched_field: 'email',
              matched_email: 'c@x.gr',
              matched_phone: null,
            },
          ],
        },
      ],
      isLoading: false,
    });
    render(<LeadIntakePage />);
    expect(screen.getByRole('button', { name: 'leads:intake.merge' })).toBeDisabled();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/features/leads/LeadIntakePage.test.tsx`
Expected: FAIL — `useMergeLeadIntake`/`useAutoMerge` not imported by the page yet, and no `leads:intake.merge` button.

- [ ] **Step 3: Update `LeadIntakePage.tsx`**

Add imports (after line 6):

```tsx
import { useState } from 'react';
import { useMergeLeadIntake } from './hooks/useMergeLeadIntake';
import { useAutoMerge } from './hooks/useAutoMerge';
import { leadMatchesOf } from './intakeMatches';
```

In the component body, after `const discard = useDiscardLeadIntake();` (line 82):

```tsx
  const merge = useMergeLeadIntake();
  const autoMerge = useAutoMerge();
  const [pickFor, setPickFor] = useState<string | null>(null);
```

Replace the header block (lines 87-90) with one that adds the toggle:

```tsx
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('leads:intake.title')}</h1>
          <p className="text-sm opacity-70">{t('leads:intake.subtitle')}</p>
        </div>
        <label className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm opacity-90">
          <input
            type="checkbox"
            checked={autoMerge.autoEnabled}
            disabled={autoMerge.isLoading || autoMerge.setEnabled.isPending}
            onChange={(e) => autoMerge.setEnabled.mutate(e.target.checked)}
          />
          {t('leads:intake.auto_merge_label')}
        </label>
      </div>
```

Inside the `rows.map((r) => { ... })` callback, after `const matches = ...` (line 103), add:

```tsx
            const leadMatches = leadMatchesOf(matches);
            const canMerge = leadMatches.length > 0;
            function onMerge() {
              if (leadMatches.length === 1) {
                merge.mutate({ id: r.id, targetLeadId: leadMatches[0].record_id });
              } else {
                setPickFor(r.id);
              }
            }
```

In the actions `<div className="flex shrink-0 gap-2">` (lines 151-170), add a Merge button as the first child (before Release):

```tsx
                    <button
                      type="button"
                      className="rounded bg-sky-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                      disabled={!canMerge || merge.isPending}
                      title={canMerge ? undefined : t('leads:intake.merge_disabled')}
                      onClick={onMerge}
                    >
                      {t('leads:intake.merge')}
                    </button>
```

After the actions `<div>` closes (after line 170, still inside the `<li>`), add the picker shown only when this row needs a choice:

```tsx
                {pickFor === r.id && leadMatches.length > 1 ? (
                  <div className="mt-2 rounded border border-sky-300 bg-sky-50 p-2 text-sm dark:border-sky-900/50 dark:bg-sky-900/20">
                    <div className="mb-1 font-medium">{t('leads:intake.merge_pick')}</div>
                    <div className="flex flex-wrap gap-2">
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
                      <button
                        type="button"
                        className="rounded px-2 py-1 text-xs underline"
                        onClick={() => setPickFor(null)}
                      >
                        {t('leads:intake.merge_cancel')}
                      </button>
                    </div>
                  </div>
                ) : null}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/features/leads/LeadIntakePage.test.tsx`
Expected: PASS — all existing tests plus the two new ones.

- [ ] **Step 5: Commit**

```bash
git add src/features/leads/LeadIntakePage.tsx src/features/leads/LeadIntakePage.test.tsx
git commit -m "feat(leads): Merge button + picker + auto-merge toggle on Lead Intake page"
```

---

## Task 12: Show `intake_log` read-only on the lead detail page

**Files:**
- Modify: `src/features/leads/LeadDetailPage.tsx`

- [ ] **Step 1: Add a read-only section in the Overview tab**

In `LeadDetailPage.tsx`, inside the overview `<div className="min-w-0 space-y-4">` (after `<LeadForm lead={lead} />` at line 304, before the attachments `<section>`), insert:

```tsx
              {lead.intake_log ? (
                <section className="rounded-xl border border-border/60 bg-card p-5 shadow-sm">
                  <h2 className="mb-2 text-sm font-semibold tracking-tight text-foreground">
                    {t('intake_log.label')}
                  </h2>
                  <pre className="whitespace-pre-wrap break-words font-sans text-sm text-muted-foreground">
                    {lead.intake_log}
                  </pre>
                </section>
              ) : null}
```

(`t` here is the `leads`-namespaced translator from `useTranslation('leads')` at line 37, so the key is `intake_log.label`.)

- [ ] **Step 2: Verify typecheck + build pass**

Run: `npx tsc --noEmit`
Expected: no errors (relies on `lead.intake_log` from the Task 5 types).

- [ ] **Step 3: Commit**

```bash
git add src/features/leads/LeadDetailPage.tsx
git commit -m "feat(leads): show 'New info from duplicates' (intake_log) on lead detail"
```

---

## Task 13: Full verification + push

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm run test:run`
Expected: all tests pass (no failures introduced).

- [ ] **Step 2: Typecheck + production build**

Run: `npx tsc --noEmit && npm run build`
Expected: both succeed with no errors.

- [ ] **Step 3: Manual smoke test as an admin (logged into the app)**

- Import a small CSV/Excel whose phone/email matches an existing pipeline lead → the row appears in Lead Intake flagged as a duplicate of that lead, with an enabled **Merge** button.
- Click **Merge** → the row disappears from the queue; open the matched lead → the **New info from duplicates** section shows a dated block with the campaign/form + answers; the lead's name/phone/notes are unchanged.
- Turn the **Auto-merge duplicates** toggle ON, import another single-match row → it does **not** appear in the queue and the block is appended automatically.
- Import a row matching **two** leads → Merge shows the picker; pick one → merges into that one.

- [ ] **Step 4: Push to main**

```bash
git push origin main
```

> Per `feedback_no_prs`: push directly to main. After deploy, watch for the Vercel stale-chunk gotcha (`reference_vercel_stale_chunk_404`) — hard-refresh if the intake page misbehaves right after deploy. Rotate any chat-shared Supabase token afterward.

---

## Self-Review

**Spec coverage:**
- New text field on leads that only adds info → `intake_log` column (Task 1) + read-only display (Task 12). ✓
- Merge button in Lead Intake → Task 11. ✓
- Add, never overwrite → `merge_lead_intake` only appends to `intake_log` (Task 3); manual smoke confirms other fields unchanged (Task 13). ✓
- Captures campaign + responses → `format_intake_merge_block` reads `title` + `source_data` (Task 2). ✓
- Auto toggle like auto-distribute → `auto_merge_enabled` column (Task 1) + `useAutoMerge` (Task 9) + toggle UI (Task 11) + cautious trigger (Task 4). ✓
- Old leads only / customers out of scope → `leadMatchesOf` filters to `match_type==='lead'`; Merge disabled otherwise (Tasks 6, 11). ✓
- Two matches → admin picks → picker in Task 11. ✓

**Placeholder scan:** No TBD/TODO; every code step contains full code; every command has expected output.

**Type consistency:** `mergeLeadIntake(id, targetLeadId)` (rpc.ts) ↔ `merge.mutate({ id, targetLeadId })` (hook input shape, Tasks 8/11) ↔ RPC params `p_id`, `p_target_lead_id` (Task 3). `leadMatchesOf` returns `LeadIntakeMatch[]` used for `.length`/`.record_id`/`.display_name`/`.context` consistently. `auto_merge_enabled` column ↔ `useAutoMerge` select/update ↔ trigger read — all match.
