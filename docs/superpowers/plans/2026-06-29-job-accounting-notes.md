# Job — Notes from accounting — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make accounting's note (already collected as `jobs.description` but currently invisible) visible — at job creation, on the job detail page, and on the deal's billing panel — without any DB migration or RPC change.

**Architecture:** Reuse the existing `jobs.description` column. Reshape the create form's input into a multi-line textarea, surface a "Notes from accounting" card on the job detail page (with inline edit and an AI SEO parent-note subsection), and add a single-line note preview under each row on the deal billing panel.

**Tech Stack:** React 18, TypeScript (strict), Vite, Vitest + React Testing Library, TanStack Query, Tailwind, shadcn/ui style components, Supabase JS, i18next.

**Reference spec:** `docs/superpowers/specs/2026-06-29-job-accounting-notes-design.md`

---

## File map

- **Create:** `src/components/ui/textarea.tsx` — base shadcn-style textarea (mirror of `input.tsx`).
- **Create:** `src/features/jobs/JobNotesCard.tsx` — the "Notes from accounting" card (read view, empty state, inline editor, parent-note subsection).
- **Create:** `src/features/jobs/JobNotesCard.test.tsx` — tests for the card.
- **Modify:** `src/features/deals/AddCustomJobForm.tsx` — Input → Textarea, relabel, reorder.
- **Modify:** `src/features/deals/AddCustomJobForm.test.tsx` — add multi-line note test.
- **Modify:** `src/features/jobs/JobDetailPage.tsx` — mount `<JobNotesCard>` at top of Overview tab.
- **Modify:** `src/features/deals/JobsBillingPanel.tsx` — add per-row note preview row.
- **Modify:** `src/features/deals/JobsBillingPanel.test.tsx` — assert preview shows/hides + truncates.
- **Modify:** `src/i18n/locales/en/deals.json` and `src/i18n/locales/el/deals.json` — add `jobs_billing.form.notes_label` / `notes_placeholder` + `jobs_billing.notes_card.*` keys.

No DB migration. No RPC change.

---

## Task 1: Base Textarea component

**Files:**
- Create: `src/components/ui/textarea.tsx`

- [ ] **Step 1.1: Create the Textarea component**

```tsx
// src/components/ui/textarea.tsx
import * as React from 'react';

import { cn } from '@/lib/utils';

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
```

- [ ] **Step 1.2: Verify the file builds**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: PASS (no errors).

- [ ] **Step 1.3: Commit**

```bash
git add src/components/ui/textarea.tsx
git commit -m "feat(ui): add Textarea base component"
```

---

## Task 2: i18n keys

**Files:**
- Modify: `src/i18n/locales/en/deals.json`
- Modify: `src/i18n/locales/el/deals.json`

- [ ] **Step 2.1: Add keys to `en/deals.json` `jobs_billing.form`**

Locate the existing `jobs_billing.form` block (lines around 188–200). Append two new keys after `"description": "Description",`:

```json
      "description": "Description",
      "notes_label": "Notes from accounting",
      "notes_placeholder": "Pricing context, what was agreed with the client, special instructions…",
      "setup_fee": "Setup fee (€)",
```

Then add a sibling block under `jobs_billing` (immediately after the `form` block closes):

```json
    "notes_card": {
      "title": "Notes from accounting",
      "empty": "No notes yet",
      "add_button": "Add note",
      "save": "Save",
      "cancel": "Cancel",
      "parent_title": "Notes from AI SEO parent"
    },
```

- [ ] **Step 2.2: Add the same keys to `el/deals.json`**

Mirror the structure in Greek. Translations:

- `notes_label`: `"Σημειώσεις λογιστηρίου"`
- `notes_placeholder`: `"Πλαίσιο τιμολόγησης, τι συμφωνήθηκε με τον πελάτη, ειδικές οδηγίες…"`
- `notes_card.title`: `"Σημειώσεις λογιστηρίου"`
- `notes_card.empty`: `"Δεν υπάρχουν σημειώσεις"`
- `notes_card.add_button`: `"Προσθήκη σημείωσης"`
- `notes_card.save`: `"Αποθήκευση"`
- `notes_card.cancel`: `"Άκυρο"`
- `notes_card.parent_title`: `"Σημειώσεις από τον γονέα AI SEO"`

- [ ] **Step 2.3: Verify JSON parses**

Run: `node -e "JSON.parse(require('fs').readFileSync('src/i18n/locales/en/deals.json','utf8'));JSON.parse(require('fs').readFileSync('src/i18n/locales/el/deals.json','utf8'));console.log('ok')"`
Expected: prints `ok`.

- [ ] **Step 2.4: Commit**

```bash
git add src/i18n/locales/en/deals.json src/i18n/locales/el/deals.json
git commit -m "i18n(deals): add notes-from-accounting labels (en+el)"
```

---

## Task 3: AddCustomJobForm — Textarea + relabel + reorder

**Files:**
- Modify: `src/features/deals/AddCustomJobForm.tsx`
- Modify: `src/features/deals/AddCustomJobForm.test.tsx`

- [ ] **Step 3.1: Write the failing test (multi-line note flows into mutation)**

Append to `src/features/deals/AddCustomJobForm.test.tsx`:

```tsx
it('sends the multi-line "Notes from accounting" value through to create', async () => {
  const user = userEvent.setup();
  render(wrap(<AddCustomJobForm dealId="d1" />));

  await user.type(screen.getByLabelText(/^title$/i), 'New site');
  await user.type(screen.getByLabelText(/price \(net/i), '1200');

  const notes = screen.getByLabelText(/notes from accounting/i);
  expect(notes.tagName).toBe('TEXTAREA');
  await user.type(notes, 'Line 1{enter}Line 2');

  await user.click(screen.getByRole('button', { name: /add job/i }));

  await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
  expect(mutateAsync.mock.calls[0]![0]).toMatchObject({
    description: 'Line 1\nLine 2',
  });
});
```

- [ ] **Step 3.2: Run the test, verify it fails**

Run: `npx vitest run src/features/deals/AddCustomJobForm.test.tsx -t "Notes from accounting"`
Expected: FAIL — `getByLabelText(/notes from accounting/i)` throws "Unable to find a label".

- [ ] **Step 3.3: Update AddCustomJobForm to use Textarea, relabel, and move the field higher**

In `src/features/deals/AddCustomJobForm.tsx`:

a) Replace the import line `import { Input } from '@/components/ui/input';` to also import Textarea:

```tsx
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
```

b) Remove the existing description block at lines 238–248 (the `<div className="col-span-2 sm:col-span-3">…<Input id="cj-desc"…/></div>`).

c) Insert the new notes block immediately after the title block (the `<div className="col-span-2 sm:col-span-1">` ending at line 121), as a full-width row above the department/cadence row:

```tsx
<div className="col-span-2 sm:col-span-3">
  <Label htmlFor="cj-notes" className="text-xs">
    {t('jobs_billing.form.notes_label')}
  </Label>
  <Textarea
    id="cj-notes"
    rows={3}
    value={description}
    onChange={(e) => setDescription(e.target.value)}
    placeholder={t('jobs_billing.form.notes_placeholder')}
    className="mt-1 text-xs"
  />
</div>
```

d) In `doCreate`, normalize empty input to `null` (it already does `description.trim() || null` — verify; if it currently uses `description.trim() || null` keep it; otherwise change `description: description.trim() || null,` ← this is already the existing line, no change needed).

- [ ] **Step 3.4: Run the test, verify it passes**

Run: `npx vitest run src/features/deals/AddCustomJobForm.test.tsx`
Expected: PASS (existing tests + the new one).

- [ ] **Step 3.5: Commit**

```bash
git add src/features/deals/AddCustomJobForm.tsx src/features/deals/AddCustomJobForm.test.tsx
git commit -m "feat(deals): accounting notes textarea on Add custom job form"
```

---

## Task 4: JobNotesCard — read view + empty state

**Files:**
- Create: `src/features/jobs/JobNotesCard.tsx`
- Create: `src/features/jobs/JobNotesCard.test.tsx`

- [ ] **Step 4.1: Write the failing test (read view + empty state)**

Create `src/features/jobs/JobNotesCard.test.tsx`:

```tsx
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { describe, it, expect, vi } from 'vitest';
import { i18n } from '@/lib/i18n';

vi.mock('@/features/deals/hooks/useCustomJobMutations', () => ({
  useUpdateJobBilling: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('./hooks/useJob', () => ({
  useJob: () => ({ data: null }),
}));

import { JobNotesCard } from './JobNotesCard';

function wrap(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
    </QueryClientProvider>
  );
}

describe('JobNotesCard', () => {
  it('renders the description with newlines preserved', () => {
    render(
      wrap(
        <JobNotesCard
          jobId="j1"
          dealId="d1"
          description={'Line 1\nLine 2'}
          parentJobId={null}
        />,
      ),
    );
    const para = screen.getByTestId('job-notes-body');
    expect(para.textContent).toBe('Line 1\nLine 2');
    expect(para.className).toMatch(/whitespace-pre-wrap/);
  });

  it('renders empty state with an Add note button when description is null', () => {
    render(
      wrap(
        <JobNotesCard
          jobId="j1"
          dealId="d1"
          description={null}
          parentJobId={null}
        />,
      ),
    );
    expect(screen.getByText(/no notes yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add note/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 4.2: Run the test, verify it fails**

Run: `npx vitest run src/features/jobs/JobNotesCard.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 4.3: Implement the minimal JobNotesCard (read view + empty state only)**

Create `src/features/jobs/JobNotesCard.tsx`:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useUpdateJobBilling } from '@/features/deals/hooks/useCustomJobMutations';
import { useJob } from './hooks/useJob';

type Props = {
  jobId: string;
  dealId: string;
  description: string | null;
  parentJobId: string | null;
};

export function JobNotesCard({ jobId, dealId, description, parentJobId }: Props) {
  const { t } = useTranslation('deals');
  const update = useUpdateJobBilling(dealId);
  const { data: parentJob } = useJob(parentJobId ?? '');
  const parentNote = parentJob?.description?.trim() || null;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(description ?? '');

  function startEdit() {
    setDraft(description ?? '');
    setEditing(true);
  }
  function cancel() {
    setEditing(false);
    setDraft(description ?? '');
  }
  async function save() {
    const next = draft.trim() === '' ? null : draft;
    try {
      await update.mutateAsync({ jobId, description: next });
      setEditing(false);
    } catch (err) {
      const code =
        (err as Error & { errors?: string[] }).errors?.[0] ?? (err as Error).message;
      alert(code);
    }
  }

  return (
    <section className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t('jobs_billing.notes_card.title')}
      </h2>

      {parentNote && (
        <div className="mb-3 rounded-md border border-border/50 bg-muted/40 p-2">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t('jobs_billing.notes_card.parent_title')}
          </div>
          <p className="whitespace-pre-wrap text-xs text-foreground">{parentNote}</p>
        </div>
      )}

      {editing ? (
        <div className="space-y-2">
          <Textarea
            rows={4}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={update.isPending}>
              {t('jobs_billing.notes_card.save')}
            </Button>
            <Button size="sm" variant="outline" onClick={cancel} disabled={update.isPending}>
              {t('jobs_billing.notes_card.cancel')}
            </Button>
          </div>
        </div>
      ) : description ? (
        <button
          type="button"
          onClick={startEdit}
          className="block w-full text-left"
          aria-label={t('jobs_billing.notes_card.title')}
        >
          <p
            data-testid="job-notes-body"
            className="whitespace-pre-wrap text-sm text-foreground"
          >
            {description}
          </p>
        </button>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-muted-foreground">
            {t('jobs_billing.notes_card.empty')}
          </span>
          <Button size="sm" variant="outline" onClick={startEdit}>
            {t('jobs_billing.notes_card.add_button')}
          </Button>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 4.4: Run the test, verify it passes**

Run: `npx vitest run src/features/jobs/JobNotesCard.test.tsx`
Expected: PASS (both tests).

- [ ] **Step 4.5: Commit**

```bash
git add src/features/jobs/JobNotesCard.tsx src/features/jobs/JobNotesCard.test.tsx
git commit -m "feat(jobs): JobNotesCard read view + empty state"
```

---

## Task 5: JobNotesCard — inline edit save

**Files:**
- Modify: `src/features/jobs/JobNotesCard.test.tsx`

The implementation is already in Task 4; this task only adds the save/cancel test to lock the behavior. (No production code change beyond Task 4.)

- [ ] **Step 5.1: Append the failing test**

```tsx
import userEvent from '@testing-library/user-event';
// (this import should already be unused — add it now)

it('saves edits via useUpdateJobBilling and exits edit mode', async () => {
  const mutateAsync = vi.fn().mockResolvedValue('j1');
  vi.doMock('@/features/deals/hooks/useCustomJobMutations', () => ({
    useUpdateJobBilling: () => ({ mutateAsync, isPending: false }),
  }));
  vi.resetModules();
  const { JobNotesCard: Fresh } = await import('./JobNotesCard');

  const user = userEvent.setup();
  render(
    wrap(
      <Fresh jobId="j1" dealId="d1" description={'Old note'} parentJobId={null} />,
    ),
  );

  await user.click(screen.getByTestId('job-notes-body'));
  const ta = await screen.findByRole('textbox');
  await user.clear(ta);
  await user.type(ta, 'New note');
  await user.click(screen.getByRole('button', { name: /^save$/i }));

  await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
  expect(mutateAsync.mock.calls[0]![0]).toEqual({
    jobId: 'j1',
    description: 'New note',
  });
});

it('normalises an empty edit to null on save', async () => {
  const mutateAsync = vi.fn().mockResolvedValue('j1');
  vi.doMock('@/features/deals/hooks/useCustomJobMutations', () => ({
    useUpdateJobBilling: () => ({ mutateAsync, isPending: false }),
  }));
  vi.resetModules();
  const { JobNotesCard: Fresh } = await import('./JobNotesCard');

  const user = userEvent.setup();
  render(
    wrap(
      <Fresh jobId="j1" dealId="d1" description={'Old'} parentJobId={null} />,
    ),
  );

  await user.click(screen.getByTestId('job-notes-body'));
  const ta = await screen.findByRole('textbox');
  await user.clear(ta);
  await user.click(screen.getByRole('button', { name: /^save$/i }));

  await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
  expect(mutateAsync.mock.calls[0]![0]).toEqual({
    jobId: 'j1',
    description: null,
  });
});
```

Add to top of file: `import { waitFor } from '@testing-library/react';` if not already imported.

- [ ] **Step 5.2: Run, verify pass**

Run: `npx vitest run src/features/jobs/JobNotesCard.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5.3: Commit**

```bash
git add src/features/jobs/JobNotesCard.test.tsx
git commit -m "test(jobs): JobNotesCard inline edit save + empty-normalisation"
```

---

## Task 6: JobNotesCard — AI SEO parent note subsection

**Files:**
- Modify: `src/features/jobs/JobNotesCard.test.tsx`

The render-side code for the parent block was already added in Task 4. This task adds the test that locks it in.

- [ ] **Step 6.1: Append the failing test**

```tsx
it('renders the AI SEO parent note when the parent job has a description', async () => {
  vi.doMock('./hooks/useJob', () => ({
    useJob: (id: string) =>
      id === 'parent-1'
        ? { data: { id: 'parent-1', description: 'Parent says: rush job' } }
        : { data: null },
  }));
  vi.resetModules();
  const { JobNotesCard: Fresh } = await import('./JobNotesCard');

  render(
    wrap(
      <Fresh
        jobId="child-1"
        dealId="d1"
        description={'Child note'}
        parentJobId={'parent-1'}
      />,
    ),
  );

  expect(screen.getByText(/notes from ai seo parent/i)).toBeInTheDocument();
  expect(screen.getByText(/parent says: rush job/i)).toBeInTheDocument();
  // child note still rendered:
  expect(screen.getByTestId('job-notes-body').textContent).toBe('Child note');
});

it('hides the parent subsection when the parent has no note or no access', async () => {
  vi.doMock('./hooks/useJob', () => ({
    useJob: () => ({ data: null }),
  }));
  vi.resetModules();
  const { JobNotesCard: Fresh } = await import('./JobNotesCard');

  render(
    wrap(
      <Fresh
        jobId="child-1"
        dealId="d1"
        description={'Child note'}
        parentJobId={'parent-1'}
      />,
    ),
  );

  expect(screen.queryByText(/notes from ai seo parent/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 6.2: Run, verify pass**

Run: `npx vitest run src/features/jobs/JobNotesCard.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 6.3: Commit**

```bash
git add src/features/jobs/JobNotesCard.test.tsx
git commit -m "test(jobs): JobNotesCard parent-note subsection visibility"
```

---

## Task 7: Mount JobNotesCard on JobDetailPage

**Files:**
- Modify: `src/features/jobs/JobDetailPage.tsx`

- [ ] **Step 7.1: Add the import at the top of JobDetailPage.tsx**

Add (alphabetical-ish with other local imports):

```tsx
import { JobNotesCard } from './JobNotesCard';
```

- [ ] **Step 7.2: Mount the card at the top of the Overview tab**

In `JobDetailPage.tsx`, in the Overview tab content area (around line 360, the left column inside `<TabsContent value="overview">`), insert the card as the FIRST child of the left column (above the `MonthlyTasksPanel` conditional and `ContactsCard`):

Find:
```tsx
            <div className="min-w-0 space-y-3 lg:h-full lg:min-h-0 lg:overflow-y-auto lg:pr-1">
              {job.billing_type === 'recurring_monthly' && infoFieldsFor(job.service_type).length === 0 && (
```

Insert immediately after the `<div className="min-w-0 …">` opening:

```tsx
              <JobNotesCard
                jobId={job.id}
                dealId={job.deal_id}
                description={job.description ?? null}
                parentJobId={job.parent_job_id ?? null}
              />
```

- [ ] **Step 7.3: Verify the build**

Run: `npm run build`
Expected: PASS (tsc + lint + vite build all green; remember the build is stricter than `npx tsc` per the memory note about [Build strictness](memory reference_build_strictness)).

If `job.deal_id` is not selected by `useJob`, check `src/features/jobs/hooks/useJob.ts` and ensure the column is in the select list. If it's missing, add `'deal_id'` to the comma-separated select and re-run the build.

- [ ] **Step 7.4: Commit**

```bash
git add src/features/jobs/JobDetailPage.tsx
# If useJob.ts was edited:
git add src/features/jobs/hooks/useJob.ts
git commit -m "feat(jobs): mount Notes from accounting card on Overview tab"
```

---

## Task 8: JobsBillingPanel — per-row note preview

**Files:**
- Modify: `src/features/deals/JobsBillingPanel.tsx`
- Modify: `src/features/deals/JobsBillingPanel.test.tsx`

- [ ] **Step 8.1: Write the failing test**

Append a new `describe` block at the end of `src/features/deals/JobsBillingPanel.test.tsx` — reuses the `makeJob` / `wrap` / `billing` helpers already in the file:

```tsx
describe('JobsBillingPanel note preview', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows a truncated single-line note preview under a job row', () => {
    const longNote = 'A'.repeat(150);
    billing.current = {
      jobs: [makeJob({ id: 'a', title: 'Hosting', description: longNote })],
      payments: [],
    };
    render(wrap(<JobsBillingPanel dealId="d1" />));

    const previewRow = screen.getByTestId('note-preview-a');
    const cell = previewRow.querySelector('td')!;
    // 120 chars + the ellipsis character is 121 visible chars.
    expect(cell.textContent!.length).toBeLessThanOrEqual(121);
    expect(cell.textContent!.startsWith('AAA')).toBe(true);
    expect(cell.getAttribute('title')).toBe(longNote);
  });

  it('does not render a preview row when the job has no description', () => {
    billing.current = {
      jobs: [makeJob({ id: 'b', title: 'Hosting', description: null })],
      payments: [],
    };
    render(wrap(<JobsBillingPanel dealId="d1" />));
    expect(screen.queryByTestId('note-preview-b')).toBeNull();
  });

  it('does not truncate notes shorter than 120 chars and omits the ellipsis', () => {
    const short = 'Short note';
    billing.current = {
      jobs: [makeJob({ id: 'c', title: 'Hosting', description: short })],
      payments: [],
    };
    render(wrap(<JobsBillingPanel dealId="d1" />));
    const cell = screen.getByTestId('note-preview-c').querySelector('td')!;
    expect(cell.textContent).toBe(short);
  });
});
```

- [ ] **Step 8.2: Run the test, verify it fails**

Run: `npx vitest run src/features/deals/JobsBillingPanel.test.tsx -t "note preview"`
Expected: FAIL — testid not found.

- [ ] **Step 8.3: Add the preview row to JobsBillingPanel**

In `src/features/deals/JobsBillingPanel.tsx`, inside the `JobRow` component (the `function JobRow` returning `<tr className="border-t">`), find the table colspan count actually used in the row (count the `<td>`s). Then change the return so it renders a React fragment with the existing `<tr>` AND a second optional `<tr>` underneath:

Replace:
```tsx
  return (
    <tr className="border-t">
```
with:
```tsx
  const noteText = (job.description ?? '').trim();
  const notePreview = noteText.length > 120 ? `${noteText.slice(0, 120)}…` : noteText;

  return (
    <>
    <tr className="border-t">
```

And immediately before the matching closing `</tr>` that ends the row, add the closing `</>` AND the preview row in between. Specifically, after the row's closing `</tr>`, append:

```tsx
    {noteText && (
      <tr data-testid={`note-preview-${job.id}`} className="border-t-0">
        <td
          colSpan={COLSPAN_COUNT}
          title={noteText}
          className="px-1.5 pb-1.5 pt-0 text-[10px] italic text-muted-foreground truncate"
        >
          {notePreview}
        </td>
      </tr>
    )}
    </>
  );
```

Replace `COLSPAN_COUNT` with the actual number of `<td>` elements in `<tr className="border-t">…</tr>` (count them in the source — likely 7 or 8; verify by reading the file).

- [ ] **Step 8.4: Run, verify pass**

Run: `npx vitest run src/features/deals/JobsBillingPanel.test.tsx`
Expected: PASS (all existing tests + the 3 new ones).

- [ ] **Step 8.5: Verify the build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 8.6: Commit**

```bash
git add src/features/deals/JobsBillingPanel.tsx src/features/deals/JobsBillingPanel.test.tsx
git commit -m "feat(deals): per-row note preview on JobsBillingPanel"
```

---

## Task 9: Manual smoke test on dev server

**Files:** none

- [ ] **Step 9.1: Start the dev server**

Run: `npm run dev`
(Skip if it's already running.)

- [ ] **Step 9.2: Smoke flow — accounting role**

1. Log in as `info@itdevcrm.com` (admin / accounting). Open any deal.
2. Click "Add custom job" → confirm the new **Notes from accounting** textarea is at the top (under Title), with placeholder text, multi-line.
3. Type a multi-line note (`Line 1` enter `Line 2 with https://example.com`) + title + price → Add job.
4. The new job row appears on the billing panel; under it, a muted single-line preview shows `Line 1 Line 2 with https://example.com` (or truncated if long).
5. Click the new job → on the detail page Overview, the **Notes from accounting** card appears at the top with both lines visible (newlines preserved).
6. Click the note → textarea opens → edit → Save → returns to display mode with new text.
7. Click again → clear text → Save → returns to empty state with "Add note" button.

- [ ] **Step 9.3: Smoke flow — AI SEO parent/child**

1. Find an existing AI SEO parent job (search "ai_seo" in the kanban or pick one from the deal billing panel).
2. Open the parent → add a note like "Parent: client wants weekly reports".
3. Open one of its children (local_seo or web_seo, identified by the "Part of AI SEO" banner).
4. The card now shows a small "Notes from AI SEO parent" block with "Parent: client wants weekly reports" above the child's own editor.
5. Edit only the child's note → Save → the parent block is unchanged, the child's note now shows the new value.

- [ ] **Step 9.4: Smoke flow — service team role**

1. Log out and log in as a service team user (web_seo group, e.g. pefstathiadis@itdev.gr) — or use a sales user if a web_seo user isn't handy.
2. Open a web_seo job → confirm the Notes card is visible and editable (the spec allows everyone-who-can-see-the-job to edit).
3. For an AI SEO child opened as a service team user where the parent isn't readable, confirm the "Notes from AI SEO parent" block is **not** shown (graceful fallback) and there's no error in the console.

- [ ] **Step 9.5: If any step above fails, file a follow-up bug task (`TaskCreate`) and stop. Do not "fix on the fly" — root-cause first.**

---

## Task 10: Final verification + push

**Files:** none

- [ ] **Step 10.1: Run the full test + build**

Run: `npm run test -- --run` (vitest single-shot)
Expected: PASS (no regressions).

Run: `npm run build`
Expected: PASS.

- [ ] **Step 10.2: Push to main**

Per [No PRs](memory feedback_no_prs), push directly:

```bash
git push origin main
```

- [ ] **Step 10.3: Post-deploy smoke**

After Vercel deploy completes, open the live app and re-run a single trip through Task 9 Step 9.2 on production. Confirm no [stale-chunk 404s](memory reference_vercel_stale_chunk_404) — hard refresh if your tab was open during the deploy.

---

## Self-review checklist (run before handing off)

- [x] Every step has runnable commands and concrete code (no "implement appropriate handler" placeholders).
- [x] Each task ends with a commit step using a specific message.
- [x] Types referenced (`description`, `parent_job_id`, `deal_id`, `JobBillingRow`) exist on the existing types/selects (verified during plan write).
- [x] The new `<JobNotesCard>` API stays consistent across tasks 4–7: props `{ jobId, dealId, description, parentJobId }` everywhere.
- [x] Test selectors (`getByLabelText(/notes from accounting/i)`, `data-testid="job-notes-body"`, `data-testid="note-preview-${id}"`) are introduced in the same task that asserts on them.
- [x] No DB migration, no RPC change — matches the spec's "reuse `jobs.description`" decision.
- [x] Tasks 5 and 6 deliberately add tests without changing production code; production behavior was already implemented in Task 4. This is called out in those tasks so the implementer doesn't get confused looking for a code change.
- [x] Task 9 covers all three user-role flows mentioned in the spec.
