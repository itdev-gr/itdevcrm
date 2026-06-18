# Per-Job Unique Codes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every job its own unique, human-friendly code (`<dealcode>-<SERVICE>`, e.g. `000013-WEBSEO`), show it (copyable) on job cards and the job page, and make it searchable so the code jumps straight to that job.

**Architecture:** A Postgres `BEFORE INSERT` trigger generates each job's code from its deal code + a service abbreviation, adding `-2`/`-3` when a deal has multiple jobs of the same service. A migration backfills existing jobs and enforces uniqueness. `global_search` gains a `jobs` branch. The frontend swaps the deal code currently shown on cards/detail for `job.code`, and the global-search dropdown learns the `job` entity type.

**Tech Stack:** Postgres (Supabase migrations), React 19, react-router-dom v7, react-i18next, Vitest + jsdom.

---

## Background (verified)

- `public.jobs` already has a `code text` column, but today it just **mirrors the deal code** (every job of a deal shares it) — set via `code = d.code` in the job-creation RPCs.
- Cards (`JobsKanbanCard.tsx:47`) and the job page (`JobDetailPage.tsx:79`) currently show `job.deal?.code`, not `job.code`.
- `job.code` is already part of `JobRow` (`JobBase = Tables<'jobs'>['Row']`) and fetched via `select('*')` in `useJobs`/`useJob` — **no type/query change needed** to read it.
- Jobs are inserted **one row at a time** (`INSERT … VALUES` inside PL/pgSQL loops), so a trigger that scans existing jobs for a free suffix is race-safe (same-transaction rows are visible to later inserts).
- `global_search` (`20260503000002_global_search.sql`) is a `security invoker` SQL function `UNION`-ing leads/clients/deals; RLS naturally scopes job hits to what the user may see.
- Service types: `web_seo, local_seo, web_dev, social_media, hosting, ads, ai_seo`.
- Minor known effect: `assigned_tasks.source_code` denormalises a job's code at creation time; historical tasks keep the old (deal) value, new ones get the new job code. Out of scope to backfill.

---

## File Structure

- `supabase/migrations/20260618000012_job_unique_codes.sql` — abbr fn, code-gen fn, trigger, backfill, unique index, `global_search` jobs branch (new).
- `src/features/jobs/JobsKanbanCard.tsx` — show `job.code` instead of `job.deal.code` (modify).
- `src/features/jobs/JobDetailPage.tsx` — show `job.code` instead of `job.deal.code` (modify).
- `src/features/search/GlobalSearch.tsx` — add `job` entity type + `/jobs/:id` path + label (modify).
- `src/features/search/GlobalSearch.test.tsx` — test the job hit renders & links (new).

---

## Task 1: DB migration — job code generation, backfill, search

**Files:**
- Create: `supabase/migrations/20260618000012_job_unique_codes.sql`

- [ ] **Step 1: Write the migration**

```sql
-- =============================================================================
-- Per-job unique codes: <deal_code>-<SERVICE>[-N]  (e.g. 000013-WEBSEO,
-- second web_seo job on the same deal -> 000013-WEBSEO-2). Replaces the old
-- behaviour where every job inherited the deal code (non-unique). Also makes
-- jobs searchable by code via global_search.
-- =============================================================================

-- 1. Service-type -> short uppercase abbreviation.
create or replace function public.job_service_abbr(st text) returns text
language sql immutable as $$
  select case st
    when 'web_seo'      then 'WEBSEO'
    when 'local_seo'    then 'LOCALSEO'
    when 'web_dev'      then 'WEBDEV'
    when 'social_media' then 'SOCIAL'
    when 'hosting'      then 'HOSTING'
    when 'ads'          then 'ADS'
    when 'ai_seo'       then 'AISEO'
    else upper(regexp_replace(coalesce(st, 'JOB'), '[^a-zA-Z0-9]', '', 'g'))
  end;
$$;

-- 2. Generate a unique job code; add -2/-3/... when the deal already has a job
--    of the same service. Scans existing jobs (incl. same-transaction rows).
create or replace function public.generate_job_code(p_deal_id uuid, p_service_type text)
returns text language plpgsql as $$
declare
  v_deal_code text;
  v_base text;
  v_code text;
  n int := 2;
begin
  select code into v_deal_code from public.deals where id = p_deal_id;
  v_base := coalesce(nullif(trim(coalesce(v_deal_code, '')), ''), 'JOB')
            || '-' || public.job_service_abbr(p_service_type);
  if not exists (select 1 from public.jobs where code = v_base) then
    return v_base;
  end if;
  loop
    v_code := v_base || '-' || n;
    exit when not exists (select 1 from public.jobs where code = v_code);
    n := n + 1;
  end loop;
  return v_code;
end;
$$;

-- 3. Trigger: every new job gets a generated unique code (overrides whatever the
--    creating RPC passed, so all job-creation paths stay consistent).
create or replace function public.set_job_code() returns trigger
language plpgsql as $$
begin
  new.code := public.generate_job_code(new.deal_id, new.service_type);
  return new;
end;
$$;

drop trigger if exists jobs_set_code on public.jobs;
create trigger jobs_set_code
  before insert on public.jobs
  for each row execute function public.set_job_code();

-- 4. Backfill existing jobs. Partition by the *coalesced deal code* so that two
--    deals with no code (-> 'JOB') still get globally-unique strings.
with ranked as (
  select j.id,
         coalesce(nullif(trim(coalesce(d.code, '')), ''), 'JOB') as deal_code,
         j.service_type,
         row_number() over (
           partition by coalesce(nullif(trim(coalesce(d.code, '')), ''), 'JOB'), j.service_type
           order by j.created_at, j.id
         ) as rn
  from public.jobs j
  join public.deals d on d.id = j.deal_id
)
update public.jobs j
set code = r.deal_code || '-' || public.job_service_abbr(r.service_type)
           || case when r.rn = 1 then '' else '-' || r.rn end
from ranked r
where j.id = r.id;

-- 5. Enforce uniqueness now that codes are distinct.
drop index if exists public.jobs_code;
create unique index jobs_code_unique on public.jobs (code) where code is not null;

-- 6. Extend global_search with a jobs branch (full re-create; identical to
--    20260503000002 plus the jobs union).
create or replace function public.global_search(q text, max_rows int default 20)
returns table (
  entity_type text, entity_id uuid, code text, label text, sublabel text, rank int
)
language sql stable security invoker as $$
  with norm as (select lower(trim(q)) as qn),
  hits as (
    select 'lead'::text as entity_type, l.id as entity_id, l.code,
      coalesce(nullif(trim(coalesce(l.contact_first_name,'')||' '||coalesce(l.contact_last_name,'')),''),
               l.company_name, l.title) as label,
      coalesce(l.company_name, l.email, l.phone, l.industry) as sublabel,
      case when l.code = (select qn from norm) then 0 else 2 end as rank,
      l.updated_at as updated_at
    from public.leads l, norm
    where l.archived = false and (
      l.code ilike '%'||norm.qn||'%'
      or lower(coalesce(l.title,'')) like '%'||norm.qn||'%'
      or lower(coalesce(l.contact_first_name,'')) like '%'||norm.qn||'%'
      or lower(coalesce(l.contact_last_name,'')) like '%'||norm.qn||'%'
      or lower(coalesce(l.email,'')) like '%'||norm.qn||'%'
      or lower(coalesce(l.phone,'')) like '%'||norm.qn||'%'
      or lower(coalesce(l.company_name,'')) like '%'||norm.qn||'%'
      or lower(coalesce(l.industry,'')) like '%'||norm.qn||'%'
      or lower(coalesce(l.country,'')) like '%'||norm.qn||'%'
      or lower(coalesce(l.address,'')) like '%'||norm.qn||'%'
      or lower(coalesce(l.vat_number,'')) like '%'||norm.qn||'%'
      or lower(coalesce(l.notes,'')) like '%'||norm.qn||'%'
      or lower(coalesce(l.additional_notes,'')) like '%'||norm.qn||'%'
      or lower(coalesce(l.website,'')) like '%'||norm.qn||'%')

    union all

    select 'client'::text, c.id, c.code,
      coalesce(c.name, c.email, c.phone) as label,
      coalesce(c.industry, c.email, c.phone) as sublabel,
      case when c.code = (select qn from norm) then 0 else 1 end as rank,
      c.updated_at
    from public.clients c, norm
    where c.archived = false and (
      coalesce(c.code,'') ilike '%'||norm.qn||'%'
      or lower(coalesce(c.name,'')) like '%'||norm.qn||'%'
      or lower(coalesce(c.contact_first_name,'')) like '%'||norm.qn||'%'
      or lower(coalesce(c.contact_last_name,'')) like '%'||norm.qn||'%'
      or lower(coalesce(c.email,'')) like '%'||norm.qn||'%'
      or lower(coalesce(c.phone,'')) like '%'||norm.qn||'%'
      or lower(coalesce(c.industry,'')) like '%'||norm.qn||'%'
      or lower(coalesce(c.country,'')) like '%'||norm.qn||'%'
      or lower(coalesce(c.address,'')) like '%'||norm.qn||'%'
      or lower(coalesce(c.vat_number,'')) like '%'||norm.qn||'%'
      or lower(coalesce(c.website,'')) like '%'||norm.qn||'%')

    union all

    select 'deal'::text, d.id, d.code, d.title,
      coalesce(d.description,'') as sublabel,
      case when d.code = (select qn from norm) then 0 else 1 end as rank,
      d.updated_at
    from public.deals d, norm
    where d.archived = false and (
      coalesce(d.code,'') ilike '%'||norm.qn||'%'
      or lower(coalesce(d.title,'')) like '%'||norm.qn||'%'
      or lower(coalesce(d.description,'')) like '%'||norm.qn||'%')

    union all

    -- Jobs (new)
    select 'job'::text, j.id, j.code,
      coalesce(jc.name, j.title) as label,
      coalesce(j.service_type,'')
        || case when jd.code is not null then ' · ' || jd.code else '' end as sublabel,
      case when j.code = (select qn from norm) then 0 else 1 end as rank,
      j.updated_at
    from public.jobs j
    left join public.clients jc on jc.id = j.client_id
    left join public.deals jd on jd.id = j.deal_id, norm
    where j.archived = false and (
      coalesce(j.code,'') ilike '%'||norm.qn||'%'
      or lower(coalesce(j.title,'')) like '%'||norm.qn||'%'
      or lower(coalesce(j.service_type,'')) like '%'||norm.qn||'%')
  )
  select entity_type, entity_id, code, label, sublabel, rank
  from hits
  order by rank asc, updated_at desc
  limit max_rows;
$$;

grant execute on function public.global_search(text, int) to authenticated;

-- ROLLBACK (manual):
--   drop trigger if exists jobs_set_code on public.jobs;
--   drop function if exists public.set_job_code();
--   drop function if exists public.generate_job_code(uuid, text);
--   drop function if exists public.job_service_abbr(text);
--   drop index if exists public.jobs_code_unique;
--   create index if not exists jobs_code on public.jobs (code) where code is not null;
--   update public.jobs j set code = d.code from public.deals d where d.id = j.deal_id;
--   -- re-apply 20260503000002_global_search.sql to drop the jobs branch.
```

- [ ] **Step 2: Apply to the database**

Apply via the Supabase MCP `apply_migration` tool (name `job_unique_codes`), or paste into the SQL editor. (Project: `xujlrclyzxrvxszepquy`.)

- [ ] **Step 3: Verify in the database**

Run these `select`s (SQL editor or `execute_sql`) and confirm:
```sql
-- a) every job now has a code, all unique
select count(*) total, count(distinct code) distinct_codes, count(*) filter (where code is null) nulls from public.jobs;
-- expect: total == distinct_codes (+nulls 0)
-- b) format sample
select code, service_type from public.jobs order by created_at desc limit 10;
-- expect codes like 000013-WEBSEO
-- c) suffix works: a deal with 2 same-service jobs (if any)
select deal_id, service_type, count(*), array_agg(code) from public.jobs group by 1,2 having count(*) > 1 limit 5;
-- expect codes differ by -2/-3
-- d) new-insert trigger: search is in next task
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260618000012_job_unique_codes.sql
git commit -m "feat(jobs): unique per-job codes (deal+service) + searchable"
```

---

## Task 2: Frontend — show the job code on cards and the job page

**Files:**
- Modify: `src/features/jobs/JobsKanbanCard.tsx:47`
- Modify: `src/features/jobs/JobDetailPage.tsx:79`

- [ ] **Step 1: Card — swap deal code for job code**

In `src/features/jobs/JobsKanbanCard.tsx`, change:
```tsx
              {job.deal?.code && <CopyableCode code={job.deal.code} className="text-[10px]" />}
```
to:
```tsx
              {job.code && <CopyableCode code={job.code} className="text-[10px]" />}
```

- [ ] **Step 2: Job page — swap deal code for job code**

In `src/features/jobs/JobDetailPage.tsx`, change:
```tsx
            {job.deal?.code && <CopyableCode code={job.deal.code} className="text-xs" />}
```
to:
```tsx
            {job.code && <CopyableCode code={job.code} className="text-xs" />}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS (`job.code` is already on `JobRow`).

- [ ] **Step 4: Commit**

```bash
git add src/features/jobs/JobsKanbanCard.tsx src/features/jobs/JobDetailPage.tsx
git commit -m "feat(jobs): show the job's own code on cards and detail"
```

---

## Task 3: Frontend — global search supports jobs (TDD)

**Files:**
- Test: `src/features/search/GlobalSearch.test.tsx` (create)
- Modify: `src/features/search/GlobalSearch.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/lib/i18n';
import { GlobalSearch } from './GlobalSearch';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc } }));

function wrap() {
  const qc = new QueryClient();
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <GlobalSearch />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('GlobalSearch job hits', () => {
  it('renders a job hit that links to /jobs/:id', async () => {
    rpc.mockResolvedValue({
      data: [
        {
          entity_type: 'job',
          entity_id: 'job-1',
          code: '000013-WEBSEO',
          label: 'Acme Ltd',
          sublabel: 'web_seo · 000013',
          rank: 0,
        },
      ],
      error: null,
    });
    render(wrap());
    await userEvent.type(screen.getByRole('textbox'), '000013-WEBSEO');
    const link = await screen.findByRole('link', { name: /000013-WEBSEO/ });
    expect(link).toHaveAttribute('href', '/jobs/job-1');
    expect(screen.getByText('Job')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `npm run test:run -- src/features/search/GlobalSearch.test.tsx`
Expected: FAIL — `job` is not a known entity type, so no `/jobs/...` link renders.

- [ ] **Step 3: Add the `job` entity type**

In `src/features/search/GlobalSearch.tsx`:

Change the `Hit` type:
```tsx
type Hit = {
  entity_type: 'lead' | 'client' | 'deal' | 'job';
  entity_id: string;
  code: string | null;
  label: string | null;
  sublabel: string | null;
  rank: number;
};
```
Add to `PATH_BY_TYPE`:
```tsx
  job: (id) => `/jobs/${id}`,
```
Add to `TYPE_LABEL`:
```tsx
  job: 'Job',
```

- [ ] **Step 4: Run it, expect PASS**

Run: `npm run test:run -- src/features/search/GlobalSearch.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/search/GlobalSearch.tsx src/features/search/GlobalSearch.test.tsx
git commit -m "feat(search): job results jump to the job page"
```

---

## Task 4: Verify end-to-end

**Files:** none (verification only)

- [ ] **Step 1: Typecheck + lint + tests**

Run: `npm run typecheck && npm run lint && npm run test:run`
Expected: green (ignore the pre-existing Deno `supabase/functions/send-email/templates.test.ts`).

- [ ] **Step 2: Browser (Playwright), logged in as an admin**

- Open a tech board (e.g. `/tech/web-seo`): each card shows a code like `000013-WEBSEO`; clicking it copies (shows ✓).
- Open a job page: same code shown top-left, copyable.
- Type the copied code into the global search: a **Job** result appears; selecting it navigates to `/jobs/:id`.
- Create/win a deal with two of the same service (if feasible) and confirm the second job's code ends `-2`.

---

## Changes / Revert

- DB: new functions `job_service_abbr`, `generate_job_code`, `set_job_code`; trigger `jobs_set_code`; unique index `jobs_code_unique`; `global_search` gains a jobs branch; existing `jobs.code` values rewritten. Rollback SQL is in the migration footer.
- Frontend: cards/detail show `job.code` instead of `job.deal.code`; global search learns the `job` type. Revert = restore the two `job.deal.code` lines and remove the `job` entries from `GlobalSearch.tsx` + delete the test.
- Known minor effect: `assigned_tasks.source_code` for historical job-tasks keeps the old (deal) code; not backfilled.

## Self-Review

- **Spec coverage:** unique per-job code (Task 1), shown & copyable on cards + detail (Task 2), searchable jumping to the job (Tasks 1 §6 + 3). ✓
- **Format decision** `<dealcode>-<SERVICE>[-N]` implemented in `job_service_abbr` + `generate_job_code` + backfill. ✓
- **No placeholders**; all SQL/TSX shown in full. ✓
- **Type consistency:** `job.code` already on `JobRow`; `Hit.entity_type` adds `'job'` used consistently in `PATH_BY_TYPE`/`TYPE_LABEL`. ✓
