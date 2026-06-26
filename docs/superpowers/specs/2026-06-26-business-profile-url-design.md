# Business Profile URL — Lead → Deal → Local SEO Info (Design)

**Date:** 2026-06-26
**Status:** Approved (design) — ready for implementation plan
**Scope:** 1 DB migration (2 columns + convert RPC + spawn fn) + frontend (lead form,
deal page, types).

## Goal

A salesperson enters a **Business Profile URL** (Google Business Profile) on a lead.
On conversion to a deal it shows on the **deal page** (editable), and it pre-fills the
**Local SEO** job's **"Profile URL"** (`profile_url`) field in the job Info tab when
that job is created.

## Data model (one migration)

Two new nullable text columns:

- `leads.business_profile_url`
- `deals.business_profile_url`

`business_profile_url` maps to the Local SEO Info field `profile_url` ("Profile URL"),
NOT the separate `business_profile` (free text) field.

## 1. Lead form

`src/features/leads/LeadForm.tsx` — add a **"Business Profile URL"** (`type="url"`)
field in the **Company** section, next to the existing "Website" field. It joins the
existing `patch` object and auto-saves to `leads.business_profile_url` via the
existing `useAutoSave` + `useUpdateLead` path (no new save mechanism). Shown on every
lead. Greek label: "URL Προφίλ Επιχείρησης".

The `leads` Row/Insert/Update types in `src/types/supabase.ts` gain the column (added
by the same loose-stub approach already used for recent columns, or regenerated).

## 2. Conversion (convert_lead_to_client)

New migration, `create or replace function public.convert_lead_to_client(...)`, copying
the existing body and adding `business_profile_url` to the `insert into public.deals`
column list + values (`l.business_profile_url`). No other behavior change. (Client row
unchanged — the URL lives on the deal, which is what spawns jobs.)

## 3. Deal page (editable)

`src/features/deals/DealDetailPage.tsx` Overview — add an **editable** "Business
Profile URL" field (URL input, auto-save to `deals.business_profile_url`), following
the existing deal-edit pattern (same edit permission as the other deal Overview
controls). Visible immediately after conversion (deal-level value, independent of any
job). The `deals` types gain the column.

## 4. Local SEO job population — BEFORE INSERT trigger on `jobs`

There are **multiple** job-spawn paths (`release_billing_jobs_for_deal` = off-board
billing jobs with `stage_id null`; `release_jobs_for_deal` = on-board + AI-SEO trio;
`create_custom_job`; the AI-SEO split). Rather than patch each insert (fragile), add
**one** `BEFORE INSERT` trigger on `public.jobs` that covers every path:

```sql
create or replace function public.jobs_seed_local_profile_url()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_url text;
begin
  if new.service_type = 'local_seo'
     and new.deal_id is not null
     and nullif(trim(coalesce(new.details->>'profile_url','')), '') is null then
    select nullif(trim(coalesce(business_profile_url,'')), '')
      into v_url from public.deals where id = new.deal_id;
    if v_url is not null then
      new.details := coalesce(new.details, '{}'::jsonb)
                     || jsonb_build_object('profile_url', v_url);
    end if;
  end if;
  return new;
end $$;

create trigger jobs_seed_local_profile_url
  before insert on public.jobs
  for each row execute function public.jobs_seed_local_profile_url();
```

Because the AI-SEO **local child** is itself `service_type = 'local_seo'` with a
`deal_id`, it is covered automatically. The convert RPC change is unrelated to this
trigger; the trigger just reads `deals.business_profile_url`, which exists by the time
any job spawns (set at conversion).

**Semantics:** copy-at-create, **only when the job has no `profile_url` yet**. Manual
edits to a job's Info tab are never overwritten; editing the deal's
`business_profile_url` after a job already exists does NOT retro-update that job.

## Deal display vs job field (decision)

The deal shows its **own** `deals.business_profile_url` (deal-level), so it is visible
at conversion before any local_seo job exists. We do **not** mark the job's
`profile_url` as `sharedWithDeal` — that would expose it for unrelated jobs and
duplicate the deal-level field. So: deal page shows the deal column; the job Info tab
shows the job's `profile_url` (pre-filled from the deal at spawn).

## Error handling / edge cases

- Lead/deal with no URL → nothing copied, job `details` stays `{}` (no `profile_url`
  key). No crash.
- Non-local services (web_seo, etc.) spawn unchanged (`details` only set on the
  `local_seo` insert).
- Re-running a spawn is not expected; if it were, the only-when-empty/once-at-create
  semantics avoid clobbering manual edits (the insert sets `details` just at creation).

## Testing

- `npm run build` green (types + eslint).
- Existing `serviceInfoFields.test.ts` unchanged (`profile_url` already defined).
- Scoped live smoke (then torn down): create a lead with a Business Profile URL →
  convert → assert `deals.business_profile_url` set → move deal to Paid-In-Full →
  assert the spawned `local_seo` job's `details->>'profile_url'` equals the URL, and
  it shows in the job Info tab + the deal page shows the field.

## Changes / Revert

Files:

- migration `…_business_profile_url.sql` (add 2 columns + `create or replace`
  convert_lead_to_client with the deal-insert column added + new
  `jobs_seed_local_profile_url` trigger fn + trigger) — includes rollback SQL (drop
  columns; drop trigger+fn; restore prior convert_lead_to_client body — captured in
  the migration's rollback section).
- `src/features/leads/LeadForm.tsx` (new field)
- `src/features/deals/DealDetailPage.tsx` (new editable field) + any small deal-edit
  hook reuse
- `src/types/supabase.ts` (leads + deals column types)

Revert: revert the commits; run the down-migration (drop the 2 columns; the
`create or replace` fns revert by re-applying their prior definitions, captured in the
migration's rollback section).

## Out of scope (YAGNI)

- Backfilling existing leads/deals.
- Syncing the deal URL into already-spawned jobs.
- Putting the URL on the client record.
- Making the job `profile_url` a shared-to-deal field.
