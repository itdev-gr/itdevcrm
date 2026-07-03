# Pro Forma Documents — Design

**Date:** 2026-07-03
**Status:** Approved (owner directive: mirror the Offer feature; recommended options accepted by default)

## Purpose

Add a **Pro Forma** document type that mirrors the existing Offer feature: same service catalog and prices, same builder UX, same per-lead/per-deal tabs, same PDF download flow — but rendered as a payment document («ΠΡΟΤΙΜΟΛΟΓΙΟ») rather than a marketing proposal.

A pro forma is what the client receives to pay against **before** a tax invoice exists. It is explicitly *not* a tax document.

## Decisions (owner-approved defaults)

1. **Creation flow:** standalone builder (identical to the offer builder, same catalog & prices) **plus** a "Create Pro Forma" button on the Offer detail page that pre-fills the builder with that offer's exact items, prices, discount, VAT, currency and notes.
2. **PDF style:** invoice-style Greek document — title «ΠΡΟΤΙΜΟΛΟΓΙΟ», IT DEV branding (same teal palette + text logo), document number & dates, recipient, line-items/totals table, the existing bank/payment-details section, and a note that this is not a tax invoice. No marketing sections (no "Who we are", mission, services accordion).
3. **No pipeline side effects:** creating a pro forma never moves the lead's stage and never schedules follow-ups (offers do both; pro formas do neither).
4. **Statuses:** `draft / sent / paid / cancelled`. `sent_at` set when → sent (mirrors offers); `paid_at` set when → paid.

## Approaches considered

- **A. Copy-adapt (chosen).** Clone the offer pages/hooks into `src/features/proformas/` + `api/proforma-pdf.ts`, reusing every already-shared unit (catalog hook, `OfferSummaryPanel`, `calculate.ts`, types). This is the pattern the Contract feature already used successfully, and it carries **zero regression risk** to the mature, revenue-critical offer flow.
- **B. Parametrize the builder.** Refactor `OfferBuilderPage` into a shared `DocumentBuilderPage` with a `docType` config. Less duplication, but it rewrites a shipped 24 KB page for a second consumer and risks offer regressions for little user-visible gain.
- **C. Pro forma as an offer row with a `kind` column.** Smallest schema change, but pollutes offer numbering, statuses, RLS and the follow-up trigger with conditionals; rejected.

Chosen: **A**, with genuinely shared logic extracted where it is pure and small (see "Shared units").

## Data model

New table `public.pro_formas` — mirror of `offers` with these differences:

| difference | offers | pro_formas |
|---|---|---|
| number | `OFR-YYYYMM-####` via `offers_seq` | `PRF-YYYYMM-####` via new `pro_formas_seq` (global monotonic counter, month prefix — same semantics as offers) |
| statuses | draft/sent/accepted/rejected/expired | `draft/sent/paid/cancelled` |
| paid_at | — | `paid_at timestamptz` (set when status → paid) |
| source link | — | `source_offer_id uuid FK → offers ON DELETE SET NULL` (set when created via the from-offer shortcut) |
| created_by | never populated (known gap) | populated by the create hook (`auth.uid()`) |
| AFTER-INSERT trigger | moves lead to offer_sent + schedules follow-up | **none** |

Everything else identical: `id, lead_id, deal_id, client_id, pro_forma_number, currency (EUR/USD/GBP), discount_amount ≥ 0, vat_percent 0–100, validity_days 1–365 default 14, notes, items jsonb (CHECK array), totals jsonb (CHECK object), pdf_path, created_at, sent_at, updated_at` + the same indexes (lead/deal/client/status-recent/unique number), `set_updated_at` trigger, realtime publication.

**RLS:** identical policy shapes to `offers` (SELECT admin / accounting-view / lead-or-deal owner-or-winner; INSERT admin / sales; UPDATE admin / sales / accounting_onboarding). Copied from the live `offers` policies — read the live definitions first (prod drift rule), not just the .sql files.

**Storage:** new private bucket `proforma-pdfs`, path `proformas/{id}.pdf`, same policy set as `offer-pdfs` including the UPDATE policy for upsert.

One migration file, with rollback SQL in a trailing comment block (project convention).

## Components

**Shared units (reused, not copied)**
- `src/lib/offers/calculate.ts` (`calculateTotals`, `formatEur`) and `src/lib/offers/types.ts` (`OfferItem`, `OfferTotals`) — pro formas use identical line-item/totals math and shapes.
- `src/features/offers/hooks/useOfferCatalog.ts` and `OfferSummaryPanel.tsx` — catalog and summary table are document-agnostic already.
- Recipient resolution: extract `resolveOfferRecipient` from `api/offer-pdf.ts` into `api/_recipient.ts` (underscore = not an endpoint); both PDF endpoints import it; existing unit tests move with it and stay green.

**New units**
- `src/lib/proformas/fromOffer.ts` — pure helper mapping an offer row → builder initial state (items, discount, vat, currency, notes). Unit-tested (TDD).
- `src/features/proformas/` — `ProFormaBuilderPage.tsx` (copy-adapt of the offer builder: same catalog picker, VAT seeding from lead country via `effectiveVatRate`, pre-select from `services_planned`; additionally reads `?fromOffer=<id>` and pre-fills from that offer via `fromOffer.ts`), `ProFormaDetailPage.tsx` (status select with the 4 new statuses + badge colors, Download PDF with the same popup-blocker pattern, Send-by-email button), `ProFormasTab.tsx`, hooks (`useCreateProForma` — sets `created_by`, `useProForma`, `useProFormasForLeadOrDeal`, `useUpdateProFormaStatus` — stamps `sent_at`/`paid_at`, `useDownloadProFormaPdf`).
- `api/proforma-pdf.ts` — clone of `offer-pdf.ts` against `pro_formas`/`proforma-pdfs`; registered in `vercel.json` (`maxDuration: 60`, chromium `includeFiles`).
- `api/_proforma-pdf-template.ts` — new invoice-style template (see PDF section).

**Wiring**
- Routes: `leads/:leadId/proformas/new` → builder; `proformas/:proFormaId` → detail (lazy, mirroring offers in `src/app/router.tsx`).
- `LeadForm.tsx`: "Create pro forma" button next to "Create offer" (same visibility rules).
- `OfferDetailPage.tsx`: "Create Pro Forma" button → `/leads/{offer.lead_id}/proformas/new?fromOffer={offer.id}`; hidden when `offer.lead_id` is null.
- Lead + Deal detail pages: "Pro Formas" tab next to the Offers tab (`<ProFormasTab leadId/dealId>`).
- i18n: `tabs.proformas` (EN "Pro Formas" / EL «Προτιμολόγια»), `record_type.proforma` (EN "Pro Forma" / EL «Προτιμολόγιο»), `email.proforma.subject/body` in both locales.
- Email: `buildProFormaDraft(name, url)` in `buildDraft.ts`; ProFormaDetailPage gets a "Send by email" button opening the existing `SendEmailDialog` (identity `personal`) prefilled with the draft, matching the offer-send pattern.

## PDF document

`renderProFormaHtml()` — self-contained HTML (Tailwind CDN, same fonts/palette as the offer template: `#118b8f / #0f6f7c / #0b2f41 / #5aa9a5`), rendered by puppeteer as a single tall page (width 210 mm, dynamic height — same mechanism as offers). Sections, in order:

1. **Header** — IT DEV text logo (same markup as offer template) + title «ΠΡΟΤΙΜΟΛΟΓΙΟ» + document number (`PRF-…`).
2. **Meta row** — issue date and «Ισχύει έως» (created_at + validity_days), `el-GR` formatting.
3. **Parties** — issuer block (IT DEV E.E., ΑΦΜ 802223278 — same details already hardcoded in the offer template) and recipient («Προς:» client name → lead name → "Client", via shared `resolveOfferRecipient`).
4. **Items table** — Κατηγορία / Υπηρεσία / Ποσότητα / Τιμή / Σύνολο with "/ μήνα" suffix for monthly categories, then Μερικό σύνολο / Έκπτωση / ΦΠΑ % / **Σύνολο** — identical math and formatting to the offer PDF.
5. **Notes** — optional «Σημειώσεις».
6. **Payment details** — the existing «Τρόποι πληρωμής» block (Τράπεζα Πειραιώς IBAN, Revolut, Viva Wallet) copied verbatim from the offer template, plus «Παρακαλούμε αναγράψτε τον αριθμό προτιμολογίου στην αιτιολογία» (reference the PRF number in the payment).
7. **Footer note** — «Το παρόν προτιμολόγιο δεν αποτελεί φορολογικό παραστατικό.» (not a tax document).

## Error handling

Same shapes as offers: PDF endpoint is `withSentry`-wrapped, returns 4xx with message on auth/not-found, mutation hooks use `captureMutation`, download button alerts on failure and closes the placeholder tab. Builder submit disabled while pending; `fromOffer` pre-fill falls back silently to the normal lead pre-fill if the offer can't be loaded or belongs to a different lead.

## Testing

- Unit (vitest): `fromOffer.test.ts` (offer row → builder state, including custom-priced items and subpackage lines); `api/_recipient.test.ts` (moved existing `resolveOfferRecipient` tests); totals math already covered by `calculate.test.ts`.
- Build gate: `npm run build` (strict tsc + eslint --max-warnings=0).
- Live smoke (post-deploy): create a pro forma from a test lead as info@itdev.gr, verify PRF number, statuses, PDF download, from-offer pre-fill; then delete the test rows. NB: vitest runs against prod — run only the targeted new/moved test files.

## Changes / Revert

**Changes**
- 1 migration: `pro_formas` table + sequence + trigger + RLS + realtime + `proforma-pdfs` bucket & policies.
- New files under `src/features/proformas/`, `src/lib/proformas/`, `api/proforma-pdf.ts`, `api/_proforma-pdf-template.ts`, `api/_recipient.ts`.
- Edits: `router.tsx`, `LeadForm.tsx`, `OfferDetailPage.tsx`, `LeadDetailPage.tsx`, `DealDetailPage.tsx`, `buildDraft.ts`, `api/offer-pdf.ts` (import shared recipient), `vercel.json`, i18n jsons, `queryKeys.ts`, regenerated `types/supabase.ts`.

**Revert**
- Frontend/API: revert the commits (atomic, one per task).
- DB rollback SQL (kept in the migration's comment block): `drop table public.pro_formas cascade; drop sequence public.pro_formas_seq; delete from storage.buckets where id = 'proforma-pdfs';` (+ drop the bucket's policies; storage objects deleted via dashboard — `protect_delete` blocks SQL deletes).
