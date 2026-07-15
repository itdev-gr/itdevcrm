# Web Dev Website + Industry (Info tab) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the client's Website + Industry (from the deal's Company section, stored on `clients`) as editable, deal-seeded fields on the web_dev job's Info tab, with a live read-only fallback in the job Overview.

**Architecture:** Add a `website` (url) and `industry` (new `select` field type, backed by `src/lib/industries.ts`) to the web_dev Info field config; render the select in `JobInfoPanel`; a `BEFORE INSERT` DB trigger fill-empty-seeds both keys from `clients` (+ one-time backfill of existing jobs); add live-fallback Website/Industry rows to the web_dev Overview. Mirrors the shipped web_seo `website` seed pattern (`20260629130000_web_seo_website_seed.sql`).

**Tech Stack:** React + TypeScript, Vite, react-i18next, vitest (jsdom), Supabase Postgres (migration applied via the Supabase Management API).

## Global Constraints
- Stored industry value is always the **code** (e.g. `restaurants`), identical to `clients.industry`; the label is derived via `industries.ts` for display only.
- Scope is `service_type = 'web_dev'` only. No other service changes.
- Seed/backfill are **fill-empty only** (never overwrite a non-empty value); the DB trigger is `security definer set search_path = public`.
- `useUpdateJobDetails` does a **full-object replace** of `jobs.details`; every web_dev details key (incl. the two new ones) must stay in the `WEB_DEV` field set so a save never drops data.
- Build gate: `npm run build` = `tsc -b && eslint --max-warnings=0 && vite build` (stricter than tsc alone).
- Do NOT run the full `vitest` suite (it can hit prod) — run only the named test file.
- No literal secrets in files: the Management API token is read from the environment; never paste it.
- Migration is committed to `supabase/migrations/`; applying it to **prod** is gated on the owner's explicit go-ahead (read-only-until-told).
- Commit per task with an explicit pathspec (a concurrent session may have unrelated staged files, e.g. `DELETE_E2E_TEST_CLIENTS.sql` — never sweep it in).

---

### Task 1: Info field config — `select` type + web_dev website/industry + `selectOptions` helper

**Files:**
- Modify: `src/features/jobs/serviceInfoFields.ts`
- Test: `src/features/jobs/serviceInfoFields.test.ts`

**Interfaces:**
- Consumes: `INDUSTRIES` from `src/lib/industries.ts` (`{ code, labels: { en, el } }[]`).
- Produces:
  - `type InfoFieldType = 'url' | 'text' | 'textarea' | 'password' | 'select'`
  - `type InfoFieldOption = { value: string; labelEn: string; labelEl: string }`
  - `InfoField` gains `options?: InfoFieldOption[]`
  - `web_dev` field keys become `['website','industry','webdev_notes','hosting','supabase_name','temp_url','live_url','email']`; `industry` is `type:'select'` with `options` = all INDUSTRIES.
  - `selectOptions(field: InfoField, currentValue: string, lang: 'en'|'el'): { value: string; label: string }[]` — leading blank `{value:'',label:'—'}`, then localized options, then a trailing `{value, label:'(legacy) '+value}` when `currentValue` is non-empty and not a known option value.

- [ ] **Step 1: Write the failing tests**

Edit `src/features/jobs/serviceInfoFields.test.ts`. Change the import line and the existing `web_dev has its six fields` test, and append new tests:

```ts
import { describe, it, expect } from 'vitest';
import { infoFieldsFor, sharedDealFields, selectOptions, SERVICE_INFO_FIELDS } from './serviceInfoFields';
import { INDUSTRIES } from '@/lib/industries';
```

Replace the `web_dev has its six fields` test with:

```ts
  it('web_dev leads with website + industry then its six base fields', () => {
    expect(infoFieldsFor('web_dev').map((f) => f.key)).toEqual([
      'website', 'industry', 'webdev_notes', 'hosting', 'supabase_name', 'temp_url', 'live_url', 'email',
    ]);
  });
  it('web_dev industry is a select backed by INDUSTRIES', () => {
    const industry = infoFieldsFor('web_dev').find((f) => f.key === 'industry');
    expect(industry?.type).toBe('select');
    expect(industry?.options?.map((o) => o.value)).toEqual(INDUSTRIES.map((i) => i.code));
  });
  it('web_dev website is a url field', () => {
    expect(infoFieldsFor('web_dev').find((f) => f.key === 'website')?.type).toBe('url');
  });
```

Append a new `describe` block at the end of the file:

```ts
describe('selectOptions', () => {
  const industry = infoFieldsFor('web_dev').find((f) => f.key === 'industry')!;

  it('leads with a blank option and localizes labels', () => {
    const en = selectOptions(industry, '', 'en');
    expect(en[0]).toEqual({ value: '', label: '—' });
    expect(en[1]).toEqual({ value: 'technology', label: 'Technology / IT' });
    const el = selectOptions(industry, '', 'el');
    expect(el[1]).toEqual({ value: 'technology', label: 'Τεχνολογία / IT' });
  });

  it('keeps an unknown/legacy value as a one-off trailing option', () => {
    const out = selectOptions(industry, 'agriculture', 'en');
    expect(out.at(-1)).toEqual({ value: 'agriculture', label: '(legacy) agriculture' });
  });

  it('adds no legacy option for a known or empty value', () => {
    expect(selectOptions(industry, 'retail', 'en').some((o) => o.label.startsWith('(legacy)'))).toBe(false);
    expect(selectOptions(industry, '', 'en').some((o) => o.label.startsWith('(legacy)'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/features/jobs/serviceInfoFields.test.ts`
Expected: FAIL — `selectOptions` is not exported (import error) and the web_dev key list assertion mismatches.

- [ ] **Step 3: Implement the config + helper**

Edit `src/features/jobs/serviceInfoFields.ts`.

Add the import at the top (this module is frontend-only — not bundled by `api/` — so the `@/` alias is fine):

```ts
import { INDUSTRIES } from '@/lib/industries';
```

Change the type declarations:

```ts
export type InfoFieldType = 'url' | 'text' | 'textarea' | 'password' | 'select';
export type InfoFieldOption = { value: string; labelEn: string; labelEl: string };
export type InfoField = {
  key: string;
  labelEn: string;
  labelEl: string;
  type: InfoFieldType;
  section?: string;
  sharedWithDeal?: boolean;
  options?: InfoFieldOption[];
};
```

Add the industry option list above the `WEB_DEV` const:

```ts
const INDUSTRY_OPTIONS: InfoFieldOption[] = INDUSTRIES.map((i) => ({
  value: i.code,
  labelEn: i.labels.en,
  labelEl: i.labels.el,
}));
```

Prepend the two fields to `WEB_DEV` (keep the existing six unchanged):

```ts
const WEB_DEV: InfoField[] = [
  { key: 'website', labelEn: 'Website', labelEl: 'Ιστοσελίδα', type: 'url' },
  { key: 'industry', labelEn: 'Industry', labelEl: 'Κλάδος', type: 'select', options: INDUSTRY_OPTIONS },
  { key: 'webdev_notes', labelEn: 'Web Dev Notes', labelEl: 'Σημειώσεις Web Dev', type: 'textarea', sharedWithDeal: true },
  { key: 'hosting', labelEn: 'Hosting', labelEl: 'Hosting', type: 'text' },
  { key: 'supabase_name', labelEn: 'Supabase name', labelEl: 'Όνομα Supabase', type: 'text' },
  { key: 'temp_url', labelEn: 'Temp Website URL', labelEl: 'Προσωρινό URL', type: 'url' },
  { key: 'live_url', labelEn: 'Live Website URL', labelEl: 'Live URL', type: 'url' },
  { key: 'email', labelEn: 'Email', labelEl: 'Email', type: 'text' },
];
```

Append the `selectOptions` helper at the end of the file:

```ts
/**
 * Option list for a `select` Info field: a leading blank (empty = clear), then
 * the field's options localized to `lang`, then a one-off "(legacy) <value>"
 * entry when the stored value isn't a known option (so an odd/legacy value is
 * never silently dropped — matches the fallback documented in industries.ts).
 */
export function selectOptions(
  field: InfoField,
  currentValue: string,
  lang: 'en' | 'el',
): { value: string; label: string }[] {
  const opts = (field.options ?? []).map((o) => ({
    value: o.value,
    label: lang === 'el' ? o.labelEl : o.labelEn,
  }));
  const out = [{ value: '', label: '—' }, ...opts];
  const cur = currentValue.trim();
  if (cur !== '' && !opts.some((o) => o.value === cur)) {
    out.push({ value: cur, label: `(legacy) ${cur}` });
  }
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/features/jobs/serviceInfoFields.test.ts`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add src/features/jobs/serviceInfoFields.ts src/features/jobs/serviceInfoFields.test.ts
git commit -m "feat(webdev-info): add website + industry (select) to web_dev Info fields

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Render the `select` field in JobInfoPanel (language-aware)

**Files:**
- Modify: `src/features/jobs/JobInfoPanel.tsx`

**Interfaces:**
- Consumes: `selectOptions`, `InfoField`, `infoFieldsFor` from `./serviceInfoFields` (Task 1).
- Produces: no new exports. The panel now renders a `<select>` for `type:'select'` fields and passes `lang` into `FieldInput`.

**Note on testing:** the select's option logic is fully unit-tested in Task 1 (`selectOptions`). This task is thin UI wiring with no new pure logic, so its gate is the strict build + a manual check rather than a new (heavy, hook-mocking) component test.

- [ ] **Step 1: Add the language hook + `select` branch**

Edit `src/features/jobs/JobInfoPanel.tsx`.

Change the imports at the top:

```ts
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { infoFieldsFor, selectOptions, type InfoField } from './serviceInfoFields';
import { useUpdateJobDetails } from './hooks/useUpdateJobDetails';
import { useAutoSave } from '@/lib/autosave';
```

Change `FieldInput`'s signature to accept `lang` and add the `select` branch as the first `if`:

```ts
function FieldInput({
  field, value, onChange, lang,
}: { field: InfoField; value: string; onChange: (v: string) => void; lang: 'en' | 'el' }) {
  const [reveal, setReveal] = useState(false);
  if (field.type === 'select') {
    return (
      <select
        className="w-full rounded border px-2 py-1 text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {selectOptions(field, value, lang).map((o) => (
          <option key={o.value || '__blank'} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  if (field.type === 'textarea') {
```

(the `textarea`, `password`, and default `input` branches below stay exactly as they are.)

In `JobInfoPanel`, derive `lang` and pass it to `FieldInput`:

```ts
export function JobInfoPanel({
  jobId, serviceType, initialDetails,
}: { jobId: string; serviceType: string; initialDetails: Record<string, unknown> }) {
  const { i18n } = useTranslation();
  const lang = i18n.resolvedLanguage === 'el' ? 'el' : 'en';
  const fields = infoFieldsFor(serviceType);
```

and in the render, add the `lang` prop:

```tsx
              <FieldInput field={f} value={values[f.key] ?? ''} lang={lang}
                onChange={(val) => setValues((p) => ({ ...p, [f.key]: val }))} />
```

- [ ] **Step 2: Verify the strict build passes**

Run: `npm run build`
Expected: PASS — `tsc -b`, `eslint --max-warnings=0`, and `vite build` all green.

- [ ] **Step 3: Manual check (dev server)**

Run: `npm run dev`, open a **web_dev** job → Info tab. Confirm: a **Website** URL input and an **Industry** dropdown appear first; the dropdown is pre-selected to the client's industry (localized label); changing it shows "Saving… / Saved". (Full end-to-end incl. seed values is exercised in Task 4.)

- [ ] **Step 4: Commit**

```bash
git add src/features/jobs/JobInfoPanel.tsx
git commit -m "feat(webdev-info): render Industry as a localized select on the Info tab

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Live-fallback Website + Industry rows in the web_dev Overview

> This is the gap-closer for the "value typed on the deal after the job existed" case (read-only, mirrors web_seo). It is self-contained — delete this task for minimal scope.

**Files:**
- Modify: `src/features/jobs/JobDetailPage.tsx`

**Interfaces:**
- Consumes: `job.details.website` / `job.details.industry` (from Task 4 seed), `job.client.website` / `job.client.industry` (already selected by `useJob`), `lang` (already defined at `JobDetailPage.tsx:85` as `i18n.resolvedLanguage === 'el' ? 'el' : 'en'`), and `industryLabel` from `src/lib/industries.ts`.
- Produces: two read-only `<div>` rows in the "Project info" `<dl>`, gated on `job.service_type === 'web_dev'`.

- [ ] **Step 1: Import `industryLabel`**

Edit `src/features/jobs/JobDetailPage.tsx`. Add near the other `@/lib` imports:

```ts
import { industryLabel } from '@/lib/industries';
```

- [ ] **Step 2: Add the two web_dev rows to Project info**

In the "Project info" `<dl>`, immediately **after** the existing `{job.service_type === 'web_seo' && (() => { … })()}` Website block (ends around line 491, before the `Status` `<div>`), insert:

```tsx
                  {job.service_type === 'web_dev' &&
                    (() => {
                      const details = job.details ?? {};
                      const fromDetails =
                        typeof details.website === 'string' ? details.website.trim() : '';
                      const fromClient = (job.client?.website ?? '').trim();
                      const raw = fromDetails || fromClient;
                      if (!raw) return null;
                      const href = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
                      return (
                        <div className="sm:col-span-2">
                          <dt className="text-[11px] text-muted-foreground">Website</dt>
                          <dd className="mt-0.5">
                            <a
                              href={href}
                              target="_blank"
                              rel="noreferrer"
                              className="break-all text-sm font-medium text-primary hover:underline"
                            >
                              {raw}
                            </a>
                          </dd>
                        </div>
                      );
                    })()}
                  {job.service_type === 'web_dev' &&
                    (() => {
                      const details = job.details ?? {};
                      const fromDetails =
                        typeof details.industry === 'string' ? details.industry.trim() : '';
                      const fromClient = (job.client?.industry ?? '').trim();
                      const code = fromDetails || fromClient;
                      if (!code) return null;
                      return (
                        <div>
                          <dt className="text-[11px] text-muted-foreground">Industry</dt>
                          <dd className="mt-0.5 text-sm font-medium">{industryLabel(code, lang)}</dd>
                        </div>
                      );
                    })()}
```

- [ ] **Step 3: Verify the strict build passes**

Run: `npm run build`
Expected: PASS (tsc + eslint + vite all green).

- [ ] **Step 4: Manual check**

`npm run dev`, open a web_dev job's **Overview**. Confirm a **Website** link and an **Industry** label appear in "Project info" (sourced from the client when the Info field is empty). A job with neither shows no rows.

- [ ] **Step 5: Commit**

```bash
git add src/features/jobs/JobDetailPage.tsx
git commit -m "feat(webdev-info): show live Website + Industry rows in web_dev Overview

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: DB seed trigger + backfill (migration)

**Files:**
- Create: `supabase/migrations/20260715120000_web_dev_info_seed.sql`

**Interfaces:**
- Consumes: `clients.website`, `clients.industry`; the existing `jobs_set_code` BEFORE-INSERT trigger (independent — sets `code`).
- Produces: trigger fn `public.jobs_seed_web_dev_info()` + trigger `jobs_seed_web_dev_info` on `public.jobs`; backup table `public.jobs_web_dev_info_backfill_backup_20260715`; seeded `jobs.details.website` / `jobs.details.industry` on web_dev jobs.

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/20260715120000_web_dev_info_seed.sql`:

```sql
-- 20260715120000_web_dev_info_seed.sql
-- Spec: docs/superpowers/specs/2026-07-15-webdev-website-industry-info-design.md
-- Plan: docs/superpowers/plans/2026-07-15-webdev-website-industry-info.md
--
-- Seed the client's website + industry (clients.website / clients.industry, set
-- from the deal's Company section) into a web_dev job's Info tab
-- (jobs.details.website / jobs.details.industry) on creation, and backfill
-- existing web_dev jobs. Mirrors jobs_seed_web_website (web_seo). Scope:
-- service_type='web_dev' only. Fill-empty only (never overwrites a value).

-- 1. Auto-seed trigger (BEFORE INSERT) -----------------------------------------
create or replace function public.jobs_seed_web_dev_info()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_url text; v_ind text;
begin
  if new.service_type = 'web_dev' and new.client_id is not null then
    select nullif(trim(coalesce(website,'')), ''),
           nullif(trim(coalesce(industry,'')), '')
      into v_url, v_ind
      from public.clients where id = new.client_id;

    if v_url is not null
       and nullif(trim(coalesce(new.details->>'website','')), '') is null then
      new.details := coalesce(new.details, '{}'::jsonb) || jsonb_build_object('website', v_url);
    end if;

    if v_ind is not null
       and nullif(trim(coalesce(new.details->>'industry','')), '') is null then
      new.details := coalesce(new.details, '{}'::jsonb) || jsonb_build_object('industry', v_ind);
    end if;
  end if;
  return new;
end $$;

drop trigger if exists jobs_seed_web_dev_info on public.jobs;
create trigger jobs_seed_web_dev_info
  before insert on public.jobs
  for each row execute function public.jobs_seed_web_dev_info();

-- 2. One-time backfill (+ backup) ---------------------------------------------
create table if not exists public.jobs_web_dev_info_backfill_backup_20260715 as
  select j.id as job_id, j.details as prev_details, now() as backed_up_at
    from public.jobs j join public.clients c on c.id = j.client_id
   where j.service_type = 'web_dev' and not j.archived
     and ( (nullif(trim(coalesce(j.details->>'website','')), '') is null
            and nullif(trim(coalesce(c.website,'')), '') is not null)
        or (nullif(trim(coalesce(j.details->>'industry','')), '') is null
            and nullif(trim(coalesce(c.industry,'')), '') is not null) );

update public.jobs j
   set details = coalesce(j.details, '{}'::jsonb)
                 || jsonb_build_object('website', nullif(trim(c.website), ''))
  from public.clients c
 where c.id = j.client_id and j.service_type = 'web_dev' and not j.archived
   and nullif(trim(coalesce(j.details->>'website','')), '') is null
   and nullif(trim(coalesce(c.website,'')), '') is not null;

update public.jobs j
   set details = coalesce(j.details, '{}'::jsonb)
                 || jsonb_build_object('industry', nullif(trim(c.industry), ''))
  from public.clients c
 where c.id = j.client_id and j.service_type = 'web_dev' and not j.archived
   and nullif(trim(coalesce(j.details->>'industry','')), '') is null
   and nullif(trim(coalesce(c.industry,'')), '') is not null;

-- ROLLBACK:
--   drop trigger if exists jobs_seed_web_dev_info on public.jobs;
--   drop function if exists public.jobs_seed_web_dev_info();
--   -- backfill is additive (JSONB keys); prior details are preserved in
--   -- public.jobs_web_dev_info_backfill_backup_20260715
```

- [ ] **Step 2: Commit the migration file (before applying)**

```bash
git add supabase/migrations/20260715120000_web_dev_info_seed.sql
git commit -m "feat(webdev-info): DB trigger + backfill to seed web_dev website/industry

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 3: Get the owner's go-ahead to apply to prod**

Per read-only-until-told: pause and confirm before mutating prod. State that you're about to apply `20260715120000_web_dev_info_seed.sql` (trigger + one-time backfill of existing web_dev jobs). Proceed only on an explicit "go".

- [ ] **Step 4: Apply the migration to prod (Management API)**

Apply the file's SQL via the Supabase Management API (project `xujlrclyzxrvxszepquy`), reading the `sbp` token from the environment (never inline it), with a browser-like `User-Agent` header. Reference: memory `reference_supabase_mgmt_api`. Alternatively use the `mcp__plugin_supabase_supabase__apply_migration` tool with name `web_dev_info_seed`.

- [ ] **Step 5: Verify the seed-on-insert (rollback-guarded)**

Run this via the Management API. It inserts a throwaway web_dev job for a real client that has website+industry (copying an existing web_dev row so all NOT NULL/FK columns are satisfied), then `raise exception` surfaces the seeded values AND rolls the whole transaction back — nothing is persisted:

```sql
do $$
declare j public.jobs%rowtype; v_client uuid; v_out jsonb;
begin
  select id into v_client from public.clients
   where nullif(trim(website),'') is not null
     and nullif(trim(industry),'') is not null
   limit 1;
  if v_client is null then raise exception 'no suitable test client'; end if;

  select * into j from public.jobs where service_type = 'web_dev' limit 1;
  if j.id is null then raise exception 'no template web_dev job'; end if;

  j.id := gen_random_uuid();          -- fresh PK
  j.client_id := v_client;            -- client under test
  j.details := '{}'::jsonb;           -- empty so the seed fires
  j.code := null;                     -- jobs_set_code regenerates it
  j.billing_group_id := null;         -- dodge the partial-unique index
  j.created_at := now();

  insert into public.jobs values (j.*) returning details into v_out;
  raise exception 'RESULT=[website=%, industry=%]', v_out->>'website', v_out->>'industry';
end $$;
```

Expected: the API returns an error whose message is `RESULT=[website=<client website>, industry=<client industry code>]` (both non-empty). Because it aborted, no row was created.

- [ ] **Step 6: Verify fill-empty guard (no empty keys for a bare client)**

```sql
do $$
declare j public.jobs%rowtype; v_client uuid; v_out jsonb;
begin
  select id into v_client from public.clients
   where nullif(trim(coalesce(website,'')),'') is null
     and nullif(trim(coalesce(industry,'')),'') is null
   limit 1;
  if v_client is null then raise exception 'no bare client to test with'; end if;

  select * into j from public.jobs where service_type = 'web_dev' limit 1;
  j.id := gen_random_uuid(); j.client_id := v_client; j.details := '{}'::jsonb;
  j.code := null; j.billing_group_id := null; j.created_at := now();

  insert into public.jobs values (j.*) returning details into v_out;
  raise exception 'RESULT=[keys=%]', (select coalesce(string_agg(k, ','), '(none)') from jsonb_object_keys(v_out) k);
end $$;
```

Expected: `RESULT=[keys=(none)]` — no `website`/`industry` keys written when the client has neither.

- [ ] **Step 7: Verify the backfill landed**

```sql
select
  (select count(*) from public.jobs_web_dev_info_backfill_backup_20260715) as backed_up,
  (select count(*) from public.jobs j join public.clients c on c.id = j.client_id
     where j.service_type = 'web_dev' and not j.archived
       and nullif(trim(coalesce(j.details->>'website','')),'') is null
       and nullif(trim(coalesce(c.website,'')),'') is not null) as website_still_missing,
  (select count(*) from public.jobs j join public.clients c on c.id = j.client_id
     where j.service_type = 'web_dev' and not j.archived
       and nullif(trim(coalesce(j.details->>'industry','')),'') is null
       and nullif(trim(coalesce(c.industry,'')),'') is not null) as industry_still_missing;
```

Expected: `backed_up` ≥ 0 (rows that were changed), and both `*_still_missing` counts are **0** (every non-archived web_dev job whose client has the value now carries it in `details`).

- [ ] **Step 8: Final full build + record**

Run: `npm run build` (green). No further commit for the SQL (already committed in Step 2); note the verification results in the session log.

---

## Post-implementation
- Update memory `project_webdev_client_intake.md` (or add a new project memory) noting web_dev jobs now seed Website + Industry from the client, with the `jobs_seed_web_dev_info` trigger + `jobs_web_dev_info_backfill_backup_20260715` backup (KEEP).
- Rotate the chat-shared `sbp` token after the session.
