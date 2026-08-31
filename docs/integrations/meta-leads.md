# Meta Lead Ingestion (Zapier) — Runbook

## Endpoint
`GET` (or `POST`) `https://www.itdevcrm.com/api/meta-lead?key=<META_LEAD_SECRET>`
The secret may instead be sent as header `X-Meta-Secret`. With GET, the lead fields are query-string params; with POST, a JSON body.

## Zapier setup (GET, "Webhooks by Zapier")
- **URL:** the endpoint above.
- **Query String Params** (one row per field): `key` (= the secret), `leadgen_id` (the Meta lead id — required for dedup), `full_name`, `email`, `phone`, `website` (optional), `company` (optional), `form_name` (optional), `campaign` (optional), `notes` (optional). Order doesn't matter.
- **Send As JSON:** No. **Headers:** leave empty (Greek campaign/form names are not valid HTTP header values — keep them in query params, which are URL-encoded).
- Keep the existing ClickUp action — both run from the same Zap.

## Behaviour
- Creates a lead: `source='meta'`, raw fields in `source_data`, lands in **New Lead**, fires the welcome email (if enabled). `website` is stored and carried to the client on conversion.
- **Title:** «Contact name (Form name)» — e.g. `Μαργαρίτα Γραβέζα (Local SEO)`.
  Franchise leads always use the literal `Franchise` label. If the form gave no
  contact name, the title is the form name alone; if neither exists, `Meta lead`.
  (Owner request 2026-08-31; helper `api/_lead-title.ts`, backfill migration
  `20260831250000`.)
- Retries are safe: a repeat `leadgen_id` returns `{ deduped: true }` and creates nothing.
- Wrong/missing secret → 401; non-GET/POST → 405.

## Go-live order
1. Set `META_LEAD_SECRET` in Vercel (Production) and redeploy. *(The endpoint needs no migration to work — dedup uses `source_data->>'leadgen_id'`.)*
2. Test the Zap → confirm a lead in New Lead.
3. **Optional, anytime:** apply `supabase/migrations/20260615000007_lead_meta_leadgen_id.sql` — a non-breaking index that speeds up dedup at scale.

## Changes / Revert
- Code: revert the `feat(leads): … Meta …` commits.
- DB: the optional index — run the ROLLBACK in `20260615000007_lead_meta_leadgen_id.sql`.
- Vercel: remove `META_LEAD_SECRET` and the `api/meta-lead.ts` entry from `vercel.json`.
