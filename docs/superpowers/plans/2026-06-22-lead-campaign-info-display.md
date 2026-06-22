# Surface Campaign Data Into Leads — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Show the company name, ad-campaign form name, and campaign question→answer pairs on every lead, by populating `leads.company_name` and the editable Lead info (`leads.notes`).

**Architecture:** A pure Postgres formatter `build_lead_info_block(source_data, title)` becomes the single source of truth. The release functions use it (fill-blank) so new leads carry the data; one-time fill-blank backfills fix existing leads + pending intake. No frontend changes — the lead page already renders `notes` and `company_name`.

**Tech Stack:** Postgres (Supabase), applied to prod via the Management API (`/database/query`, token in env, not in files). Migration files committed for history.

---

### Task 1: Formatter function `build_lead_info_block`

**Files:**
- Create: `supabase/migrations/20260622170000_build_lead_info_block.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Human-readable "Lead info" text from a Meta-lead source_data blob:
--   line 1: Φόρμα: <form_name>
--   then:   <humanized question>: <answer>  (one per non-system key)
-- Hides system IDs + fields already shown in structured columns. Used by the
-- release functions and the one-time backfill so both produce identical text.
create or replace function public.build_lead_info_block(p_source_data jsonb, p_title text default null)
returns text
language plpgsql
immutable
as $$
declare
  block text := '';
  form_name text;
  rec record;
  label text;
  skip_keys text[] := array[
    'id','leadgen_id','key','page_id','source','lead_status',
    'form_id','form_name','campaign_id','campaign_name',
    'ad_id','ad_name','adset_id','adset_name','platform','is_organic','created_time',
    'όνομα_εταιρείας','όνομα εταιρείας','company','company_name',
    'αριθμός_τηλεφώνου','αριθμός τηλεφώνου','work_phone_number','phone','mobile',
    'email','e-mail','website','site',
    'full_name','name','ονοματεπώνυμο','όνομα'
  ];
begin
  if p_source_data is null or jsonb_typeof(p_source_data) <> 'object' then
    return null;
  end if;

  form_name := nullif(btrim(p_source_data->>'form_name'), '');
  if form_name is not null then
    block := 'Φόρμα: ' || form_name || E'\n';
  end if;

  for rec in
    select key, value
      from jsonb_each_text(p_source_data)
     where coalesce(btrim(value), '') <> ''
       and lower(key) <> all (skip_keys)
       and lower(key) not like 'col$%'
     order by key
  loop
    label := btrim(regexp_replace(replace(rec.key, '_', ' '), '[;:]+\s*$', ''));
    label := regexp_replace(label, '\s+', ' ', 'g');
    block := block || label || ': ' || btrim(rec.value) || E'\n';
  end loop;

  return nullif(btrim(block), '');
end;
$$;

-- ROLLBACK: drop function public.build_lead_info_block(jsonb, text);
```

- [ ] **Step 2: Apply via Management API**

Build `{"query": <file contents>}` with Python and POST to `/v1/projects/xujlrclyzxrvxszepquy/database/query` (Bearer token from env). Expect `[]` (no error).

- [ ] **Step 3: Verify output on real leads (the "test")**

Run:
```sql
select l.title,
       public.build_lead_info_block(l.source_data, l.title) as lead_info
from public.leads l
join public.lead_intake li on li.released_lead_id = l.id
where li.source = 'import'
order by l.created_at desc
limit 5;
```
Expected: each `lead_info` starts with `Φόρμα: …` then humanized Greek `question: answer` lines; NO `ad_id`/`campaign_id`/`form_id`/phone/email/company lines; no trailing `;` on labels.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260622170000_build_lead_info_block.sql
git commit -m "feat(leads): build_lead_info_block formatter (form + humanized Q&A)"
```

---

### Task 2: Release functions carry notes + company

**Files:**
- Read first: `supabase/migrations/20260622120100_release_intake_notes_to_lead_info.sql` (current `release_lead_intake`), `supabase/migrations/20260622140000_bulk_release_intake.sql` (current `bulk_release_intake`).
- Create: `supabase/migrations/20260622170100_release_carries_campaign_info.sql`

- [ ] **Step 1: Read both current function bodies**

Read the two migration files above verbatim. Copy each function whole; change ONLY the two value expressions in their `insert ... values (...)`:
- the value going into `notes`: was `r.contact_info` → becomes
  `coalesce(nullif(btrim(r.contact_info), ''), nullif(public.build_lead_info_block(r.source_data, r.title), ''))`
- the value going into `company_name`: was `r.company_name` → becomes
  `coalesce(nullif(btrim(r.company_name), ''), nullif(btrim(r.source_data->>'όνομα_εταιρείας'), ''))`

Keep every other line, the security/`search_path` settings, and the stage logic identical.

- [ ] **Step 2: Write the migration**

Paste both full `create or replace function …` definitions (release_lead_intake and bulk_release_intake) with only the two expressions above swapped. End with a ROLLBACK comment pointing to restoring from `20260622120100` / `20260622140000`.

- [ ] **Step 3: Apply via Management API**

POST the file. Expect `[]`.

- [ ] **Step 4: Verify the new bodies are live (the "test")**

Run:
```sql
select pg_get_functiondef('public.release_lead_intake(uuid)'::regprocedure) like '%build_lead_info_block%' as release_ok,
       pg_get_functiondef('public.bulk_release_intake(integer)'::regprocedure) like '%build_lead_info_block%' as bulk_ok;
```
Expected: both `true`. (Adjust the argument types to match the real signatures found in Step 1.)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260622170100_release_carries_campaign_info.sql
git commit -m "feat(leads): release carries form/Q&A into notes + company from source_data"
```

---

### Task 3: One-time backfills (fill-blank, with backups)

**Files:**
- Create: `supabase/migrations/20260622170200_backfill_lead_campaign_info.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Fill-blank backfill of campaign data already captured in source_data.
-- Backups for rollback; never overwrites an existing value.

create table if not exists public.leads_campaign_backfill_backup_20260622 as
select id, company_name, notes, now() as backed_up_at
from public.leads
where coalesce(nullif(btrim(company_name), ''), nullif(btrim(notes), '')) is null;

create table if not exists public.lead_intake_company_backup_20260622 as
select id, company_name, now() as backed_up_at
from public.lead_intake
where nullif(btrim(company_name), '') is null;

-- (A) leads.company_name from source_data, fill-blank
update public.leads
   set company_name = nullif(btrim(source_data->>'όνομα_εταιρείας'), ''),
       updated_at = now()
 where nullif(btrim(company_name), '') is null
   and nullif(btrim(source_data->>'όνομα_εταιρείας'), '') is not null;

-- (B) leads.notes from the formatter, fill-blank
update public.leads
   set notes = public.build_lead_info_block(source_data, title),
       updated_at = now()
 where nullif(btrim(notes), '') is null
   and public.build_lead_info_block(source_data, title) is not null;

-- (C) lead_intake.company_name from source_data, fill-blank
update public.lead_intake
   set company_name = nullif(btrim(source_data->>'όνομα_εταιρείας'), '')
 where nullif(btrim(company_name), '') is null
   and nullif(btrim(source_data->>'όνομα_εταιρείας'), '') is not null;

-- ROLLBACK:
--   update public.leads l set company_name = b.company_name, notes = b.notes
--     from public.leads_campaign_backfill_backup_20260622 b where l.id = b.id;
--   update public.lead_intake li set company_name = b.company_name
--     from public.lead_intake_company_backup_20260622 b where li.id = b.id;
--   drop table public.leads_campaign_backfill_backup_20260622;
--   drop table public.lead_intake_company_backup_20260622;
```

- [ ] **Step 2: Apply via Management API**

POST the file. Expect `[]`.

- [ ] **Step 3: Verify counts + fill-blank proof (the "test")**

Run:
```sql
select
  (select count(*) from public.leads where nullif(btrim(company_name),'') is not null) as leads_with_company,
  (select count(*) from public.leads where nullif(btrim(notes),'') is not null)        as leads_with_notes,
  (select count(*) from public.lead_intake where nullif(btrim(company_name),'') is not null) as intake_with_company;
```
Then spot-check 3 leads:
```sql
select title, company_name, left(notes, 250) as notes_preview
from public.leads where nullif(btrim(notes),'') is not null
order by updated_at desc limit 3;
```
Expected: company populated where source had it; `notes_preview` shows `Φόρμα: …` + Greek Q&A.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260622170200_backfill_lead_campaign_info.sql
git commit -m "feat(leads): backfill company_name + Lead info from source_data (fill-blank, backups)"
```

---

### Task 4: Final verification + push + memory

- [ ] **Step 1: Confirm a previously-broken lead now reads correctly**

Re-run the Task 3 spot-check on one of the leads from the original investigation (imported, company was null, notes was null). Confirm both now populated.

- [ ] **Step 2: Push**

```bash
git push origin main
```

- [ ] **Step 3: Record in memory**

Add a memory note (the campaign-data surfacing + formatter + backfill, fill-blank, backup tables) and a MEMORY.md pointer; link `[[project_intake_phone_backfill]]`.

---

## Self-Review

- **Spec coverage:** company display → Task 3A + release 2; form name + Q&A in Lead info → Task 1 formatter + release 2 + backfill 3B; humanize/hide IDs → Task 1 skip_keys + regex; backfills with backups/rollback → Task 3; verification → Steps 3 of each task + Task 4. All spec sections covered.
- **Placeholder scan:** none — all SQL is concrete; Task 2 intentionally reads current bodies first (the only safe way to edit existing functions) and specifies the exact two expressions to swap.
- **Type/name consistency:** `build_lead_info_block(jsonb, text)` used identically in Tasks 1, 2, 3B. Backup table names consistent between create and rollback. `όνομα_εταιρείας` key consistent across 2/3A/3C.
