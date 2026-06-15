# Email Pipeline Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the automated-email pipeline immune to Supabase key rotations/migrations, and surface any stall to admins in-app within minutes (never silently dead again).

**Architecture:** Decouple the outbox-drain auth from Supabase JWT keys (a dedicated random `EMAIL_DRAIN_SECRET` + `verify_jwt=false`, function self-authenticates). Add a per-drain heartbeat and an `email_pipeline_health()` RPC that returns ok/degraded/down, surfaced by an admin-only red banner in the app shell.

**Tech Stack:** Supabase Postgres + pg_cron + pg_net + Vault, Deno edge function (`send-email`), Vite + React 19 + TS, TanStack Query, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-06-15-email-pipeline-resilience-design.md`

**Note on task types:** Tasks 1, 4 are **code** (TDD, committable, subagent-friendly). Tasks 2–3, 5 are **ops** (apply migration, deploy function, set secrets, verify against prod) — run by the controller with the Supabase token; never print secret values.

---

## File Structure

| File | Responsibility | New/Modify |
| --- | --- | --- |
| `supabase/migrations/20260615000003_email_health.sql` | heartbeat table + `email_pipeline_health()` + RLS | Create |
| `supabase/migrations/20260615000004_drain_uses_drain_secret.sql` | repoint `drain_email_outbox` cron at the vault `email_drain_secret` | Create |
| `supabase/functions/send-email/index.ts` | write heartbeat at end of `drain()` | Modify |
| `supabase/config.toml` | `[functions.send-email] verify_jwt = false` | Modify |
| `src/features/system_health/emailHealth.ts` | pure `EmailHealth` type + `emailHealthMessage()` mapper | Create |
| `src/features/system_health/emailHealth.test.ts` | unit tests for the mapper | Create |
| `src/features/system_health/useEmailHealth.ts` | TanStack Query hook calling the RPC (fail-safe) | Create |
| `src/features/system_health/EmailHealthBanner.tsx` | admin-only red/amber banner | Create |
| `src/features/system_health/EmailHealthBanner.test.tsx` | component test | Create |
| `src/components/layout/AppShell.tsx` | render the banner under the Topbar | Modify |

---

## Phase A — Health backend

### Task 1: Migration — heartbeat table + health RPC

**Files:** Create `supabase/migrations/20260615000003_email_health.sql`. No unit test (DB layer); verified by SQL in Step 3.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260615000003_email_health.sql
-- =============================================================================
-- Email pipeline health: a per-drain heartbeat + a status RPC for the in-app alert.
-- =============================================================================

-- Singleton heartbeat row, written by the send-email function on each drain run.
create table public.email_drain_heartbeat (
  id          boolean primary key default true check (id),
  last_run_at timestamptz,
  last_ok_at  timestamptz,
  processed   int not null default 0,
  sent        int not null default 0,
  failed      int not null default 0,
  updated_at  timestamptz not null default now()
);
insert into public.email_drain_heartbeat (id) values (true) on conflict do nothing;

alter table public.email_drain_heartbeat enable row level security;
-- Admins can read it; the function writes via the service role (bypasses RLS).
create policy email_drain_heartbeat_admin_read on public.email_drain_heartbeat
  for select to authenticated using (public.current_user_is_admin());

-- Returns { status, reason, last_run_age_seconds, stuck_count, failed_count,
-- oldest_pending_age_seconds }. Non-admins get a bare {status:'ok'} (no leakage).
create or replace function public.email_pipeline_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  last_run_age   int;
  stuck          int;
  maxed          int;
  failed_recent  int;
  oldest_pending int;
  v_status       text;
  v_reason       text;
begin
  if not public.current_user_is_admin() then
    return jsonb_build_object('status', 'ok');
  end if;

  select extract(epoch from now() - last_run_at)::int into last_run_age
    from public.email_drain_heartbeat where id;
  select count(*) into stuck from public.email_outbox
    where status = 'pending' and created_at < now() - interval '15 minutes';
  select count(*) into maxed from public.email_outbox
    where status = 'pending' and attempts >= 5;
  select count(*) into failed_recent from public.email_log
    where status = 'failed' and created_at > now() - interval '1 hour';
  select extract(epoch from now() - min(created_at))::int into oldest_pending
    from public.email_outbox where status = 'pending';

  if last_run_age is null or last_run_age > 600 then
    v_status := 'down';
  elsif coalesce(stuck, 0) > 0 or coalesce(maxed, 0) > 0 or coalesce(failed_recent, 0) > 0 then
    v_status := 'degraded';
  else
    v_status := 'ok';
  end if;

  v_reason := case
    when last_run_age is null            then 'drain has never run'
    when last_run_age > 600              then 'drain last ran ' || last_run_age || 's ago'
    when coalesce(stuck, 0) > 0          then stuck || ' email(s) stuck pending'
    when coalesce(maxed, 0) > 0          then maxed || ' email(s) hit max retries'
    when coalesce(failed_recent, 0) > 0  then failed_recent || ' send failure(s) in the last hour'
    else 'ok' end;

  return jsonb_build_object(
    'status', v_status, 'reason', v_reason,
    'last_run_age_seconds', last_run_age,
    'stuck_count', coalesce(stuck, 0),
    'failed_count', coalesce(failed_recent, 0),
    'oldest_pending_age_seconds', oldest_pending
  );
end;
$$;

revoke all on function public.email_pipeline_health() from public;
grant execute on function public.email_pipeline_health() to authenticated;

-- ---------------------------------------------------------------------------
-- ROLLBACK:
--   drop function if exists public.email_pipeline_health();
--   drop table if exists public.email_drain_heartbeat;
-- ---------------------------------------------------------------------------
```

- [ ] **Step 2: Apply the migration**

Run (controller, with `REF` + `SUPABASE_ACCESS_TOKEN` env set) via the Management API query endpoint, then record it in `supabase_migrations.schema_migrations` (version `20260615000003`, name `email_health`).
Expected: no error.

- [ ] **Step 3: Verify with SQL**

```sql
select public.email_pipeline_health();
```
Expected (admin caller): `status = 'down'` with `reason = 'drain has never run'` (heartbeat empty until Task 2 deploys), `stuck_count`/`failed_count` present.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260615000003_email_health.sql
git commit -m "feat(email): heartbeat table + email_pipeline_health RPC"
```

---

## Phase B — Function heartbeat + verify_jwt off

### Task 2: send-email writes the heartbeat; verify_jwt disabled

**Files:** Modify `supabase/functions/send-email/index.ts`; Modify `supabase/config.toml`. Verified by deploy + drain in Task 3.

- [ ] **Step 1: Write the heartbeat at the end of `drain()`**

In `supabase/functions/send-email/index.ts`, the `drain()` function currently ends with:

```ts
  return { processed: (rows ?? []).length, sent, failed };
}
```

Replace that return with a heartbeat upsert first:

```ts
  const nowIso = new Date().toISOString();
  await admin.from('email_drain_heartbeat').upsert({
    id: true,
    last_run_at: nowIso,
    last_ok_at: nowIso,
    processed: (rows ?? []).length,
    sent,
    failed,
    updated_at: nowIso,
  });
  return { processed: (rows ?? []).length, sent, failed };
}
```

- [ ] **Step 2: Disable the JWT gateway for this function (durable config)**

Add to `supabase/config.toml` (append a section):

```toml
[functions.send-email]
verify_jwt = false
```

- [ ] **Step 3: Commit (deploy happens in Task 3)**

```bash
git add supabase/functions/send-email/index.ts supabase/config.toml
git commit -m "feat(email): drain heartbeat + verify_jwt=false for send-email"
```

---

## Phase C — Auth decoupling cutover (ops)

### Task 3: Switch the drain to a dedicated random secret + deploy

**Files:** Create `supabase/migrations/20260615000004_drain_uses_drain_secret.sql`. Controller runs the ops steps with the token; **never print the secret**.

- [ ] **Step 1: Generate a random `EMAIL_DRAIN_SECRET`** (32 bytes base64url) in a script; keep it only in script memory.

- [ ] **Step 2: Set it as the function env + deploy the function** (this also ships the Task 2 heartbeat + verify_jwt):

```bash
# in a script, value never echoed:
#   POST /v1/projects/$REF/secrets  [{name: EMAIL_DRAIN_SECRET, value: <random>}]
SUPABASE_ACCESS_TOKEN=$TOK npx supabase functions deploy send-email \
  --project-ref $REF --no-verify-jwt
```
Expected: deploy succeeds; function version increments.

- [ ] **Step 3: Store the same random value in the vault** as `email_drain_secret`:

```sql
select vault.create_secret('<random>', 'email_drain_secret');
```
(Run inside the same script so the value isn't printed. If it already exists, `vault.update_secret` the existing id instead.)

- [ ] **Step 4: Write + apply the cron-repoint migration**

```sql
-- supabase/migrations/20260615000004_drain_uses_drain_secret.sql
-- Repoint the drain cron at the dedicated email_drain_secret (JWT-decoupled auth).
select cron.unschedule('drain_email_outbox');
select cron.schedule('drain_email_outbox', '*/2 * * * *', $cmd$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/send-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'email_drain_secret')
    ),
    body := jsonb_build_object('drain', true)
  );
$cmd$);

-- ---------------------------------------------------------------------------
-- ROLLBACK (restore the service_role_key-based drain):
--   select cron.unschedule('drain_email_outbox');
--   select cron.schedule('drain_email_outbox', '*/2 * * * *', $cmd$
--     select net.http_post(
--       url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/send-email',
--       headers := jsonb_build_object('Content-Type','application/json',
--         'Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')),
--       body := jsonb_build_object('drain', true));
--   $cmd$);
-- ---------------------------------------------------------------------------
```
Apply it and record version `20260615000004` in `schema_migrations`. (Steps 2→4 run back-to-back so the ≤2-min cron interval isn't missed; a single skipped cycle is harmless — emails wait one cycle.)

- [ ] **Step 5: Verify the cutover end-to-end**

```sql
-- trigger a drain using the NEW secret path
select net.http_post(url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/send-email',
  headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'email_drain_secret')),
  body := jsonb_build_object('drain', true)) as rid;
-- then check the response is 200 and the heartbeat updated:
select status_code from net._http_response order by created desc limit 1;          -- expect 200
select last_run_at, processed, sent, failed from public.email_drain_heartbeat;     -- recent timestamp
select public.email_pipeline_health();                                             -- expect status 'ok'
```
Expected: `200`; heartbeat `last_run_at` within seconds; health `ok`.

- [ ] **Step 6: Clean up** — remove the temporary `EMAIL_DRAIN_SECRET = service_role JWT` value set during the incident fix by overwriting it with the new random (already done in Step 2). Confirm `select public.email_pipeline_health()` is `ok`.

---

## Phase D — In-app admin alert

### Task 4: Health mapper, hook, banner, and shell wiring

**Files:** Create `src/features/system_health/{emailHealth.ts,emailHealth.test.ts,useEmailHealth.ts,EmailHealthBanner.tsx,EmailHealthBanner.test.tsx}`; Modify `src/components/layout/AppShell.tsx`.

- [ ] **Step 1: Write the failing mapper test**

```ts
// src/features/system_health/emailHealth.test.ts
import { describe, it, expect } from 'vitest';
import { emailHealthMessage } from './emailHealth';

describe('emailHealthMessage', () => {
  it('returns null when healthy or missing', () => {
    expect(emailHealthMessage(null)).toBeNull();
    expect(emailHealthMessage({ status: 'ok' })).toBeNull();
  });
  it('maps down to a red banner with the reason', () => {
    expect(emailHealthMessage({ status: 'down', reason: 'drain last ran 7200s ago' })).toEqual({
      severity: 'down',
      text: 'Email: drain last ran 7200s ago',
    });
  });
  it('maps degraded to an amber banner', () => {
    const b = emailHealthMessage({ status: 'degraded', reason: '4 email(s) stuck pending' });
    expect(b?.severity).toBe('degraded');
    expect(b?.text).toBe('Email: 4 email(s) stuck pending');
  });
  it('falls back to a generic reason when none provided', () => {
    expect(emailHealthMessage({ status: 'down' })?.text).toBe('Email: pipeline is down');
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npx vitest run src/features/system_health/emailHealth.test.ts`
Expected: FAIL — cannot resolve `./emailHealth`.

- [ ] **Step 3: Implement the mapper**

```ts
// src/features/system_health/emailHealth.ts
export type EmailHealth = {
  status: 'ok' | 'degraded' | 'down';
  reason?: string;
  last_run_age_seconds?: number | null;
  stuck_count?: number;
  failed_count?: number;
  oldest_pending_age_seconds?: number | null;
};

export type HealthBanner = { severity: 'down' | 'degraded'; text: string };

// Maps a health result to a banner, or null when there's nothing to show.
export function emailHealthMessage(h: EmailHealth | null | undefined): HealthBanner | null {
  if (!h || h.status === 'ok') return null;
  const reason = h.reason ?? (h.status === 'down' ? 'pipeline is down' : 'pipeline degraded');
  return { severity: h.status, text: `Email: ${reason}` };
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `npx vitest run src/features/system_health/emailHealth.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Implement the hook (fail-safe)**

```ts
// src/features/system_health/useEmailHealth.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { EmailHealth } from './emailHealth';

// Polls the health RPC. Never throws — a monitoring failure must not break the app.
export function useEmailHealth(enabled: boolean) {
  return useQuery({
    queryKey: ['email-health'] as const,
    enabled,
    queryFn: async (): Promise<EmailHealth | null> => {
      const { data, error } = await supabase.rpc('email_pipeline_health' as never);
      if (error) return null;
      return (data ?? null) as EmailHealth | null;
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}
```

- [ ] **Step 6: Write the failing banner test**

```tsx
// src/features/system_health/EmailHealthBanner.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmailHealthBanner } from './EmailHealthBanner';

vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (sel: (s: { isAdmin: boolean }) => unknown) => sel({ isAdmin: true }),
}));
vi.mock('./useEmailHealth', () => ({
  useEmailHealth: () => ({ data: { status: 'down', reason: 'drain last ran 7200s ago' } }),
}));

describe('EmailHealthBanner', () => {
  it('shows a red alert for an admin when the pipeline is down', () => {
    render(<EmailHealthBanner />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Email: drain last ran 7200s ago');
  });
});
```

- [ ] **Step 7: Run it — expect FAIL**

Run: `npx vitest run src/features/system_health/EmailHealthBanner.test.tsx`
Expected: FAIL — cannot resolve `./EmailHealthBanner`.

- [ ] **Step 8: Implement the banner**

```tsx
// src/features/system_health/EmailHealthBanner.tsx
import { useAuthStore } from '@/lib/stores/authStore';
import { useEmailHealth } from './useEmailHealth';
import { emailHealthMessage } from './emailHealth';

// Admin-only. Renders nothing when healthy or for non-admins.
export function EmailHealthBanner() {
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const { data } = useEmailHealth(isAdmin);
  if (!isAdmin) return null;
  const banner = emailHealthMessage(data);
  if (!banner) return null;
  const color = banner.severity === 'down' ? 'bg-red-600' : 'bg-amber-500';
  return (
    <div className={`${color} px-4 py-2 text-center text-sm font-medium text-white`} role="alert">
      ⚠ {banner.text}
    </div>
  );
}
```

- [ ] **Step 9: Run it — expect PASS**

Run: `npx vitest run src/features/system_health/EmailHealthBanner.test.tsx`
Expected: PASS.

- [ ] **Step 10: Wire the banner into the app shell**

In `src/components/layout/AppShell.tsx`, add the import:

```tsx
import { EmailHealthBanner } from '@/features/system_health/EmailHealthBanner';
```

Then render it between the Topbar and the content row:

```tsx
      <Topbar onMenuClick={() => setMobileNavOpen(true)} />
      <EmailHealthBanner />
      <div className="flex flex-1 overflow-hidden">
```

- [ ] **Step 11: Verify build + tests**

Run: `npm run typecheck && npx vitest run src/features/system_health && npm run lint`
Expected: typecheck clean; tests PASS; 0 lint warnings.

- [ ] **Step 12: Commit**

```bash
git add src/features/system_health src/components/layout/AppShell.tsx
git commit -m "feat(email): in-app admin email-pipeline health banner"
```

---

## Phase E — Gate, push, end-to-end verify

### Task 5: Full gate + production verification

- [ ] **Step 1: Full suite + lint + typecheck**

Run: `npm run typecheck && npx vitest run && npm run lint`
Expected: all green.

- [ ] **Step 2: Push to main**

```bash
git push origin main
```

- [ ] **Step 3: Verify healthy state (prod)** — drive the app as admin (`test@test.gr`): the shell shows **no** banner (health `ok`).

- [ ] **Step 4: Simulate a stall and confirm the alarm** — temporarily set the heartbeat stale:

```sql
update public.email_drain_heartbeat set last_run_at = now() - interval '30 minutes';
```
Reload the app as admin → expect the **red "Email: drain last ran …" banner**. Then let the next drain run (≤2 min) or trigger one → reload → banner clears (back to `ok`).

---

## Changes / Revert (summary)

- **New:** migrations `20260615000003` (heartbeat + health RPC) and `20260615000004` (cron → drain secret); `src/features/system_health/*`; `EMAIL_DRAIN_SECRET` (vault `email_drain_secret` + function env); `verify_jwt=false`.
- **Modified:** `send-email/index.ts` (heartbeat), `config.toml`, `AppShell.tsx`.
- **Revert:** run each migration's ROLLBACK block (drop health objects; restore the `service_role_key` drain cron); redeploy `send-email` with `verify_jwt=true` and the heartbeat removed; remove `src/features/system_health/*` and the AppShell line.

## Human prerequisites
None blocking — the controller applies migrations, sets secrets, and deploys with the Supabase token. (Reminder: rotate that token after go-live.)
