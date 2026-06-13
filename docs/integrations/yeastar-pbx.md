# Yeastar PBX Integration — Runbook

## Inbound caller-ID lookup
- Endpoint: `GET https://<crm-domain>/api/pbx-lookup?phone={CALLER_NUMBER}&key=<PBX_LOOKUP_SECRET>`
  - The PBX may instead send the secret as header `X-PBX-Secret` (the endpoint accepts either).
- Response on a hit (HTTP 200): `{ "contact": { id, firstname, lastname, company, email, businessphone, mobilephone, url } }`
- Miss → HTTP 404; bad/blank number → 400; wrong/missing secret → 401.
- Matching: the number is reduced to its last 10 digits (strips `+30` / `0030` / `30` and separators),
  then checked against client primary phones, client additional-contact phones, and lead phones,
  in that priority order. `url` deep-links to the contact in the CRM (`/clients/:id` or `/leads/:id`).

## Config to give Yeastar's tech department
- The URL template above, with their caller-number variable substituted for `{CALLER_NUMBER}`.
- The shared secret value (kept only in Vercel env `PBX_LOOKUP_SECRET`).
- (Optional) their PBX public IP, if we later add an IP allowlist.

## Outbound click-to-call
- Phone numbers in the CRM render as `tel:` links (clients list, accounting clients table,
  sales lead cards, assigned-task detail, client edit form). The dial is handled by whatever
  softphone is registered as the `tel:` handler on the agent's machine (e.g. Yeastar Linkus).
- Each agent must have that softphone installed and set as the default `tel:` handler.

## Env vars
- `PBX_LOOKUP_SECRET` (Vercel) — shared secret for the lookup endpoint. Without it the endpoint
  returns 401 to everyone (fail-closed), so the feature is dormant until this is set.
- `PBX_DEEPLINK_BASE` (Vercel) — base URL for the CRM deep-link in the popup. Defaults to
  `https://crm.itdev.gr` if unset.

## Go-live checklist
1. Apply the migration `supabase/migrations/20260614000001_pbx_phone_lookup.sql` to the project.
2. Set `PBX_LOOKUP_SECRET` (and `PBX_DEEPLINK_BASE` if the domain differs) in Vercel, then deploy.
3. Smoke test the endpoint:
   `curl "https://<crm-domain>/api/pbx-lookup?phone=<known-number>&key=<secret>"` → expect the contact JSON.
   Wrong secret → 401; unknown number → 404.
4. Give Yeastar's team the URL template + secret; they configure the PBX 3rd-party lookup.
5. Place a real inbound call from a number on a client/lead → the call-center app shows the contact.
6. In the CRM, click a phone number → the softphone dials.

## Changes / Revert
- Code: revert the `feat(pbx):` / `fix(pbx):` / `docs(pbx):` commits on `main`.
- DB: run the ROLLBACK block at the bottom of
  `supabase/migrations/20260614000001_pbx_phone_lookup.sql`.
- Vercel: remove `PBX_LOOKUP_SECRET` / `PBX_DEEPLINK_BASE` and the `api/pbx-lookup.ts`
  entry from `vercel.json`.
