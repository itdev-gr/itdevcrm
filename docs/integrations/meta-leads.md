# Meta Lead Ingestion (Zapier) — Runbook

## Endpoint
`GET` (or `POST`) `https://itdevcrm.vercel.app/api/meta-lead?key=<META_LEAD_SECRET>`
The secret may instead be sent as header `X-Meta-Secret`. With GET, the lead fields are query-string params; with POST, a JSON body.

## Zapier setup (GET, "Webhooks by Zapier")
- **URL:** the endpoint above.
- **Query String Params** (one row per field): `key` (= the secret), `leadgen_id` (the Meta lead id — required for dedup), `full_name`, `email`, `phone`, `website` (optional), `company` (optional), `form_name` (optional), `campaign` (optional), `notes` (optional). Order doesn't matter.
- **Send As JSON:** No. **Headers:** leave empty (Greek campaign/form names are not valid HTTP header values — keep them in query params, which are URL-encoded).
- Keep the existing ClickUp action — both run from the same Zap.

## Behaviour
- Creates a lead: `source='meta'`, raw fields in `source_data`, `form_name`→title, lands in **New Lead**, fires the welcome email (if enabled). `website` is stored and carried to the client on conversion.
- Retries are safe: a repeat `leadgen_id` returns `{ deduped: true }` and creates nothing.
- Wrong/missing secret → 401; non-GET/POST → 405.

## Go-live order (important)
1. Apply migration `supabase/migrations/20260615000007_lead_meta_leadgen_id.sql` (adds `meta_leadgen_id`). **The endpoint errors on insert until this is applied.**
2. Set `META_LEAD_SECRET` in Vercel (Production) and redeploy.
3. Test the Zap → confirm a lead in New Lead.

## Changes / Revert
- Code: revert the `feat(leads): … Meta …` commits.
- DB: run the ROLLBACK in `20260615000007_lead_meta_leadgen_id.sql`.
- Vercel: remove `META_LEAD_SECRET` and the `api/meta-lead.ts` entry from `vercel.json`.
