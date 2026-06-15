# Per-Service Job Info Tab + Deal-Overview Summary — Design Spec

**Date:** 2026-06-15

**Goal:** Give each technical job (Local SEO, Web SEO, AI SEO, Web Dev) a service-specific **Info** tab holding its URLs, credentials, and notes — replacing the monthly checklist where one exists. The **Notes + Report URLs** also surface read-only on the parent **deal's Overview** so accounting can see them without opening jobs.

**Non-goals (YAGNI):** keeping the AI-SEO monthly checklist; editing these fields from the deal page (the job is the single source of truth); encrypting credentials at rest.

---

## Fields per job type

Each field has a **distinct key** (so AI SEO, which combines Local + Web SEO, never collides). `shared` = also shown on the deal Overview.

**Local SEO** (`local_seo`)
- `profile_url` — "Profile URL" — url
- `local_report_url` — "Report URL" — url — **shared**
- `local_notes` — "Local SEO Notes" — textarea — **shared**

**Web SEO** (`web_seo`)
- `website_username` — "Website username" — text
- `website_password` — "Website password" — password
- `web_report_url` — "Web SEO report URL" — url — **shared**
- `seo_notes` — "SEO Notes" — textarea — **shared**

**AI SEO** (`ai_seo`) — **both sets**, grouped into two sections:
- Section "Local SEO": `profile_url`, `local_report_url` (**shared**), `local_notes` (**shared**)
- Section "Web SEO": `website_username`, `website_password`, `web_report_url` (**shared**), `seo_notes` (**shared**)

**Web Dev** (`web_dev`)
- `webdev_notes` — "Web Dev Notes" — textarea — **shared**
- `hosting` — "Hosting" — text
- `supabase_name` — "Supabase name" — text
- `temp_url` — "Temp Website URL" — url
- `live_url` — "Live Website URL" — url
- `email` — "Email" — text

**Shared-with-deal keys:** `local_report_url`, `local_notes`, `web_report_url`, `seo_notes`, `webdev_notes`. (Credentials — passwords, hosting, supabase, email, usernames — are **never** shared to the deal.)

---

## Data model

- Add `details jsonb not null default '{}'` to `public.jobs`. Each service stores only its own keys; no schema churn when fields evolve. Inherits the existing `jobs` RLS (tech team per `service_type` + admin read/write; accounting has read access to jobs already).
- The field **definitions** live in code (not the DB): `src/features/jobs/serviceInfoFields.ts` — a `Record<serviceType, InfoField[]>` plus a `sharedDealFields(serviceType, details)` helper that returns the shared `{ label, type, value }` entries for the deal Overview.

```ts
export type InfoFieldType = 'url' | 'text' | 'textarea' | 'password';
export type InfoField = {
  key: string; labelEn: string; labelEl: string;
  type: InfoFieldType; section?: string; sharedWithDeal?: boolean;
};
export const SERVICE_INFO_FIELDS: Record<string, InfoField[]>; // local_seo, web_seo, ai_seo, web_dev
export function infoFieldsFor(serviceType: string): InfoField[];
export function sharedDealFields(serviceType: string, details: Record<string, unknown>):
  { key: string; label: string; type: InfoFieldType; value: string }[];
```

---

## UI

**Job page (`JobDetailPage.tsx`).** Add an **Info** tab (only for services present in `SERVICE_INFO_FIELDS`). It renders `JobInfoPanel`, which:
- lays out the service's fields (grouped by `section` when present — AI SEO shows "Local SEO" / "Web SEO" sub-headers),
- edits values into `jobs.details` (autosave, matching the codebase's existing form autosave),
- renders `password` masked with a 👁 reveal toggle, and `url` values as a clickable link when populated.
- **Replaces the monthly checklist:** for `local_seo` / `web_seo` / `ai_seo`, the `MonthlyTasksPanel` is no longer rendered in Overview. (`web_dev` never had one.)

**Deal Overview (`DealDetailPage.tsx`).** Add a read-only **"Service info"** section listing, per job in the deal, that job's **shared** fields (notes + report URLs) via `sharedDealFields()`. Report URLs render as links; notes as text. Credentials never appear here.

**Mutation.** `src/features/jobs/hooks/useUpdateJobDetails.ts` — merges changed keys into `jobs.details` and invalidates the job query.

---

## Migration

- `ALTER TABLE public.jobs ADD COLUMN details jsonb NOT NULL DEFAULT '{}'`.
- Stop the monthly checklist from regenerating for the replaced services: set `service_monthly_task_templates.tasks = '[]'` for `local_seo`, `web_seo`, `ai_seo` (the monthly-reset cron then creates nothing for them). Existing already-generated monthly tasks simply stop being displayed (panel removed).
- **Rollback:** drop the `details` column; restore the three template rows' original `tasks` arrays (originals recorded in the migration's rollback comment).

---

## Security
- `jobs.details` is protected by the existing job RLS (per-service tech team + admin). Accounting can read jobs, but the **deal Overview only renders the shared keys**, so passwords/hosting/Supabase/email never surface there.
- Password stored as text, **masked** in the UI with a reveal toggle — acceptable for an internal tool behind login + RLS (encryption is an explicit non-goal).

## Testing
- `serviceInfoFields.test.ts` — config integrity (AI SEO = Local + Web with distinct keys; correct `sharedWithDeal` flags) and `sharedDealFields()` (returns notes/reports, excludes credentials).
- `JobInfoPanel.test.tsx` — renders a service's fields; password masked by default; URL renders as a link.
- Deal-Overview summary test — shows shared notes/reports, hides credential keys.

## Changes / Revert
- **New:** migration (jobs.details + clear 3 templates); `serviceInfoFields.ts`, `JobInfoPanel.tsx`, `useUpdateJobDetails.ts`; Info tab in `JobDetailPage`; Service-info section in `DealDetailPage`.
- **Revert:** migration rollback (drop column, restore template rows); remove the new files + the Info tab + the deal section; restore `MonthlyTasksPanel` rendering.
