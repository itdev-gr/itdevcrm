# Email Pipeline Resilience — Design Spec

**Date:** 2026-06-15
**Goal:** Make the automated-email pipeline (1) immune to Supabase key rotations / API-key migrations, and (2) self-evident — any stall is visible to admins **in-app within minutes**, never silent again.

**Non-goals (YAGNI):** monitoring of other background jobs (the health layer is built to extend, but only email is wired in v1); auto-remediation; external/email-based alerting (chicken-and-egg: email alerts can't fire when email is the thing that's down).

---

## Background — current architecture & the failure we're hardening against

- `drain_email_outbox` pg_cron job (every 2 min) → `net.http_post` → `send-email` edge function → drains `email_outbox` (sends via Resend), marking rows `sent`.
- **Auth today:** the cron sends the Postgres vault secret `service_role_key` as the `Authorization: Bearer`. The edge function has `verify_jwt = true` (gateway validates the JWT) and then checks `token === SUPABASE_SERVICE_ROLE_KEY || token === EMAIL_DRAIN_SECRET`.
- **What broke (June 2026):** the vault `service_role_key` was overwritten with a non-JWT value → gateway `401 INVALID_JWT_FORMAT`; and the API-key migration changed the function's injected `SUPABASE_SERVICE_ROLE_KEY` while `verify_jwt` stayed on → `403 Forbidden`. No emails sent for ~1 week, and **nothing surfaced it** (rows sat `pending`, `attempts=0`, no error; the cron reported "succeeded" because `net.http_post` only queues the request).

Two root weaknesses: the drain auth is **coupled to Supabase's JWT key system**, and failures are **invisible**.

---

## Part 1 — JWT-decoupled drain auth (so key changes can't break it)

- Introduce a dedicated, stable, random **`EMAIL_DRAIN_SECRET`** (e.g. 32 random bytes, base64url — **not** a JWT). Store it in two places that must match: the Postgres **vault** (secret name `email_drain_secret`) and the function **env** `EMAIL_DRAIN_SECRET`.
- Turn **`verify_jwt = false`** on the `send-email` function. The function already authenticates every path itself:
  - **drain** → requires `token === EMAIL_DRAIN_SECRET`
  - **"send as me"** (staff personal emails) → validates the logged-in user via `supabase.auth.getUser()` (works regardless of the gateway)
  - **service/default send** → service-role token or a valid user
- Update the `drain_email_outbox` cron to send `Authorization: Bearer <vault email_drain_secret>`.
- **Net effect:** no part of the drain path depends on Supabase JWT keys. Rotating, migrating, or disabling keys cannot break it. The only shared dependency is the random drain secret, which nothing else uses.
- **Security note:** the gateway no longer pre-filters this one function, but every code path still authenticates internally — a standard, supported Supabase pattern. The drain secret is as privileged as the old setup (it triggers a send-only drain).

### Zero-downtime change order
The function accepts **both** the old service-role path and the drain secret, so the cutover has no outage window:
1. Set function env `EMAIL_DRAIN_SECRET` = new random value.
2. Set `verify_jwt = false` and redeploy `send-email`.
3. Store the same value in the vault as `email_drain_secret`.
4. Switch the `drain_email_outbox` cron to send the vault `email_drain_secret`.

At every step the drain keeps working (old path remains valid until step 4 swaps it).

---

## Part 2 — Health heartbeat + in-app admin alert (so a stall is never silent)

### Heartbeat
- New singleton table `public.email_drain_heartbeat`: `id` (fixed), `last_run_at`, `last_ok_at`, `processed`, `sent`, `failed`, `updated_at`. RLS: **admin read**; written by the function (service role).
- The `send-email` function, at the end of each `drain()`, **upserts** the heartbeat (`last_run_at = now()`, `last_ok_at = now()` when the run completed without a hard error, plus the processed/sent/failed counts).

### Health check
- `public.email_pipeline_health()` returns JSON `{ status, reason, last_run_age_seconds, stuck_count, failed_count, oldest_pending_age_seconds }`:
  - **down** — heartbeat missing, or `last_run_at` older than **10 min** (the drain isn't running — exactly this week's failure).
  - **degraded** — any `pending` email older than **15 min**, or any `pending` row with `attempts >= 5` (maxed-out / stuck), or recent `failed` sends.
  - **ok** — otherwise.
- `SECURITY DEFINER`, callable by admins only (or exposed via an admin-RLS view).

### In-app alert
- `useEmailHealth()` hook (TanStack Query, refetch ~60s) calls the health RPC.
- `EmailHealthBanner` (admin-only) rendered in the main layout: hidden when **ok**; a **red banner** when **degraded/down** with a plain-language reason (e.g. *"Email pipeline DOWN — last successful run 2h ago"*, *"4 emails stuck"*). No external dependency; works even when email is fully down.
- Generic `system_health` shape so other jobs can be added later by returning more rows; v1 returns email only.

---

## Data flow

```
pg_cron (drain secret from vault) ──Bearer──► send-email function
        every 2 min                              │ drains email_outbox → Resend
                                                  │ upserts email_drain_heartbeat
app (admin) ──► email_pipeline_health() ──► EmailHealthBanner (red when not ok)
        poll ~60s
```

## Error handling
- Key rotation/migration can no longer break the drain (Part 1).
- If the function is unreachable for any reason, the heartbeat ages → banner shows **DOWN** within ~10 min.
- Maxed-retry rows surface as **degraded** instead of sitting silently forever.
- If the health RPC itself errors, the banner **stays hidden** (fail-safe — monitoring never blocks the app).

## Testing
- **SQL:** seed `email_drain_heartbeat` + `email_outbox` states and assert `email_pipeline_health()` returns ok / degraded / down at the threshold boundaries (verified via SQL during execution; no DB unit-test harness in repo).
- **App:** `EmailHealthBanner` RTL tests — hidden when ok; red with the right message for degraded and down (health hook mocked).
- **End-to-end verification:** after deploy, confirm the drain still returns `200` and the heartbeat updates; simulate a stall and confirm the banner appears; restore and confirm it clears.

## Changes / Revert
- **New:** migration (`email_drain_heartbeat` table, `email_pipeline_health()` fn, cron pointed at `email_drain_secret`); function heartbeat write + `verify_jwt=false`; `EmailHealthBanner` + `useEmailHealth`; `EMAIL_DRAIN_SECRET` (vault + function env).
- **Revert:** run the migration rollback SQL (drop table/fn; restore cron to the service-role path); redeploy `send-email` with `verify_jwt=true` and the heartbeat write removed; remove the banner/hook. (The previously-broken vault value is not restored — the current working state stays.)
