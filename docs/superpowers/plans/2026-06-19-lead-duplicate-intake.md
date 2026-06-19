# Lead Duplicate Intake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hold incoming Zapier/Meta leads whose email or phone already exists (on another lead, or on a client that has a deal) in a review queue instead of inserting them onto the sales board; let an admin Release or Discard each.

**Architecture:** A new `lead_intake` table holds matched leads. The webhook (`api/meta-lead.ts`) calls a `find_lead_duplicates()` SQL function: clean → existing `leads` insert (unchanged); duplicate → `lead_intake` row (no welcome email, no board entry). A new admin-only `/sales/lead-intake` page lists pending rows with match badges and Release/Discard actions backed by `release_lead_intake()` / `discard_lead_intake()` RPCs.

**Tech Stack:** Postgres (Supabase) migrations + RPCs, Vercel serverless TS (`api/`), React + Vite + TanStack Query + react-router, vitest + @testing-library/react, i18next.

**Supersedes spec on one point:** the spec said reviewers = admins + sales manager. This plan scopes reviewers to **admins only** (mkifokeris is an admin, so the real intake owner is covered) for a simpler, internally-consistent implementation. To broaden later: change `current_user_is_admin()` → `current_user_can('sales','view_all')` in the RLS policy + both RPCs, and add a `view_all` flag to the auth store for nav gating.

**Prod note:** the Supabase CLI in this environment is logged out. Apply the migration and regenerate types via the **Supabase MCP** (`apply_migration`, `generate_typescript_types`) on project `xujlrclyzxrvxszepquy`, not the CLI.

---

## File Structure

- **Create** `supabase/migrations/20260619160000_lead_intake.sql` — table, indexes, `find_lead_duplicates`, `release_lead_intake`, `discard_lead_intake`, RLS, grants, ROLLBACK.
- **Modify** `api/meta-lead.ts` — extend retry-dedup to the queue; duplicate guard before the `leads` insert.
- **Modify** `src/lib/rpc.ts` — `releaseLeadIntake`, `discardLeadIntake` wrappers.
- **Create** `src/features/leads/hooks/useLeadIntake.ts` — pending-list query + `useLeadIntakeCount`.
- **Create** `src/features/leads/hooks/useLeadIntake.test.tsx` — hook test.
- **Create** `src/features/leads/hooks/useReleaseLeadIntake.ts`, `useDiscardLeadIntake.ts` — mutation hooks.
- **Create** `src/features/leads/LeadIntakePage.tsx` — review page.
- **Create** `src/features/leads/LeadIntakePage.test.tsx` — component test.
- **Modify** `src/app/router.tsx` — lazy import + `sales/lead-intake` route (AdminGuard).
- **Modify** `src/components/layout/Sidebar.tsx` — admin-only nav link + count badge.
- **Modify** `src/i18n/locales/en/leads.json`, `src/i18n/locales/el/leads.json` — `intake.*` keys.
- **Regenerate** `src/types/supabase.ts` — after the migration.

Auth helpers already in DB: `public.current_user_is_admin()`. RPC result convention: `{ ok: true, ... } | { ok: false, errors: string[] }` (see `delete_jobs`). Frontend RPCs not in generated types call through the loose `rpcCall` in `src/lib/rpc.ts`.

---

## Task 1: `lead_intake` table + duplicate function + RPCs (migration)

**Files:**
- Create: `supabase/migrations/20260619160000_lead_intake.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- Lead duplicate intake. Zapier/Meta leads whose email or normalized phone already
-- exists (on another lead, or on a client that has >=1 deal) are held here for review
-- instead of being inserted into `leads`. Clean leads are unaffected. Admins Release a
-- held row into `leads` (its normal default-stage + welcome-email path) or Discard it
-- (kept as an audit row). Writers: api/meta-lead.ts (service role) + the RPCs below.
-- UI: src/features/leads/LeadIntakePage.tsx via src/lib/rpc.ts.

create table if not exists public.lead_intake (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  status text not null default 'pending'
    check (status in ('pending','released','discarded')),
  source text not null default 'meta',
  source_data jsonb,
  title text,
  contact_first_name text,
  contact_last_name text,
  email text,
  phone text,
  phone_normalized text,
  website text,
  company_name text,
  contact_info text,
  matched_on text[] not null default '{}',
  matches jsonb not null default '[]'::jsonb,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  released_lead_id uuid references public.leads(id) on delete set null
);

create index if not exists lead_intake_pending_idx
  on public.lead_intake (created_at desc) where status = 'pending';
create index if not exists lead_intake_leadgen_idx
  on public.lead_intake ((source_data->>'leadgen_id'));

-- The rule: return every existing lead and deal-client that matches the given email
-- (case-insensitive) or normalized phone (last 10 digits). Used by the webhook + UI.
create or replace function public.find_lead_duplicates(p_email text, p_phone text)
returns table (
  match_type text,     -- 'lead' | 'deal_client'
  record_id uuid,
  display_name text,
  context text,        -- matched lead's stage (en) | client's deal code(s)
  matched_field text   -- 'email' | 'phone'
)
language sql
stable
security definer
set search_path = public
as $$
  with norm as (
    select
      nullif(lower(trim(coalesce(p_email,''))), '') as email,
      case
        when length(regexp_replace(coalesce(p_phone,''), '[^0-9]', '', 'g')) >= 10
          then right(regexp_replace(coalesce(p_phone,''), '[^0-9]', '', 'g'), 10)
        else null
      end as phone
  )
  select 'lead'::text, l.id,
         coalesce(
           nullif(trim(coalesce(l.contact_first_name,'') || ' ' || coalesce(l.contact_last_name,'')), ''),
           l.company_name, l.email, 'lead'),
         coalesce(ps.display_names->>'en', ps.code),
         case when n.email is not null and lower(trim(l.email)) = n.email then 'email' else 'phone' end
  from public.leads l
  left join public.pipeline_stages ps on ps.id = l.stage_id
  cross join norm n
  where (n.email is not null and lower(trim(l.email)) = n.email)
     or (n.phone is not null and l.phone_normalized = n.phone)

  union all

  select 'deal_client'::text, c.id,
         coalesce(c.name, c.email, 'client'),
         (select string_agg(d.code, ', ') from public.deals d where d.client_id = c.id),
         case when n.email is not null and lower(trim(c.email)) = n.email then 'email' else 'phone' end
  from public.clients c
  cross join norm n
  where exists (select 1 from public.deals d where d.client_id = c.id)
    and ((n.email is not null and lower(trim(c.email)) = n.email)
      or (n.phone is not null and c.phone_normalized = n.phone));
$$;

grant execute on function public.find_lead_duplicates(text, text) to authenticated, service_role;

-- Release a held row into `leads` (normal triggers fire: default stage = unique_lead,
-- welcome email queued). Admin-only.
create or replace function public.release_lead_intake(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.lead_intake;
  v_lead_id uuid;
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

  insert into public.leads (
    source, source_data, title, contact_first_name, contact_last_name,
    email, phone, website, company_name, contact_info
  ) values (
    r.source, r.source_data, r.title, r.contact_first_name, r.contact_last_name,
    r.email, r.phone, r.website, r.company_name, r.contact_info
  )
  returning id into v_lead_id;

  update public.lead_intake
     set status = 'released', released_lead_id = v_lead_id,
         reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_id;

  return jsonb_build_object('ok', true, 'lead_id', v_lead_id);
end;
$$;

grant execute on function public.release_lead_intake(uuid) to authenticated;

-- Discard a held row (audit only; never reaches `leads`). Admin-only.
create or replace function public.discard_lead_intake(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if not public.current_user_is_admin() then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array('not_authorized'));
  end if;
  select status into v_status from public.lead_intake where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array('not_found'));
  end if;
  if v_status <> 'pending' then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array('already_' || v_status));
  end if;
  update public.lead_intake
     set status = 'discarded', reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.discard_lead_intake(uuid) to authenticated;

-- RLS: only admins can read the queue. Writes happen via service_role (webhook,
-- bypasses RLS) and the SECURITY DEFINER RPCs above, so no write policies exist.
alter table public.lead_intake enable row level security;
grant select on public.lead_intake to authenticated;
grant all on public.lead_intake to service_role;

create policy lead_intake_select_admin on public.lead_intake
  for select to authenticated
  using (public.current_user_is_admin());

-- ROLLBACK:
-- drop policy if exists lead_intake_select_admin on public.lead_intake;
-- drop function if exists public.discard_lead_intake(uuid);
-- drop function if exists public.release_lead_intake(uuid);
-- drop function if exists public.find_lead_duplicates(text, text);
-- drop table if exists public.lead_intake;
```

- [ ] **Step 2: Apply the migration to the project (via Supabase MCP)**

Use the Supabase MCP `apply_migration` tool with `project_id: xujlrclyzxrvxszepquy`, `name: lead_intake`, and the SQL body above. (The CLI is logged out; do not use `supabase db push`.)
Expected: success, no error.

- [ ] **Step 3: Verify the table + function exist**

Run via MCP `execute_sql` (project `xujlrclyzxrvxszepquy`):
```sql
select to_regclass('public.lead_intake') as tbl,
       (select count(*) from pg_proc where proname in
        ('find_lead_duplicates','release_lead_intake','discard_lead_intake')) as fns;
```
Expected: `tbl = lead_intake`, `fns = 3`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260619160000_lead_intake.sql
git commit -m "feat(leads): lead_intake table + find_lead_duplicates + release/discard RPCs"
```

---

## Task 2: Verify the duplicate rule against real data

This is the SQL equivalent of a unit test — the repo has no pgTAP harness, so we assert behaviour with `execute_sql` against seeded/known rows.

**Files:** none (verification only, via Supabase MCP `execute_sql`, project `xujlrclyzxrvxszepquy`).

- [ ] **Step 1: Seed a temporary lead + a client-with-deal to match against**

```sql
-- temp lead with a known email/phone
insert into public.leads (source, title, email, phone)
values ('manual','DUPCHECK temp lead','dupcheck@example.com','+30 6900000001')
returning id;
-- NOTE the returned id as <LEAD_ID>. phone_normalized is auto-populated.
```

- [ ] **Step 2: Email match returns the lead**

```sql
select match_type, matched_field, display_name
from public.find_lead_duplicates('DUPCHECK@example.com', null);
```
Expected: at least one row, `match_type='lead'`, `matched_field='email'`.

- [ ] **Step 3: Phone match returns the lead (different formatting)**

```sql
select match_type, matched_field
from public.find_lead_duplicates(null, '00306900000001');
```
Expected: a `lead` row with `matched_field='phone'` (last-10-digit match ignores `+30`/`0030`).

- [ ] **Step 4: No-match returns nothing; blank inputs return nothing**

```sql
select count(*) as n_unknown from public.find_lead_duplicates('nobody@nowhere.test','+1 555 000 9999');
select count(*) as n_blank   from public.find_lead_duplicates('', '');
```
Expected: `n_unknown = 0` and `n_blank = 0`.

- [ ] **Step 5: A client WITHOUT a deal does NOT match; clean up the temp lead**

```sql
-- pick an existing client that has no deal, read its email
select c.id, c.email, c.phone_normalized from public.clients c
where not exists (select 1 from public.deals d where d.client_id = c.id)
  and c.email is not null limit 1;
-- call find_lead_duplicates with that email -> expect 0 'deal_client' rows
-- (it may still match a lead with the same email; assert no match_type='deal_client').

-- cleanup
delete from public.leads where email = 'dupcheck@example.com' and title = 'DUPCHECK temp lead';
```
Expected: no `deal_client` row for a dealless client; cleanup deletes the temp lead.

- [ ] **Step 6: No commit** (verification only).

---

## Task 3: Webhook duplicate guard (`api/meta-lead.ts`)

**Files:**
- Modify: `api/meta-lead.ts` (retry-dedup block ~lines 108-118; duplicate guard inserted after `title` is computed ~line 121, before the `leads` insert ~line 123)

- [ ] **Step 1: Extend the leadgen retry-dedup to also check the queue**

Replace the existing `if (leadgenId) { ... }` dedup block with:

```ts
  // Dedup on the Meta lead id stored in source_data. Retries return the existing
  // record — whether it landed in `leads` (clean) or `lead_intake` (held duplicate).
  if (leadgenId) {
    const { data: existing } = await admin
      .from('leads')
      .select('id')
      .eq('source_data->>leadgen_id', leadgenId)
      .limit(1);
    if (existing && existing.length > 0) {
      res.status(200).json({ ok: true, deduped: true, lead_id: existing[0].id });
      return;
    }
    const { data: held } = await admin
      .from('lead_intake')
      .select('id')
      .eq('source_data->>leadgen_id', leadgenId)
      .limit(1);
    if (held && held.length > 0) {
      res.status(200).json({ ok: true, deduped: true, held: true, intake_id: held[0].id });
      return;
    }
  }
```

- [ ] **Step 2: Insert the duplicate guard before the `leads` insert**

Immediately after the existing lines:
```ts
  const { first, last } = splitFullName(fullName ?? '');
  const title = (formName ?? 'Meta lead').slice(0, 200);
```
insert:

```ts
  // ---- Duplicate guard -----------------------------------------------------
  // Hold leads whose email or phone already exists (on another lead, or on a
  // client that has a deal) in `lead_intake` for review, instead of inserting
  // into `leads` (which would queue a welcome email + round-robin assign an
  // unreviewed contact). Clean leads fall through to the normal insert.
  const phoneDigits = (phone ?? '').replace(/\D/g, '');
  const phoneNorm = phoneDigits.length >= 10 ? phoneDigits.slice(-10) : null;

  const { data: dupRows } = await admin.rpc('find_lead_duplicates', {
    p_email: email,
    p_phone: phone,
  });
  const matches = (dupRows ?? []) as Array<{
    match_type: string;
    record_id: string;
    display_name: string;
    context: string | null;
    matched_field: string;
  }>;

  if (matches.length > 0) {
    const matchedOn = Array.from(new Set(matches.map((m) => m.matched_field)));
    const { data: intake, error: intakeErr } = await admin
      .from('lead_intake')
      .insert({
        source: 'meta',
        source_data: payload,
        title,
        contact_first_name: first,
        contact_last_name: last,
        email,
        phone,
        phone_normalized: phoneNorm,
        website,
        company_name: company,
        contact_info: notes,
        matched_on: matchedOn,
        matches,
      })
      .select('id')
      .single();
    if (intakeErr || !intake) {
      res.status(500).json({ error: intakeErr?.message ?? 'intake_failed' });
      return;
    }
    res.status(200).json({ ok: true, held: true, intake_id: intake.id });
    return;
  }
```

(The existing `leads` insert below stays exactly as-is and runs only for clean leads.)

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors. (`admin.rpc(...)`/`admin.from('lead_intake')` resolve once types are regenerated in Task 7; if typecheck runs before that, cast is unnecessary because supabase-js `.rpc` accepts any string — confirm no error, else regenerate types first.)

- [ ] **Step 4: Commit**

```bash
git add api/meta-lead.ts
git commit -m "feat(leads): hold duplicate Meta leads in lead_intake queue"
```

- [ ] **Step 5: Deploy + live verification (after Task 1 is applied to prod)**

The handler reads the DB at runtime; deploy via `npx vercel redeploy <latest prod deployment url>` (or push to main). Then verify against `https://www.itdevcrm.com`:

```bash
# clean lead (unique email/phone) -> created in leads
curl -s -X POST "https://www.itdevcrm.com/api/meta-lead?key=$META_LEAD_SECRET" \
  -H 'Content-Type: application/json' \
  -d '{"leadgen_id":"DUP-CLEAN-DELETEME","full_name":"Clean Test","email":"clean-uniq-deleteme@example.com","phone":"+30 6900000777"}'
# expect {"ok":true,"lead_id":"..."}

# duplicate of the just-created lead -> held in intake
curl -s -X POST "https://www.itdevcrm.com/api/meta-lead?key=$META_LEAD_SECRET" \
  -H 'Content-Type: application/json' \
  -d '{"leadgen_id":"DUP-HELD-DELETEME","full_name":"Dup Test","email":"clean-uniq-deleteme@example.com"}'
# expect {"ok":true,"held":true,"intake_id":"..."}
```
`$META_LEAD_SECRET` is the Vercel/Zapier key (do not paste the literal value into the repo).
Then clean up via MCP `execute_sql`:
```sql
delete from public.lead_intake where source_data->>'leadgen_id' in ('DUP-HELD-DELETEME');
delete from public.leads where source_data->>'leadgen_id' in ('DUP-CLEAN-DELETEME');
```
Expected: first call creates a lead, second is held, cleanup removes both.

---

## Task 4: Regenerate Supabase types

**Files:**
- Modify: `src/types/supabase.ts`

- [ ] **Step 1: Generate types (via Supabase MCP)**

Use the Supabase MCP `generate_typescript_types` tool (project `xujlrclyzxrvxszepquy`) and write the result to `src/types/supabase.ts`. (CLI `npm run types:gen` needs `supabase login`, which is unavailable here.)

- [ ] **Step 2: Confirm `lead_intake` is present**

Run: `grep -c "lead_intake" src/types/supabase.ts`
Expected: ≥ 1.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/types/supabase.ts
git commit -m "chore(types): regenerate supabase types for lead_intake"
```

---

## Task 5: RPC wrappers (`src/lib/rpc.ts`)

**Files:**
- Modify: `src/lib/rpc.ts` (append after `closeDeal`)

- [ ] **Step 1: Append the wrappers**

```ts
// --- Lead intake (duplicate review) ------------------------------------------
export type LeadIntakeActionResult =
  | { ok: true; lead_id?: string }
  | { ok: false; errors: string[] };

// Admin-only. Release moves a held duplicate into `leads`; discard marks it
// discarded. Both go through the loose `rpcCall` (not in generated types).
export async function releaseLeadIntake(id: string): Promise<LeadIntakeActionResult> {
  const { data, error } = await rpcCall('release_lead_intake', { p_id: id });
  if (error) return { ok: false, errors: [error.message] };
  const r = data as { ok: boolean; lead_id?: string; errors?: string[] };
  if (!r.ok) return { ok: false, errors: r.errors ?? ['release_failed'] };
  return { ok: true, lead_id: r.lead_id };
}

export async function discardLeadIntake(id: string): Promise<LeadIntakeActionResult> {
  const { data, error } = await rpcCall('discard_lead_intake', { p_id: id });
  if (error) return { ok: false, errors: [error.message] };
  const r = data as { ok: boolean; errors?: string[] };
  if (!r.ok) return { ok: false, errors: r.errors ?? ['discard_failed'] };
  return { ok: true };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/rpc.ts
git commit -m "feat(leads): releaseLeadIntake/discardLeadIntake rpc wrappers"
```

---

## Task 6: `useLeadIntake` query hook (+ count) with test

**Files:**
- Create: `src/features/leads/hooks/useLeadIntake.ts`
- Test: `src/features/leads/hooks/useLeadIntake.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const { order, eq, select, from } = vi.hoisted(() => {
  const order = vi.fn();
  const eq = vi.fn();
  const chain: Record<string, unknown> = { eq, order };
  eq.mockReturnValue(chain);
  const select = vi.fn().mockReturnValue(chain);
  const from = vi.fn().mockReturnValue({ select });
  return { order, eq, select, from };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from } }));

import { useLeadIntake } from './useLeadIntake';

function wrap(c: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{c}</QueryClientProvider>;
}

describe('useLeadIntake', () => {
  beforeEach(() => vi.clearAllMocks());

  it('queries pending rows newest-first', async () => {
    order.mockResolvedValue({
      data: [{ id: 'i1', status: 'pending', email: 'a@b.gr', matched_on: ['email'], matches: [] }],
      error: null,
    });
    const { result } = renderHook(() => useLeadIntake(), {
      wrapper: ({ children }) => wrap(children),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(from).toHaveBeenCalledWith('lead_intake');
    expect(eq).toHaveBeenCalledWith('status', 'pending');
    expect(order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(result.current.data?.[0]?.id).toBe('i1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/features/leads/hooks/useLeadIntake.test.tsx`
Expected: FAIL — cannot resolve `./useLeadIntake`.

- [ ] **Step 3: Write the hook**

```ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/supabase';

export type LeadIntakeMatch = {
  match_type: 'lead' | 'deal_client';
  record_id: string;
  display_name: string;
  context: string | null;
  matched_field: 'email' | 'phone';
};

export type LeadIntakeRow = Database['public']['Tables']['lead_intake']['Row'];

export function useLeadIntake() {
  return useQuery({
    queryKey: ['lead_intake', 'pending'],
    queryFn: async (): Promise<LeadIntakeRow[]> => {
      const { data, error } = await supabase
        .from('lead_intake')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as LeadIntakeRow[];
    },
  });
}

export function useLeadIntakeCount() {
  return useQuery({
    queryKey: ['lead_intake', 'count'],
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase
        .from('lead_intake')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending');
      if (error) throw new Error(error.message);
      return count ?? 0;
    },
    refetchInterval: 60_000,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/features/leads/hooks/useLeadIntake.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/leads/hooks/useLeadIntake.ts src/features/leads/hooks/useLeadIntake.test.tsx
git commit -m "feat(leads): useLeadIntake pending-queue hook"
```

---

## Task 7: Mutation hooks (release / discard)

**Files:**
- Create: `src/features/leads/hooks/useReleaseLeadIntake.ts`
- Create: `src/features/leads/hooks/useDiscardLeadIntake.ts`

- [ ] **Step 1: Write `useReleaseLeadIntake`**

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { releaseLeadIntake } from '@/lib/rpc';
import { captureMutation } from '@/lib/sentry/captureMutation';

export function useReleaseLeadIntake() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: captureMutation('lead_intake', 'release', async (id: string) => {
      const r = await releaseLeadIntake(id);
      if (!r.ok) throw new Error(r.errors.join(', '));
      return r;
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['lead_intake'] });
      void qc.invalidateQueries({ queryKey: ['leads'] });
    },
  });
}
```

- [ ] **Step 2: Write `useDiscardLeadIntake`**

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { discardLeadIntake } from '@/lib/rpc';
import { captureMutation } from '@/lib/sentry/captureMutation';

export function useDiscardLeadIntake() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: captureMutation('lead_intake', 'discard', async (id: string) => {
      const r = await discardLeadIntake(id);
      if (!r.ok) throw new Error(r.errors.join(', '));
      return r;
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['lead_intake'] });
    },
  });
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors. (Confirm `@/lib/sentry/captureMutation` import path matches `useDeleteJobs.ts`.)

- [ ] **Step 4: Commit**

```bash
git add src/features/leads/hooks/useReleaseLeadIntake.ts src/features/leads/hooks/useDiscardLeadIntake.ts
git commit -m "feat(leads): release/discard lead-intake mutation hooks"
```

---

## Task 8: i18n keys

**Files:**
- Modify: `src/i18n/locales/en/leads.json`
- Modify: `src/i18n/locales/el/leads.json`

- [ ] **Step 1: Add an `intake` block to `en/leads.json`** (top-level key, sibling of `"title"`)

```json
  "intake": {
    "nav": "Lead Intake",
    "title": "Lead Intake — Duplicate Review",
    "subtitle": "New Meta leads that match an existing lead or customer wait here. Release the ones you want on the board, or discard duplicates.",
    "empty": "No leads waiting for review.",
    "col_lead": "Lead",
    "col_contact": "Contact",
    "col_match": "Matches",
    "col_received": "Received",
    "release": "Release",
    "discard": "Discard",
    "confirm_discard": "Discard this lead? It will not appear on the sales board.",
    "match_email": "same email as",
    "match_phone": "phone matches",
    "match_lead": "lead",
    "match_deal_client": "customer",
    "released": "Released to the board.",
    "discarded": "Discarded.",
    "action_failed": "Action failed. Please try again."
  }
```

- [ ] **Step 2: Add the matching `intake` block to `el/leads.json`**

```json
  "intake": {
    "nav": "Έλεγχος Lead",
    "title": "Έλεγχος Lead — Διπλότυπα",
    "subtitle": "Νέα Meta leads που ταιριάζουν με υπάρχον lead ή πελάτη περιμένουν εδώ. Απελευθερώστε όσα θέλετε στον πίνακα ή απορρίψτε τα διπλότυπα.",
    "empty": "Δεν υπάρχουν leads προς έλεγχο.",
    "col_lead": "Lead",
    "col_contact": "Επικοινωνία",
    "col_match": "Ταυτίσεις",
    "col_received": "Ελήφθη",
    "release": "Απελευθέρωση",
    "discard": "Απόρριψη",
    "confirm_discard": "Απόρριψη αυτού του lead; Δεν θα εμφανιστεί στον πίνακα πωλήσεων.",
    "match_email": "ίδιο email με",
    "match_phone": "τηλέφωνο ταιριάζει με",
    "match_lead": "lead",
    "match_deal_client": "πελάτη",
    "released": "Απελευθερώθηκε στον πίνακα.",
    "discarded": "Απορρίφθηκε.",
    "action_failed": "Η ενέργεια απέτυχε. Δοκιμάστε ξανά."
  }
```

- [ ] **Step 3: Validate JSON**

Run: `node -e "require('./src/i18n/locales/en/leads.json');require('./src/i18n/locales/el/leads.json');console.log('ok')"`
Expected: `ok`.

- [ ] **Step 4: Commit**

```bash
git add src/i18n/locales/en/leads.json src/i18n/locales/el/leads.json
git commit -m "i18n(leads): lead intake strings (en/el)"
```

---

## Task 9: `LeadIntakePage` component with test

**Files:**
- Create: `src/features/leads/LeadIntakePage.tsx`
- Test: `src/features/leads/LeadIntakePage.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const release = vi.fn();
const discard = vi.fn();
const { useLeadIntake } = vi.hoisted(() => ({ useLeadIntake: vi.fn() }));

vi.mock('./hooks/useLeadIntake', () => ({ useLeadIntake }));
vi.mock('./hooks/useReleaseLeadIntake', () => ({
  useReleaseLeadIntake: () => ({ mutate: release, isPending: false }),
}));
vi.mock('./hooks/useDiscardLeadIntake', () => ({
  useDiscardLeadIntake: () => ({ mutate: discard, isPending: false }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('react-router-dom', () => ({ Link: (p: { children: unknown }) => p.children }));

import { LeadIntakePage } from './LeadIntakePage';

describe('LeadIntakePage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders a held lead with its match and fires release', () => {
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
            },
          ],
        },
      ],
      isLoading: false,
    });
    render(<LeadIntakePage />);
    expect(screen.getByText('x@kara.gr')).toBeInTheDocument();
    expect(screen.getByText('Old Lead')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'leads:intake.release' }));
    expect(release).toHaveBeenCalledWith('i1');
  });

  it('shows the empty state', () => {
    useLeadIntake.mockReturnValue({ data: [], isLoading: false });
    render(<LeadIntakePage />);
    expect(screen.getByText('leads:intake.empty')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/features/leads/LeadIntakePage.test.tsx`
Expected: FAIL — cannot resolve `./LeadIntakePage`.

- [ ] **Step 3: Write the component**

```tsx
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useLeadIntake, type LeadIntakeRow, type LeadIntakeMatch } from './hooks/useLeadIntake';
import { useReleaseLeadIntake } from './hooks/useReleaseLeadIntake';
import { useDiscardLeadIntake } from './hooks/useDiscardLeadIntake';

function fullName(r: LeadIntakeRow): string {
  const n = `${r.contact_first_name ?? ''} ${r.contact_last_name ?? ''}`.trim();
  return n || r.company_name || r.email || r.phone || '—';
}

function MatchBadge({ m, t }: { m: LeadIntakeMatch; t: (k: string) => string }) {
  const verb = m.matched_field === 'email' ? t('leads:intake.match_email') : t('leads:intake.match_phone');
  const kind = m.match_type === 'lead' ? t('leads:intake.match_lead') : t('leads:intake.match_deal_client');
  const to = m.match_type === 'lead' ? `/leads/${m.record_id}` : `/clients/${m.record_id}`;
  return (
    <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
      {m.matched_field === 'email' ? '📧' : '📞'} {verb} {kind}{' '}
      <Link to={to} className="font-medium underline">
        {m.display_name}
      </Link>
      {m.context ? <span className="opacity-70">({m.context})</span> : null}
    </span>
  );
}

export function LeadIntakePage() {
  const { t } = useTranslation();
  const { data, isLoading } = useLeadIntake();
  const release = useReleaseLeadIntake();
  const discard = useDiscardLeadIntake();
  const rows = data ?? [];

  return (
    <div className="space-y-4 p-4">
      <div>
        <h1 className="text-xl font-semibold">{t('leads:intake.title')}</h1>
        <p className="text-sm opacity-70">{t('leads:intake.subtitle')}</p>
      </div>

      {isLoading ? (
        <p className="text-sm opacity-70">…</p>
      ) : rows.length === 0 ? (
        <p className="rounded border border-dashed p-6 text-center text-sm opacity-70">
          {t('leads:intake.empty')}
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const matches = (r.matches as unknown as LeadIntakeMatch[]) ?? [];
            return (
              <li key={r.id} className="rounded border p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="font-medium">{fullName(r)}</div>
                    <div className="text-sm opacity-80">{r.email}</div>
                    <div className="text-sm opacity-80">{r.phone}</div>
                    {r.title ? <div className="text-xs opacity-60">{r.title}</div> : null}
                    <div className="flex flex-wrap gap-1 pt-1">
                      {matches.map((m, i) => (
                        <MatchBadge key={`${m.record_id}-${i}`} m={m} t={t} />
                      ))}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                      disabled={release.isPending}
                      onClick={() => release.mutate(r.id)}
                    >
                      {t('leads:intake.release')}
                    </button>
                    <button
                      type="button"
                      className="rounded border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
                      disabled={discard.isPending}
                      onClick={() => {
                        if (window.confirm(t('leads:intake.confirm_discard'))) discard.mutate(r.id);
                      }}
                    >
                      {t('leads:intake.discard')}
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/features/leads/LeadIntakePage.test.tsx`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add src/features/leads/LeadIntakePage.tsx src/features/leads/LeadIntakePage.test.tsx
git commit -m "feat(leads): LeadIntakePage duplicate-review screen"
```

---

## Task 10: Wire route + sidebar nav

**Files:**
- Modify: `src/app/router.tsx` (lazy import near line 70; route in the `sales` children near line 199)
- Modify: `src/components/layout/Sidebar.tsx` (sales block, after the `/sales/leads` link ~line 105)

- [ ] **Step 1: Add the lazy import in `router.tsx`** (after the `LeadsListPage` import, ~line 70)

```ts
const LeadIntakePage = lazyPage(() => import('@/features/leads/LeadIntakePage'), 'LeadIntakePage');
```

- [ ] **Step 2: Add the route under the `sales` children** (after `{ path: 'leads', element: <LeadsListPage /> }`)

```tsx
            {
              path: 'lead-intake',
              element: (
                <AdminGuard>
                  <LeadIntakePage />
                </AdminGuard>
              ),
            },
```

- [ ] **Step 3: Add the admin-only nav link in `Sidebar.tsx`** (inside the sales `<div className="space-y-0.5">`, right after the `/sales/leads` NavLink)

```tsx
            {isAdmin && (
              <NavLink
                to="/sales/lead-intake"
                className={({ isActive }) => sidebarLinkClass(isActive)}
              >
                <ShieldAlert className="size-4 shrink-0 opacity-80" />
                {t('leads:intake.nav')}
                <LeadIntakeBadge />
              </NavLink>
            )}
```

- [ ] **Step 4: Add the badge component + import to `Sidebar.tsx`**

At the top of `Sidebar.tsx` add `ShieldAlert` to the existing `lucide-react` import, and add this import:
```ts
import { useLeadIntakeCount } from '@/features/leads/hooks/useLeadIntake';
```
Above `export function SidebarNav`, add:
```tsx
function LeadIntakeBadge() {
  const { data } = useLeadIntakeCount();
  if (!data) return null;
  return (
    <span className="ml-auto rounded-full bg-amber-500 px-1.5 text-xs font-semibold text-white">
      {data}
    </span>
  );
}
```

- [ ] **Step 5: Typecheck + lint + run the affected tests**

Run: `npm run typecheck && npm run test:run -- src/features/leads`
Expected: no type errors; all `src/features/leads` tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/app/router.tsx src/components/layout/Sidebar.tsx
git commit -m "feat(leads): route + admin nav for lead intake queue"
```

---

## Task 11: Full build, manual UI verification, push

**Files:** none (verification + deploy)

- [ ] **Step 1: Full check**

Run: `npm run test:run && npm run build`
Expected: all tests pass; build succeeds (tsc + lint + vite).

- [ ] **Step 2: Manual end-to-end (against prod, after deploy)**

1. Send a duplicate Meta lead (curl from Task 3 Step 5) → confirm it does NOT appear on the sales board (Unique Lead) and the **Lead Intake** nav badge increments.
2. Open `/sales/lead-intake` as an admin → the held lead shows with its match badge linking to the matched lead/customer.
3. Click **Release** → it appears in the Unique Lead column; the queue badge decrements.
4. Send another duplicate → click **Discard** → it disappears from the queue and never reaches the board.
5. Clean up any test rows via MCP `execute_sql` (delete by `source_data->>'leadgen_id'` markers).

- [ ] **Step 3: Push**

```bash
git push origin main
```
(Confirm with the user first — repo has the standing "push to main" preference, but verify no unrelated unpushed commits should be excluded.)

---

## Self-Review

- **Spec coverage:** rule (Task 1 `find_lead_duplicates`); clean-vs-held flow (Task 3); `lead_intake` table + RPCs + RLS (Task 1); webhook change incl. retry-dedup vs queue (Task 3); review page + badges + release/discard + nav badge (Tasks 6-10); edge cases — no email/phone → clean (function returns 0 rows → falls through), discarded retained (status kept), any-stage match (no stage filter); Changes/Revert (Task 1 ROLLBACK + per-commit reverts). ✓
- **Deviation:** reviewers scoped to admins-only (documented at top); broadening path noted.
- **Type consistency:** `LeadIntakeMatch` shape identical in the SQL function return, the webhook cast, the hook, and the component; RPC names `release_lead_intake`/`discard_lead_intake` consistent across migration, rpc.ts, and hooks; query keys `['lead_intake', ...]` invalidated by both mutation hooks.
- **Placeholders:** none — all SQL, TS, and JSON shown in full.
