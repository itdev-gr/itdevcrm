# Per-User Gmail Sending (Sales Emails) — Design Spec

**Date:** 2026-06-02
**Status:** Approved (pending user review of this spec)
**Relationship:** Extends the Resend email system (`docs/superpowers/specs/2026-06-02-resend-automated-email-design.md`). Resend remains the sender for all **automated** email (payment reminders, new-job/task notices). This spec adds **per-user Gmail** sending for **interactive** sales email only.

## Goal

Let each user connect their Google Workspace account once, then send the **sales offer** and **won-welcome** emails from **their own mailbox** via the Gmail API — so the client sees the email from the actual salesperson, and a copy lands in that salesperson's Sent folder.

## Decisions (from brainstorming)

- **Auth model:** per-user OAuth ("Connect Google" — each user consents individually). Not domain-wide delegation.
- **Scope of personal sending:** interactive only — `offer` + `won_welcome`. Automated email stays on Resend (no "current user" to send as).
- **OAuth scope:** `https://www.googleapis.com/auth/gmail.send` only (send-only; cannot read mail).
- **No silent fallback:** if a user hasn't connected Google, the sales send is **blocked** with a "Connect Google first" prompt (it does not quietly send from `sales@`).

## Architecture

**Connect:** Profile page → "Connect Google" calls the `google-oauth` Edge Function (`action=start`, authenticated) which returns a Google consent URL carrying a **signed `state`** (HMAC of user_id + nonce + expiry). Browser navigates to Google; Google redirects to the function's callback (`GET ?code&state`); the function verifies `state`, exchanges the code for a **refresh token** using the client secret (server-side only), encrypts and stores it, then redirects to `/profile?google=connected`.

**Send:** The sales dialog sends via a new `personal` path in `send-email`. The function reads the caller's `user_id` from their JWT, loads + decrypts their refresh token, mints a short-lived access token, builds a MIME message, and calls Gmail `users.messages.send` **from the user's own address**. Logged to `email_log` (identity `personal`). If the user isn't connected → `409 not_connected`, and the dialog shows the connect prompt.

```
Profile "Connect Google" ─► google-oauth(start) ─► Google consent ─► google-oauth(callback)
                                                                          │ store encrypted refresh_token
Sales dialog (offer/won) ─► send-email(personal, user JWT) ─► Gmail API send-as-user ─► email_log
                                                  │ not connected → 409 → "Connect Google first"
```

## Components

- **DB — `user_google_accounts`** (migration): `user_id uuid PK → profiles(user_id)`, `google_email text`, `refresh_token_enc text` (AES-GCM ciphertext, base64), `connected_at timestamptz`, `revoked_at timestamptz`. RLS: the owner may `select` **status columns only** (`google_email`, `connected_at`, `revoked_at`) via a view; `refresh_token_enc` is never exposed to clients (no client policy — service-role only). Writes only via the Edge Function (service role).
- **Edge Function `google-oauth`** (Deno): `start` (authenticated → consent URL with signed state), `callback` (code→token, encrypt, upsert row, redirect), `disconnect` (authenticated → revoke token at Google + clear row). Reads `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GMAIL_STATE_SECRET` (HMAC), `GMAIL_TOKEN_KEY` (AES-GCM key), `APP_URL` (redirect target).
- **`send-email` extension:** add identity/path `personal` — requires a user JWT (never service role), resolves the caller's Gmail account, sends via Gmail API. Existing `sales`/`accounting`/`internal` Resend paths unchanged. Honors `EMAIL_DRY_RUN` (logs instead of calling Gmail).
- **Frontend:**
  - `useGoogleConnection()` — query connection status (`{ connected, email }`) from the status view; `connect()` (calls `start`, redirects to the returned URL); `disconnect()`.
  - Profile page section: "Connect Google" / "Connected as x@company.com · Disconnect".
  - Sales `SendEmailDialog` (offer/won): route via `personal`; if `useGoogleConnection` reports not-connected, show an inline "Connect Google to send from your address" prompt instead of the Send button.

## Security

- Minimal `gmail.send` scope (no inbox read).
- Client secret + refresh token live only server-side (Edge Function); refresh token **encrypted at rest** (AES-GCM, key in `GMAIL_TOKEN_KEY` secret) on top of RLS service-role-only access.
- `state` is HMAC-signed (`GMAIL_STATE_SECRET`) with a short expiry → prevents CSRF and binds the callback to the initiating user.
- OAuth consent screen = **Internal** → only Workspace-domain users can connect; no Google verification needed.
- Disconnect revokes the token at Google (`oauth2/revoke`) and clears the row.

## Manual setup (you, one-time — documented in the plan)

1. Create a Google Cloud project; **enable the Gmail API**.
2. OAuth consent screen → **Internal**; add the `gmail.send` scope.
3. Create an **OAuth client (Web application)**; authorized redirect URI = `https://xujlrclyzxrvxszepquy.supabase.co/functions/v1/google-oauth`.
4. Store as Supabase secrets: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, plus generated `GMAIL_STATE_SECRET` and `GMAIL_TOKEN_KEY`, and `APP_URL` (the production app origin).

## Testing

- **Unit (vitest):** MIME message builder (correct `From`/`To`/`Subject`/base64url body); `state` sign/verify round-trip; AES-GCM encrypt/decrypt round-trip.
- **Edge Function:** exercised in `EMAIL_DRY_RUN` (no real Gmail call) — `personal` path resolves the account and logs; `not_connected` returns 409.
- **Frontend (RTL):** dialog shows the connect prompt when not connected; sends when connected.
- **Manual go-live:** one real connect + one real offer send from a test salesperson account, verify it arrives from their address and appears in their Sent.

## Out of scope

Reading/searching Gmail, threading/replies, calendar, shared-mailbox sending, automated email via Gmail (those stay on Resend), non-Google providers.

## Changes / Revert

- **New:** migration `user_google_accounts` (+ status view, RLS); Edge Function `google-oauth`; `personal` path in `send-email`; `src/features/email/useGoogleConnection.ts`; profile "Connect Google" UI; sales dialog routing. **Secrets:** `GOOGLE_CLIENT_ID/SECRET`, `GMAIL_STATE_SECRET`, `GMAIL_TOKEN_KEY`, `APP_URL` — none in the repo.
- **Revert:** migration ships a `-- ROLLBACK:` block (drop view + table); `supabase functions delete google-oauth`; revert the `send-email` `personal` branch + frontend by commit. **Kill switch:** set `EMAIL_DRY_RUN=true` (no real sends) or revert the dialog to the Resend `sales` identity.

## Related fix (noted, separate)

The Resend smoke test showed the drain cron's `token === SUPABASE_SERVICE_ROLE_KEY` check is sensitive to this project's **new API-key system** (`sb_secret_…` vs legacy JWT). The drain cron's Vault `service_role_key` must equal the function's injected key; the plan for this work will include a one-line hardening of that check (accept the configured key) so drain auth is unambiguous. Does not affect the user-JWT sales path (verified working).
