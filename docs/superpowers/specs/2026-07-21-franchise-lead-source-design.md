# Franchise lead source — design

Date: 2026-07-21
Status: approved by owner (chat)

## Goal

Add `franchise` as a third lead source next to Meta and Manual. Franchise leads are created manually for now (New-lead dialog). NO automated email may ever be sent to a franchise-source lead until the owner explicitly enables it — future franchise-specific flows come in later steps.

## Decisions (owner, 2026-07-21)

- Creation: manual only for now; automated feed/intake is a later step.
- Emails: total silence for franchise leads, enforced centrally.
- Won-boundary: if a franchise lead is won, today's client-level emails (won_welcome, onboarding) still apply — owner will decide on those in the next steps.

## Changes

### DB (migration `20260721100000_franchise_lead_source.sql`)
- `leads_source_check` → `source in ('meta','manual','import','franchise')` (drop + re-add constraint).
- **Central email gate:** `enqueue_lead_email(...)` gets a guard at the top — if the lead's `source = 'franchise'`, return without enqueueing. This single choke point covers the Unique-Lead welcome trigger (`leads_email_automations`) and every other current/future lead-email call site. Live body captured via `pg_get_functiondef` before editing (prod drift); pre-image saved; ROLLBACK documented.
- `lead_intake.source` untouched (franchise doesn't flow through intake yet).

### Frontend
- `'franchise'` added to the source unions and option lists: `CreateLeadDialog` (picker), `salesBoardFilterStore` + sales-board source filter UI, leads-table filter, `LeadRowEditor`, source badge renderers, `useLeads` types.
- i18n en+el: label "Franchise" wherever source labels are translated.

## Non-goals
- Automated franchise ingestion/webhook and Lead-Intake handling.
- Franchise-specific email templates/flows.
- Suppressing client-level emails after a franchise lead is won.

## Testing
- Rollback-wrapped prod harness: insert a franchise lead entering Unique Lead → assert NOTHING enqueued in the email queue/log; control manual lead in the same transaction DOES enqueue; rollback.
- Frontend: extend existing test files touching source unions; file-scoped vitest only; `npm run build` clean.

## Changes / Revert
- Migration rollback: restore prior CHECK; restore `enqueue_lead_email` pre-image (saved under `.superpowers/sdd/`).
- Frontend: revert commit.
