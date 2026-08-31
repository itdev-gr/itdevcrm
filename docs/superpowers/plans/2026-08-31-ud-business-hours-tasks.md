# UD Business-Hours Task Scheduling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sales cadence call tasks open only inside the company schedule — Mon–Fri 09:00–17:30 Europe/Athens. A due time computed past 17:30 (or on a weekend / before 09:00) rolls to the next business day at 09:00; the snooze presets follow the same rule.

**Architecture:** One SQL function `ud_business_due(timestamptz)` clamps any instant into the business window in Athens wall-clock time (≤09:00 → same-day 09:00; >17:30 → next-day 09:00; Sat/Sun → Monday 09:00; loop handles Fri-evening → Sat → Mon). `ud_advance_run`'s task branch pipes its `v_due` through it (email steps deliberately untouched — the owner asked for the calls/tasks). Frontend: the snooze presets' `at10()` helper is extracted to a pure `nextBusinessAt10()` that skips weekends. No other frontend change — `due_at` arrives already clamped.

**Tech Stack:** Postgres plpgsql (Europe/Athens `at time zone` math), applied via the Management API script; React + Vitest for the pure helper.

## Global Constraints

- Repo: `/Users/marios/Desktop/Projects/itdevcrm-main`, branch `main` (atomic commits straight to `main`). Shared checkout with other active Claude sessions: `git add` ONLY the files each task names; `git diff --cached` before each commit. Migration timestamps: the latest shipped is `20260831230000_reminders_require_first_payment.sql` — ours is **`20260831240000_ud_business_hours_due.sql`**; if an even newer migration exists at execution time, bump ours to sort last.
- **`npm run build` gate** before any commit touching `src/`; migration applied to prod BEFORE push.
- **Timezone:** business hours are **Europe/Athens wall-clock** (`at time zone 'Europe/Athens'` in SQL — the server runs UTC; DST is handled by the tz conversion, never hardcode +2/+3). Frontend preset uses the browser's local clock (reps are in Greece — matches the existing `at10` behavior).
- **Window boundaries:** 09:00 and 17:30 are both INCLUSIVE (a task due exactly 17:30 stays; 17:31 rolls). Weekend = ISO dow 6 (Sat) and 7 (Sun).
- Scope: **task steps only**. Email steps, `next_event_at` for emails, the custom snooze datetime picker (free choice stays free), overdue escalation, and existing open tasks' `due_at` (no backfill — stated assumption: only newly created tasks follow the schedule) are all deliberately untouched.
- `ud_advance_run`'s current final definition lives in `supabase/migrations/20260831200000_ud_cadence_hardening.sql:53-148` (the G1-hardened version). Copy it byte-identical; the ONLY change is wrapping the task-branch `v_due` assignment (line 116: `v_due := greatest(now(), r.last_event_at + make_interval(days => s.delay_days, hours => s.delay_hours));`) with `public.ud_business_due(...)`.
- New exported frontend helper: `nextBusinessAt10(daysFromNow: number, now?: Date): string` (ISO string; default `now = new Date()`), in `src/features/under_development/businessSnooze.ts`. Rule: add `daysFromNow` days to `now` (local), set 10:00:00.000 local, then roll Sat→+2d, Sun→+1d (to Monday 10:00). Presets keep their labels; clicking «Αύριο» on Friday lands Monday 10:00 — intended.

## File Structure

| File | Responsibility |
| --- | --- |
| `supabase/migrations/20260831240000_ud_business_hours_due.sql` (create) | `ud_business_due()` + `ud_advance_run` re-emission with the wrapped `v_due` |
| `src/features/under_development/businessSnooze.ts` (create) + `.test.ts` | `nextBusinessAt10()` |
| `src/features/under_development/CadenceSnoozeButton.tsx` (modify) | presets use the helper |
| `docs/tech/sales/under-development.md` (modify) | document the schedule rule |

---

### Task 1: `ud_business_due` + wrapped `ud_advance_run`

**Files:**
- Create: `supabase/migrations/20260831240000_ud_business_hours_due.sql`
- Create (scratch, NOT committed): `/private/tmp/claude-501/-Users-marios-Desktop-Projects-itdevcrm-main/e9172216-432a-4f2b-aecc-f7124ac58afa/scratchpad/apply-ud-business-hours.sh`

**Interfaces:**
- Consumes: `ud_advance_run` final definition from `20260831200000:53-148`.
- Produces: `public.ud_business_due(p_due timestamptz) returns timestamptz` (STABLE); `ud_advance_run` unchanged except the one wrapped line. No signature changes (ACLs survive).

- [ ] **Step 1: Write the migration**

```sql
-- Sales cadence call tasks open on the company schedule (owner request
-- 2026-08-31): Mon-Fri 09:00-17:30 Europe/Athens. A task due past 17:30 (or
-- on a weekend / before 09:00) opens the next business day at 09:00.
-- Task steps only — email steps keep firing on their exact delays.
-- Boundaries inclusive: exactly 09:00 or 17:30 stays put.

create or replace function public.ud_business_due(p_due timestamptz)
returns timestamptz
language plpgsql
stable
set search_path = public
as $$
declare
  v_local timestamp; -- Athens wall clock
  v_dow int;         -- ISO: 1=Mon .. 7=Sun
  v_time time;
begin
  v_local := p_due at time zone 'Europe/Athens';
  loop
    v_dow := extract(isodow from v_local)::int;
    v_time := v_local::time;
    if v_dow >= 6 then
      -- Weekend → Monday 09:00
      v_local := date_trunc('day', v_local) + make_interval(days => 8 - v_dow) + interval '9 hours';
    elsif v_time < time '09:00' then
      v_local := date_trunc('day', v_local) + interval '9 hours';
    elsif v_time > time '17:30' then
      -- Past closing → next day 09:00 (loop again: Fri 18:00 → Sat 09:00 → Mon 09:00)
      v_local := date_trunc('day', v_local) + interval '1 day 9 hours';
    else
      exit; -- inside the window
    end if;
  end loop;
  return v_local at time zone 'Europe/Athens';
end $$;
```

Then re-emit `ud_advance_run`: copy the ENTIRE definition from `20260831200000_ud_cadence_hardening.sql:53-148` byte-identical, changing ONLY the task-branch line

```sql
      v_due := greatest(now(), r.last_event_at + make_interval(days => s.delay_days, hours => s.delay_hours));
```

to

```sql
      -- Business-hours clamp (owner 2026-08-31): calls open Mon-Fri 09:00-17:30
      -- Europe/Athens; anything later rolls to the next business day 09:00.
      v_due := public.ud_business_due(
        greatest(now(), r.last_event_at + make_interval(days => s.delay_days, hours => s.delay_hours)));
```

End with:

```sql
-- ROLLBACK:
-- Re-run the ud_advance_run emission from 20260831200000_ud_cadence_hardening.sql:53-148
-- (drops the clamp), then: drop function if exists public.ud_business_due(timestamptz);
```

- [ ] **Step 2: Static sanity check**

`node -e "const s=require('fs').readFileSync('supabase/migrations/20260831240000_ud_business_hours_due.sql','utf8'); console.log('balance', (s.match(/\\$\\$/g)||[]).length % 2 === 0 ? 'ok' : 'BROKEN', '| creates:', (s.match(/create or replace function/g)||[]).length)"` → `balance ok | creates: 2`. Diff the copied `ud_advance_run` body against the source (e.g. extract both to temp files and `diff`) — the only hunk must be the wrapped `v_due` line + its comment.

- [ ] **Step 3: Apply script** (same curl pattern as the previous scratchpad scripts, project `xujlrclyzxrvxszepquy`), with a verification battery of `select public.ud_business_due(...)` cases and expected values in comments:

```
q "Wed 10:00 Athens stays"        "select public.ud_business_due('2026-09-02T07:00:00Z') = '2026-09-02T07:00:00Z'::timestamptz as pass"
q "Fri 19:00 Athens -> Mon 09:00" "select public.ud_business_due('2026-09-04T16:00:00Z') = '2026-09-07T06:00:00Z'::timestamptz as pass"
q "Sat -> Mon 09:00"              "select public.ud_business_due('2026-09-05T09:00:00Z') = '2026-09-07T06:00:00Z'::timestamptz as pass"
q "Tue 06:00 Athens -> 09:00"     "select public.ud_business_due('2026-09-01T03:00:00Z') = '2026-09-01T06:00:00Z'::timestamptz as pass"
q "exactly 17:30 Athens stays"    "select public.ud_business_due('2026-09-02T14:30:00Z') = '2026-09-02T14:30:00Z'::timestamptz as pass"
q "17:31 Athens -> next day 09:00" "select public.ud_business_due('2026-09-02T14:31:00Z') = '2026-09-03T06:00:00Z'::timestamptz as pass"
```

(2026-09: Athens = UTC+3. All six must return `pass=true`.)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260831240000_ud_business_hours_due.sql
git commit -m "feat(ud): cadence call tasks open Mon-Fri 09:00-17:30 Athens — ud_business_due clamp"
```

---

### Task 2: Snooze presets skip weekends

**Files:**
- Create: `src/features/under_development/businessSnooze.ts`; Test: `src/features/under_development/businessSnooze.test.ts`
- Modify: `src/features/under_development/CadenceSnoozeButton.tsx` (replace the inline `at10`, lines ~18-23)

**Interfaces:**
- Produces: `export function nextBusinessAt10(daysFromNow: number, now: Date = new Date()): string` (ISO).

- [ ] **Step 1: Failing tests**

```ts
// src/features/under_development/businessSnooze.test.ts
import { describe, it, expect } from 'vitest';
import { nextBusinessAt10 } from './businessSnooze';

describe('nextBusinessAt10', () => {
  const wed = new Date(2026, 8, 2, 15, 0); // Wed Sep 2 2026, local
  const fri = new Date(2026, 8, 4, 15, 0); // Fri Sep 4 2026
  it('weekday + 1 → next day 10:00 local', () => {
    expect(nextBusinessAt10(1, wed)).toBe(new Date(2026, 8, 3, 10, 0, 0, 0).toISOString());
  });
  it('Friday + 1 (Saturday) rolls to Monday 10:00', () => {
    expect(nextBusinessAt10(1, fri)).toBe(new Date(2026, 8, 7, 10, 0, 0, 0).toISOString());
  });
  it('Friday + 2 (Sunday) rolls to Monday 10:00', () => {
    expect(nextBusinessAt10(2, fri)).toBe(new Date(2026, 8, 7, 10, 0, 0, 0).toISOString());
  });
  it('+7 lands a weekday and stays', () => {
    expect(nextBusinessAt10(7, wed)).toBe(new Date(2026, 8, 9, 10, 0, 0, 0).toISOString());
  });
});
```

Run `npx vitest run src/features/under_development/businessSnooze.test.ts` → FAIL (unresolved import).

- [ ] **Step 2: Implement**

```ts
// src/features/under_development/businessSnooze.ts
/** Snooze preset target: now + daysFromNow at 10:00 LOCAL, rolled off
 *  weekends to Monday (company schedule Mon-Fri — owner 2026-08-31). The DB
 *  clamps cadence-created tasks the same way (ud_business_due). */
export function nextBusinessAt10(daysFromNow: number, now: Date = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(10, 0, 0, 0);
  const day = d.getDay(); // 0=Sun, 6=Sat
  if (day === 6) d.setDate(d.getDate() + 2);
  else if (day === 0) d.setDate(d.getDate() + 1);
  return d.toISOString();
}
```

Run → PASS.

- [ ] **Step 3: Use it in `CadenceSnoozeButton.tsx`**

Delete the inline `at10` function (lines ~18-23); import `nextBusinessAt10` from `./businessSnooze`; change the preset click handler `onClick={() => void apply(at10(days))}` → `onClick={() => void apply(nextBusinessAt10(days))}`.

- [ ] **Step 4: Build + tests + commit**

`npm run build` exit 0; `npx vitest run src/features/under_development` all pass.

```bash
npx prettier --write src/features/under_development/businessSnooze.ts src/features/under_development/businessSnooze.test.ts
git add src/features/under_development/businessSnooze.ts src/features/under_development/businessSnooze.test.ts src/features/under_development/CadenceSnoozeButton.tsx
git commit -m "feat(ud): snooze presets skip weekends — land Monday 10:00"
```

---

### Task 3: Docs

**Files:**
- Modify: `docs/tech/sales/under-development.md`

- [ ] **Step 1:** In the section describing cadence task creation/delays, add:

```markdown
- **Company schedule:** cadence call tasks only open Mon–Fri **09:00–17:30**
  (Europe/Athens). A step whose delay lands past 17:30, before 09:00, or on a
  weekend opens the **next business day at 09:00** (`ud_business_due`). Email
  steps are NOT clamped — they fire on their exact delays. Snooze presets
  (tomorrow/+2/+7) skip weekends and land Monday 10:00.
```

- [ ] **Step 2: Commit**

```bash
git add docs/tech/sales/under-development.md
git commit -m "docs(ud): business-hours rule for cadence call tasks"
```

---

## Self-review

- **Spec coverage:** «τα calls ανοίγουν μέχρι 17:30, αλλιώς επόμενη μέρα 09:00, πρόγραμμα Δευ–Παρ 09:00–17:30» → `ud_business_due` (Task 1) covers late/early/weekend with Athens wall-clock; presets aligned (Task 2); documented (Task 3). Stated assumptions: task steps only (emails untouched); no backfill of already-open tasks; custom snooze stays free.
- **Placeholder scan:** the one copy-instruction cites exact source lines with the exact replacement — everything else is full code.
- **Type consistency:** `ud_business_due(timestamptz)` (Task 1 def = wrapped call); `nextBusinessAt10(daysFromNow, now?)` (Task 2 def = button call with 1 arg, default now).
