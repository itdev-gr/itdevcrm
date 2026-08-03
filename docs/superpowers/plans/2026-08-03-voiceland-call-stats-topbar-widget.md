# Voiceland Call-Stats Top-Bar Widget — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a live top-bar widget (left of the profile icon) that shows the logged-in user's telephone activity today — calls, missed, talk time — with a click-popover of the breakdown and last calls.

**Architecture:** The Yeastar CDR box (`72.62.58.175`, IP-whitelisted to the PBX) computes per-extension "today" aggregates every 2 min and **pushes** them into a new Supabase table `call_stats_daily`. The CRM reads them via a SECURITY-DEFINER RPC scoped to the caller's `profiles.phone_extension`; a small React widget polls that RPC every 60 s.

**Tech Stack:** React + TypeScript + Vite, TanStack Query v5, shadcn/ui (`popover`), Supabase (Postgres + RLS + PostgREST RPC), `supabase-js` v2, PHP 8.1 (producer on the box), Vitest.

## Global Constraints (copy verbatim from spec)

- Supabase client import: `import { supabase } from '@/lib/supabase'`.
- Admin predicate in RLS/policies: `is_admin()` (already defined; do not invent). `current_user_is_admin()` also exists — either is fine, be consistent.
- `profiles.phone_extension` is `text | null`, already mapped 14/14 (101 marios · 102 mkifokeris · 103 dtzouvaras · 104 pefstathiadis · 203 tvogiatzi · 204 stavroula · 205 dgiannakakis · 206 vdimitrov · 207 akotzampasakis · 208 ekitsakis · 303 agaleou · 500 emarketaki · 501 cpostantzian · 601 azazas).
- Migrations: SQL files in `supabase/migrations/YYYYMMDDHHMMSS_<name>.sql`, each ending with a `-- ROLLBACK:` comment block (see `20260728120000_lead_task_read_visibility.sql`).
- Types regen: `npm run types:gen` (writes `src/types/supabase.ts`, project `xujlrclyzxrvxszepquy`).
- Tests: `npm run test:run` (Vitest). Use **core matchers only** — `jest-dom` is broken here (`reference_jestdom_vitest_broken`). Vitest hits PROD data (`project_full_live_sweep`) — use disposable/seeded rows and clean them up.
- Lint gate is strict: `eslint . --max-warnings=0` runs inside `npm run build`.
- No secrets in committed files (env-var names only). The box's Supabase service key lives in `/etc/voiceland-supabase.env` (chmod 600), never in git.
- Talk-time field: Yeastar `duration` is TOTAL (ring+talk); `talk_duration` exists only on ANSWERED calls. Correct talk time in all cases = `max(0, duration - ring_duration)` (verified live 2026-08-03: NO ANSWER dur=63/ring=63→0, ANSWERED dur=1160/ring=10→1150, BUSY dur=13/ring=13→0). Do NOT use `talk_duration ?? duration` (inflates unanswered calls by their ring time).

## File Structure

- `supabase/migrations/20260803140000_call_stats_daily.sql` — **create**: table `call_stats_daily`, RLS select policy, RPC `get_my_call_stats_today()`.
- `src/types/supabase.ts` — **regen** after migration (adds table + RPC types).
- `src/lib/queryKeys.ts` — **modify**: add `callStatsToday`.
- `src/features/callstats/hooks/useMyCallStats.ts` — **create**: the query hook + types.
- `src/features/callstats/hooks/useMyCallStats.test.ts` — **create**.
- `src/features/callstats/hms.ts` — **create**: seconds→`H:MM:SS`/`M:SS`.
- `src/features/callstats/hms.test.ts` — **create**.
- `src/features/callstats/CallStatsWidget.tsx` — **create**: collapsed counters + popover.
- `src/features/callstats/CallStatsWidget.test.tsx` — **create**.
- `src/components/layout/Topbar.tsx` — **modify**: mount widget before the profile `<Link>`.
- `src/i18n/locales/el/common.json`, `src/i18n/locales/en/common.json` — **modify**: `callstats.*` keys.
- Box (NOT in repo): `/var/www/recordings/push_stats.php`, `/etc/voiceland-supabase.env`, cron line in `/etc/cron.d/yeastar-stats-warm`.

---

### Task 1: DB — `call_stats_daily` table, RLS, RPC

**Files:**
- Create: `supabase/migrations/20260803140000_call_stats_daily.sql`
- Regen: `src/types/supabase.ts`

**Interfaces:**
- Produces: table `public.call_stats_daily(extension text, stat_date date, total/inbound/outbound/internal/answered/missed/missed_inbound/talk_seconds/ring_seconds/unique_numbers int, recent jsonb, updated_at timestamptz, pk(extension,stat_date))`; RPC `public.get_my_call_stats_today() returns public.call_stats_daily`.

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/20260803140000_call_stats_daily.sql`:

```sql
-- =============================================================================
-- Live per-extension call stats (Voiceland/Yeastar) for the CRM top-bar widget.
-- Spec: docs/superpowers/specs/2026-08-03-voiceland-call-stats-topbar-widget-design.md
-- The box (72.62.58.175) upserts one row per extension per day via the service
-- role (bypasses RLS). Users read only their own row (profiles.phone_extension).
-- =============================================================================

create table if not exists public.call_stats_daily (
  extension      text not null,
  stat_date      date not null,
  total          int  not null default 0,
  inbound        int  not null default 0,
  outbound       int  not null default 0,
  internal       int  not null default 0,
  answered       int  not null default 0,
  missed         int  not null default 0,
  missed_inbound int  not null default 0,
  talk_seconds   int  not null default 0,
  ring_seconds   int  not null default 0,
  unique_numbers int  not null default 0,
  recent         jsonb not null default '[]'::jsonb,
  updated_at     timestamptz not null default now(),
  primary key (extension, stat_date)
);

alter table public.call_stats_daily enable row level security;

-- Read: own extension (via profiles.phone_extension) or admin.
drop policy if exists call_stats_daily_select on public.call_stats_daily;
create policy call_stats_daily_select on public.call_stats_daily
  for select to authenticated
  using (
    is_admin()
    or exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid()
        and p.phone_extension = call_stats_daily.extension
    )
  );
-- No INSERT/UPDATE/DELETE policy: writes come only from the service role.

-- Caller-scoped read RPC (single row for today, Athens tz).
create or replace function public.get_my_call_stats_today()
returns public.call_stats_daily
language sql stable security definer set search_path = public as $$
  select s.*
  from public.call_stats_daily s
  join public.profiles p
    on p.phone_extension = s.extension and p.user_id = auth.uid()
  where s.stat_date = (now() at time zone 'Europe/Athens')::date
  limit 1;
$$;

revoke all on function public.get_my_call_stats_today() from public;
grant execute on function public.get_my_call_stats_today() to authenticated;

-- ROLLBACK:
-- drop function if exists public.get_my_call_stats_today();
-- drop table if exists public.call_stats_daily;
```

- [ ] **Step 2: Apply the migration to prod**

Use the project's standard apply path (`supabase db push`, or the Management API per `reference_supabase_mgmt_api`). Confirm no error and the table exists:

Run (Management API or psql): `select to_regclass('public.call_stats_daily');`
Expected: returns `call_stats_daily` (not null).

- [ ] **Step 3: Seed one disposable row and verify RLS + RPC**

Seed today's row for extension `207` (akotzampasakis) via the **service role** (bypasses RLS), then verify a normal user reads only their own. All sales/admin test accounts share password `123456789`.

```bash
# A) service-role insert of a fake row (use SUPABASE_URL + SERVICE_ROLE_KEY)
curl -s -X POST "$SUPABASE_URL/rest/v1/call_stats_daily" \
  -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" -H "Prefer: resolution=merge-duplicates" \
  -d '[{"extension":"207","stat_date":"TODAY_ATHENS","total":5,"missed":2,"talk_seconds":72}]'
# (replace TODAY_ATHENS with the Athens date, e.g. 2026-08-03)
```

Then, as user `akotzampasakis@itdev.gr` (ext 207): sign in with `POST /auth/v1/token?grant_type=password`, get the access token, and call the RPC:

```bash
curl -s -X POST "$SUPABASE_URL/rest/v1/rpc/get_my_call_stats_today" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $AKOTZAMPASAKIS_TOKEN" \
  -H "Content-Type: application/json" -d '{}'
```
Expected: JSON object with `"extension":"207","total":5,"missed":2`.

Repeat the RPC as `dtzouvaras@itdev.gr` (ext 103, no row).
Expected: `null`.

- [ ] **Step 4: Clean up the seed row**

```bash
curl -s -X DELETE "$SUPABASE_URL/rest/v1/call_stats_daily?extension=eq.207&stat_date=eq.TODAY_ATHENS" \
  -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY"
```

- [ ] **Step 5: Regenerate types**

Run: `npm run types:gen`
Expected: `git diff src/types/supabase.ts` shows `call_stats_daily` + `get_my_call_stats_today` added.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260803140000_call_stats_daily.sql src/types/supabase.ts
git commit -m "feat(callstats): call_stats_daily table + RLS + get_my_call_stats_today RPC"
```

---

### Task 2: Frontend hook `useMyCallStats`

**Files:**
- Modify: `src/lib/queryKeys.ts`
- Create: `src/features/callstats/hooks/useMyCallStats.ts`
- Test: `src/features/callstats/hooks/useMyCallStats.test.ts`

**Interfaces:**
- Consumes: `supabase.rpc('get_my_call_stats_today')`, `queryKeys.callStatsToday()`.
- Produces: `useMyCallStats(): UseQueryResult<MyCallStats>`, types `MyCallStats` (object | null) and `RecentCall`.

- [ ] **Step 1: Add the query key**

In `src/lib/queryKeys.ts`, add inside the `queryKeys` object (near the other feature keys):

```ts
  callStatsToday: () => ['call-stats', 'today'] as const,
```

- [ ] **Step 2: Write the failing hook test**

Create `src/features/callstats/hooks/useMyCallStats.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

const rpc = vi.fn();
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import { useMyCallStats } from './useMyCallStats';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client: qc }, children);
}

describe('useMyCallStats', () => {
  beforeEach(() => rpc.mockReset());

  it('returns the row from the RPC', async () => {
    rpc.mockResolvedValue({ data: { extension: '207', total: 5, missed: 2, talk_seconds: 72, recent: [] }, error: null });
    const { result } = renderHook(() => useMyCallStats(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.extension).toBe('207');
    expect(result.current.data?.total).toBe(5);
  });

  it('returns null when the user has no row', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const { result } = renderHook(() => useMyCallStats(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test:run -- src/features/callstats/hooks/useMyCallStats.test.ts`
Expected: FAIL — cannot resolve `./useMyCallStats`.

- [ ] **Step 4: Implement the hook**

Create `src/features/callstats/hooks/useMyCallStats.ts`:

```ts
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export type RecentCall = {
  t: string;               // 'HH:MM' Athens
  num: string;             // other party number
  dir: 'in' | 'out' | 'int';
  disp: string;            // 'ANSWERED' | 'NO ANSWER' | ...
  dur: number;             // talk seconds
};

export type MyCallStats = {
  extension: string;
  stat_date: string;
  total: number;
  inbound: number;
  outbound: number;
  internal: number;
  answered: number;
  missed: number;
  missed_inbound: number;
  talk_seconds: number;
  ring_seconds: number;
  unique_numbers: number;
  recent: RecentCall[];
} | null;

/** Today's call stats for the logged-in user (RLS-scoped via phone_extension). */
export function useMyCallStats() {
  return useQuery({
    queryKey: queryKeys.callStatsToday(),
    queryFn: async (): Promise<MyCallStats> => {
      const { data, error } = await supabase.rpc('get_my_call_stats_today');
      if (error) throw new Error(error.message);
      return (data ?? null) as MyCallStats;
    },
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test:run -- src/features/callstats/hooks/useMyCallStats.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/queryKeys.ts src/features/callstats/hooks/useMyCallStats.ts src/features/callstats/hooks/useMyCallStats.test.ts
git commit -m "feat(callstats): useMyCallStats hook"
```

---

### Task 3: `hms` util + `CallStatsWidget` + Topbar mount + i18n

**Files:**
- Create: `src/features/callstats/hms.ts`, `src/features/callstats/hms.test.ts`
- Create: `src/features/callstats/CallStatsWidget.tsx`, `src/features/callstats/CallStatsWidget.test.tsx`
- Modify: `src/components/layout/Topbar.tsx`
- Modify: `src/i18n/locales/el/common.json`, `src/i18n/locales/en/common.json`

**Interfaces:**
- Consumes: `useMyCallStats()`, `hms()`, `@/components/ui/popover`.
- Produces: `<CallStatsWidget />` (renders nothing when data is null).

- [ ] **Step 1: Write the failing `hms` test**

Create `src/features/callstats/hms.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { hms } from './hms';

describe('hms', () => {
  it('formats sub-hour as M:SS', () => {
    expect(hms(0)).toBe('0:00');
    expect(hms(72)).toBe('1:12');
    expect(hms(605)).toBe('10:05');
  });
  it('formats hours as H:MM:SS', () => {
    expect(hms(3720)).toBe('1:02:00');
    expect(hms(4332)).toBe('1:12:12');
  });
  it('clamps negatives/NaN to 0:00', () => {
    expect(hms(-5)).toBe('0:00');
    expect(hms(Number.NaN)).toBe('0:00');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:run -- src/features/callstats/hms.test.ts`
Expected: FAIL — cannot resolve `./hms`.

- [ ] **Step 3: Implement `hms`**

Create `src/features/callstats/hms.ts`:

```ts
/** Format seconds as H:MM:SS (>=1h) or M:SS. Non-finite/negative → '0:00'. */
export function hms(totalSeconds: number): string {
  const s = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm run test:run -- src/features/callstats/hms.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Add i18n keys**

In `src/i18n/locales/el/common.json`, add a top-level `"callstats"` block:

```json
  "callstats": {
    "today": "Σήμερα",
    "calls": "κλήσεις",
    "missed": "αναπάντητες",
    "talk": "ομιλία",
    "inbound": "Εισερχόμενες",
    "outbound": "Εξερχόμενες",
    "answered": "Απαντημένες",
    "ring": "Χρόνος κουδουνίσματος",
    "unique": "Μοναδικοί αριθμοί",
    "recent": "Τελευταίες κλήσεις",
    "none": "Καμία κλήση σήμερα"
  }
```

In `src/i18n/locales/en/common.json`, add:

```json
  "callstats": {
    "today": "Today",
    "calls": "calls",
    "missed": "missed",
    "talk": "talk",
    "inbound": "Inbound",
    "outbound": "Outbound",
    "answered": "Answered",
    "ring": "Ring time",
    "unique": "Unique numbers",
    "recent": "Recent calls",
    "none": "No calls today"
  }
```

- [ ] **Step 6: Write the failing widget test**

Create `src/features/callstats/CallStatsWidget.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? _k }) }));
const useMyCallStats = vi.fn();
vi.mock('./hooks/useMyCallStats', () => ({ useMyCallStats: () => useMyCallStats() }));

import { CallStatsWidget } from './CallStatsWidget';

describe('CallStatsWidget', () => {
  it('renders nothing when there is no row', () => {
    useMyCallStats.mockReturnValue({ data: null });
    const { container } = render(<CallStatsWidget />);
    expect(container.firstChild).toBeNull();
  });

  it('shows counters when data is present', () => {
    useMyCallStats.mockReturnValue({ data: { extension: '207', total: 23, missed: 4, talk_seconds: 4320, recent: [] } });
    render(<CallStatsWidget />);
    expect(screen.getByText('23')).toBeTruthy();
    expect(screen.getByText('4')).toBeTruthy();
    expect(screen.getByText('1:12:00')).toBeTruthy();
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `npm run test:run -- src/features/callstats/CallStatsWidget.test.tsx`
Expected: FAIL — cannot resolve `./CallStatsWidget`.

- [ ] **Step 8: Implement the widget**

Create `src/features/callstats/CallStatsWidget.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { Phone, PhoneMissed, Timer } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useMyCallStats } from './hooks/useMyCallStats';
import { hms } from './hms';

const dirIcon: Record<string, string> = { in: '↙', out: '↗', int: '↔' };

export function CallStatsWidget() {
  const { t } = useTranslation('common');
  const { data } = useMyCallStats();
  if (!data) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="hidden items-center gap-2 rounded-lg border border-border/70 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted lg:flex"
          title={t('callstats.today')}
        >
          <span className="flex items-center gap-1"><Phone className="size-3.5" />{data.total}</span>
          <span className="flex items-center gap-1 text-red-600 dark:text-red-400"><PhoneMissed className="size-3.5" />{data.missed}</span>
          <span className="flex items-center gap-1"><Timer className="size-3.5" />{hms(data.talk_seconds)}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="mb-2 text-sm font-semibold">{t('callstats.today')}</div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <Row label={t('callstats.inbound')} value={data.inbound} />
          <Row label={t('callstats.outbound')} value={data.outbound} />
          <Row label={t('callstats.answered')} value={data.answered} />
          <Row label={t('callstats.missed')} value={data.missed} />
          <Row label={t('callstats.ring')} value={hms(data.ring_seconds)} />
          <Row label={t('callstats.unique')} value={data.unique_numbers} />
        </div>
        <div className="mt-3 mb-1 text-xs font-semibold text-muted-foreground">{t('callstats.recent')}</div>
        <ul className="max-h-56 space-y-1 overflow-y-auto text-xs">
          {data.recent.length === 0 && <li className="text-muted-foreground">{t('callstats.none')}</li>}
          {data.recent.map((c, i) => (
            <li key={i} className="flex items-center justify-between gap-2">
              <span className="tabular-nums text-muted-foreground">{c.t}</span>
              <span className="flex-1 truncate">{dirIcon[c.dir] ?? ''} {c.num}</span>
              <span className="tabular-nums text-muted-foreground">{c.dur ? hms(c.dur) : '—'}</span>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function Row({ label, value }: { label: string; value: number | string }) {
  return (
    <>
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium tabular-nums">{value}</span>
    </>
  );
}
```

- [ ] **Step 9: Run the widget test to verify it passes**

Run: `npm run test:run -- src/features/callstats/CallStatsWidget.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 10: Mount in the Topbar**

In `src/components/layout/Topbar.tsx`: add the import and render the widget as the first item of the right cluster (before the profile `<Link to="/profile">`).

Add near the other imports:
```tsx
import { CallStatsWidget } from '@/features/callstats/CallStatsWidget';
```

Change the right-cluster opening (currently `<div className="flex shrink-0 items-center gap-1.5 sm:gap-2">` then `{session && (`) so the widget renders first:
```tsx
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          {session && <CallStatsWidget />}
          {session && (
            <>
              <Link
                to="/profile"
```

- [ ] **Step 11: Typecheck / lint / full test run**

Run: `npm run build`
Expected: passes (tsc + eslint `--max-warnings=0` + vite build all green).

- [ ] **Step 12: Commit**

```bash
git add src/features/callstats src/components/layout/Topbar.tsx src/i18n/locales/el/common.json src/i18n/locales/en/common.json
git commit -m "feat(callstats): top-bar widget + popover, hms util, i18n, Topbar mount"
```

---

### Task 4: Box producer — `push_stats.php` + env + cron (deployed via SSH)

> Runs on `72.62.58.175`, not in the repo. Deploy over SSH (`ssh root@72.62.58.175`). Track the change in the spec's rollback section.

**Files (on box):**
- Create: `/var/www/recordings/push_stats.php`
- Create: `/etc/voiceland-supabase.env` (chmod 600)
- Modify: `/etc/cron.d/yeastar-stats-warm` (add push line)

**Interfaces:**
- Consumes: `/var/www/recordings/yeastar.php` (`yeastar_cdr_range`), Supabase REST `POST /rest/v1/call_stats_daily` with `Prefer: resolution=merge-duplicates`.
- Produces: upserted `call_stats_daily` rows (one per active extension, today).

- [ ] **Step 1: Create the env file (secrets, chmod 600)**

```bash
cat > /etc/voiceland-supabase.env <<'EOF'
export SUPABASE_URL="https://xujlrclyzxrvxszepquy.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="<paste service role key>"
EOF
chmod 600 /etc/voiceland-supabase.env
```
> Do not commit this anywhere. Env-var names only in any doc.

- [ ] **Step 2: Create `push_stats.php`**

```php
<?php
/** CLI: aggregate today's Yeastar CDR per extension and upsert to Supabase call_stats_daily. */
require __DIR__ . '/yeastar.php';

date_default_timezone_set('Europe/Athens');
$SUP_URL = getenv('SUPABASE_URL');
$SUP_KEY = getenv('SUPABASE_SERVICE_ROLE_KEY');
if (!$SUP_URL || !$SUP_KEY) { fwrite(STDERR, "missing SUPABASE env\n"); exit(1); }

$EXT = ['101','102','103','104','203','204','205','206','207','208','303','500','501','601'];
$isExt = array_flip($EXT);

$startTs = strtotime('today 00:00:00');
$endTs   = strtotime('today 23:59:59');
$res = yeastar_cdr_range($startTs, $endTs);
$cdr = $res['data'] ?? [];
$today = date('Y-m-d');

function agentExt($c, $isExt) {
    $t = $c['call_type'] ?? ''; $f = $c['call_from_number'] ?? ''; $to = $c['call_to_number'] ?? '';
    if ($t === 'Outbound')  return isset($isExt[$f])  ? $f  : null;
    if ($t === 'Inbound')   return isset($isExt[$to]) ? $to : null;
    if ($t === 'Internal')  return isset($isExt[$f])  ? $f  : null;
    return null;
}

$agg = [];
foreach ($cdr as $c) {
    $ext = agentExt($c, $isExt);
    if (!$ext) continue;
    if (!isset($agg[$ext])) $agg[$ext] = [
        'total'=>0,'inbound'=>0,'outbound'=>0,'internal'=>0,'answered'=>0,'missed'=>0,
        'missed_inbound'=>0,'talk_seconds'=>0,'ring_seconds'=>0,'nums'=>[],'recent'=>[]];
    $a =& $agg[$ext];
    $type = $c['call_type'] ?? ''; $disp = $c['disposition'] ?? '';
    $isAns = ($disp === 'ANSWERED');
    // duration = total (ring+talk); talk_duration only on answered calls.
    // duration - ring_duration = talk in all cases (0 when unanswered).
    $ring = (int)($c['ring_duration'] ?? 0);
    $talk = max(0, (int)($c['duration'] ?? 0) - $ring);
    $a['total']++;
    if ($type === 'Inbound') { $a['inbound']++; if (!$isAns) $a['missed_inbound']++; }
    elseif ($type === 'Outbound') $a['outbound']++;
    elseif ($type === 'Internal') $a['internal']++;
    if ($isAns) $a['answered']++; else $a['missed']++;
    $a['talk_seconds'] += $talk;
    $a['ring_seconds'] += $ring;
    // other party (customer) number + direction
    $other = ($type === 'Inbound') ? ($c['call_from_number'] ?? '') : ($c['call_to_number'] ?? '');
    if ($other !== '') $a['nums'][$other] = true;
    if (count($a['recent']) < 15) {
        $ts = (int)($c['timestamp'] ?? 0);
        $a['recent'][] = [
            't'   => $ts ? date('H:i', $ts) : substr((string)($c['time'] ?? ''), 11, 5),
            'num' => (string)$other,
            'dir' => $type === 'Inbound' ? 'in' : ($type === 'Outbound' ? 'out' : 'int'),
            'disp'=> $disp,
            'dur' => $talk,
        ];
    }
    unset($a);
}

$rows = [];
foreach ($agg as $ext => $a) {
    $rows[] = [
        'extension'=>$ext,'stat_date'=>$today,'total'=>$a['total'],'inbound'=>$a['inbound'],
        'outbound'=>$a['outbound'],'internal'=>$a['internal'],'answered'=>$a['answered'],
        'missed'=>$a['missed'],'missed_inbound'=>$a['missed_inbound'],'talk_seconds'=>$a['talk_seconds'],
        'ring_seconds'=>$a['ring_seconds'],'unique_numbers'=>count($a['nums']),
        'recent'=>array_values($a['recent']),'updated_at'=>date('c'),
    ];
}
if (!$rows) { fwrite(STDERR, date('c')." no extension calls today\n"); exit(0); }

$ch = curl_init($SUP_URL . '/rest/v1/call_stats_daily');
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => [
        'apikey: ' . $SUP_KEY,
        'Authorization: Bearer ' . $SUP_KEY,
        'Content-Type: application/json',
        'Prefer: resolution=merge-duplicates,return=minimal',
    ],
    CURLOPT_POSTFIELDS => json_encode($rows),
    CURLOPT_TIMEOUT => 30,
]);
$out = curl_exec($ch);
$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);
fwrite(STDERR, date('c')." pushed ".count($rows)." rows, http=$code ".($code>=300?$out:'')."\n");
exit($code >= 300 ? 1 : 0);
```

- [ ] **Step 3: Dry-run once and verify a row lands**

```bash
. /etc/voiceland-supabase.env && /usr/bin/php /var/www/recordings/push_stats.php
```
Expected stderr: `pushed N rows, http=201` (or `204`).
Then in the CRM, log in as any mapped user with calls today and confirm the widget shows numbers; cross-check against `https://recordings.itdev.gr/stats.php` for the same extension.

- [ ] **Step 4: Add the cron line**

Append to `/etc/cron.d/yeastar-stats-warm`:
```
*/2 8-20 * * * www-data . /etc/voiceland-supabase.env && /usr/bin/php /var/www/recordings/push_stats.php >> /var/log/yeastar-push.log 2>&1
```
Verify after a couple minutes: `tail /var/log/yeastar-push.log` shows periodic `pushed N rows, http=...`.

- [ ] **Step 5: Verify talk-time correctness**

Pick one extension with a known answered call today; compare `talk_seconds` in `call_stats_daily` against the real call length. If it reads as ring+talk or zero, adjust the talk field in `push_stats.php` (`duration` vs `duration - ring_duration`) and re-run Step 3.

---

## Self-Review

- **Spec coverage:** table + RLS + RPC (Task 1) ✓; widget + popover + hidden-when-empty (Task 3) ✓; box push every 2 min (Task 4) ✓; reuse `profiles.phone_extension`, no map table ✓; "for everyone with an extension" — RLS keys off any user's `phone_extension`, not a role ✓; talk-time caveat handled with `?? duration` fallback + verify step ✓; Athens tz in RPC + producer ✓. Team leaderboard intentionally out of v1 (admin can already read all rows).
- **Open items resolved in-plan:** refresh = 60 s poll (`refetchInterval`), realtime deferred; talk-field verification is Task 4 Step 5.
- **Type consistency:** `MyCallStats`/`RecentCall` fields (Task 2) match the SQL columns (Task 1) and the widget's reads (Task 3): `total, inbound, outbound, internal, answered, missed, missed_inbound, talk_seconds, ring_seconds, unique_numbers, recent{t,num,dir,disp,dur}`. RPC name `get_my_call_stats_today` identical across tasks.
- **Placeholder scan:** none — every step has concrete code/commands. The only literal fills are `TODAY_ATHENS` (a date) and the service key (a secret), both intentionally not hard-coded.
```
