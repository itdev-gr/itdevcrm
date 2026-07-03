# Hosting info on the Web Dev Info tab — design

**Date:** 2026-07-03 · **Status:** Approved (brainstorm)

## Context

When a Web Dev job's owner opens the job's **Info** tab, they should see whether the client also has **hosting** with us. Today there's no cross-reference (the web_dev Info tab only has editable fields, incl. a free-text `hosting` note). 23 of 46 web-dev jobs belong to a client that also has a hosting job.

## Design

A small read-only component `HostingInfoSection` rendered inside the web_dev Info tab (`JobDetailPage.tsx`, inside the Info `TabsContent` card, after `JobInfoPanel`), gated by `job.service_type === 'web_dev'`.

- **Data:** the existing `useJobsForClient(job.client_id)` hook (already joins `stage`, has realtime invalidation), filtered to `service_type === 'hosting'` non-archived jobs. **No new query, hook, or migration.**
- **Renders nothing** when the client has no hosting job (like the web_seo website block returns null).
- **Per hosting job** it shows (confirmed with the owner): a **link** to the hosting job (its `code`, → `/jobs/:id`), the **status** (Active / Done via `hostingStatus(job)` from `hostingList.ts`, using the joined `stage.code`), and the **renewal due date** (`period_due_date`, via `formatDate`). No amount.
- Styled as a bordered sub-section (`border-t`) inside the existing Info card — not a nested card.

## Out of scope / preserved

Read-only only — no edits to the hosting job from here. The existing editable web_dev `hosting` free-text field, JobInfoPanel, and attachments are untouched. Hosting jobs carry no `details`, so no domain/creds are shown.

## Changes / Revert

**Changes** — new `src/features/jobs/HostingInfoSection.tsx`; one gated line + import in `src/features/jobs/JobDetailPage.tsx`.
**Revert** — delete `HostingInfoSection.tsx`; remove the import + the one `{job.service_type === 'web_dev' && …}` line.
