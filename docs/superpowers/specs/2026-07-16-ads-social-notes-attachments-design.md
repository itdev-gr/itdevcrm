# Design: Ads + Social service attachments & Social notes

**Date:** 2026-07-16
**Status:** Design approved in conversation. Product decisions confirmed: scope =
Ads AND Social; ads gets no extra Info fields (notes already shipped as
`ads_notes`, commit 6471cc1).

## Problem

On the deal page, Dev and SEO services surface two things ads/social lack:

- **Service info card** (`DealServiceInfo`) — per-service notes/fields marked
  `sharedWithDeal`. Ads already participates (`ads_notes`); social_media has no
  Info fields at all, so social jobs have no Info tab and nothing shared.
- **Service attachments card** (`DealServiceAttachments`) — files uploaded into
  per-service areas (`svc_local`/`svc_web`/`svc_webdev`) on the job Info tab.
  Neither ads nor social has an area, so neither can upload service files.

Goal: parity. Social gets a notes field; both ads and social get attachment areas.

## What ships

### 1. Social notes (`src/features/jobs/serviceInfoFields.ts`)

```ts
const SOCIAL: InfoField[] = [
  { key: 'social_notes', labelEn: 'Social Media Notes', labelEl: 'Σημειώσεις Social Media', type: 'textarea', sharedWithDeal: true },
];
```

plus `social_media: SOCIAL` in `SERVICE_INFO_FIELDS` (and the type annotation's
explicit key list). Knock-on effects, all automatic:

- Social jobs gain the **Info tab** (`JobDetailPage.tsx` gates it on
  `infoFieldsFor(...).length > 0` — lines 403/646) with the editable textarea
  (autosaved into `jobs.details` JSONB like every other Info field).
- Filled notes appear on the deal page's Service info card via
  `sharedDealFields` (`serviceInfoFields.ts:75-90`).
- The `recurring_monthly`-without-fields fallback at `JobDetailPage.tsx:431` no
  longer applies to social jobs (they now have fields) — intended.

### 2. Attachment areas (`src/features/attachments/serviceAreas.ts`)

Two new areas, following the existing shape exactly:

```ts
export type AreaKind = 'svc_local' | 'svc_web' | 'svc_webdev' | 'svc_ads' | 'svc_social';
export type AreaGroup = 'local_seo' | 'web_seo' | 'web_dev' | 'ads' | 'social_media';

export const ADS_AREA: ServiceArea = { kind: 'svc_ads', labelEn: 'Ads', labelEl: 'Ads', groupCode: 'ads' };
export const SOCIAL_AREA: ServiceArea = { kind: 'svc_social', labelEn: 'Social Media', labelEl: 'Social Media', groupCode: 'social_media' };
```

`SERVICE_AREA_KINDS` + `BY_KIND` extended; `areasForJob` gains
`case 'ads': return [ADS_AREA]` and `case 'social_media': return [SOCIAL_AREA]`.

Downstream picks everything up with no further code changes:

- Job Info tab upload sections: `areasForJob(job).map(area => <ServiceAttachmentsSection …/>)`
  (`JobDetailPage.tsx:~655`).
- Deal card + query: `DealServiceAttachments.tsx` and
  `useDealServiceAttachments.ts` both iterate `SERVICE_AREA_KINDS`.
- Upload/delete button gating: `canUploadArea(isAdmin, groupCodes, area)` —
  groups `ads` and `social_media` exist in prod (verified live 07-16).

### 3. DB (one migration)

`attachments.kind` is free text with no CHECK (`20260502000009:80`), so the only
DB surface is the two RLS policies from `20260624140000_service_attachment_rls.sql`
— recreate both with the new branches:

- `attachments_insert` WITH CHECK: extend the gated-kinds list to
  `('svc_local','svc_web','svc_webdev','svc_ads','svc_social')` and add
  `(kind = 'svc_ads' and current_user_in_group('ads'))` /
  `(kind = 'svc_social' and current_user_in_group('social_media'))` branches.
- `attachments_delete` USING: add the same two group branches.

Live policy expressions verified 07-16 to match the repo migration exactly (no
drift). `current_user_in_group` already exists and is granted. No storage-bucket
changes (svc gating lives at the attachments table only, per 20260624140000).

Alternative considered and rejected: a SQL kind→group mapping function — the
codebase style is explicit branches and there are only five kinds.

## Testing (TDD)

- `serviceAreas.test.ts`: `areasForJob` for ads/social_media; `areaForKind` for
  the new kinds; hosting/ai_seo-parent still return `[]`.
- `serviceInfoFields.test.ts`: `infoFieldsFor('social_media')` returns the notes
  field; `sharedDealFields('social_media', {social_notes: 'x'})` surfaces it.
- `DealServiceInfo.test.tsx`: a social job with notes renders a Social row.
- Migration post-assert (DO block): both policy expressions contain `svc_ads`
  and `svc_social`.
- Manual smoke: upload a file in the ads job Info tab as admin → appears on the
  deal's Service attachments card under "Ads"; social notes typed on a social
  job appear on the deal's Service info card.

## Changes / Revert

- **Changes:** one migration (two policies) + two frontend commits
  (serviceInfoFields + serviceAreas, each with tests). Direct to main.
- **Revert:** re-run the policy definitions from
  `20260624140000_service_attachment_rls.sql` (verified identical to live
  pre-change); revert the frontend commits. Already-uploaded svc_ads/svc_social
  files keep their rows/storage objects but stop being uploadable/visible in
  service areas after revert — acceptable; delete manually if ever needed.
