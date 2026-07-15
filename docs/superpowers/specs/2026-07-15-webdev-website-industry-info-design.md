# Web Dev job — Website + Industry from the deal (Info tab) — design

## Problem
On a **web_dev** job, the client's **Website** and **Industry** (entered on the deal's
Company section, stored on `clients.website` / `clients.industry`) do not surface
anywhere. This is the same drift we hit with Local/Web SEO: a client field that
belongs on the job never made it onto the job. Web SEO already solved it for
`website` (seed trigger → `jobs.details.website` + a live Overview fallback row);
web_dev should get the same treatment for **both** website and industry.

Both fields are already loaded on the web_dev job — `useJob` selects
`client.website` and `client.industry` — so no data plumbing is missing; only the
seed + display.

## Decisions (from brainstorming)
- **Placement:** editable, deal-seeded fields on the web_dev **Info tab** (not
  read-only-only). Chosen over a pure Overview display.
- **Industry field type:** a **proper dropdown** backed by `src/lib/industries.ts`
  (stored value = industry **code**, same as `clients.industry`; rendered as the
  localized label). Chosen over a free-text snapshot.
- **Live fallback (Overview rows):** included — best-judgment default while the
  owner was away, because the reported problem is precisely "value doesn't flow
  from the deal". This is the gap-closer for the *entered-after-job-creation*
  case and mirrors web_seo exactly. **Trimmable at review** if minimal scope is
  preferred (see §4 — it is an isolated, read-only addition).

## Architecture

### 1. Field config — `src/features/jobs/serviceInfoFields.ts`
- Extend `InfoFieldType` with `'select'`.
- Extend `InfoField` with optional `options?: { value: string; labelEn: string; labelEl: string }[]`.
- Prepend to the `WEB_DEV` set (so they appear first, as web_seo does with website):
  - `{ key: 'website',  labelEn: 'Website',  labelEl: 'Ιστοσελίδα', type: 'url' }`
  - `{ key: 'industry', labelEn: 'Industry', labelEl: 'Κλάδος',     type: 'select', options: <from INDUSTRIES> }`
- The `industry` options are derived from `INDUSTRIES` (`{ value: code, labelEn, labelEl }`).
  Keep `serviceInfoFields.ts` dependency-light: import `INDUSTRIES` from
  `src/lib/industries.ts` (a plain data module, no React) to build the options.

### 2. Select rendering — `src/features/jobs/JobInfoPanel.tsx`
- `FieldInput` gains a `field.type === 'select'` branch rendering a native
  `<select>`:
  - a leading blank option (`—`, empty value = clear),
  - one `<option value={code}>` per `field.options`, label chosen by current
    language,
  - **legacy guard:** if the stored value is non-empty and not among the option
    values, render a one-off trailing `<option>` for it labelled `"(legacy) <value>"`
    so an odd historical value is never silently dropped (matches the documented
    behavior in `industries.ts`).
- Make the panel language-aware: read `i18n.language` (`useTranslation`) → `'el' | 'en'`
  and thread `lang` into `FieldInput` for select labels. Text/url/textarea/password
  inputs are unchanged; existing labels stay `labelEn` (out of scope to localize).
- Stored value for industry is always the **code**.

### 3. DB seed + backfill — new migration `20260715xxxxxx_web_dev_info_seed.sql`
Mirror `20260629130000_web_seo_website_seed.sql`, but seed **two** keys.

- **Trigger fn** `public.jobs_seed_web_dev_info()` (BEFORE INSERT, security definer,
  `search_path = public`): when `new.service_type = 'web_dev'` and
  `new.client_id is not null`, fill-empty each key independently:
  - `details.website`  ← `nullif(trim(clients.website), '')`  (only if the
    incoming `details->>'website'` is blank)
  - `details.industry` ← `nullif(trim(clients.industry), '')` (only if the
    incoming `details->>'industry'` is blank)
  Merge with `coalesce(new.details,'{}'::jsonb) || jsonb_build_object(...)`; skip a
  key entirely when its source is null so we never write empty keys. One `SELECT`
  from `clients` for both values.
- **Trigger** `jobs_seed_web_dev_info` (drop-if-exists then create), separate from
  the web_seo trigger.
- **Backfill:** create backup table `jobs_web_dev_info_backfill_backup_20260715`
  (`job_id, prev_details, backed_up_at`) capturing every non-archived web_dev job
  that will change, then fill-empty `website`/`industry` from the client. Additive
  (JSONB keys only). **KEEP the backup** (per revert policy).
- **Rollback SQL** in the migration header: drop trigger + fn; note the backfill is
  additive and prior details are preserved in the backup table.

### 4. Live Overview fallback rows (gap-closer) — `src/features/jobs/JobDetailPage.tsx`
Add to the web_dev branch of the "Project info" `<dl>` (next to the Service row),
mirroring the existing `job.service_type === 'web_seo'` Website block:
- **Website** row (`sm:col-span-2`): value = `details.website || client.website`;
  if non-empty, render as an external link (prefix `https://` when scheme-less).
- **Industry** row: value = `details.industry || client.industry`; render
  `industryLabel(value, lang)` as plain text.
Both render only when a value exists. This makes a website/industry typed on the
deal *after* the job was created still visible even before anyone edits the Info
field. Read-only; no writes. (Delete this section for minimal scope — nothing else
depends on it.)

## Isolation / boundaries
- `useUpdateJobDetails` does a **full-object replace** of `jobs.details`; `JobInfoPanel`
  only tracks the field-set keys. Since every web_dev details key (incl. the two new
  ones) is in `WEB_DEV`, a save never drops data. Do **not** assume merge semantics
  when extending — verified against the current mutation.
- No change to the public client-intake wizard, `job_intake_forms`, `api/client-intake.ts`,
  or the intake schema in `src/lib/clientIntake.ts`. This feature is job Info-tab
  context, separate from the client form.
- Scope = `service_type = 'web_dev'` only. Other services untouched.

## Testing / verification
- Frontend `npm run build` (tsc -b + eslint max-warnings=0 + vite) green.
- Unit: `serviceInfoFields` exposes `website` + `industry` (select w/ options) for
  web_dev; select legacy-guard adds a one-off option for an unknown value.
- DB (rollback-guarded, via Management API): insert a web_dev job for a client with
  website+industry → `details` seeded with both; insert for a client with neither →
  no empty keys written; a non-web_dev insert → untouched. Backfill counts sane;
  backup row count == changed row count.
- Manual: Info tab shows Website (url input) + Industry (dropdown, localized,
  pre-selected to the client's industry); edit + autosave persists; Overview shows
  the live fallback rows.

## Changes / Revert
- **Frontend commits (atomic):** (a) `serviceInfoFields.ts` field config + `'select'`
  type; (b) `JobInfoPanel.tsx` select rendering + lang; (c) `JobDetailPage.tsx`
  Overview rows.
- **DB:** one migration `20260715xxxxxx_web_dev_info_seed.sql` (trigger + fn +
  backfill + backup). Applied via Supabase Management API.
- **Revert:** git-revert the frontend commits; run the migration's ROLLBACK block
  (drop trigger + fn). Backfill is additive; restore prior details from
  `jobs_web_dev_info_backfill_backup_20260715` if ever needed. **Keep the backup.**
- Rotate the chat-shared `sbp` token after the session.
