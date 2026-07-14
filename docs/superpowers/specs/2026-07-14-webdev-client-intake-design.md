# Web Dev Client Intake Form — design (as shipped 2026-07-14)

Port of the standalone `info-website-main` app into the CRM. Clients of web_dev
jobs fill a public, token-gated Greek/English wizard (business info, logo,
photos/files up to 500 MB each, WhatsApp-button preference, domain choice); the
answers and files appear on the web_dev job's Info tab. Data lives entirely in
the CRM's own Supabase — the old info-website project (`dakvgxcvwnbedykwpzmm`)
is untouched and can be decommissioned.

## Decisions
- Same field set as info-website (schema ported verbatim), rebuilt as a 4-step
  wizard with progress, per-step validation, autosave (server patch + localStorage
  fallback), EL default + EN toggle.
- Link is REOPENABLE: `submitted` stays valid so clients can return with the
  missing logo/photos; only staff "Mark complete" (status `locked`) or the
  30-day expiry kill it. Regenerate/Reopen bump expiry.
- Staff card on the job Info tab: badge Not sent / Sent / Submitted / Complete,
  missing-item chips, Send (client email) / Copy / Regenerate / Lock / Reopen,
  grouped answers, logo+files galleries (AttachmentGallery, `bucket` prop).
- No old-data migration.

## Architecture
- **DB** (`20260714150000_webdev_client_intake.sql`): `job_intake_forms`
  (job_id PK, token unique, status draft|submitted|locked, data jsonb,
  logo_path, locale, expires_at, sent/first_submitted/submitted/locked audit),
  `job_intake_files`, private bucket `client-intake` (500 MB), AFTER-UPDATE
  trigger on submitted_at → activity_log + internal email per web_dev member.
  RLS: staff select; insert creator-only; update admin/web_dev-edit/
  accounting_onboarding-edit. ZERO anon policies.
- **Public API** `api/client-intake.ts` (Vercel, service_role, Sentry, 60/min/IP
  rate limit): actions load / save (whitelisted shallow-merge) / upload-url
  (signed upload URLs; logo pre-signed with upsert) / file-added / file-removed /
  submit (shared-zod validation; DB trigger owns notifications). Token
  precedence not_found → locked → expired → valid via shared module.
- **Shared module** `src/lib/clientIntake.ts` — single source for schema,
  limits, link-state, missing-items, sanitizer. NOTE: any src module bundled by
  api/ MUST use `.js` extensions on relative imports (Vercel ESM runtime).
- **Wizard** `src/features/intake/` at `/f/:token` (outside ShellLayout, no
  supabase in module graph), i18n namespace `intake`.
- **Staff card** `src/features/jobs/ClientIntakeSection.tsx` + `useJobIntake`
  hooks; send mirrors `useRequestSeoAccess` (identity accounting) with template
  `webdev_client_form`; stamps `sent_at`.
- **Email templates** (DB-editable): `webdev_client_form` (client, Greek,
  `{{code}}` subject prefix, body ends at content), `internal_webdev_form_submitted`.

## Verification (all on prod, 2026-07-14)
Rollback-guarded trigger test; deployed curl matrix (403/400/413 paths, upload
flow, traversal block); Playwright E2E: staff Create → client wizard fill with
logo+PDF uploads → submit → Info tab shows all answers + preview tiles →
Mark complete → public link locked → Reopen. Client email rendered + delivered
(to owner's address). 56 unit tests + strict build green.

## Changes / Revert
Commits `a103917` (DB), `6330bc3` (shared module), `41aafdb`+`222d43e` (API +
ESM fix), `78a9f77` (wizard), `86ec474` (staff card), docs/memory commit.
Migration rollback SQL is in the migration header (bucket objects via Storage
API only — protect_delete). Frontend/API revert = git revert of the commits.
`jobs.details` untouched.

## Known follow-ups (deliberate)
- Kanban-card badge for intake status (Info-tab badge shipped; board badge skipped).
- The submit trigger doesn't check `email_automation_settings` (internal alert
  always enqueues; send-side dept gates still apply) — wire if ever needed.
- Activity entry shows "no changes" on a re-submit with unchanged status (cosmetic).
- Old info-website data migration if ever wanted (name-matching pass).
