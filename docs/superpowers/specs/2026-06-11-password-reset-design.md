# Password reset via email — design

**Date:** 2026-06-11
**Status:** Approved (brainstormed with product owner)

| | |
|---|---|
| **Goal** | Staff can reset a forgotten password themselves via an emailed link; no admin involvement. |
| **Approach** | Supabase Auth recovery links + Send Email Hook delivering through the existing `send-email` / Resend pipeline. |
| **Out of scope** | Email verification on signup (accounts stay invite-only with admin-set temp passwords), 2FA, magic-link login. |

## 1. User flow

1. **Login page** gains a "Forgot password? / Ξέχασες τον κωδικό;" link under the password field → `/forgot-password`.
2. **`/forgot-password`** (public route): single email field. Submit calls `supabase.auth.resetPasswordForEmail(email, { redirectTo: <origin>/reset-password })`. Regardless of whether the email has an account, the page shows the same notice: *"If an account exists with this email, we've sent a reset link."* (prevents account enumeration). Supabase sends nothing for unknown emails.
3. **Reset email** (bilingual, Greek first then English) arrives from `ITDEV <noreply@itdev.gr>` (existing `internal` identity) with a button **"Ορισμός νέου κωδικού / Set new password"** → Supabase verify URL → redirects to `/reset-password` with a recovery session.
4. **`/reset-password`** (public route): if a recovery session is present, show new password + confirm (same validation rules as `SetPasswordPage`); on success the user is signed in and redirected to `/`. If the URL carries an error (expired/used link — links are single-use, 1-hour expiry) or no session exists, show an explanatory state with a link back to `/forgot-password`.
5. Both pages are translated EN + EL (`auth` namespace), consistent with the rest of the app.

## 2. Architecture

```
/forgot-password ──resetPasswordForEmail()──▶ Supabase Auth
                                                  │ Send Email Hook (HTTPS, signed)
                                                  ▼
                                      auth-email edge function
                                        │  verify webhook signature
                                        │  build reset URL from token_hash
                                        ▼
                              send-email pipeline (Resend)
                                template: auth_password_reset
                                identity: internal · logged in email_log
```

### New edge function: `supabase/functions/auth-email`

- Receives Supabase Auth "Send Email Hook" POSTs (`user`, `email_data: { token_hash, redirect_to, email_action_type, ... }`).
- Verifies the request signature against `SEND_EMAIL_HOOK_SECRET` (standard-webhooks format) — unsigned/invalid requests get 401.
- Handles `email_action_type === 'recovery'`: builds
  `{SUPABASE_URL}/auth/v1/verify?token_hash={token_hash}&type=recovery&redirect_to={redirect_to}`
  and sends via the shared Resend send path with template `auth_password_reset` (variable: `{{reset_url}}`), identity `internal`, logging to `email_log`.
- Any other `email_action_type` (none are used today — invites set passwords directly): log a warning, send nothing, return 200. Noted here so future auth-email types are wired consciously.
- Deployed with JWT verification disabled (hook calls carry a webhook signature, not a user JWT).

### Template

New row in `email_templates`, key `auth_password_reset`, bilingual subject/body (EL first, EN below), editable in the admin **Email automations** page like the lead templates. Single variable `{{reset_url}}`. Not tied to a lead/automation — excluded from the lead-automation toggles.

### Frontend

- `src/features/auth/ForgotPasswordPage.tsx` — email form + uniform success notice.
- `src/features/auth/ResetPasswordPage.tsx` — reuses `useChangePassword` (which calls `auth.updateUser` and clears `must_change_password`, keeping temp-password users consistent if they reset via email instead).
- Router: public routes `/forgot-password`, `/reset-password` alongside `/set-password`; the auth listener's existing session handling hydrates the recovery session (`detectSessionInUrl`).
- Login page link + i18n strings (EN/EL).

## 3. Security

- Tokens generated/validated entirely by Supabase Auth — single-use, 1-hour expiry (dashboard-configurable).
- Supabase built-in rate limits cap reset-email requests per address/IP.
- Uniform success response on `/forgot-password` — no account enumeration.
- Hook secret stored as a Supabase function secret (`SEND_EMAIL_HOOK_SECRET`); never committed to the repo or written literally in docs/plans.
- The edge function never logs the token_hash or reset URL.

## 4. Configuration (manual, Supabase dashboard)

1. Auth → Hooks → enable **Send Email Hook** (HTTPS) pointing at the deployed `auth-email` function; generate the secret.
2. Store the secret as function secret `SEND_EMAIL_HOOK_SECRET`.
3. Confirm Auth rate limits and recovery-link expiry (defaults are fine).

## 5. Testing

- **TDD per task** (Vitest): ForgotPasswordPage (submit → uniform notice, calls `resetPasswordForEmail` with correct redirect), ResetPasswordPage (session → form → success redirect; error params → expired state), auth-email function units (signature rejection, recovery URL building, non-recovery no-op).
- **SQL test** for the template migration (row exists with both languages and the `{{reset_url}}` placeholder in the body).
- **Manual smoke** (test@test.gr): dry-run first, then one real reset email end-to-end; verify `email_log` row and that an expired link shows the expired state.

## 6. Changes / Revert

| Change | Revert |
|---|---|
| Migration: insert `auth_password_reset` into `email_templates` | Rollback SQL in the migration: `DELETE FROM email_templates WHERE key = 'auth_password_reset';` |
| New edge function `auth-email` | `supabase functions delete auth-email`; disable the Send Email Hook in the dashboard |
| Dashboard: Send Email Hook enabled + `SEND_EMAIL_HOOK_SECRET` | Disable the hook; remove the secret |
| Frontend: 2 pages, 2 routes, login link, i18n strings | Revert the atomic commits (one per task) |

No existing behavior changes: invite flow, temp passwords, and `/set-password` are untouched; the hook only affects auth emails, of which recovery is the only one in use.
