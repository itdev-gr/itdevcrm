# Surface campaign data into leads — design

**Date:** 2026-06-22
**Status:** approved (design)

## Problem

For leads that came from Meta ad imports, information we already store is invisible in the app:

- **Company name** — `leads.company_name` is `null` even though it sits in `source_data` under `όνομα_εταιρείας`.
- **Lead info (`leads.notes`)** — empty; the **form name** and the campaign **question → answer** pairs never landed there.

Evidence (real released imported leads, 2026-06-22): `company_name = null`, `notes = null`, while `source_data` holds `form_name` (e.g. `📍 LOCAL SEO LEAD FORM — ITDEV`), `όνομα_εταιρείας`, and Greek Q&A keys such as `έχεις_google_business_profile_(google_maps);` and `ποιο_είναι_το_βασικό_σου_πρόβλημα_σήμερα;`.

Same family as the phone gap: data captured into `source_data`, never mapped to structured fields or assembled into Lead info. The import path (unlike the Meta webhook) doesn't assemble notes, and these rows predate the column-mapping fixes.

## Decisions (approved)

1. **Presentation:** write the campaign data into the **editable Lead info** field (`leads.notes`), not a separate read-only panel.
2. **Company:** also populate the structured **Company** field (`leads.company_name`) + backfill existing.
3. **Formatting:** humanize the Greek question labels and hide raw system IDs.

Accepted trade-off: because it lands in the editable notes, a rep who clears that text loses the campaign data from view (still preserved in `source_data`).

## Design

No frontend changes — the lead page already renders the Lead info (`notes`) textarea (`LeadForm.tsx:165`) and the Company field (`company_name`). They're just empty. This is a backend/data change.

### A. Formatter — `build_lead_info_block(p_source_data jsonb, p_title text) returns text`

Pure SQL function (single source of truth for release + backfill):

- **Form line:** `Φόρμα: <source_data->>'form_name'>` (NOT `title` — for imports `title` is the person's name).
- **Q&A:** iterate `jsonb_each_text(source_data)`; for each non-skipped key with a non-empty value, emit `humanize(key): value`.
- **humanize(key):** replace `_`→space, strip trailing `;`/`:`, trim, collapse whitespace. (Greek case left as-is.)
- **skip_keys** (case-insensitive): system — `id, leadgen_id, key, page_id, source, lead_status, form_id, form_name, campaign_id, campaign_name, ad_id, ad_name, adset_id, adset_name, platform, is_organic, created_time`; already-structured — `όνομα_εταιρείας, company, company_name, αριθμός_τηλεφώνου, work_phone_number, phone, mobile, email, website, site, full_name, name, ονοματεπώνυμο, όνομα`; plus any key matching `^col$` (columnar exports have no question labels — their Q&A are skipped; report the count).
- Deterministic order (by key).

### B. Release carries it forward

`release_lead_intake` and `bulk_release_intake`:
- `notes = COALESCE(NULLIF(btrim(r.contact_info),''), NULLIF(build_lead_info_block(r.source_data, r.title),''))` — fill-blank; Meta-webhook leads (which already assemble `contact_info`) are unchanged; import leads now get the block.
- `company_name = COALESCE(NULLIF(btrim(r.company_name),''), NULLIF(btrim(r.source_data->>'όνομα_εταιρείας'),''))`.

### C. One-time backfills (fill-blank, backup tables + rollback)

- `leads.company_name` ← `source_data->>'όνομα_εταιρείας'` where blank.
- `leads.notes` ← `build_lead_info_block(source_data, title)` where blank (never touches sales-edited notes).
- `lead_intake.company_name` ← `source_data->>'όνομα_εταιρείας'` where blank (so pending rows release complete + show on the intake page).

### D. Verification (this is SQL data work, not unit-testable)

- Run `build_lead_info_block` against a sample of real leads; eyeball Greek output + form line.
- Confirm each backfill's `WHERE blank` touched 0 already-populated rows (fill-blank proof).
- Spot-check before/after on 3–5 leads via the Management API.

## Files / migrations

- `supabase/migrations/<ts>_build_lead_info_block.sql` — the formatter function.
- `supabase/migrations/<ts>_release_carries_campaign_info.sql` — updated `release_lead_intake` + `bulk_release_intake`.
- `supabase/migrations/<ts>_backfill_lead_campaign_info.sql` — the three backfills + backup tables + rollback SQL.
- Applied to prod via the Management API (DML + DDL confirmed working this session).

## Changes / Revert

- Revert: restore `release_lead_intake`/`bulk_release_intake` from their prior migrations; run the documented ROLLBACK in the backfill migration (restore `leads.company_name`, `leads.notes`, `lead_intake.company_name` from backup tables); `drop function build_lead_info_block`.
- Fill-blank throughout — no existing value is overwritten.

## Out of scope

- The read-only campaign panel (rejected in favor of editable notes).
- Re-formatting Meta-webhook leads' existing notes (already populated; left as-is).
- Recovering Q&A labels for columnar `COL$…` leads (no labels stored).
- Frontend changes (none needed).
