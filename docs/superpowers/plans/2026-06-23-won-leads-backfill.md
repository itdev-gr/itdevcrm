# Won Leads Backfill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create one Won lead per active accounting deal that has no linked lead (~470), built from the deal + its client and linked via `converted_deal_id`, and add an opt-in "Include won/converted" toggle to the `/sales/leads` table — creating **zero** new accounting rows.

**Architecture:** A single idempotent SQL backfill (run on prod via the Supabase Management API after approval) inserts `leads` rows from `deals`+`clients`, pausing round-robin distribution during the run and recording every inserted id in a backup table for rollback. A tiny frontend change exposes `useLeads({ includeConverted })` as a checkbox.

**Tech Stack:** Postgres/Supabase, React + TypeScript, React-Query, Vitest.

## Spec

`docs/superpowers/specs/2026-06-23-won-leads-backfill-design.md`. Verified facts:
- Won stage id = `b6476d2c-4ed5-4832-b034-90ca40e804cc` (board `sales`, code `won`).
- `leads.source` CHECK ∈ {`meta`,`manual`,`import`} → use **`import`**. NOT-NULL-without-default leads cols = `source`, `title` (must set). `code` defaults to `generate_lead_code()` but we set it = deal code. `phone_normalized` is **GENERATED** (do NOT insert; set `phone`).
- `leads` BEFORE-INSERT triggers: `leads_auto_distribute` (assigns owner only if owner null AND `lead_distribution_state.auto_enabled`), `leads_set_default_stage` (only if stage null), `leads_enforce_stage_restriction` (won is NOT restricted → fine). Inserting into `won` fires **no** email (welcome needs `unique_lead`; won emails only fire on UPDATE-transition). None touch accounting.
- `lead_distribution_state.auto_enabled = true` right now → must pause during backfill.
- Data: 473 active deals, 470 with no linked lead, 0 code-collisions, all have email.

## File map
- Create migration `supabase/migrations/20260623120000_backfill_won_leads_from_deals.sql` (backup table + backfill DO block + rollback comment).
- Modify `src/features/leads/LeadsListPage.tsx` (add the toggle; pass `includeConverted` to `useLeads`).
- Test `src/features/leads/LeadsListPage.test.tsx` (extend).

---

### Task 1: Backfill migration SQL

**Files:** Create `supabase/migrations/20260623120000_backfill_won_leads_from_deals.sql`

- [ ] **Step 1: Write the migration file** with exactly:

```sql
-- 20260623120000_backfill_won_leads_from_deals.sql
-- =============================================================================
-- Backfill: one Won lead per active accounting deal that has no linked lead.
-- Inserts ONLY into public.leads (linked to the existing deal/client via
-- converted_deal_id). Creates ZERO new deals/clients/jobs/payments. Pauses
-- round-robin distribution during the run so historical won leads aren't
-- auto-assigned. Every inserted lead id is recorded for rollback.
-- =============================================================================

create table if not exists public.leads_won_backfill_backup_20260623 (
  lead_id uuid primary key,
  action text not null,            -- 'created' (this run inserts only)
  deal_id uuid,
  inserted_at timestamptz not null default now()
);

do $$
declare
  v_won uuid;
  v_dist boolean;
begin
  select id into v_won from public.pipeline_stages where board = 'sales' and code = 'won' limit 1;
  if v_won is null then raise exception 'won stage not found'; end if;

  -- pause round-robin so backfilled won leads aren't auto-distributed
  select auto_enabled into v_dist from public.lead_distribution_state where id = true;
  update public.lead_distribution_state set auto_enabled = false where id = true;

  with d as (
    select dd.id as deal_id, dd.client_id, dd.code, dd.title,
           dd.one_time_value, dd.recurring_monthly_value,
           coalesce(dd.actual_close_date::timestamptz, dd.invoiced_date::timestamptz, dd.created_at) as won_at,
           coalesce(dd.won_by_user_id, dd.owner_user_id) as owner_id, dd.won_by_user_id,
           c.name as c_name, c.contact_first_name as c_fn, c.contact_last_name as c_ln,
           c.email as c_email, c.phone as c_phone, c.address as c_addr, c.industry as c_ind,
           c.country as c_country, c.vat_number as c_vat, c.website as c_web
    from public.deals dd
    join public.clients c on c.id = dd.client_id
    where not dd.archived
      and not exists (select 1 from public.leads l where l.converted_deal_id = dd.id)
  ),
  ins as (
    insert into public.leads (
      source, title, code, stage_id, automations_enabled,
      converted_at, converted_deal_id, converted_client_id,
      company_name, contact_first_name, contact_last_name, email, phone,
      address, industry, country, vat_number, website,
      estimated_one_time_value, estimated_monthly_value,
      owner_user_id, won_by_user_id
    )
    select
      'import',
      coalesce(nullif(trim(d.title), ''), nullif(trim(d.c_name), ''), 'Won deal'),
      coalesce(nullif(trim(d.code), ''), public.generate_lead_code()),
      v_won, false,
      d.won_at, d.deal_id, d.client_id,
      d.c_name, d.c_fn, d.c_ln, d.c_email, d.c_phone,
      d.c_addr, d.c_ind, d.c_country, d.c_vat, d.c_web,
      coalesce(d.one_time_value, 0), coalesce(d.recurring_monthly_value, 0),
      d.owner_id, d.won_by_user_id
    from d
    returning id, converted_deal_id
  )
  insert into public.leads_won_backfill_backup_20260623 (lead_id, action, deal_id)
  select id, 'created', converted_deal_id from ins;

  -- restore the distribution toggle to whatever it was
  update public.lead_distribution_state set auto_enabled = coalesce(v_dist, false) where id = true;
end $$;

-- ---------------------------------------------------------------------------
-- Rollback:
--   delete from public.leads l using public.leads_won_backfill_backup_20260623 b
--     where b.lead_id = l.id and b.action = 'created';
--   drop table if exists public.leads_won_backfill_backup_20260623;
--   -- (distribution toggle is left as restored; no accounting rows were created)
-- ---------------------------------------------------------------------------
```

- [ ] **Step 2: Sanity-check** — re-read the file; confirm it references only existing objects (`pipeline_stages`, `lead_distribution_state`, `deals`, `clients`, `leads`, `generate_lead_code`) and inserts ONLY into `leads` (+ the backup table). No local DB apply here (prod apply is Task 3).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260623120000_backfill_won_leads_from_deals.sql
git commit -m "feat(sales): backfill Won leads from accounting deals (migration)"
```

---

### Task 2: "Include won/converted" toggle on the leads list

**Files:** Modify `src/features/leads/LeadsListPage.tsx`; Test `src/features/leads/LeadsListPage.test.tsx`

- [ ] **Step 1: Write the failing test** — append to `LeadsListPage.test.tsx` a case asserting the toggle drives `useLeads`. Inspect the existing test file first for its mock setup; add (matching its style):

```tsx
it('passes includeConverted to useLeads when the toggle is on', () => {
  render(<LeadsListPage />);
  // default: hidden
  expect(useLeadsMock).toHaveBeenLastCalledWith({ includeConverted: false });
  fireEvent.click(screen.getByLabelText('leads:filters.include_won'));
  expect(useLeadsMock).toHaveBeenLastCalledWith({ includeConverted: true });
});
```

(If the existing test mocks `useLeads` under a different variable name, reuse that; the assertion is that the last call's arg flips `includeConverted`.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:run -- src/features/leads/LeadsListPage.test.tsx`
Expected: FAIL — no `leads:filters.include_won` control / `useLeads` called with `{}`.

- [ ] **Step 3: Implement the toggle.** In `src/features/leads/LeadsListPage.tsx`:

Add state near the other filter state (after line 61):
```tsx
  const [includeConverted, setIncludeConverted] = useState(false);
```
Change the data fetch (line 37) from `useLeads({})` to:
```tsx
  const { data: leads = [], isLoading, error } = useLeads({ includeConverted });
```
Add the checkbox inside `<FilterBar>` (after the owner `FilterSelect`, before the count `<span>` on line 238):
```tsx
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            aria-label={t('filters.include_won')}
            checked={includeConverted}
            onChange={(e) => setIncludeConverted(e.target.checked)}
          />
          {t('filters.include_won')}
        </label>
```
Add the page-reset dependency so toggling resets to page 0 (line 86-88 effect already resets on filter changes — add `includeConverted`):
```tsx
  useEffect(() => {
    setPage(0);
  }, [search, statusId, ownerId, sort, includeConverted]);
```

- [ ] **Step 4: Add the i18n key** in `src/i18n/locales/en/leads.json` and `src/i18n/locales/el/leads.json` under `filters`:
  - en: `"include_won": "Include won/converted"`
  - el: `"include_won": "Με κερδισμένους/μετατραπέντες"`

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test:run -- src/features/leads/LeadsListPage.test.tsx`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

```bash
npm run typecheck
git add src/features/leads/LeadsListPage.tsx src/features/leads/LeadsListPage.test.tsx src/i18n/locales/en/leads.json src/i18n/locales/el/leads.json
git commit -m "feat(leads): opt-in Include won/converted toggle on the leads list"
```

---

### Task 3: Pre-flight, apply to prod, verify, push

**Files:** none (verification + deploy)

- [ ] **Step 1: Pre-flight read-only checks** (Management API, project `xujlrclyzxrvxszepquy`). Confirm before running the backfill:
  - `select count(*) from deals d where not d.archived and not exists (select 1 from leads l where l.converted_deal_id=d.id);` → ~470 (the target count).
  - No code collisions / nulls: `select count(*) from deals d where not d.archived and not exists (select 1 from leads l where l.converted_deal_id=d.id) and (d.code is null or exists (select 1 from leads l2 where l2.code=d.code));` → expect 0 (the migration's `coalesce(...,generate_lead_code())` covers null anyway).
  - Snapshot counts: `select (select count(*) from deals) deals,(select count(*) from clients) clients,(select count(*) from jobs) jobs,(select count(*) from payments) payments,(select count(*) from leads) leads;`

- [ ] **Step 2: Apply the backfill** (requires user go-ahead) — run the migration SQL via the Management API. The DO block is atomic; if it errors it rolls back (including the distribution toggle).

- [ ] **Step 3: Verify** (Management API):
  - **Accounting unchanged (the hard constraint):** deals/clients/jobs/payments counts equal the Step-1 snapshot. **If any changed, STOP and roll back.**
  - `select count(*) from leads_won_backfill_backup_20260623;` → ~470.
  - `select count(*) from deals d where not d.archived and not exists (select 1 from leads l where l.converted_deal_id=d.id);` → 0 (every active deal now linked).
  - Won-stage lead count: `select count(*) from leads l join pipeline_stages ps on ps.id=l.stage_id where ps.code='won' and not l.archived;` → ~473.
  - Spot-check 5: `select l.code, l.company_name, l.email, l.stage_id=v_won, l.converted_deal_id from leads l join leads_won_backfill_backup_20260623 b on b.lead_id=l.id limit 5;` — each links to its deal, carries deal code + client contact.
  - `select auto_enabled from lead_distribution_state where id=true;` → restored to `true`.

- [ ] **Step 4: Push the frontend**

```bash
git push origin main
```

- [ ] **Step 5: Live smoke** (hard-refresh first): `/sales/kanban` Won column shows the won leads; `/sales/leads` default list unchanged, toggling "Include won/converted" reveals them; a won lead's code matches its deal code.

---

## Self-Review

**Spec coverage:** backfill one Won lead per unlinked active deal → Task 1; dedup-aware (reuse existing lead) — none match today so all create; no accounting rows → Task 1 (leads-only) + Task 3 verify; keep-visible toggle → Task 2; dedup track = `converted_deal_id` + code + generated `phone_normalized` → Task 1; backup + rollback → Task 1. ✓

**Placeholder scan:** none — concrete SQL/code/commands throughout.

**Type consistency:** `includeConverted` (boolean) matches `useLeads`'s `LeadsFilter.includeConverted`. Backup table name consistent across Tasks 1 & 3.

## Changes / Revert
- **DB:** inserts only `leads` rows (+ `leads_won_backfill_backup_20260623`). Rollback = delete the backed-up ids, drop the backup table. No accounting rows created → nothing to revert there.
- **Frontend:** revert the Task-2 commit. Default list behaviour unchanged (toggle off by default).
