# Website on the Web SEO job (Project info + Info tab)

- **Date:** 2026-06-29
- **Status:** Design — approved, ready for implementation

## Goal

Surface the client's **website** (entered by sales/accounting in the deal's Company section, stored in `clients.website`) on the **Web SEO** job — in both its **Project info** (Overview) and its editable **Info tab** — so the Web SEO team (and AI SEO's web work) always has the site they're working on. Mirrors the existing Local SEO Business-Profile-URL pattern.

## Decisions

- **Source:** `clients.website` (the deal Company "Website" field → `DealForm` → `clients.website`).
- **Scope:** `service_type = 'web_seo'` only (standalone Web SEO + AI SEO's web child, which is a web_seo job). AI SEO's local child keeps `profile_url`; not touched here.
- **Info tab field:** editable, auto-seeded (team can correct).
- **Existing jobs:** backfill now.

## Design

### 1. Info tab field
`src/features/jobs/serviceInfoFields.ts` — add a field to the `WEB_SEO` set (placed first):
```
{ key: 'website', type: 'url', labelEn: 'Website', labelEl: 'Ιστοσελίδα' }
```
Stored in `jobs.details.website`. Appears in the Web SEO Info tab and the AI SEO "Web SEO" section automatically (ai_seo composes WEB_SEO). Not `sharedWithDeal` (the website already lives on the deal's Company section).

### 2. Auto-seed trigger (new migration)
Mirror `jobs_seed_local_profile_url`. BEFORE INSERT on `public.jobs`:
```sql
create or replace function public.jobs_seed_web_website()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_url text;
begin
  if new.service_type = 'web_seo'
     and new.client_id is not null
     and nullif(trim(coalesce(new.details->>'website','')), '') is null then
    select nullif(trim(coalesce(website,'')), '') into v_url from public.clients where id = new.client_id;
    if v_url is not null then
      new.details := coalesce(new.details, '{}'::jsonb) || jsonb_build_object('website', v_url);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists jobs_seed_web_website on public.jobs;
create trigger jobs_seed_web_website before insert on public.jobs
  for each row execute function public.jobs_seed_web_website();
```
Reads `clients.website` via `new.client_id` (jobs carry client_id). Fires for standalone web_seo and the AI SEO web child (web_seo service type), regardless of stage (off-board or on-board). Only seeds when the field is empty (idempotent / non-destructive).

### 3. Project info display
`src/features/jobs/JobDetailPage.tsx` Project info section — for web_seo jobs, add a **Website** row rendering a clickable link. Value = `job.details.website` (the seeded/edited value), falling back to the live `client.website` when `details.website` is empty (so a website added after job creation still shows). Render nothing if both empty.
`src/features/jobs/hooks/useJob.ts` — add `website` to the client select (already selected by `useJobs`; just missing in `useJob`). Add `details` to the JobRow type usage if not present.

### 4. One-time backfill (in the migration, with backup)
```sql
create table if not exists public.jobs_website_backfill_backup_20260629 as
  select j.id as job_id, j.details as prev_details, now() as backed_up_at
    from public.jobs j join public.clients c on c.id = j.client_id
   where j.service_type = 'web_seo' and not j.archived
     and nullif(trim(coalesce(j.details->>'website','')), '') is null
     and nullif(trim(coalesce(c.website,'')), '') is not null;

update public.jobs j
   set details = coalesce(j.details, '{}'::jsonb) || jsonb_build_object('website', nullif(trim(c.website), ''))
  from public.clients c
 where c.id = j.client_id and j.service_type = 'web_seo' and not j.archived
   and nullif(trim(coalesce(j.details->>'website','')), '') is null
   and nullif(trim(coalesce(c.website,'')), '') is not null;
```

## Edge cases
- Empty `clients.website` → nothing seeded; Project info row hidden. Fine.
- Website entered AFTER job creation → trigger (insert-only) won't seed, but Project info falls back to the live `client.website`; the team can also type it into the Info tab.
- AI SEO web child created off-board → still web_seo service type → trigger seeds it. ✓
- Existing edited `details.website` → never overwritten (guard on empty), in trigger and backfill.

## Verification
- **Frontend:** `npm run build` (tsc + vite + eslint, no Docker) green.
- **Backend:** apply trigger + backfill via Management API; rolled-back prod test — insert a web_seo job on a client with a website → `details.website` seeded; insert an AI SEO deal → web child seeded, local child not; backfill count sane.
- Gated on explicit go-ahead before applying to prod.

## Changes / Revert
**Changes:** `serviceInfoFields.ts` (+website field), `JobDetailPage.tsx` (+Website row), `useJob.ts` (+client.website select); new migration (trigger `jobs_seed_web_website` + backfill + backup table).
**Revert:** drop trigger + function `jobs_seed_web_website`; revert the three frontend files; backfill is additive (a JSONB key) — backup `jobs_website_backfill_backup_20260629` holds prior `details` if a restore is needed.
