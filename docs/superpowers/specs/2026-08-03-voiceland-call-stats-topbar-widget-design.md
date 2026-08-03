# Voiceland Live Call-Stats Top-Bar Widget — Design / Spec

- **Date:** 2026-08-03
- **Status:** Design approved (owner), pending spec review → implementation plan
- **Owner ask:** A live widget in the CRM top bar (left of the profile icon) that shows the logged-in user's telephone activity today — calls made, missed/unanswered, talk time — refreshing on its own. **For every user with a phone extension, not only the sales team.**

## Greek TL;DR (για τον owner)

Μικρό widget στο top bar που δείχνει, για τον συνδεδεμένο χρήστη: **κλήσεις σήμερα · αναπάντητες · χρόνος ομιλίας**, με κλικ για ανάλυση + τελευταίες κλήσεις. Τα δεδομένα έρχονται από το Yeastar μέσω του server `72.62.58.175`, ο οποίος **σπρώχνει** κάθε 2 λεπτά τα σύνολα ανά εσωτερικό στο Supabase. Κάθε χρήστης βλέπει **μόνο τα δικά του** (RLS). Ισχύει για **όλους** όσους έχουν εσωτερικό.

---

## 1. Context

There is a separate Ubuntu box (`72.62.58.175`, hostname `srv1622863`) that serves `recordings.itdev.gr` and already pulls **Yeastar P-Series Cloud OpenAPI** CDR (Call Detail Records). See memory `project_voiceland_call_stats` and `project_pbx_telephony`.

Existing pieces we reuse:
- `/var/www/recordings/yeastar.php` — Yeastar API client (`yeastar_cdr_range($startTs,$endTs)`), token cache.
- `/var/www/recordings/stats.php` — computes per-extension aggregates (total / in / out / answered / missed / talk / ring) for a date range; HTML dashboard.
- `/var/www/recordings/warm_stats.php` + cron `*/2 8-20 * * *` — keeps today's CDR cache warm every 2 minutes.

**Hard constraint:** The Yeastar API is IP-whitelisted to `72.62.58.175` only. The CRM (Vercel, dynamic IPs) **cannot** call Yeastar directly. All Yeastar access must originate from this box. → The box is the producer; the CRM is the consumer.

## 2. Scope

### In scope (v1)
- A per-user top-bar widget showing **today's** counters for the logged-in user: total calls, missed (and missed-inbound), talk time.
- A **click popover** with the breakdown (inbound / outbound / answered / missed, ring time, unique numbers) and the user's **last ~15 calls** (time, number, direction, disposition, duration).
- Available to **any CRM user mapped to a Yeastar extension** (not gated by sales role).
- Near-real-time: data is at most ~2–3 min stale (matches the existing 2-min warm cadence).

### Out of scope (v1) — future tracks
- Team leaderboard / cross-user comparison UI (RLS will already allow admins to read all rows, so it is a later frontend-only addition).
- Historical ranges beyond "today" in the widget (the box already supports week/month; can be layered later).
- Matching calls to leads/deals, or importing the AI daily sales summaries / extracted deals. Separate initiative.

## 3. Architecture / data flow

```
Yeastar Cloud API ──(IP-whitelisted)──▶  Box: warm_stats + push_stats (cron */2)
                                                    │  upsert per-extension "today" row
                                                    ▼  (Supabase REST, service-role key)
                                          Supabase: call_stats_daily  ◀── RLS: own extension only
                                                    ▲
                                    RPC get_my_call_stats_today() (security definer)
                                                    ▲
                                     CRM top-bar widget (React Query poll 60s / realtime)
```

Three components: (A) box push, (B) Supabase schema + RLS + RPC, (C) frontend widget.

## 4. Data model (Supabase)

### 4.1 User ↔ extension: reuse `profiles.phone_extension` (NO new table)
The CRM `profiles` table already has a `phone_extension` column, and it is now **fully populated for all 14 Yeastar extensions** (mapping completed 2026-08-03 — see memory `project_voiceland_call_stats`). So there is **no `call_extension_map` table**; the widget resolves the current user's extension from `profiles.phone_extension` where `user_id = auth.uid()`.

Completed mapping: 101 marios · 102 mkifokeris · 103 dtzouvaras · 104 pefstathiadis · 203 tvogiatzi · 204 stavroula · 205 dgiannakakis · 206 vdimitrov · 207 akotzampasakis · 208 ekitsakis · 303 agaleou · 500 emarketaki (Eirini, Λογιστήριο/Γραμματεία) · 501 cpostantzian · 601 azazas.
(The 4 previously-empty rows 102/104/204/500 were set on 2026-08-03; rollback = set those back to NULL.)

### 4.2 `call_stats_daily` — per-extension, per-day aggregate (+ recent calls)
One row per extension per day; upserted by the box. `recent` holds the last ~15 calls for the popover.

```sql
create table public.call_stats_daily (
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
```

`recent` element shape: `{ "t": "10:09", "num": "69xxxxxxxx", "dir": "out", "disp": "NO ANSWER", "dur": 32 }`.

### 4.3 RLS
```sql
alter table public.call_stats_daily enable row level security;

-- A user reads only the row whose extension equals their profiles.phone_extension; admins read all.
create policy call_stats_daily_select on public.call_stats_daily
for select using (
  is_admin(auth.uid())                                   -- reuse existing admin predicate
  or exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid()
      and p.phone_extension = call_stats_daily.extension
  )
);
```
> Confirm the real admin predicate name during implementation (repo already has one — do NOT invent). Also confirm `phone_extension`'s column type and that comparison to `call_stats_daily.extension text` is type-clean (cast if it is int). Writes to `call_stats_daily` come from the box using the **service role key**, which bypasses RLS; no insert/update policy for regular users.

### 4.4 RPC (frontend entry point)
Keeps the client query trivial and never exposes the whole table.
```sql
create or replace function public.get_my_call_stats_today()
returns public.call_stats_daily
language sql stable security definer set search_path = public as $$
  select s.* from public.call_stats_daily s
  join public.profiles p
    on p.phone_extension = s.extension and p.user_id = auth.uid()
  where s.stat_date = (now() at time zone 'Europe/Athens')::date
  limit 1;
$$;
```
> Timezone matters: "today" must be Athens local, matching the box's `strtotime('today')`. Verify the box runs in Europe/Athens (or normalize both sides to the same tz).

## 5. Box producer (`push_stats.php` + cron)

- New file `/var/www/recordings/push_stats.php` (CLI). Reuses `yeastar.php` + the same aggregation logic as `stats.php` for the **today** range. To avoid drift, refactor the per-extension aggregation out of `stats.php` into a shared include (e.g. `agg.php`) that both `stats.php` and `push_stats.php` call.
- For each extension present in today's CDR, upsert one `call_stats_daily` row via Supabase REST:
  - `POST {SUPABASE_URL}/rest/v1/call_stats_daily`
  - Headers: `apikey`, `Authorization: Bearer {SERVICE_ROLE_KEY}`, `Content-Type: application/json`, `Prefer: resolution=merge-duplicates,return=minimal`.
- Secrets in `/etc/voiceland-supabase.env` (chmod 600, NOT in git): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. (Env-var names only per `feedback_no_secrets_in_docs`.)
- Cron: add alongside the existing warmer so push runs right after the cache is warm, every 2 min in business hours:
  ```
  */2 8-20 * * * www-data . /etc/voiceland-supabase.env && /usr/bin/php /var/www/recordings/push_stats.php >> /var/log/yeastar-push.log 2>&1
  ```
- **Field caveat to verify:** the sampled CDR contained `duration` and `ring_duration` but **no** `talk_duration`, yet `stats.php` sums `talk_duration` (likely a latent bug showing 0 talk time). `push_stats.php` must use the correct talk field — verify against a live call whether talk = `duration` (billsec, ring excluded) or `duration - ring_duration`. Do not blindly copy `stats.php`.
- **All extensions**: unlike `daily-summary.py` (which restricts AI analysis to a sales subset for cost), the push covers **every** extension seen in CDR, so all mapped users get stats.

## 6. Frontend widget (CRM)

- Component `CallStatsWidget`, mounted in the top bar immediately left of the profile icon.
- Hook `useMyCallStats()` → React Query calling `get_my_call_stats_today` (RPC). `refetchInterval: 60_000`, `placeholderData` to avoid flicker (see `project_replies_column_persistent`). Optional: Supabase realtime subscription on the user's row for instant updates.
- Collapsed view: `📞 {total} σήμερα · ❌ {missed} αναπάντητες · ⏱ {hms(talk_seconds)}`.
- Popover (on click): inbound/outbound/answered, ring time, unique numbers, and the `recent` list rendered as rows (ώρα, αριθμός, κατεύθυνση εικονίδιο, έκβαση, διάρκεια).
- **Hidden** when the user has no active mapping or no row yet for today (render nothing — no empty box).
- Greek labels; reuse existing `hms()`-style duration formatting util if present, else add one with a unit test.

## 7. Security

- Yeastar & OpenAI secrets never leave the box; the CRM only receives aggregates.
- Box→Supabase uses the service-role key (outbound only) stored in a chmod-600 env file, not in git.
- RLS guarantees each user reads only their own extension's row; admins read all.
- Standing follow-up: rotate the server root password + (ideally) Yeastar creds that were shared in chat.

## 8. Testing (TDD, per `feedback_plan_granularity`)

- **Migration/RLS:** with a seeded map + row, a non-admin user reading `get_my_call_stats_today` gets only their row; a different user gets none; admin can select any row. (Use the role-switch technique from `reference_attachments_rls`.)
- **RPC tz:** row for Athens-today is returned; yesterday's is not.
- **Frontend:** `useMyCallStats` renders counters from a mocked RPC result; widget hides when result is null; popover lists `recent` items; `hms` formatting unit test.
- **Producer:** unit-test the aggregation helper against a fixture CDR array → expected per-extension counters (incl. the talk-field decision); dry-run `push_stats.php` against a test extension and assert the upserted row.
- Note `reference_jestdom_vitest_broken` (use core matchers) and `project_full_live_sweep` (vitest hits PROD — guard test data).

## 9. Rollout — small, testable, commit-per-task

1. **Migration**: `call_stats_daily` + RLS + RPC (with rollback SQL). Commit. (No mapping table — reuses `profiles.phone_extension`.)
2. **Mapping**: ✅ DONE — `profiles.phone_extension` populated for all 14 extensions (2026-08-03). No task.
3. **Frontend**: `useMyCallStats` hook + `CallStatsWidget` + popover + tests. Commit.
4. **Producer on box**: `agg.php` refactor + `push_stats.php` + `/etc/voiceland-supabase.env` + cron line. (Box change, tracked in this spec; not a repo commit.)
5. **E2E verify**: confirm live numbers match the `recordings.itdev.gr` dashboard for a couple of extensions; verify talk-time field.

## 10. Rollback SQL (per `feedback_track_changes_for_revert`)

```sql
drop function if exists public.get_my_call_stats_today();
drop table if exists public.call_stats_daily;
-- Undo the 2026-08-03 mapping backfill (only if fully reverting the feature):
update public.profiles set phone_extension = null
  where email in ('mkifokeris@itdev.gr','pefstathiadis@itdev.gr','stavroula@itdev.gr','emarketaki@itdev.gr');
-- Box: remove push cron line, delete /var/www/recordings/push_stats.php and /etc/voiceland-supabase.env,
--      revert agg.php refactor in stats.php.
```

## 11. Open items to confirm

1. **Extension ↔ CRM user mapping** — ✅ RESOLVED 2026-08-03. All 14 extensions mapped in `profiles.phone_extension` (500→Eirini Marketaki per owner). Users without an extension (Elena, Stelios, mailboxes, test) simply get no widget.
2. **Talk-time field** — resolve `duration` vs `talk_duration` vs `duration - ring_duration` against a live call.
3. **Refresh mechanism** — 60s poll (simple) vs Supabase realtime on the row (instant). Default: poll for v1, realtime optional.
4. **Timezone** — confirm the box + RPC agree on Europe/Athens for "today".
