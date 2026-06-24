# Per-Service Job Attachments — Design Spec

**Date:** 2026-06-24
**Status:** Approved (brainstorm)

## Goal

Add an **Attachments** area to the **Info tab** of `web_dev`, `local_seo`, `web_seo`, and `ai_seo` jobs. Each service team uploads files for **their own** area; the matching group (plus admins) can upload/delete, everyone else can only view/download. The uploaded files must also be **visible to accounting on the deal** (read-only) in the service-info / notes area.

## Decisions (from brainstorm)

- **Who uploads:** matching group only (+ admins). `local_seo` group → Local area, `web_seo` group → Web area, `web_dev` group → Web Dev area. Others (incl. accounting) view/download only.
- **AI SEO:** files live on the **single `ai_seo` parent job**, split into a **Local** area (local group) and a **Web** area (web group). The AI SEO local/web **child** jobs do **not** show an area (managed on the parent).
- **On the deal:** **read-only** download links, grouped by area, in the deal's service-info area under Notes.

## Architecture

Reuse the existing `attachments` table (`parent_type='job'`, `parent_id=jobId`) — no new table. Tag service files via the existing `kind` column with `svc_local` / `svc_web` / `svc_webdev`. A pure helper decides which areas a job shows; RLS tightens upload/delete of `svc_*` files to the owning group; a small gated component renders each area in the Info tab; a read-only component surfaces them on the deal. Group codes already equal service types (`local_seo`, `web_seo`, `web_dev`), so the kind→group map is direct.

## Tech Stack

React + Vite + TypeScript, @tanstack/react-query, react-i18next, shadcn/ui, Supabase Postgres + Storage (`attachments` bucket), Vitest, Playwright (real-UI verification). Reuses `AttachmentsPanel`/`useAttachments`/`useUploadAttachment`/`useDeleteAttachment`, `serviceInfoFields.ts`/`JobInfoPanel`, `DealServiceInfo`, and `useAuthStore` (`isAdmin` + `groupCodes`).

## Areas & mapping

```
AREA            kind          label (en/el)            owning group
Local SEO       svc_local     Local SEO / Local SEO    local_seo
Web SEO         svc_web       Web SEO / Web SEO         web_seo
Web Dev         svc_webdev    Web Dev / Web Dev         web_dev
```

`areasForJob(job)` (pure, unit-tested):
- `job.parent_job_id != null` → `[]` (AI SEO child; managed on the parent)
- `service_type === 'ai_seo'` → `[Local, Web]`
- `service_type === 'local_seo'` → `[Local]`
- `service_type === 'web_seo'` → `[Web]`
- `service_type === 'web_dev'` → `[WebDev]`
- else → `[]`

`canUploadArea(isAdmin, groupCodes, area)` = `isAdmin || groupCodes.includes(area.groupCode)`.

## Backend (RLS)

Add a helper and tighten only `svc_*` writes; everything else (contracts/invoices/other on deals/clients/leads, generic job files) is unchanged.

```sql
create or replace function public.current_user_in_group(p_code text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_groups ug
    join public.groups g on g.id = ug.group_id
    where g.code = p_code and ug.user_id = auth.uid()
  );
$$;
```

- **INSERT** (`with check`): `auth.uid() = uploaded_by AND ( kind is null OR kind not in ('svc_local','svc_web','svc_webdev') OR current_user_is_admin() OR (kind='svc_local' and current_user_in_group('local_seo')) OR (kind='svc_web' and current_user_in_group('web_seo')) OR (kind='svc_webdev' and current_user_in_group('web_dev')) )`
- **DELETE** (`using`): `current_user_is_admin() OR auth.uid() = uploaded_by OR (kind='svc_local' and current_user_in_group('local_seo')) OR (kind='svc_web' and current_user_in_group('web_seo')) OR (kind='svc_webdev' and current_user_in_group('web_dev'))` — preserves existing uploader/admin delete, adds group-delete for service files.
- **SELECT**: unchanged (admin / `clients.view` / `sales.view`); all relevant groups already have `clients.view`, so service teams and accounting can view.

## Frontend

- `src/features/attachments/serviceAreas.ts` (+ test) — `AREA` constants, `areasForJob`, `canUploadArea`.
- `ServiceAttachmentsSection` (`{ jobId, area, canUpload }`) — lists that area's files (`useAttachments` filtered to the area's kind) as download links; shows an upload control + per-file delete only when `canUpload`. Reuses `useUploadAttachment` (passes `kind=area.kind`) + `useDeleteAttachment`.
- `JobInfoPanel` renders `areasForJob(job).map(...)` below the info fields, each `<ServiceAttachmentsSection>` with `canUpload = canUploadArea(isAdmin, groupCodes, area)`.
- `DealServiceAttachments` (`{ dealId }`) — read-only: fetches the deal's jobs (`useDealJobs`) then their `svc_*` attachments, grouped by area, as download links. Rendered next to `DealServiceInfo` (under `DealNotesArea` on the deal page). No upload/delete.
- Generic job **Attachments tab**: filter out `svc_*` kinds so service files appear only in the Info-tab areas.
- i18n: new keys in `jobs.json` (area labels, "Service files", upload/empty strings) en + el.

## Behavior / Edge cases

- Same file area appears in exactly one place (Info-tab area on the owning job), and read-only on the deal. AI SEO child jobs show no area.
- A non-owning team (e.g. web on a Local area) sees the files + download, but no upload/delete control; RLS also blocks the write.
- Accounting sees read-only links on the deal; cannot upload/delete anywhere.
- Deleting an attachment removes the Storage object **and** the row (existing `useDeleteAttachment` behavior).

## Out of scope (YAGNI)

No file-type/size limits beyond Storage defaults; no versioning; no per-file notes; no edit-after-upload (delete + re-upload); no new capability rows (gating is group-membership based).

## Testing — REAL-USER, per group (hard requirement)

Verify **through the deployed UI as a real user** (Playwright, clicking like a person — not SQL/RPC shortcuts), so genuine product problems surface. Steps:

1. **Create one test account per group** (via the documented auth-user recipe): `local_seo`, `web_seo`, `web_dev`, and `accounting`. Each a non-admin member of exactly its group, password set, login-ready (normalize GoTrue token columns).
2. **As the Local user:** open a `local_seo` job and an `ai_seo` job → upload a file in the **Local** area (succeeds); confirm there is **no upload control** in the **Web** area on the AI SEO job.
3. **As the Web user:** upload in the **Web** area of the AI SEO job (succeeds); confirm **no** upload control on the Local area; on a `web_seo` job, upload succeeds.
4. **As the Web Dev user:** upload in the Web Dev area of a `web_dev` job (succeeds); confirm no upload control on Local/Web areas elsewhere.
5. **Cross-group denial:** confirm a non-owning user cannot upload to another area (no control; and an attempted write is RLS-denied).
6. **As the Accounting user:** open the deal(s) for the above jobs → see the **read-only** Service files card with download links; confirm **no** upload/delete; download works.
7. **Unit tests:** `areasForJob`, `canUploadArea`. **Build:** `npm run build` strict. **Suite:** `npm run test:run`.

**Cleanup (mandatory):** delete every test attachment created during the run — **both** the Storage objects and the `attachments` rows — and delete the **test accounts** (auth user cascade → profile/identity/group). Verify zero residue (no `svc_*` rows for the test jobs, accounts gone). Use empty/safe jobs and never disturb real users.

## Changes / Revert

**Changes:** `current_user_in_group()` helper + tightened `attachments` INSERT/DELETE policies; new `serviceAreas.ts`, `ServiceAttachmentsSection`, `DealServiceAttachments`; `JobInfoPanel`, deal page, generic Attachments tab, i18n edits.

**Revert:** restore the prior `attachments_insert`/`attachments_delete` policies (open self/uploader+admin); `drop function current_user_in_group`; revert the frontend additions. No data migration to undo (kind values are additive; any `svc_*` rows can be left or cleared).
