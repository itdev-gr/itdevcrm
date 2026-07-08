# Combined "Attachments" tab (Files + Offers + Pro Formas + Contracts)

**Date:** 2026-07-08
**Status:** Approved scope/layout via user selections; auto-upload handling assumed (see Open decision below)

## Goal

Replace the separate Attachments / Offers / Pro Formas / Contracts tabs on the detail
pages with ONE tab named "Attachments" that contains all of them, without disturbing
any existing offer / pro-forma / contract operation (create, send, PDF, status flows).

## User decisions

- **Scope:** all 3 detail pages (user-selected).
  - Deal page: Attachments + Offers + Pro Formas + Contracts → one tab (9 tabs → 6).
  - Lead page: Attachments + Offers + Pro Formas → one tab (6 tabs → 4).
  - Client page: Attachments + Contracts → one tab (7 tabs → 6).
- **Layout:** stacked sections inside the one tab (user-selected): Files (upload + list),
  Offers, Pro Formas, Contracts — each with a section header, all visible at once.
- **Open decision (assumed, flag for user):** auto-uploaded PDFs are surfaced via a
  per-row **PDF** download button on each offer / pro-forma / contract row, reusing the
  existing `useDownloadOfferPdf` / `useDownloadProFormaPdf` / `useDownloadContractPdf`
  hooks (same regenerate-and-open-signed-URL flow as the detail pages). Storage buckets
  (`offer-pdfs`, `proforma-pdfs`, `contract-pdfs`), the `/api/*-pdf` endpoints, and the
  email send flows are **not** touched. Alternative the user may still pick: also upsert
  a row in the `attachments` table on each PDF generation so the files appear in the
  Files list (touches the 3 API endpoints — riskier, not done in this design).

## Current state (verified 2026-07-08)

- `DealDetailPage.tsx` — separate TabsTriggers/TabsContents for `attachments`
  (`AttachmentsPanel parentType="deal"`), `offers` (`OffersTab dealId`), `proformas`
  (`ProFormasTab dealId`), `contracts` (`ContractsTab clientId` — only when
  `deal.client_id`).
- `LeadDetailPage.tsx` — separate tabs `attachments`, `offers`, `proformas`. The lead
  Overview tab ALSO embeds an inline `AttachmentsPanel` section — that stays untouched.
- `ClientDetailPage.tsx` — separate tabs `attachments`, `contracts`.
- `OffersTab` / `ProFormasTab` / `ContractsTab` are thin read-only lists whose rows link
  to `/offers/:id`, `/proformas/:id`, `/contracts/:id`; all real operations live on those
  detail/builder pages (routes untouched). `ContractsTab` also carries the
  "+ New contract" button (`/contracts/new?clientId=…`) — it carries over as-is.
- Offer/pro-forma creation entry points are on `LeadForm` (buttons →
  `/leads/:id/offers/new`, `/leads/:id/proformas/new`) — untouched.
- Auto-upload today: `/api/offer-pdf`, `/api/proforma-pdf`, `/api/contract-pdf` upsert
  the generated PDF to `offer-pdfs/offers/<id>.pdf`, `proforma-pdfs/proformas/<id>.pdf`,
  `contract-pdfs/contracts/<id>.pdf` and return a signed URL. `useSendContract` emails
  the storage-backed attachment from `contract-pdfs`. None of this changes.
- No deep links `?tab=offers|proformas|contracts` exist anywhere (grepped src/api/supabase);
  the three pages use `Tabs defaultValue="overview"` with no URL syncing. No Playwright
  tests reference the removed tab names.

## Design

### New shared component

`src/features/attachments/CombinedAttachmentsTab.tsx`

```
type Props = {
  parentType: 'lead' | 'deal' | 'client';   // for the Files panel
  parentId: string;
  leadId?: string;    // show Offers + Pro Formas sections scoped to lead
  dealId?: string;    // show Offers + Pro Formas sections scoped to deal
  clientId?: string;  // show Contracts section
};
```

Renders stacked sections, each a bordered card with an uppercase section header:

1. **Files** — existing `AttachmentsPanel` (unchanged component).
2. **Offers** — `OffersTab` (when `leadId` or `dealId`).
3. **Pro Formas** — `ProFormasTab` (when `leadId` or `dealId`).
4. **Contracts** — `ContractsTab` (when `clientId`), including its "+ New" button.

### Per-row PDF button

`OffersTab`, `ProFormasTab`, `ContractsTab` each get a small "PDF" button per row next
to "View →", wired to the existing download hooks (pending state while generating;
error surfaced the same way the detail pages do). Gating identical to the detail pages
(no status gating — Download works for any status, same as today).

### Page wiring

- **DealDetailPage:** `attachments` TabsContent → `CombinedAttachmentsTab
  parentType="deal" parentId={dealId} dealId={dealId} clientId={deal.client_id ?? undefined}`.
  Remove the `offers`, `proformas`, `contracts` triggers + contents.
- **LeadDetailPage:** `attachments` TabsContent → `CombinedAttachmentsTab
  parentType="lead" parentId={leadId} leadId={leadId}`. Remove `offers` + `proformas`
  triggers + contents. Overview inline Files section stays as-is.
- **ClientDetailPage:** `attachments` TabsContent → `CombinedAttachmentsTab
  parentType="client" parentId={clientId} clientId={clientId}`. Remove `contracts`
  trigger + content.

### i18n

New keys in the `sales` namespace (both `el` and `en`), used by the shared component:
`attachments.sections.files`, `attachments.sections.offers`,
`attachments.sections.proformas`, `attachments.sections.contracts`,
`attachments.pdf` (row-button label). Tab label stays each page's existing
`tabs.attachments` key. Unused `tabs.offers` / `tabs.proformas` keys are left in place
(harmless; avoids cross-namespace churn).

### Explicitly NOT changed

- `/api/offer-pdf`, `/api/proforma-pdf`, `/api/contract-pdf` and their buckets/paths.
- `useSendContract` email + status flow; offer/pro-forma/contract detail + builder pages
  and routes; `LeadForm` create buttons.
- `AttachmentsPanel` upload flow, `attachments` table/bucket, RLS.
- Lead Overview inline attachments section; deal Overview `DealServiceAttachments`
  (service `svc_*` attachments) and job-page attachments (`hideKinds`) — unrelated.

## Error handling

- PDF row button failure → same error surfacing as the existing hooks (toast/alert),
  button returns to idle.
- Sections render independently: one section's query error shows that section's error
  text (existing per-list behavior), others still render.

## Testing

- Vitest component tests (mocked hooks, no network — suite runs against prod otherwise):
  section visibility per props (deal shows 4, lead 3, client 2), PDF button invokes the
  right hook, contracts "+ New" link preserved.
- `npm run build` (strict tsc + eslint) — the authoritative frontend gate.
- Manual/Playwright smoke on one deal, one lead, one client detail page.

## Changes / Revert

- Pure frontend change (components + 3 page files + 2 locale files). No DB, no storage,
  no API changes. Revert = `git revert` of the feature commits; no data migration.
