# UD Cadence Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 10 Important + cheap Minor findings of the 2026-08-31 UD cadence audit — the SQL edge-state bombs (ownerless-lead park, auto-pause crash, cron wedge, task-delete hole, leapfrog, archived restart) and the frontend silent-failure/stale-UI class — without changing any intended behavior.

**Architecture:** One additive SQL migration redefines five functions (`ud_advance_run`, `ud_process_due_runs`, `ud_start_cadence_run`, `ud_auto_pause_lead`, `ud_leads_transfer_cadence_tasks`) with surgical guards, adds a current-task check to `ud_complete_cadence_task`, and adds a BEFORE DELETE guard on open cadence `user_tasks`. Frontend: a shared `udErrorMessage()` mapper + `onError` on the four silent mutations, bounds on the admin hour input and the snooze picker, a pure `isDueToday()` helper fixing the due-display bug, and a 60s `refetchInterval` on the cadence overview.

**Tech Stack:** Postgres (plpgsql, SECURITY DEFINER, triggers) via the Management API apply script; React 19 + TanStack Query + react-i18next (`sales` ns); Vitest.

## Global Constraints

- Repo: `/Users/marios/Desktop/Projects/itdevcrm-main`, branch `main` (team norm: atomic commits straight to `main`). Shared checkout with other Claude sessions: `git add` ONLY the files each task names; check `git diff --cached` before each commit.
- **`npm run build` is the strict gate** before every commit touching `src/`. Prettier on new files.
- **Migration applied to prod BEFORE pushing** (Vercel auto-deploys `main`). The owner (or controller) runs the prepared curl script; every migration carries `-- ROLLBACK:`.
- Behavior must NOT change on the happy paths: same emails, same tasks, same delays, same outcomes. Every SQL change is a guard on an edge state.
- The **final effective definitions** being amended (copy each function body from these exact sources, then apply only the stated insertions):
  - `ud_advance_run` → `supabase/migrations/20260828230000_ud_doc_alignment.sql:32-115`
  - `ud_process_due_runs` → `supabase/migrations/20260826150000_ud_cadence_engine.sql:347-360`
  - `ud_start_cadence_run` → `supabase/migrations/20260826150000_ud_cadence_engine.sql:245-268`
  - `ud_auto_pause_lead` → `supabase/migrations/20260826250000_ud_auto_pause.sql:24-59` (keep its `revoke execute` line semantics — re-issue the revoke after CREATE OR REPLACE is NOT needed; ACLs survive)
  - `ud_leads_transfer_cadence_tasks` → `supabase/migrations/20260826210000_ud_reassign_and_overdue.sql:45-74`
  - `ud_complete_cadence_task` → `supabase/migrations/20260826230000_ud_flow_upgrades.sql:26-121` (3-arg version)
- Exact new SQL error codes: `not_current_task` (complete on a task that is not the run's current one), `cadence_task_delete_blocked` (direct DELETE of an open cadence task). Frontend maps both.
- Exact i18n error keys (EN / EL), all under `sales:ud.cadence.errors`: `already_completed` ("This task was already completed." / "Αυτό το task έχει ήδη ολοκληρωθεί."), `invalid_due` ("The snooze date must be in the future." / "Η ημερομηνία αναβολής πρέπει να είναι μελλοντική."), `invalid_outcome` ("Invalid outcome." / "Μη έγκυρο αποτέλεσμα."), `not_a_cadence_task` ("This is not an automation task." / "Αυτό δεν είναι task αυτοματισμού."), `no_live_run` ("The lead has no live automation chain." / "Ο lead δεν έχει ενεργή αλυσίδα."), `permission_denied` ("You don't have permission for this action." / "Δεν έχεις δικαίωμα για αυτή την ενέργεια."), `pause_failed` ("Pause/resume failed." / "Η παύση/συνέχιση απέτυχε."), `snooze_failed` ("Snooze failed." / "Η αναβολή απέτυχε."), `cadence_complete_failed` ("Completing the task failed." / "Η ολοκλήρωση του task απέτυχε."), `lead_not_found` ("Lead not found." / "Ο lead δεν βρέθηκε."), `not_current_task` ("This is not the chain's current task anymore — refresh the page." / "Αυτό δεν είναι πλέον το τρέχον task της αλυσίδας — κάνε ανανέωση."), `run_paused` (reuse existing copy of `ud.cadence.paused_error` verbatim as the value), `save_failed` ("Save failed: {{msg}}" / "Η αποθήκευση απέτυχε: {{msg}}"). Plus `ud.admin.hours_after_previous`: "hours" / "ώρες".
- Frontend error surfacing uses `alert()` (the page's existing pattern) — no new toast system.
- Out of scope (owner decisions, deliberately untouched): offer-chain tail returning 'advanced' instead of 'exhausted'; offers created while in `ud_scheduled` starting no chain; realtime channels (polling only).

## File Structure

| File | Responsibility |
| --- | --- |
| `supabase/migrations/20260831140000_ud_cadence_hardening.sql` (create) | All 7 SQL guards |
| `src/features/under_development/udErrors.ts` (create) + `.test.ts` | RPC error-code → translated message |
| `src/features/under_development/hooks/useLeadCadence.ts` (modify) | `onError` on `useSetRunPaused` |
| `src/features/under_development/hooks/useUdAdmin.ts` (modify) | `onError` on the 3 admin mutations |
| `src/features/under_development/SalesAutomationsPage.tsx` (modify) | `max` prop on DaysInput; `max={23}` on hours; real i18n key |
| `src/features/under_development/CadenceOutcomeButtons.tsx` (modify) | catch → `udErrorMessage` |
| `src/features/under_development/CadenceSnoozeButton.tsx` (modify) | catch → `udErrorMessage`; `min` on datetime-local |
| `src/features/under_development/salesTaskDue.ts` (create) + `.test.ts` | `isDueToday(iso, now)` |
| `src/features/under_development/SalesTasksPage.tsx` (modify) | use `isDueToday` in `fmtDue` |
| `src/features/under_development/hooks/useCadenceOverview.ts` (modify) | `refetchInterval: 60_000` |
| `src/i18n/locales/{en,el}/sales.json` (modify) | `ud.cadence.errors.*`, `ud.admin.hours_after_previous` |

---

### Task 1: SQL hardening migration

**Files:**
- Create: `supabase/migrations/20260831140000_ud_cadence_hardening.sql`
- Create (scratch, NOT committed): `/private/tmp/claude-501/-Users-marios-Desktop-Projects-itdevcrm-main/e9172216-432a-4f2b-aecc-f7124ac58afa/scratchpad/apply-ud-hardening.sh`

**Interfaces:**
- Consumes: the final definitions listed in Global Constraints (copy verbatim, then insert only the blocks below).
- Produces: the two new error codes `not_current_task` and `cadence_task_delete_blocked`; trigger `user_tasks_guard_cadence_delete`; no signature changes anywhere (ACLs/revokes survive CREATE OR REPLACE).

- [ ] **Step 1: Write the migration**

Header comment: cite the 2026-08-31 audit, one line per guard. Then, in this order:

**(G1) `ud_advance_run` — open-task + concurrency guard.** Copy the full body from `20260828230000:36-115` unchanged EXCEPT: immediately after the line `if r is null or r.status <> 'active' then return; end if;` insert:

```sql
    -- Audit G1: never advance past an open task. All legitimate callers clear
    -- current_task_id before calling; a concurrent/overlapping invocation
    -- (double cron tick, manual call) would otherwise leapfrog the open task,
    -- fire the next email early and orphan the task.
    if r.current_task_id is not null then return; end if;
```

**(G2) `ud_process_due_runs` — per-run error isolation.** Full replacement:

```sql
create or replace function public.ud_process_due_runs()
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  for v_id in
    select id from public.ud_cadence_runs
     where status = 'active' and next_event_at is not null and next_event_at <= now()
     order by next_event_at
  loop
    -- Audit G2: one poisoned run must not wedge the whole batch (and, because
    -- the loop used to be one transaction, permanently block every UD email).
    begin
      perform public.ud_advance_run(v_id);
    exception when others then
      raise warning 'ud_process_due_runs: run % failed: %', v_id, sqlerrm;
    end;
  end loop;
end $$;
```

**(G3) `ud_start_cadence_run` — never start on archived/converted leads.** Copy the body from `20260826150000:245-268` unchanged EXCEPT: as the FIRST statements of the body (before `perform public.ud_stop_live_run(...)`) insert:

```sql
  -- Audit G3: a stage change on an already-archived or converted lead must not
  -- restart a chain (tasks for invisible leads / chase emails to customers).
  if exists (
    select 1 from public.leads l
     where l.id = p_lead_id and (l.archived or l.converted_at is not null)
  ) then return; end if;
```

**(G4) `ud_auto_pause_lead` — never throw inside ingestion triggers.** Full replacement — same body as `20260826250000:24-59` with two changes: the comment insert only runs when an author exists, and the whole body is belt-and-braces wrapped:

```sql
create or replace function public.ud_auto_pause_lead(p_lead_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  r public.ud_cadence_runs;
  l public.leads;
  v_author uuid;
begin
  if not coalesce((select auto_pause_enabled from public.ud_cadence_settings limit 1), true) then
    return;
  end if;

  select * into r from public.ud_cadence_runs
   where lead_id = p_lead_id and status = 'active'
   for update;
  if r.id is null then return; end if;

  update public.ud_cadence_runs set status = 'paused' where id = r.id;

  select * into l from public.leads where id = p_lead_id;

  -- Audit G4: ownerless+creatorless leads (intake auto-release) have no valid
  -- comments.author_id (NOT NULL). Pause silently instead of blowing up the
  -- gmail-sync / call-router transaction that fired us.
  v_author := coalesce(l.owner_user_id, l.created_by);
  if v_author is not null then
    insert into public.comments (parent_type, parent_id, author_id, body, mentioned_user_ids, task_key)
    values ('lead', p_lead_id, v_author,
            '⏸ Αυτόματη παύση αλυσίδας — '
              || case p_reason when 'email' then 'ο lead απάντησε με email.'
                               else 'ο lead μάς κάλεσε.' end,
            '{}', 'cadence:auto_pause:' || r.id);
  end if;

  if l.owner_user_id is not null then
    insert into public.notifications (user_id, type, payload)
    values (l.owner_user_id, 'cadence_auto_paused',
      jsonb_build_object(
        'parent_type', 'lead', 'parent_id', p_lead_id,
        'lead_title', l.title, 'reason', p_reason));
  end if;
exception when others then
  -- A lead's sign of life must NEVER break the pipeline recording it.
  raise warning 'ud_auto_pause_lead(%): %', p_lead_id, sqlerrm;
end $$;
```

**(G5) parked-run resume on owner assignment.** Full replacement of `ud_leads_transfer_cadence_tasks` — same body as `20260826210000:45-74` with one addition just before `return new;`:

```sql
  -- Audit G5: a run parked for "no assignee" (active, no current task, no next
  -- event — see ud_advance_run's park branch) is invisible to the cron. The
  -- owner arriving is the resume signal: advance it now so the lead finally
  -- gets its first task.
  perform public.ud_advance_run(r.id)
    from (
      select id from public.ud_cadence_runs
       where lead_id = new.id and status = 'active'
         and current_task_id is null and next_event_at is null
       limit 1
    ) r;
```

NOTE plpgsql syntax: `perform ... from (subquery) r` is valid — it evaluates `ud_advance_run(r.id)` once per subquery row (0 or 1 rows). If you prefer, an equivalent explicit form is `select id into v_run_id from ... limit 1; if v_run_id is not null then perform public.ud_advance_run(v_run_id); end if;` with `v_run_id uuid` added to the declare block — either form is acceptable; pick one and keep it consistent.

**(G6) open cadence task delete guard.**

```sql
create or replace function public.user_tasks_guard_cadence_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Audit G6: deleting an open cadence task strands its run (active, no
  -- current task, no next event = dead). Engine-internal deletes (the
  -- lead-delete trigger from 20260830090000) arrive at trigger depth > 1 and
  -- pass; direct user deletes are refused (admins included — archive or
  -- complete the task instead; hard job/lead deletes go through their RPCs).
  if old.cadence_run_id is not null
     and old.completed_at is null
     and pg_trigger_depth() = 1 then
    raise exception 'cadence_task_delete_blocked';
  end if;
  return old;
end $$;

drop trigger if exists user_tasks_guard_cadence_delete on public.user_tasks;
create trigger user_tasks_guard_cadence_delete
  before delete on public.user_tasks
  for each row execute function public.user_tasks_guard_cadence_delete();
```

**(G7) `ud_complete_cadence_task` — stale-task guard.** Copy the full 3-arg body from `20260826230000:26-121` unchanged EXCEPT: immediately after the statement that loads the run row `for update` (the `select * into r from public.ud_cadence_runs where id = t.cadence_run_id for update;` line — locate it in the copied body) and after any existing `no_live_run` check that follows it, insert:

```sql
  -- Audit G7: a stale open task of the same run (leapfrog or reopen) must not
  -- stop/advance the chain out from under the genuinely current task.
  if r.status = 'active' and r.current_task_id is not null
     and r.current_task_id <> p_task_id then
    return jsonb_build_object('ok', false, 'error', 'not_current_task');
  end if;
```

End with a `-- ROLLBACK:` section: drop the G6 trigger+function, and note that the five replaced functions roll back by re-running their previous emissions (name the five source migrations + line ranges from Global Constraints).

- [ ] **Step 2: Static sanity check**

Run: `node -e "const s=require('fs').readFileSync('supabase/migrations/20260831140000_ud_cadence_hardening.sql','utf8'); console.log('len',s.length, 'dollar-quote balance', (s.match(/\\$\\$/g)||[]).length % 2 === 0 ? 'ok' : 'BROKEN')"`
Expected: `dollar-quote balance ok`. Also count: exactly 6 `create or replace function` + 1 `create trigger`.

- [ ] **Step 3: Write the apply script** (same curl pattern as `apply-acc-delete-migration.sh` in the scratchpad, project `xujlrclyzxrvxszepquy`), with verification queries after the apply:

```
q "guard trigger exists" "select tgname from pg_trigger where tgrelid='public.user_tasks'::regclass and tgname='user_tasks_guard_cadence_delete'"
q "fn md5s" "select proname, md5(pg_get_functiondef(oid)) from pg_proc where proname in ('ud_advance_run','ud_process_due_runs','ud_start_cadence_run','ud_auto_pause_lead','ud_leads_transfer_cadence_tasks','ud_complete_cadence_task') order by 1"
q "parked runs that G5 will resume on next owner change" "select count(*) from ud_cadence_runs r where r.status='active' and r.current_task_id is null and r.next_event_at is null"
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260831140000_ud_cadence_hardening.sql
git commit -m "fix(ud): cadence hardening — park-resume, auto-pause crash, cron isolation, delete guard, leapfrog + archived-lead guards"
```

---

### Task 2: Frontend — error surfacing, bounds, i18n

**Files:**
- Create: `src/features/under_development/udErrors.ts`; Test: `src/features/under_development/udErrors.test.ts`
- Modify: `src/features/under_development/hooks/useLeadCadence.ts` (`useSetRunPaused`, lines ~119-133)
- Modify: `src/features/under_development/hooks/useUdAdmin.ts` (`useUpdateUdCadence` ~52, `useUpdateUdStep` ~63, `useUpdateUdSettings` ~96)
- Modify: `src/features/under_development/SalesAutomationsPage.tsx` (DaysInput ~21-51; hours input ~117-122)
- Modify: `src/features/under_development/CadenceOutcomeButtons.tsx` (catch ~143-147)
- Modify: `src/features/under_development/CadenceSnoozeButton.tsx` (catch ~25-31; datetime-local ~67-72)
- Modify: `src/i18n/locales/en/sales.json`, `src/i18n/locales/el/sales.json`

**Interfaces:**
- Consumes: i18n keys from Global Constraints.
- Produces: `export function udErrorMessage(t: TFunction, raw: string): string` — returns the translated message for a known code (exact match on the raw string against the `ud.cadence.errors.*` key set), else the raw string unchanged. `export const UD_ERROR_CODES: readonly string[]`.

- [ ] **Step 1: i18n** — in BOTH locales' `sales.json`, inside the existing `ud.cadence` object add an `"errors"` object with the 13 keys/copy from Global Constraints (for `run_paused`, copy each locale's existing `ud.cadence.paused_error` value verbatim); inside `ud.admin` add `"hours_after_previous"`. Verify both parse with node.

- [ ] **Step 2: Failing tests**

```ts
// src/features/under_development/udErrors.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { i18n } from '@/lib/i18n';
import { udErrorMessage } from './udErrors';

describe('udErrorMessage', () => {
  beforeEach(async () => { await i18n.changeLanguage('en'); });
  const t = () => i18n.getFixedT(null, 'sales');

  it('maps known RPC codes to translated copy', () => {
    expect(udErrorMessage(t(), 'already_completed')).toBe('This task was already completed.');
    expect(udErrorMessage(t(), 'not_current_task')).toMatch(/refresh the page/i);
    expect(udErrorMessage(t(), 'permission_denied')).toMatch(/permission/i);
  });
  it('passes unknown messages through unchanged', () => {
    expect(udErrorMessage(t(), 'TypeError: fetch failed')).toBe('TypeError: fetch failed');
  });
  it('Greek copy', async () => {
    await i18n.changeLanguage('el');
    expect(udErrorMessage(i18n.getFixedT(null, 'sales'), 'already_completed')).toMatch(/ολοκληρωθεί/);
  });
});
```

Run `npx vitest run src/features/under_development/udErrors.test.ts` → FAIL (unresolved import).

- [ ] **Step 3: Implement `udErrors.ts`**

```ts
import type { TFunction } from 'i18next';

/** RPC error codes the UD cadence functions return in {ok:false, error}. */
export const UD_ERROR_CODES = [
  'already_completed', 'invalid_due', 'invalid_outcome', 'not_a_cadence_task',
  'no_live_run', 'permission_denied', 'pause_failed', 'snooze_failed',
  'cadence_complete_failed', 'lead_not_found', 'not_current_task', 'run_paused',
] as const;

/** Translate a raw cadence error (exact code match) or pass it through. */
export function udErrorMessage(t: TFunction, raw: string): string {
  return (UD_ERROR_CODES as readonly string[]).includes(raw)
    ? t(`ud.cadence.errors.${raw}`)
    : raw;
}
```

Run the test → PASS.

- [ ] **Step 4: Wire the four silent mutations**

In `useLeadCadence.ts` — `useSetRunPaused` gains (import `useTranslation` from react-i18next and `udErrorMessage` from `../udErrors`):

```ts
  const { t } = useTranslation('sales');
  ...
    onError: (e) => alert(udErrorMessage(t, e.message)),
```

In `useUdAdmin.ts` — all three mutations (`useUpdateUdCadence`, `useUpdateUdStep`, `useUpdateUdSettings`) gain, next to their `onSuccess`:

```ts
    onError: (e) => alert(t('ud.cadence.errors.save_failed', { msg: e.message })),
```

with `const { t } = useTranslation('sales');` added inside each hook (top level of the hook function, valid hook usage).

- [ ] **Step 5: Bounds**

`SalesAutomationsPage.tsx` DaysInput: add `max?: number` prop; in `commit()` change the accept condition to `if (Number.isInteger(n) && n >= 0 && (max == null || n <= max) && n !== value) onSave(n);` and pass `max={max}` to the `<Input>`. The hours `<DaysInput ...>` call gains `max={23}`. The label line changes to `{t('ud.admin.hours_after_previous')}` (drop the defaultValue).

`CadenceSnoozeButton.tsx`: catch becomes `alert(udErrorMessage(t, (e as Error).message))` (import `udErrorMessage`); the datetime-local `<Input>` gains `min={new Date().toISOString().slice(0, 16)}`.

`CadenceOutcomeButtons.tsx` catch (~145-147) becomes:

```ts
      const msg = (e as Error).message;
      alert(udErrorMessage(t, msg));
```

(the existing `run_paused` special case is now covered by the map — remove the ternary).

- [ ] **Step 6: Build + tests + commit**

`npm run build` exit 0; `npx vitest run src/features/under_development` all pass.

```bash
npx prettier --write src/features/under_development/udErrors.ts src/features/under_development/udErrors.test.ts
git add src/features/under_development/udErrors.ts src/features/under_development/udErrors.test.ts src/features/under_development/hooks/useLeadCadence.ts src/features/under_development/hooks/useUdAdmin.ts src/features/under_development/SalesAutomationsPage.tsx src/features/under_development/CadenceOutcomeButtons.tsx src/features/under_development/CadenceSnoozeButton.tsx src/i18n/locales/en/sales.json src/i18n/locales/el/sales.json
git commit -m "fix(ud): surface cadence/admin mutation errors, bound inputs, translate RPC error codes"
```

---

### Task 3: Sales Tasks freshness + due-display fix

**Files:**
- Create: `src/features/under_development/salesTaskDue.ts`; Test: `src/features/under_development/salesTaskDue.test.ts`
- Modify: `src/features/under_development/SalesTasksPage.tsx` (`fmtDue`, lines ~86-92)
- Modify: `src/features/under_development/hooks/useCadenceOverview.ts` (the `useQuery` options at ~79)

**Interfaces:**
- Produces: `export function isDueToday(iso: string, now: Date): boolean` — true iff the instant falls on the same LOCAL calendar date as `now`.

- [ ] **Step 1: Failing tests**

```ts
// src/features/under_development/salesTaskDue.test.ts
import { describe, it, expect } from 'vitest';
import { isDueToday } from './salesTaskDue';

describe('isDueToday', () => {
  const now = new Date(2026, 7, 31, 12, 0); // Mon Aug 31 2026, local
  it('same local day → true', () => {
    expect(isDueToday(new Date(2026, 7, 31, 9, 30).toISOString(), now)).toBe(true);
    expect(isDueToday(new Date(2026, 7, 31, 23, 59).toISOString(), now)).toBe(true);
  });
  it('audit bug: a FUTURE month sharing the day-of-month is NOT today (Aug 31 vs Oct 31)', () => {
    expect(isDueToday(new Date(2026, 9, 31, 10, 0).toISOString(), now)).toBe(false);
  });
  it('yesterday and tomorrow → false', () => {
    expect(isDueToday(new Date(2026, 7, 30, 10, 0).toISOString(), now)).toBe(false);
    expect(isDueToday(new Date(2026, 8, 1, 0, 0).toISOString(), now)).toBe(false);
  });
});
```

Run → FAIL (unresolved import).

- [ ] **Step 2: Implement**

```ts
// src/features/under_development/salesTaskDue.ts
/** True iff the instant falls on the same LOCAL calendar date as `now`.
 *  Replaces a day-of-month-only check that made "snoozed to Oct 31" render
 *  as a bare time on Aug 31 (2026-08-31 audit finding). */
export function isDueToday(iso: string, now: Date): boolean {
  const d = new Date(iso);
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}
```

Run → PASS.

- [ ] **Step 3: Use it in `SalesTasksPage.tsx`**

Import `isDueToday` from `./salesTaskDue`. Replace the `fmtDue` body's condition:

```ts
  const fmtDue = (iso: string) => {
    const d = new Date(iso);
    return isDueToday(iso, now)
      ? new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(d)
      : new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit' }).format(d);
  };
```

(The `startOfToday` const stays — `groupOf` still uses its own logic and is correct; do not touch it.)

- [ ] **Step 4: Overview freshness**

In `useCadenceOverview.ts`, add to the `useQuery({ ... })` options object (next to its existing options):

```ts
    // Multi-rep call sheet: without realtime, a 60s poll keeps "open task"
    // lists honest across tabs/reps (2026-08-31 audit; badge already polls).
    refetchInterval: 60_000,
```

- [ ] **Step 5: Build + tests + commit**

`npm run build` exit 0; `npx vitest run src/features/under_development` all pass.

```bash
npx prettier --write src/features/under_development/salesTaskDue.ts src/features/under_development/salesTaskDue.test.ts
git add src/features/under_development/salesTaskDue.ts src/features/under_development/salesTaskDue.test.ts src/features/under_development/SalesTasksPage.tsx src/features/under_development/hooks/useCadenceOverview.ts
git commit -m "fix(ud): correct due-today display and poll the cadence overview every 60s"
```

---

## Self-review

- **Spec coverage:** SQL findings 1-6 of the audit → G5+G4 (ownerless pair), G2 (cron wedge), G6 (delete hole), G1 (leapfrog), G3 (archived restart), G7 (stale task, audit minor 8). Frontend findings → Task 2 (silent failures #3/#4, error codes #6, missing key #5, snooze min #7, hours bound) and Task 3 (date bug #1, staleness #2). Deliberately excluded items listed in Global Constraints.
- **Placeholder scan:** the two "copy from source lines X-Y then insert exactly this block" instructions are precise references with the complete inserted code — acceptable since reproducing 200 lines verbatim invites transcription drift; everything else is full code.
- **Type consistency:** `udErrorMessage(t, raw)` (Task 2 def = all call sites); `isDueToday(iso, now)` (Task 3 def = SalesTasksPage call); SQL error codes `not_current_task` (G7) and `run_paused` map to the i18n keys defined in Global Constraints; `save_failed` takes `{{msg}}`.
