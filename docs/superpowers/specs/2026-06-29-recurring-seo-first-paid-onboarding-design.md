# Recurring SEO: first Fully-Paid → New project (+email), later Fully-Paid → Renewal

- **Date:** 2026-06-29
- **Status:** Design — awaiting user review before plan
- **Area:** Accounting → Tech board automation (job stage placement + SEO onboarding email)
- **Robustness target:** maximal — every silent-failure path closed or surfaced.

## Problem

A `local_seo` / `web_seo` job is meant to land in its board's **New project** column the first
time the deal is paid, because that null→`new_project` stage change is what fires the onboarding
access email (`localseo_gbp_access` / `webseo_gsc_access`). Today this is unreliable:

1. **Direct drag to Paid-In-Full skips onboarding.** A job is seeded *off-board* (`stage_id` null)
   at deal insert by `release_billing_jobs_for_deal()`. Only `complete_accounting()` and the
   partial-payment trigger place it on a board. The Paid-In-Full handler `release_deal_jobs()`
   only moves *already-staged* jobs to `renewal` and unblocks the rest — it never places a
   stage-less job. A deal moved straight to **Paid In Full** leaves the job off-board, invisible,
   and **no email is ever sent.** (This is what happened to deal 001206 / IONIAN VIEW.)
2. **The "Complete accounting" path bounces the job out of New project.** It places the job in
   `new_project` (email fires) and then sets the deal to `paid_in_full` in the same transaction;
   the Paid-In-Full trigger immediately moves that job to `renewal`. So even the happy path doesn't
   *keep* a first-time job in New project.
3. **The email can be "done" but never actually sent.** Even when a job reaches New project, the
   email can silently miss: the outbox drain is stuck, or the `dept_technical` toggle was off at
   that instant. With a once-only design that becomes a permanent silent miss.

## Goal

On the deal's transition to **Paid In Full**, for a **recurring** `local_seo` / `web_seo` job:

- **First time ever** → land in **New project** and stay there; fire the onboarding email; mark the
  job "onboarded."
- **Every later time** → move to **Renewal** (today's behavior). No email.

And make the onboarding email **impossible to miss silently** (detect + self-heal).

## Scope

**In scope (new behavior):** recurring `local_seo` and `web_seo` jobs. "Recurring" is defined
defensively as **`billing_type is distinct from 'one_time'`** (so a missing/odd billing value still
onboards rather than silently dropping out).

**Out of scope — unchanged:**
- `web_dev`, `hosting`, `ai_seo` parent (billing record): unblock-only.
- `ads`, `social_media`: always move to Renewal on paid.
- **One-time** `local_seo` / `web_seo` jobs (explicit `one_time`): keep current behavior (Renewal on paid).
- The onboarding-email trigger, `complete_accounting()`, the partial-payment path: **not modified.**

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Which services get the new rule | `local_seo` + `web_seo` only. "The web" kept as-is = `web_dev`. |
| First-time vs later-time test | **Once-only marker** (`jobs.onboarded_at`). |
| Backfill of existing SEO jobs | **Conservative** — mark *all* current SEO jobs onboarded; no surprise emails to existing clients. Gap victims (e.g. IONIAN VIEW) sent manually via the ✉ button. |
| Partial-payment email timing | **Keep as-is** (email may fire at Partial; job marked onboarded at Fully-Paid). |
| Email safety net | **Detect + self-heal** — admin banner shows unsent onboarding emails AND a reconciler cron re-queues them. |

## Why this placement is robust — every Paid-In-Full path is covered

All of these set `accounting_stage_id`, which fires `deals_hold_jobs_on_stage_change` →
`release_deal_jobs`. So a single change to `release_deal_jobs` covers them all:

| Path | Routes through `release_deal_jobs`? |
|---|---|
| `complete_accounting()` | yes (sets stage to paid_in_full) |
| `accounting_mark_paid_in_full()` — established client | yes |
| `accounting_mark_paid_in_full()` — fresh client | yes (delegates to `complete_accounting`) |
| `deal_payments_release_from_on_hold()` (payment paid) | yes |
| `move_overdue_deals_to_on_hold()` reverse / sweeps | yes |
| Manual drag on the board | yes |

## Design

### 1. Marker column

```sql
alter table public.jobs add column if not exists onboarded_at timestamptz;
comment on column public.jobs.onboarded_at is
  'Set the first time a recurring local_seo/web_seo job is onboarded (placed in New project at first Fully-Paid). Null = never onboarded. Drives first-time vs renewal routing in release_deal_jobs().';
```

### 2. Conservative backfill (one-time, in the same migration, with backup)

```sql
create table if not exists public.jobs_onboarded_backfill_backup_20260629 as
  select id as job_id, onboarded_at as prev_onboarded_at, now() as backed_up_at
    from public.jobs
   where service_type in ('web_seo','local_seo') and not archived and onboarded_at is null;

update public.jobs
   set onboarded_at = coalesce(started_at, created_at, now())
 where service_type in ('web_seo','local_seo') and not archived and onboarded_at is null;
-- (log row_count)
```

Only brand-new SEO jobs created after ship get the first-time flow.

### 3. `release_deal_jobs(p_deal_id uuid)` — the single behavioral change

Defensive guard + four independent, idempotent UPDATEs. `RECURRING` ≙ `billing_type is distinct from 'one_time'`.

```sql
create or replace function public.release_deal_jobs(p_deal_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- Fail-loud guard: SEO boards must have their New project / Renewal stages.
  if not exists (select 1 from public.pipeline_stages where board='local_seo' and code='new_project' and not archived)
     or not exists (select 1 from public.pipeline_stages where board='web_seo' and code='new_project' and not archived) then
    raise warning 'release_deal_jobs: a SEO board is missing its new_project stage; onboarding placement skipped for deal %', p_deal_id;
  end if;

  -- (1a) RECURRING SEO, never onboarded, off-board -> New project + mark + unblock.
  --      Fires jobs_seo_onboarding_email (null->new_project). Fixes the direct-drag gap.
  --      Only runs when new_project resolves (never nulls a stage).
  update public.jobs j
     set is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null,
         onboarded_at=now(),
         stage_id=(select s.id from public.pipeline_stages s
                    where s.board=j.service_type and s.code='new_project' and not s.archived limit 1)
   where j.deal_id=p_deal_id and not j.archived
     and j.service_type in ('web_seo','local_seo')
     and j.billing_type is distinct from 'one_time'
     and j.onboarded_at is null
     and j.stage_id is null
     and exists (select 1 from public.pipeline_stages s
                  where s.board=j.service_type and s.code='new_project' and not s.archived);

  -- (1b) RECURRING SEO, never onboarded, already on a board -> just MARK + unblock; leave in place.
  --      (Placed earlier by complete_accounting / partial / ai_seo child; email already fired.)
  --      Kills the bounce-to-Renewal on first paid.
  update public.jobs j
     set is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null,
         onboarded_at=now()
   where j.deal_id=p_deal_id and not j.archived
     and j.service_type in ('web_seo','local_seo')
     and j.billing_type is distinct from 'one_time'
     and j.onboarded_at is null
     and j.stage_id is not null;

  -- (1c) RECURRING SEO, already onboarded -> Renewal (non-terminal only) + unblock.
  update public.jobs j
     set is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null,
         stage_id=coalesce((select rs.id from public.pipeline_stages rs
                             where rs.board=j.service_type and rs.code='renewal' and not rs.archived limit 1),
                           j.stage_id)
    from public.pipeline_stages cur
   where j.deal_id=p_deal_id and not j.archived
     and j.service_type in ('web_seo','local_seo')
     and j.billing_type is distinct from 'one_time'
     and j.onboarded_at is not null
     and cur.id=j.stage_id and not cur.is_terminal;

  -- (2) UNCHANGED renewal-move: one-time SEO + all ads/social_media -> Renewal (non-terminal) + unblock.
  update public.jobs j
     set is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null,
         stage_id=coalesce((select rs.id from public.pipeline_stages rs
                             where rs.board=j.service_type and rs.code='renewal' and not rs.archived limit 1),
                           j.stage_id)
    from public.pipeline_stages cur
   where j.deal_id=p_deal_id and not j.archived
     and ( (j.service_type in ('web_seo','local_seo') and j.billing_type = 'one_time')
           or j.service_type in ('ads','social_media') )
     and cur.id=j.stage_id and not cur.is_terminal;

  -- (3) UNCHANGED: everything else (web_dev, hosting, ai_seo parent) -> unblock only.
  update public.jobs
     set is_blocked=false, blocked_reason=null, blocked_at=null, blocked_by=null
   where deal_id=p_deal_id and is_blocked and not archived
     and blocked_reason in ('account_on_hold','partial_payment_pending')
     and service_type not in ('web_seo','local_seo','ads','social_media');
end $$;
```

### 4. Email safety net (independent of the marker / board behavior)

**4a. Detect — extend `email_pipeline_health()`** to add an `onboarding_unsent_count`: recurring SEO
jobs with `onboarded_at < now() - interval '1 hour'`, client email present, the relevant dept/automation
toggle enabled, and **no** delivered/sent onboarding row and **no** pending/sending outbox row for the
job's dedupe key. Surface in the admin banner: *"N onboarding email(s) not sent."*

**4b. Self-heal — `reconcile_seo_onboarding_emails()` cron** (mirrors `block_lifecycle_reconciler`,
every ~15 min). For the exact same set as 4a, re-queue the onboarding email by inserting into
`email_outbox` with the **same dedupe key** the trigger uses (`localseo_gbp:<deal_id>` /
`webseo_gsc:<deal_id>`) and template (`localseo_gbp_access` / `webseo_gsc_access`). Idempotent: the
dedupe key + the `email_log` dedupe-unique index prevent duplicates; respects the dept toggle; skips
anything already pending (those are the drain's problem, already flagged by the existing health check).

### 5. Untouched, relied-upon behavior

- **The email trigger** `jobs_seo_onboarding_email` (after insert/update of `stage_id`): fires on
  null→`new_project`, checks toggle + client email + per-deal dedupe. Branch (1a) is its new caller.
- **"New project" / "Renewal"** resolved by `code`, not column order — a future reorder can't break it.

## Failure-mode matrix

| Failure mode | Mitigation |
|---|---|
| Deal dragged straight to Paid-In-Full (no Complete accounting) | Branch 1a places off-board job → New project + email. |
| Complete-accounting bounce to Renewal on first paid | Branch 1b marks in place, no move. |
| Email outbox stuck/down | Existing drain health banner + reconciler skips pending (won't pile up). |
| Email never queued (toggle was off / send failed) | Reconciler re-queues once conditions allow; banner shows count. |
| Double-fire / concurrent paid_in_full | Marker UPDATE is row-locked + idempotent; email dedupe-unique index blocks double-send. |
| Missing `new_project`/`renewal` stage on a board | Fail-loud `raise warning`; UPDATEs never null a stage (coalesce / existence guard). |
| Missing/odd `billing_type` on a SEO job | Treated as recurring (`is distinct from 'one_time'`) → still onboards. |
| Existing clients re-emailed on ship | Conservative backfill marks all current SEO jobs onboarded. |
| AI-SEO child yanked on first paid | Branch 1b leaves it in place; existing ones marked by backfill. |
| Job mid-work (e.g. Optimize) at first paid | Branch 1b leaves it; only goes to Renewal once marked (next paid). |
| Finished job (Done/Closed) | `not cur.is_terminal` guard prevents yanking. |

## Edge cases

- **Re-onboarding a returned client:** once-only by design; clear `onboarded_at` (admin) to re-arm, or
  use the ✉ button. Documented, not automated.
- **Partial then Fully-Paid:** email fires at Partial (today's behavior); job marked at Fully-Paid.

## Testing (pgTAP, `supabase/tests/`)

Behavioral:
1. First paid, off-board recurring local_seo → `new_project`, `onboarded_at` set, onboarding row queued.
2. Second paid, same job → `renewal`, marker unchanged, **no new** email row.
3. web_seo analog of #1 (GSC).
4. First paid, recurring SEO already in `new_project` (1b) → stays, marked, no bounce.
5. One-time local_seo → `renewal`, no first-time routing, no email.
6. web_dev → unblock only; stage untouched.
7. Onboarded job in a terminal stage → not moved.

Robustness:
8. Each Paid-In-Full entry path (complete_accounting, accounting_mark_paid_in_full established + fresh,
   on-hold→paid trigger, manual drag) onboards exactly once.
9. Double-fire paid_in_full → one onboard, one email (idempotency).
10. Missing `new_project` stage → warning raised, job left off-board (no null stage), no crash.
11. SEO job with null `billing_type` → treated as recurring (onboards).
12. Reconciler: onboarded job with no sent email + toggle on → re-queued once; with a pending row → skipped;
    with a delivered row → skipped; toggle off → skipped (and counted by health).

## Changes / Revert

**Changes**
- `jobs.onboarded_at` column + conservative backfill (backup: `jobs_onboarded_backfill_backup_20260629`).
- `release_deal_jobs()` rewritten (guard + 4 branches).
- `email_pipeline_health()` extended with `onboarding_unsent_count`.
- New `reconcile_seo_onboarding_emails()` function + pg_cron schedule.

**Revert**
- Restore `release_deal_jobs()` from `20260628040000_release_deal_jobs_partial_payment.sql`.
- Restore `email_pipeline_health()` from `20260615000003_email_health.sql`.
- `select cron.unschedule('reconcile-seo-onboarding-emails'); drop function if exists public.reconcile_seo_onboarding_emails();`
- Optionally `alter table public.jobs drop column onboarded_at;` (harmless to leave).
- No data restore needed (backfill only sets a new, otherwise-unused column; backup table available).

## Open questions

None.
