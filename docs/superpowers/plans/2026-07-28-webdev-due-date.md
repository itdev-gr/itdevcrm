# Web Dev Delivery Due Date Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Web Dev jobs get a manually assigned delivery due date (Info-tab date field stored in `jobs.details.due_date`) shown as an urgency-colored chip on Web Dev kanban cards.

**Architecture:** Frontend-only. The date lives in the existing `jobs.details` JSONB (key `due_date`, ISO `yyyy-mm-dd`), edited via a new `date` Info-field type on the web_dev Info tab (auto-save path unchanged). A new pure formatter `jobDueDateChip.ts` (mirroring `jobPeriodChip.ts`) drives the card chip. No DB migration, no RLS work.

**Tech Stack:** React + TypeScript, vitest + @testing-library/react, Tailwind, lucide-react.

**Spec:** `docs/superpowers/specs/2026-07-28-webdev-due-date-design.md`

## Global Constraints

- **Test matchers:** jest-dom matchers (`toBeInTheDocument` etc.) are broken repo-wide — use core matchers only (`.type`, `toBe`, `toEqual`, `toBeNull`).
- **Test runs:** the vitest suite can hit PROD — run ONLY the targeted test files named in each task, never the whole suite.
- **Build gate:** `npm run build` runs `tsc -b` + eslint with `--max-warnings=0`; it is stricter than `tsc --noEmit`. It must pass before push. `exactOptionalPropertyTypes` is on — never pass a possibly-`undefined` value where `string | null` is expected without coercion.
- **Field labels:** `labelEn: 'Due date'`, `labelEl: 'Προθεσμία παράδοσης'` (JobInfoPanel currently displays `labelEn` only — no i18n JSON changes needed).
- **Chip tooltip copy:** en `Delivery due dd/MM/yyyy`, el `Παράδοση έως dd/MM/yyyy`.
- **Commits:** one commit per task, push to `main` directly (no PRs) at the end.

---

### Task 1: `jobDueDateChip.ts` pure formatter

**Files:**
- Create: `src/features/jobs/jobDueDateChip.ts`
- Test: `src/features/jobs/jobDueDateChip.test.ts`

**Interfaces:**
- Consumes: nothing (pure module).
- Produces: `formatJobDueDateChip(input: { due: string | null | undefined; completed: boolean }, today: Date, lang: 'en' | 'el'): { label: string; tooltip: string; tone: 'ok' | 'due-soon' | 'overdue' } | null` — Task 4 imports exactly this.

- [ ] **Step 1: Write the failing test**

Create `src/features/jobs/jobDueDateChip.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { formatJobDueDateChip } from './jobDueDateChip';

const today = new Date('2026-07-01T00:00:00Z');

describe('formatJobDueDateChip', () => {
  it('returns null when due is missing', () => {
    expect(formatJobDueDateChip({ due: null, completed: false }, today, 'en')).toBeNull();
    expect(formatJobDueDateChip({ due: undefined, completed: false }, today, 'en')).toBeNull();
    expect(formatJobDueDateChip({ due: '', completed: false }, today, 'en')).toBeNull();
  });

  it('returns null for an unparsable date', () => {
    expect(formatJobDueDateChip({ due: 'not-a-date', completed: false }, today, 'en')).toBeNull();
  });

  it('formats a far-future due date as DD/MM with tone=ok', () => {
    const r = formatJobDueDateChip({ due: '2026-08-15', completed: false }, today, 'en');
    expect(r).not.toBeNull();
    expect(r!.label).toBe('15/08');
    expect(r!.tone).toBe('ok');
    expect(r!.tooltip).toBe('Delivery due 15/08/2026');
  });

  it('localizes the tooltip in Greek', () => {
    const r = formatJobDueDateChip({ due: '2026-08-15', completed: false }, today, 'el');
    expect(r!.tooltip).toBe('Παράδοση έως 15/08/2026');
  });

  it('uses tone=due-soon when 0..7 days remain', () => {
    expect(formatJobDueDateChip({ due: '2026-07-08', completed: false }, today, 'en')!.tone).toBe('due-soon');
    expect(formatJobDueDateChip({ due: '2026-07-01', completed: false }, today, 'en')!.tone).toBe('due-soon');
  });

  it('uses tone=ok at exactly 8 days out', () => {
    expect(formatJobDueDateChip({ due: '2026-07-09', completed: false }, today, 'en')!.tone).toBe('ok');
  });

  it('uses tone=overdue when the due date is in the past', () => {
    expect(formatJobDueDateChip({ due: '2026-06-25', completed: false }, today, 'en')!.tone).toBe('overdue');
  });

  it('suppresses urgency on completed jobs (tone=ok, chip still shown)', () => {
    const r = formatJobDueDateChip({ due: '2026-06-25', completed: true }, today, 'en');
    expect(r!.tone).toBe('ok');
    expect(r!.label).toBe('25/06');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/jobs/jobDueDateChip.test.ts`
Expected: FAIL — cannot resolve `./jobDueDateChip`.

- [ ] **Step 3: Write the implementation**

Create `src/features/jobs/jobDueDateChip.ts`:

```ts
export type JobDueDateChip = { label: string; tooltip: string; tone: 'ok' | 'due-soon' | 'overdue' };

/**
 * Pure formatter for the web-dev delivery due-date chip.
 * - `due` is jobs.details.due_date (ISO yyyy-mm-dd, set manually on the
 *   web_dev Info tab) — distinct from the BILLING period chip in
 *   jobPeriodChip.ts, which reads jobs.period_due_date.
 * - `completed` forces tone=ok so a done job never shows a red overdue chip.
 * - `today` is passed in so tests are deterministic.
 * - Returns null when there is no valid due date.
 */
export function formatJobDueDateChip(
  input: { due: string | null | undefined; completed: boolean },
  today: Date,
  lang: 'en' | 'el',
): JobDueDateChip | null {
  if (typeof input.due !== 'string' || input.due === '') return null;
  const dueMs = Date.parse(input.due + 'T00:00:00Z');
  if (Number.isNaN(dueMs)) return null;

  const todayMs = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const daysDelta = Math.round((dueMs - todayMs) / (24 * 60 * 60 * 1000));

  const d = new Date(dueMs);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  const label = `${dd}/${mm}`;
  const tooltip =
    lang === 'el' ? `Παράδοση έως ${dd}/${mm}/${yyyy}` : `Delivery due ${dd}/${mm}/${yyyy}`;

  let tone: JobDueDateChip['tone'];
  if (input.completed) tone = 'ok';
  else if (daysDelta < 0) tone = 'overdue';
  else if (daysDelta <= 7) tone = 'due-soon';
  else tone = 'ok';

  return { label, tooltip, tone };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/jobs/jobDueDateChip.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/jobs/jobDueDateChip.ts src/features/jobs/jobDueDateChip.test.ts
git commit -m "feat(webdev): due-date chip formatter

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `date` Info-field type + web_dev `due_date` field

**Files:**
- Modify: `src/features/jobs/serviceInfoFields.ts` (lines 3 and 37-46)
- Test: `src/features/jobs/serviceInfoFields.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `InfoFieldType` union now includes `'date'`; `infoFieldsFor('web_dev')` returns a `{ key: 'due_date', labelEn: 'Due date', labelEl: 'Προθεσμία παράδοσης', type: 'date' }` entry directly after `industry`. Tasks 3-4 rely on the key `due_date` and type `'date'`.

- [ ] **Step 1: Update the existing key-order test and add the new field test (failing)**

In `src/features/jobs/serviceInfoFields.test.ts`, replace the test `'web_dev leads with website + industry then its six base fields'`:

```ts
  it('web_dev leads with website + industry + due date then its six base fields', () => {
    expect(infoFieldsFor('web_dev').map((f) => f.key)).toEqual([
      'website', 'industry', 'due_date', 'webdev_notes', 'hosting', 'supabase_name', 'temp_url', 'live_url', 'email',
    ]);
  });
  it('web_dev due date is a date field not shared with the deal', () => {
    const due = infoFieldsFor('web_dev').find((f) => f.key === 'due_date');
    expect(due?.type).toBe('date');
    expect(due?.sharedWithDeal).toBeUndefined();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/jobs/serviceInfoFields.test.ts`
Expected: FAIL — both web_dev tests (key list mismatch, `due` undefined).

- [ ] **Step 3: Implement**

In `src/features/jobs/serviceInfoFields.ts`:

Line 3 — extend the type union:

```ts
export type InfoFieldType = 'url' | 'text' | 'textarea' | 'password' | 'select' | 'date';
```

In the `WEB_DEV` array, insert directly after the `industry` line:

```ts
  { key: 'due_date', labelEn: 'Due date', labelEl: 'Προθεσμία παράδοσης', type: 'date' },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/jobs/serviceInfoFields.test.ts`
Expected: PASS (all tests in file).

- [ ] **Step 5: Commit**

```bash
git add src/features/jobs/serviceInfoFields.ts src/features/jobs/serviceInfoFields.test.ts
git commit -m "feat(webdev): due_date Info field (new date type)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Date input in `JobInfoPanel`

**Files:**
- Modify: `src/features/jobs/JobInfoPanel.tsx` (the `FieldInput` component, lines 7-48)
- Test: `src/features/jobs/JobInfoPanel.test.tsx`

**Interfaces:**
- Consumes: `InfoFieldType 'date'` from Task 2.
- Produces: web_dev Info tab renders an `<input type="date">` whose string value (`yyyy-mm-dd`) flows through the existing `useAutoSave` → `useUpdateJobDetails` path unchanged.

- [ ] **Step 1: Write the failing test**

Add to `src/features/jobs/JobInfoPanel.test.tsx` inside the `describe('JobInfoPanel')` block (core matchers only — no jest-dom):

```tsx
  it('renders the web_dev due date as a date input', () => {
    renderPanel('web_dev', { due_date: '2026-08-15' });
    const input = screen.getByDisplayValue('2026-08-15') as HTMLInputElement;
    expect(input.type).toBe('date');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/jobs/JobInfoPanel.test.tsx`
Expected: the new test FAILS — the fallback branch renders a text input, so `input.type` is `'text'`. (Pre-existing tests in the file must still pass.)

- [ ] **Step 3: Implement**

In `src/features/jobs/JobInfoPanel.tsx`, inside `FieldInput`, add a branch before the `textarea` branch:

```tsx
  if (field.type === 'date') {
    return (
      <input type="date" className="w-full rounded border px-2 py-1 text-sm"
        value={value} onChange={(e) => onChange(e.target.value)} />
    );
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/jobs/JobInfoPanel.test.tsx`
Expected: PASS (all tests in file).

- [ ] **Step 5: Commit**

```bash
git add src/features/jobs/JobInfoPanel.tsx src/features/jobs/JobInfoPanel.test.tsx
git commit -m "feat(webdev): date input on job Info tab

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Due-date chip on kanban cards + build gate + push

**Files:**
- Modify: `src/features/jobs/JobsKanbanCard.tsx`

**Interfaces:**
- Consumes: `formatJobDueDateChip` from Task 1 (`{ due, completed }, today, lang` → `{ label, tooltip, tone } | null`); `jobs.details.due_date` written by Tasks 2-3.
- Produces: user-visible chip; no exports.

No new unit test (per spec, the formatter carries the logic tests; the card is verified by the build gate + live check).

- [ ] **Step 1: Implement the chip**

In `src/features/jobs/JobsKanbanCard.tsx`:

1. Extend the lucide import (line 5):

```tsx
import { AlarmClock, Calendar, CheckCircle2, ListChecks, Lock, User } from 'lucide-react';
```

2. Add the formatter import next to the other `./` imports:

```tsx
import { formatJobDueDateChip } from './jobDueDateChip';
```

3. After the `periodChip` computation (line ~61), add:

```tsx
  const rawDueDate = job.details?.['due_date'];
  const dueChip = formatJobDueDateChip(
    {
      due: typeof rawDueDate === 'string' ? rawDueDate : null,
      completed: job.completed_at != null,
    },
    new Date(),
    lang,
  );
```

4. In the JSX chip row, directly after the `{periodChip && (...)}` block and before the `{job.parent_job_id != null && (...)}` block, add:

```tsx
                {dueChip && (
                  <span
                    title={dueChip.tooltip}
                    className={cn(
                      'inline-flex items-center gap-0.5 rounded px-1 text-[10px] font-medium',
                      dueChip.tone === 'overdue' &&
                        'bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300',
                      dueChip.tone === 'due-soon' &&
                        'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300',
                      dueChip.tone === 'ok' && 'bg-muted text-muted-foreground',
                    )}
                  >
                    <AlarmClock className="size-2.5" />
                    {dueChip.label}
                  </span>
                )}
```

- [ ] **Step 2: Run the build gate**

Run: `npm run build`
Expected: exits 0 (tsc + eslint `--max-warnings=0` clean).

- [ ] **Step 3: Re-run all three touched test files**

Run: `npx vitest run src/features/jobs/jobDueDateChip.test.ts src/features/jobs/serviceInfoFields.test.ts src/features/jobs/JobInfoPanel.test.tsx`
Expected: PASS, zero failures.

- [ ] **Step 4: Commit and push**

```bash
git add src/features/jobs/JobsKanbanCard.tsx
git commit -m "feat(webdev): delivery due-date chip on kanban cards

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push origin main
```

- [ ] **Step 5: Live verification (after Vercel deploy)**

On itdevcrm.vercel.app: open a web_dev job → Info tab → set "Due date" → confirm auto-save "Saved" appears; open `/tech/web-dev` board → the card shows the `⏰ dd/MM` chip with the expected color. (If chunks 404 right after deploy, hard-refresh first.)
