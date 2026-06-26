# Business Profile URL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A salesperson enters a Business Profile URL on a lead; on conversion it lands on the deal (editable) and pre-fills the Local SEO job's "Profile URL" when that job is created.

**Architecture:** Two new text columns (`leads.business_profile_url`, `deals.business_profile_url`). `convert_lead_to_client` copies lead→deal. A single `BEFORE INSERT` trigger on `jobs` copies the deal's URL into any `local_seo` job's `details.profile_url` (covers every spawn path + the AI-SEO local child). Frontend: a field on the lead form + an editable field on the deal Overview.

**Tech Stack:** Supabase Postgres (migration via MCP `apply_migration`), React + TS (Vite), TanStack Query, `useAutoSave`, Vitest.

---

## File structure

- `supabase/migrations/20260626120000_business_profile_url.sql` — new: 2 columns + `convert_lead_to_client` replace + `jobs_seed_local_profile_url` trigger.
- `src/types/supabase.ts` — modify: add column to `leads` and `deals` Row/Insert/Update.
- `src/features/leads/LeadForm.tsx` — modify: new "Business Profile URL" field.
- `src/i18n/locales/en/leads.json`, `src/i18n/locales/el/leads.json` — modify: `form.business_profile_url`.
- `src/features/deals/DealNotesArea.tsx` — modify: editable "Business Profile URL" field.
- `src/i18n/locales/en/deals.json`, `src/i18n/locales/el/deals.json` — modify: `notes_area.business_profile_url`.

---

## Task 1: DB migration (columns + convert RPC + trigger)

**Files:**
- Create: `supabase/migrations/20260626120000_business_profile_url.sql`

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/20260626120000_business_profile_url.sql` with EXACTLY this content (the `convert_lead_to_client` body is the current live definition with one column added — `business_profile_url` in the deals insert):

```sql
-- Business Profile URL: lead -> deal -> local_seo job details.profile_url
-- Forward-only. Rollback at bottom.

alter table public.leads add column if not exists business_profile_url text;
alter table public.deals add column if not exists business_profile_url text;

-- convert_lead_to_client: copy the new lead column onto the created deal.
create or replace function public.convert_lead_to_client(target_lead_id uuid)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  l record; errors text[] := '{}'; service_count int;
  won_stage_id uuid; acc_new_stage_id uuid; new_client_id uuid; new_deal_id uuid; full_name text;
begin
  if not (public.current_user_is_admin() or public.current_user_can('sales', 'lock_deal')) then
    return jsonb_build_object('ok', false, 'errors', array['permission_denied']);
  end if;
  select * into l from public.leads where id = target_lead_id;
  if l is null then return jsonb_build_object('ok', false, 'errors', array['lead_not_found']); end if;
  if l.converted_at is not null then return jsonb_build_object('ok', false, 'errors', array['already_converted']); end if;
  if l.archived then return jsonb_build_object('ok', false, 'errors', array['lead_archived']); end if;
  if coalesce(l.estimated_one_time_value, 0) + coalesce(l.estimated_monthly_value, 0) <= 0 then
    errors := array_append(errors, 'value_required'); end if;
  service_count := coalesce(jsonb_array_length(l.services_planned), 0);
  if service_count = 0 then errors := array_append(errors, 'at_least_one_service_required'); end if;
  if l.email is null or l.email = '' then errors := array_append(errors, 'email_required'); end if;
  if (l.phone is null or l.phone = '') and (l.address is null or l.address = '') then
    errors := array_append(errors, 'phone_or_address_required'); end if;
  if l.company_name is null or trim(l.company_name) = '' then errors := array_append(errors, 'company_name_required'); end if;
  if l.payment_method is null or l.payment_method = '' then errors := array_append(errors, 'payment_method_required'); end if;
  if array_length(errors, 1) is not null and array_length(errors, 1) > 0 then
    return jsonb_build_object('ok', false, 'errors', errors); end if;

  insert into public.clients (
    name, contact_first_name, contact_last_name, email, phone, address,
    industry, country, vat_number, website, assigned_owner_id, code, start_date,
    contact_info, additional_contacts
  ) values (
    l.company_name, l.contact_first_name, l.contact_last_name, l.email, l.phone, l.address,
    l.industry, l.country, l.vat_number, l.website, null, l.code, current_date,
    l.contact_info, coalesce(l.additional_contacts, '[]'::jsonb)
  ) returning id into new_client_id;

  select id into won_stage_id from public.pipeline_stages where board = 'sales' and code = 'won' limit 1;
  select id into acc_new_stage_id from public.pipeline_stages where board = 'accounting_onboarding' and code = 'new' limit 1;

  full_name := coalesce(nullif(trim(coalesce(l.contact_first_name, '') || ' ' || coalesce(l.contact_last_name, '')), ''), l.company_name);
  insert into public.deals (
    client_id, title, description, owner_user_id,
    one_time_value, recurring_monthly_value, services_planned,
    expected_close_date, actual_close_date,
    stage_id, accounting_stage_id,
    locked_at, locked_by, code, won_by_user_id, payment_method, sales_note,
    business_profile_url
  ) values (
    new_client_id,
    coalesce(nullif(trim(l.title), ''), full_name || ' deal'),
    l.notes, null,
    l.estimated_one_time_value, l.estimated_monthly_value, l.services_planned,
    l.expected_close_date, current_date,
    coalesce(won_stage_id, l.stage_id), acc_new_stage_id,
    now(), auth.uid(), l.code, auth.uid(), l.payment_method, l.additional_notes,
    l.business_profile_url
  ) returning id into new_deal_id;

  update public.comments set parent_type = 'deal', parent_id = new_deal_id
    where parent_type = 'lead' and parent_id = l.id;
  update public.attachments set parent_type = 'deal', parent_id = new_deal_id
    where parent_type = 'lead' and parent_id = l.id;
  update public.leads set
      converted_at = now(), converted_client_id = new_client_id, converted_deal_id = new_deal_id,
      stage_id = coalesce(won_stage_id, stage_id), won_by_user_id = auth.uid()
    where id = l.id;

  if l.owner_user_id is not null then
    insert into public.notifications (user_id, type, payload)
    values (l.owner_user_id, 'lead_converted',
      jsonb_build_object('lead_id', l.id, 'client_id', new_client_id, 'deal_id', new_deal_id, 'code', l.code));
  end if;

  return jsonb_build_object('ok', true, 'lead_id', l.id, 'client_id', new_client_id, 'deal_id', new_deal_id, 'code', l.code);
end $function$;

-- Trigger: seed local_seo job details.profile_url from the deal, only when empty.
create or replace function public.jobs_seed_local_profile_url()
returns trigger language plpgsql security definer set search_path = public as $function$
declare v_url text;
begin
  if new.service_type = 'local_seo'
     and new.deal_id is not null
     and nullif(trim(coalesce(new.details->>'profile_url','')), '') is null then
    select nullif(trim(coalesce(business_profile_url,'')), '')
      into v_url from public.deals where id = new.deal_id;
    if v_url is not null then
      new.details := coalesce(new.details, '{}'::jsonb) || jsonb_build_object('profile_url', v_url);
    end if;
  end if;
  return new;
end $function$;

drop trigger if exists jobs_seed_local_profile_url on public.jobs;
create trigger jobs_seed_local_profile_url
  before insert on public.jobs
  for each row execute function public.jobs_seed_local_profile_url();

-- ROLLBACK (manual):
--   drop trigger if exists jobs_seed_local_profile_url on public.jobs;
--   drop function if exists public.jobs_seed_local_profile_url();
--   alter table public.deals drop column if exists business_profile_url;
--   alter table public.leads drop column if exists business_profile_url;
--   -- then re-apply the prior convert_lead_to_client body (without the business_profile_url column).
```

- [ ] **Step 2: Apply to prod via MCP**

Apply with the Supabase MCP tool `apply_migration` (name `business_profile_url`, the SQL above). Do NOT run DDL via Bash/psql — prod DDL goes through `apply_migration`.

- [ ] **Step 3: Verify columns + trigger behavior (read + rolled-back write)**

Run via MCP `execute_sql`:

```sql
-- columns exist
select
  (select count(*) from information_schema.columns where table_schema='public' and table_name='leads'  and column_name='business_profile_url') as leads_col,
  (select count(*) from information_schema.columns where table_schema='public' and table_name='deals'  and column_name='business_profile_url') as deals_col;
```
Expected: both `1`.

```sql
-- trigger seeds profile_url for a local_seo job, then roll back (no residue)
begin;
  with d as (
    insert into public.deals (client_id, title, code, business_profile_url, accounting_stage_id)
    select client_id, 'BPURL TRIGGER TEST', '999999', 'https://g.page/bpurl-test', accounting_stage_id
    from public.deals where business_profile_url is null limit 1
    returning id, client_id
  )
  insert into public.jobs (deal_id, client_id, service_type, billing_type, amount_net, title, status, started_at)
  select id, client_id, 'local_seo', 'recurring_monthly', 0, 'trigger test', 'active', now() from d
  returning details->>'profile_url' as seeded_profile_url;
rollback;
```
Expected: one row with `seeded_profile_url = 'https://g.page/bpurl-test'`. (The `rollback` discards everything.)

- [ ] **Step 4: Commit the migration file**

```bash
git add supabase/migrations/20260626120000_business_profile_url.sql
git commit -m "feat(leads): business_profile_url columns + convert copy + local_seo seed trigger

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Add the column to generated types

**Files:**
- Modify: `src/types/supabase.ts` (the `leads` table Row/Insert/Update, and the `deals` table Row/Insert/Update)

`types:gen` needs CLI auth (not available); add the field manually, matching the nullable-text pattern used by neighbouring columns (e.g. `website`).

- [ ] **Step 1: Add to the `leads` table types**

In `src/types/supabase.ts`, find the `leads:` table block. In its `Row: {` object add `business_profile_url: string | null`. In its `Insert: {` object add `business_profile_url?: string | null`. In its `Update: {` object add `business_profile_url?: string | null`. (Place each alphabetically near `website` / `vat_number` for tidiness — exact position is cosmetic.)

- [ ] **Step 2: Add to the `deals` table types**

In the `deals:` table block, add the same three lines: `Row` → `business_profile_url: string | null`; `Insert` → `business_profile_url?: string | null`; `Update` → `business_profile_url?: string | null`.

- [ ] **Step 3: Verify the build type-checks**

Run: `npm run build`
Expected: PASS (no TS errors). This proves the type additions are syntactically valid before the UI uses them.

- [ ] **Step 4: Commit**

```bash
git add src/types/supabase.ts
git commit -m "types(leads,deals): business_profile_url column

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Lead form — "Business Profile URL" field

**Files:**
- Modify: `src/features/leads/LeadForm.tsx`
- Modify: `src/i18n/locales/en/leads.json`, `src/i18n/locales/el/leads.json`

- [ ] **Step 1: Add the i18n labels**

In `src/i18n/locales/en/leads.json`, inside the `"form"` object add: `"business_profile_url": "Business Profile URL",`
In `src/i18n/locales/el/leads.json`, inside the `"form"` object add: `"business_profile_url": "URL Προφίλ Επιχείρησης",`

- [ ] **Step 2: Add state + initial value**

In `src/features/leads/LeadForm.tsx`, near the other `useState` field declarations (where `website` is initialised, e.g. `const [website, setWebsite] = useState(lead.website ?? '')`), add:

```tsx
  const [businessProfileUrl, setBusinessProfileUrl] = useState(lead.business_profile_url ?? '');
```

- [ ] **Step 3: Add it to the auto-save `patch` (object + deps)**

In the `patch` `useMemo` object (currently lines ~94-119), add the line after `website: website.trim() || null,`:

```tsx
      business_profile_url: businessProfileUrl.trim() || null,
```

And add `businessProfileUrl` to the `useMemo` dependency array (after `website,`).

- [ ] **Step 4: Render the input in the Company section**

In the Company `<Section>` grid, immediately after the existing Website `<div>` (the block containing `id="ws"`), add:

```tsx
            <div>
              <Label htmlFor="bpurl">{t('form.business_profile_url')}</Label>
              <Input
                id="bpurl"
                type="url"
                placeholder="https://"
                value={businessProfileUrl}
                onChange={(e) => setBusinessProfileUrl(e.target.value)}
                className="mt-1.5"
              />
            </div>
```

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/leads/LeadForm.tsx src/i18n/locales/en/leads.json src/i18n/locales/el/leads.json
git commit -m "feat(leads): Business Profile URL field on the lead form

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Deal page — editable "Business Profile URL"

Reuse `DealNotesArea` (already an editable deal-level field with `useAutoSave` + direct `deals` update). Add the URL field there.

**Files:**
- Modify: `src/features/deals/DealNotesArea.tsx`
- Modify: `src/i18n/locales/en/deals.json`, `src/i18n/locales/el/deals.json`

- [ ] **Step 1: Add the i18n labels**

In `src/i18n/locales/en/deals.json`, inside the `"notes_area"` object add:
`"business_profile_url": "Business Profile URL",`
In `src/i18n/locales/el/deals.json`, inside `"notes_area"` add:
`"business_profile_url": "URL Προφίλ Επιχείρησης",`

- [ ] **Step 2: Add state + extend the patch + the update**

In `src/features/deals/DealNotesArea.tsx`:

After `const [salesNote, setSalesNote] = useState(deal.sales_note ?? '');` add:

```tsx
  const [businessProfileUrl, setBusinessProfileUrl] = useState(deal.business_profile_url ?? '');
```

Replace the `patch` memo and the auto-save body so both fields save together:

```tsx
  const patch = useMemo(
    () => ({ sales_note: salesNote.trim() || null, business_profile_url: businessProfileUrl.trim() || null }),
    [salesNote, businessProfileUrl],
  );
  const status = useAutoSave(patch, async (next) => {
    const { error } = await supabase
      .from('deals')
      .update({ sales_note: next.sales_note, business_profile_url: next.business_profile_url })
      .eq('id', deal.id);
    if (error) throw new Error(error.message);
    void qc.invalidateQueries({ queryKey: queryKeys.deal(deal.id) });
  });
```

- [ ] **Step 3: Render the input (need the shared `Input` component)**

At the top of `DealNotesArea.tsx`, add the import (next to the `Label` import):

```tsx
import { Input } from '@/components/ui/input';
```

In the returned JSX, immediately after the opening `<h2 ...>{t('notes_area.title')}</h2>` line, add:

```tsx
      <div>
        <Label htmlFor="deal-bpurl">{t('notes_area.business_profile_url')}</Label>
        <Input
          id="deal-bpurl"
          type="url"
          placeholder="https://"
          value={businessProfileUrl}
          onChange={(e) => setBusinessProfileUrl(e.target.value)}
          className="mt-1.5"
        />
      </div>
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: PASS. (`deal.business_profile_url` resolves because Task 2 added it to the `deals` type; `DealRow` derives from it.)

- [ ] **Step 5: Commit**

```bash
git add src/features/deals/DealNotesArea.tsx src/i18n/locales/en/deals.json src/i18n/locales/el/deals.json
git commit -m "feat(deals): editable Business Profile URL on the deal Overview

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Full verification + push

- [ ] **Step 1: Full test suite + build**

Run: `npm run test:run` → all green.
Run: `npm run build` → PASS.

- [ ] **Step 2: Push**

```bash
git push origin main
```

- [ ] **Step 3: Live smoke (manual, then clean up)**

On `www.itdevcrm.com` (admin), after deploy: open a lead → Company → enter a Business Profile URL → it autosaves. Add a service (local_seo) + payment method + value → move to **Won** → open the created deal → confirm the **Business Profile URL** shows and is editable on the Overview → move the deal to **Paid In Full** → open the spawned `local_seo` job → **Info** tab → confirm **Profile URL** is pre-filled with the entered URL. Then delete the test lead/deal/client/jobs (FK-safe, as in the email smoke-test runbook).

A read-only DB cross-check:
```sql
select d.business_profile_url, j.details->>'profile_url' as job_profile_url
from public.deals d join public.jobs j on j.deal_id = d.id and j.service_type='local_seo'
where d.code = '<the test deal code>';
```
Expected: both equal the entered URL.

---

## Self-review notes

- **Spec coverage:** lead field → Task 3; convert copy → Task 1 (deal insert column); deal page editable → Task 4; local_seo job seed (incl. AI-SEO local child + all spawn paths) → Task 1 trigger; types → Task 2; testing/revert → Task 5 + migration rollback block.
- **No placeholders:** the migration reproduces the live `convert_lead_to_client` verbatim + one added column/value; trigger fn shown in full; every UI edit shows the exact code.
- **Type consistency:** column name `business_profile_url` everywhere (lead state, patch key, deal state, deals/leads types, SQL columns, trigger reads `deals.business_profile_url`); job detail key is `profile_url` (matches `serviceInfoFields` LOCAL). `DealRow`/`LeadRow` derive from `src/types/supabase.ts` (Task 2), so Tasks 3–4 type-check.
- **Semantics:** trigger is only-if-empty + only-with-deal — never clobbers manual job edits; deal shows its own column (visible at conversion before any job exists).
