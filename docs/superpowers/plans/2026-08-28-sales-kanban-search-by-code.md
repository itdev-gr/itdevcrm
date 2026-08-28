# Sales Kanban Search by Lead Code Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Typing a lead code (e.g. `006250`) into the Sales Pipeline search box shows that lead's card in the kanban (and the column headers count it) — today it silently matches nothing.

**Architecture:** The kanban search runs in TWO places that must stay in lock-step: (1) the browser builds a PostgREST `or=` clause (`searchOrClause` in `src/features/sales/salesKanbanColumns.ts`) used by both the column query (`useColumnLeads`) and the lead page's "Next in stage" walker (`LeadDetailPage.tsx`); (2) the per-column totals come from the SQL RPC `sales_kanban_counts` (migration `20260826120000_under_development_board.sql`), which repeats the same `ilike` list. Neither list contains `leads.code`, so the search cannot find a lead by code. Fix = add `code` (plus `business_profile_name` and `vat_number`, so the kanban search matches the same fields as the existing lead typeahead `useLeadSearch`) to both lists, with a unit test for the clause and a pgTAP test for the RPC.

**Tech Stack:** React 19 + TanStack Query + Supabase (PostgREST + SQL RPC), Vitest for unit tests, pgTAP (`supabase test db`) for SQL tests, Supabase MCP `apply_migration` for prod DDL.

## Global Constraints

- Repo: `/Users/marios/Desktop/Projects/itdevcrm-main`. Work on `main` (team norm: push straight to `main`, atomic commits, rebase before push).
- **`npm run build` is the strict gate** (`tsc -b` → `eslint . --max-warnings=0` → `vite build`). Run it before every commit that touches `src/`.
- **Migrations are the source of truth.** Production DDL is applied via the Supabase MCP `apply_migration` tool, then the matching file is committed. Every migration carries a `-- ROLLBACK:` section.
- The RPC signature `sales_kanban_counts(uuid, text, text, text)` does NOT change → no `npm run types:gen` needed (verify in Task 2 that `src/types/supabase.ts` is untouched).
- Lead codes are 6-digit zero-padded strings from `generate_lead_code()` (`lpad(nextval('lead_code_seq'), 6, '0')`, e.g. `006250`). Match with `ilike '%term%'` like every other field — so typing `6250` also finds `006250`.
- The browser clause and the SQL RPC must search the SAME column list. The canonical list is `KANBAN_SEARCH_COLUMNS` in `salesKanbanColumns.ts`; the migration mirrors it and says so in a comment.
- No literal secrets in markdown or migrations.
- The working tree already has unrelated uncommitted edits (`api/offer-pdf.ts`, `src/features/activity/format.ts`, `src/features/email/SendEmailDialog.tsx`, `src/features/email/buildDraft.ts`). **Do not stage or commit them** — `git add` only the files named in each task.

---

### Task 1: Browser search clause matches `code` (+ business_profile_name, vat_number)

**Files:**
- Modify: `src/features/sales/salesKanbanColumns.ts:39-53` (`searchOrClause`)
- Test: `src/features/sales/salesKanbanColumns.test.ts:14-23`

**Interfaces:**
- Consumes: nothing new.
- Produces: `export const KANBAN_SEARCH_COLUMNS: readonly string[]` (the ordered list of `leads` columns the kanban search matches) and the unchanged signature `searchOrClause(search: string): string | null`. Task 2's SQL mirrors `KANBAN_SEARCH_COLUMNS` exactly. Callers `useColumnLeads.ts:35` and `LeadDetailPage.tsx:94` need no change — they get the new columns for free.

- [ ] **Step 1: Write the failing tests**

Replace the existing `'builds an ilike OR clause across the searchable fields'` test in `src/features/sales/salesKanbanColumns.test.ts` with these two tests (keep the other tests in the file as they are; update the import line):

```ts
import { describe, it, expect } from 'vitest';
import {
  KANBAN_PAGE_SIZE,
  KANBAN_SEARCH_COLUMNS,
  orderForSort,
  pickNextId,
  searchOrClause,
} from './salesKanbanColumns';
```

```ts
  it('builds an ilike OR clause across the searchable fields', () => {
    expect(searchOrClause('   ')).toBeNull();
    const c = searchOrClause('acme');
    expect(c).toContain('title.ilike.%acme%');
    expect(c).toContain('phone.ilike.%acme%');
    // one `<column>.ilike.%term%` per searchable column, nothing else
    expect(c?.split(',')).toEqual(KANBAN_SEARCH_COLUMNS.map((col) => `${col}.ilike.%acme%`));
  });

  it('matches the lead code so "006250" finds lead 006250 in the kanban', () => {
    expect(KANBAN_SEARCH_COLUMNS).toContain('code');
    expect(searchOrClause('006250')).toContain('code.ilike.%006250%');
    // parity with the lead typeahead (useLeadSearch): business profile + VAT too
    expect(KANBAN_SEARCH_COLUMNS).toContain('business_profile_name');
    expect(KANBAN_SEARCH_COLUMNS).toContain('vat_number');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/features/sales/salesKanbanColumns.test.ts`
Expected: FAIL — `KANBAN_SEARCH_COLUMNS` is not exported (TypeScript/undefined error) and/or `code.ilike.%006250%` not found in the clause.

- [ ] **Step 3: Implement — single column list, clause derived from it**

In `src/features/sales/salesKanbanColumns.ts` replace the whole `searchOrClause` block (the comment + function, currently lines 39-53) with:

```ts
// The `leads` columns the kanban search box matches. ONE list, mirrored
// verbatim by the SQL RPC sales_kanban_counts (column totals) — keep them in
// sync or the headers will count leads the columns don't show (or vice versa).
// `code` is the 6-digit lead code shown on every card (e.g. 006250);
// business_profile_name / vat_number give parity with useLeadSearch.
export const KANBAN_SEARCH_COLUMNS = [
  'title',
  'company_name',
  'contact_first_name',
  'contact_last_name',
  'email',
  'phone',
  'code',
  'business_profile_name',
  'vat_number',
] as const satisfies readonly string[];

// PostgREST `or=` clause for the kanban search box; null when the term is empty.
// Strips characters that would break the filter grammar (`%` `,` `(` `)`).
export function searchOrClause(search: string): string | null {
  const v = search.replace(/[%,()]/g, ' ').trim();
  if (!v) return null;
  const like = `%${v}%`;
  return KANBAN_SEARCH_COLUMNS.map((col) => `${col}.ilike.${like}`).join(',');
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /Users/marios/Desktop/Projects/itdevcrm-main && npx vitest run src/features/sales`
Expected: PASS — all tests in `salesKanbanColumns.test.ts` (and the rest of the sales folder) green.

- [ ] **Step 5: Run the strict gate**

Run: `cd /Users/marios/Desktop/Projects/itdevcrm-main && npm run build`
Expected: exit 0 (tsc, eslint with zero warnings, vite build). If eslint complains about `satisfies readonly string[]`, drop the `satisfies …` part and keep `as const` — the tests only need `.map` and `.toContain`.

- [ ] **Step 6: Commit (only these two files)**

```bash
cd /Users/marios/Desktop/Projects/itdevcrm-main
git add src/features/sales/salesKanbanColumns.ts src/features/sales/salesKanbanColumns.test.ts
git commit -m "fix(sales): kanban search matches lead code (+ business profile, VAT)

Changes: searchOrClause now derives from KANBAN_SEARCH_COLUMNS, which adds
code / business_profile_name / vat_number. Covers the column query and the
lead page's Next-in-stage walker. Revert: git revert this commit."
```

---

### Task 2: `sales_kanban_counts` RPC searches the same columns (migration + pgTAP)

**Files:**
- Create: `supabase/migrations/20260828160000_sales_kanban_counts_search_code.sql`
- Create: `supabase/tests/sales_kanban_counts_search.sql`
- Reference (read only): `supabase/migrations/20260826120000_under_development_board.sql:44-80` (current function body), `supabase/tests/cash_charge_vat.sql` (pgTAP file shape)

**Interfaces:**
- Consumes: the column list `KANBAN_SEARCH_COLUMNS` from Task 1 (`title, company_name, contact_first_name, contact_last_name, email, phone, code, business_profile_name, vat_number`).
- Produces: the same function `public.sales_kanban_counts(p_owner uuid, p_source text, p_search text, p_board text) returns table(stage_id uuid, total bigint)` — identical signature, so `useSalesKanbanCounts.ts` and `src/types/supabase.ts` stay unchanged.

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/sales_kanban_counts_search.sql`:

```sql
-- supabase/tests/sales_kanban_counts_search.sql
-- Run with: supabase test db  (transactional; rolls back)
-- The kanban column totals must find a lead by its code / business profile /
-- VAT — the same columns the browser's searchOrClause() matches
-- (src/features/sales/salesKanbanColumns.ts KANBAN_SEARCH_COLUMNS).
begin;
select plan(5);

do $$
declare v_stage uuid;
begin
  select id into v_stage from public.pipeline_stages
   where board = 'sales' and code = 'new_lead' limit 1;
  perform set_config('t.stage', v_stage::text, true);

  insert into public.leads (title, source, stage_id, code, business_profile_name, vat_number)
  values ('TEST search by code', 'manual', v_stage, 'TSRCH1', 'Test Profile Zebra', 'EL999888777');
end $$;

select is(
  (select total from public.sales_kanban_counts(null, null, 'TSRCH1', 'sales')
    where stage_id = current_setting('t.stage')::uuid),
  1::bigint, 'search by full lead code counts the lead');

select is(
  (select total from public.sales_kanban_counts(null, null, 'srch', 'sales')
    where stage_id = current_setting('t.stage')::uuid),
  1::bigint, 'search by partial, case-insensitive code counts the lead');

select is(
  (select total from public.sales_kanban_counts(null, null, 'Zebra', 'sales')
    where stage_id = current_setting('t.stage')::uuid),
  1::bigint, 'search by business_profile_name counts the lead');

select is(
  (select total from public.sales_kanban_counts(null, null, 'EL999888777', 'sales')
    where stage_id = current_setting('t.stage')::uuid),
  1::bigint, 'search by vat_number counts the lead');

select is(
  (select coalesce((select total from public.sales_kanban_counts(null, null, 'NOPE-ZZZ-404', 'sales')
    where stage_id = current_setting('t.stage')::uuid), 0::bigint)),
  0::bigint, 'a term matching nothing counts nothing');

select * from finish();
rollback;
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/marios/Desktop/Projects/itdevcrm-main && supabase test db --help >/dev/null 2>&1 && supabase test db 2>&1 | grep -E "sales_kanban_counts_search|not ok|Result" | head -20`
Expected: the first four assertions are `not ok` (the current function only searches title/company/contact/email/phone; it returns no row for the stage, so `total` is NULL ≠ 1). The fifth passes.
If `supabase test db` needs a local stack that is not running (`supabase start` fails / Docker absent), note it in the task report and rely on Step 5's live check instead — do NOT skip Step 5 in that case.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260828160000_sales_kanban_counts_search_code.sql`:

```sql
-- 2026-08-28: Sales kanban search could not find a lead by its code.
-- Typing "006250" (the code printed on every card) into the board's search
-- box showed nothing: neither the browser's PostgREST or= clause
-- (src/features/sales/salesKanbanColumns.ts) nor this counts RPC matched
-- leads.code. The browser side is fixed in the same commit series; this
-- migration brings the column totals in line so headers and columns agree.
--
-- Column list MUST mirror KANBAN_SEARCH_COLUMNS in
-- src/features/sales/salesKanbanColumns.ts:
--   title, company_name, contact_first_name, contact_last_name, email, phone,
--   code, business_profile_name, vat_number
--
-- Base body: 20260826120000_under_development_board.sql (4-arg, p_board).
-- Same signature → no PostgREST overload ambiguity, no types:gen needed.

create or replace function public.sales_kanban_counts(
  p_owner uuid default null,
  p_source text default null,
  p_search text default null,
  p_board text default 'sales'
) returns table (stage_id uuid, total bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select l.stage_id, count(*)::bigint as total
  from public.leads l
  join public.pipeline_stages ps on ps.id = l.stage_id
  where not l.archived
    and ps.board = coalesce(p_board, 'sales')
    and (p_owner is null or l.owner_user_id = p_owner)
    and (p_source is null or l.source = p_source)
    and (
      p_search is null or p_search = ''
      or l.title ilike '%' || p_search || '%'
      or l.company_name ilike '%' || p_search || '%'
      or l.contact_first_name ilike '%' || p_search || '%'
      or l.contact_last_name ilike '%' || p_search || '%'
      or l.email ilike '%' || p_search || '%'
      or l.phone ilike '%' || p_search || '%'
      or l.code ilike '%' || p_search || '%'
      or l.business_profile_name ilike '%' || p_search || '%'
      or l.vat_number ilike '%' || p_search || '%'
    )
  group by l.stage_id;
$$;

grant execute on function public.sales_kanban_counts(uuid, text, text, text) to authenticated;

-- ROLLBACK:
-- Re-run section "2. Board-aware kanban counts" of
-- 20260826120000_under_development_board.sql (same signature, without the
-- code / business_profile_name / vat_number predicates).
```

- [ ] **Step 4: Run the pgTAP test to verify it passes (local stack)**

Run: `cd /Users/marios/Desktop/Projects/itdevcrm-main && supabase test db 2>&1 | grep -E "sales_kanban_counts_search|not ok|Result" | head -20`
Expected: all 5 assertions `ok`; no `not ok` lines for `sales_kanban_counts_search`.
(Skip only if Step 2 established the local stack is unavailable.)

- [ ] **Step 5: Apply to production via the Supabase MCP `apply_migration` tool, then verify live**

1. Call the Supabase MCP tool `apply_migration` with `name = "sales_kanban_counts_search_code"` and `query` = the full contents of the migration file from Step 3.
2. Verify with the Supabase MCP `execute_sql` tool (read-only SELECTs):

```sql
-- the function now mentions leads.code
select position('l.code ilike' in pg_get_functiondef('public.sales_kanban_counts(uuid,text,text,text)'::regprocedure)) > 0 as searches_code;
```
Expected: `searches_code = true`.

```sql
-- the user's reproduction: lead 006250 is counted in its stage
select c.stage_id, c.total, ps.code as stage_code
from public.sales_kanban_counts(null, null, '006250', 'sales') c
join public.pipeline_stages ps on ps.id = c.stage_id;
```
Expected: exactly one row with `total = 1` and the stage lead 006250 actually sits in (cross-check: `select stage_id, archived from public.leads where code = '006250';` — if that lead is `archived = true` or on another board, the empty result is correct; pick any non-archived sales lead's code instead and repeat).

3. Record the applied md5 in the migration header comment (house pattern, see `20260826120000`), by appending below the `-- Base body:` line:

```sql
-- LIVE DRIFT CHECK 2026-08-28 (md5(pg_get_functiondef)), APPLIED same day:
--   sales_kanban_counts    pre 1ff94f2748faf73e3d09204a3cd8f897 (= 20260826120000)
--                          post <paste result of the query below>
```
Query for the post md5: `select md5(pg_get_functiondef('public.sales_kanban_counts(uuid,text,text,text)'::regprocedure));`

- [ ] **Step 6: Confirm no type regen is needed**

Run: `cd /Users/marios/Desktop/Projects/itdevcrm-main && git status --porcelain src/types/supabase.ts`
Expected: no output (file unchanged — same RPC signature).

- [ ] **Step 7: Commit (only these two files)**

```bash
cd /Users/marios/Desktop/Projects/itdevcrm-main
git add supabase/migrations/20260828160000_sales_kanban_counts_search_code.sql supabase/tests/sales_kanban_counts_search.sql
git commit -m "fix(sales): kanban column counts search lead code (+ business profile, VAT)

Changes: sales_kanban_counts ilike list mirrors KANBAN_SEARCH_COLUMNS
(adds code / business_profile_name / vat_number). Applied to prod via MCP
apply_migration. Revert: re-apply section 2 of
20260826120000_under_development_board.sql."
```

---

### Task 3: End-to-end verification in the app + push

**Files:**
- Read only: `src/features/sales/SalesKanbanPage.tsx:237-243` (the search input), `src/features/under_development/UnderDevKanbanPage.tsx:91` (second board using the same RPC)

**Interfaces:**
- Consumes: Task 1 (browser clause) and Task 2 (RPC) both deployed/committed.
- Produces: nothing new — a verified, pushed fix.

- [ ] **Step 1: Run the full unit suite and the strict gate once more on the combined tree**

Run: `cd /Users/marios/Desktop/Projects/itdevcrm-main && npx vitest run && npm run build`
Expected: vitest all green; `npm run build` exit 0.

- [ ] **Step 2: Manual check in the browser (dev server against prod DB — the RPC was applied in Task 2)**

Run: `cd /Users/marios/Desktop/Projects/itdevcrm-main && npm run dev` (leave running; note the printed local URL).

Then, logged in as an admin (or as the lead's owner — RLS scopes non-admins to their own leads), open the Sales Pipeline page and check:

1. Type `006250` in the search box → the card with code `006250` appears in its column AND that column's header count reads `1` (or the number of leads matching); all other columns show `0`.
2. Type `6250` (no leading zeros) → the same card appears (partial `ilike` match).
3. Clear the search → all columns and counts return to their previous totals.
4. Open the found card, click "Next in stage" → it does not jump to an unrelated lead (the lead page walks the same filtered list; with one match it reports no next lead or stays on the same one — this is `pickNextId` returning `null` for a one-item list).
5. Open the Under Development board (route used by `UnderDevKanbanPage.tsx`) and search any of its test leads' codes → the header counts follow the search there too (same RPC with `p_board = 'under_development'`).

If step 1 shows the card but the header count stays `0` → the migration did not apply (redo Task 2 Step 5). If the header count is right but no card appears → Task 1's build is not what the dev server serves (restart `npm run dev`).

Stop the dev server when done (Ctrl+C).

- [ ] **Step 3: Rebase and push to main**

```bash
cd /Users/marios/Desktop/Projects/itdevcrm-main
git fetch origin && git rebase origin/main
git log --oneline origin/main..HEAD   # expect exactly the 2 commits from Tasks 1 and 2
git push origin main
```
Expected: push succeeds; Vercel auto-deploys `main`. Re-check item 1 of Step 2 on https://www.itdevcrm.com once the deploy is live.
