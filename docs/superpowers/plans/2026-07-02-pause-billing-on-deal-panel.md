# Pause/Resume Billing on the Deal Billing Panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the existing job billing pause/resume control in `JobsBillingPanel`'s job rows (Deal detail page), where accounting works.

**Architecture:** Frontend-only. Add `blocked_reason` to the deal billing hook, then render pause/resume buttons + a "Paused" badge per eligible job row, reusing the existing `useJobPauseBilling`/`useJobResumeBilling` hooks and `ConfirmDialog`. No backend/permission/RPC changes.

**Tech Stack:** React + TypeScript, TanStack Query, react-i18next, Vitest + Testing Library.

## Global Constraints

- Reuse the EXISTING hooks `useJobPauseBilling(jobId, dealId)` / `useJobResumeBilling(jobId, dealId)` from `src/features/jobs/hooks/useJobBillingPause.ts` (each returns `{ mutateAsync, isPending }`). No new RPC.
- Eligibility (same as the job-page card): recurring (`billing_type in ('recurring_monthly','recurring_yearly')`) AND parent (`parent_job_id == null`) AND (paused OR (active billing)). `isPaused = blocked_reason === 'billing_paused'`. Controls render only when `!readOnly`.
- Localize via `t('jobs_billing.pause.*')` in the `deals` namespace (the panel is fully i18n'd) — add el + en keys. Do NOT hardcode English.
- `npm run build` (tsc -b, `noUncheckedIndexedAccess`, eslint `--max-warnings=0`) must be green — it is STRICTER than tsc --noEmit.
- Push to `main`, no PR.

---

### Task 1: Pause/resume in the deal billing row

**Files:**
- Modify: `src/features/deals/hooks/useJobsBilling.ts` (add `blocked_reason` to the select string, the `JobBillingRow` type, the row mapping)
- Modify: `src/features/deals/JobsBillingPanel.tsx` (`JobRow`: pause/resume buttons + Paused badge)
- Modify: `src/i18n/locales/en/deals.json` + `src/i18n/locales/el/deals.json` (add `jobs_billing.pause.*`)
- Test: `src/features/deals/JobsBillingPanel.test.tsx` (mock the pause hooks + 4 new tests; add `blocked_reason` to `makeJob`)

**Interfaces:**
- Consumes: `useJobPauseBilling`, `useJobResumeBilling` from `@/features/jobs/hooks/useJobBillingPause`.
- Produces: `JobBillingRow.blocked_reason: string | null`.

- [ ] **Step 1: Write the failing tests** — in `JobsBillingPanel.test.tsx`, add the pause-hook mock near the other `vi.mock` calls, add `blocked_reason: null` to the `makeJob` factory defaults, and append a new describe block:

```tsx
// add near the top mocks:
const pauseMutate = vi.fn().mockResolvedValue(undefined);
const resumeMutate = vi.fn().mockResolvedValue(undefined);
vi.mock('@/features/jobs/hooks/useJobBillingPause', () => ({
  useJobPauseBilling: () => ({ mutateAsync: pauseMutate, isPending: false }),
  useJobResumeBilling: () => ({ mutateAsync: resumeMutate, isPending: false }),
}));
```

```tsx
// add `blocked_reason: null,` to the object returned by makeJob()

describe('JobsBillingPanel pause/resume', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows Pause for a recurring parent active job and calls the pause hook', async () => {
    billing.current = { jobs: [makeJob({ id: 'a', title: 'SEO', billing_type: 'recurring_monthly' })], payments: [] };
    const user = userEvent.setup();
    render(wrap(<JobsBillingPanel dealId="d1" />));
    const row = screen.getByText('SEO').closest('tr') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: /pause billing/i }));
    // confirm dialog
    await user.click(await screen.findByRole('button', { name: /^pause billing$/i }));
    await waitFor(() => expect(pauseMutate).toHaveBeenCalledTimes(1));
  });

  it('shows a Paused badge + Resume for a paused job and calls the resume hook', async () => {
    billing.current = { jobs: [makeJob({ id: 'a', title: 'SEO', billing_type: 'recurring_monthly', blocked_reason: 'billing_paused' })], payments: [] };
    const user = userEvent.setup();
    render(wrap(<JobsBillingPanel dealId="d1" />));
    const row = screen.getByText('SEO').closest('tr') as HTMLElement;
    expect(within(row).getByText(/paused/i)).toBeInTheDocument();
    await user.click(within(row).getByRole('button', { name: /resume billing/i }));
    await user.click(await screen.findByRole('button', { name: /^resume billing$/i }));
    await waitFor(() => expect(resumeMutate).toHaveBeenCalledTimes(1));
  });

  it('shows no pause control for one-time / child / non-recurring jobs', () => {
    billing.current = { jobs: [
      makeJob({ id: 'a', title: 'Setup', billing_type: 'one_time' }),
      makeJob({ id: 'b', title: 'Child', billing_type: 'recurring_monthly', parent_job_id: 'p1' }),
    ], payments: [] };
    render(wrap(<JobsBillingPanel dealId="d1" />));
    expect(screen.queryByRole('button', { name: /pause billing/i })).not.toBeInTheDocument();
  });

  it('hides pause/resume controls in read-only mode', () => {
    billing.current = { jobs: [makeJob({ id: 'a', title: 'SEO', billing_type: 'recurring_monthly' })], payments: [] };
    render(wrap(<JobsBillingPanel dealId="d1" readOnly />));
    expect(screen.queryByRole('button', { name: /pause billing/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests, verify they FAIL**

Run: `npx vitest run src/features/deals/JobsBillingPanel.test.tsx -t "pause/resume"`
Expected: FAIL — no "Pause billing" button exists yet (and `blocked_reason` unknown on the type until Step 3).

- [ ] **Step 3: Add `blocked_reason` to the billing hook** — in `src/features/deals/hooks/useJobsBilling.ts`:
  - In the `.select('id, title, service_type, billing_type, installment_plan, amount_net, setup_fee, vat_rate, billing_active, billing_only, billing_group_id, status, is_custom, description, parent_job_id')` string, append `, blocked_reason`.
  - In the `JobBillingRow` type, add: `blocked_reason: string | null;`
  - In the row mapping object (where `parent_job_id: (j.parent_job_id as string | null) ?? null,` is set), add: `blocked_reason: (j.blocked_reason as string | null) ?? null,`

- [ ] **Step 4: Add i18n keys** — in `src/i18n/locales/en/deals.json`, under the existing `jobs_billing` object, add:

```json
"pause": {
  "pause": "Pause billing",
  "resume": "Resume billing",
  "paused": "Paused",
  "pause_confirm_title": "Pause billing for this service?",
  "pause_confirm_body": "Unpaid payments for this service will be cancelled (kept in history) and no new periods will be generated. Paused months are never back-billed.",
  "resume_confirm_title": "Resume billing for this service?",
  "resume_confirm_body": "The job is unblocked and a fresh billing period starts today. The deal will move to Awaiting Payment."
}
```

  In `src/i18n/locales/el/deals.json`, under `jobs_billing`, add:

```json
"pause": {
  "pause": "Παύση χρέωσης",
  "resume": "Συνέχιση χρέωσης",
  "paused": "Σε παύση",
  "pause_confirm_title": "Παύση χρέωσης για αυτή την υπηρεσία;",
  "pause_confirm_body": "Οι απλήρωτες πληρωμές αυτής της υπηρεσίας θα ακυρωθούν (παραμένουν στο ιστορικό) και δεν θα δημιουργηθούν νέες περίοδοι. Οι μήνες σε παύση δεν χρεώνονται αναδρομικά.",
  "resume_confirm_title": "Συνέχιση χρέωσης για αυτή την υπηρεσία;",
  "resume_confirm_body": "Η εργασία ξεμπλοκάρεται και ξεκινά νέα περίοδος χρέωσης σήμερα. Η συμφωνία θα μετακινηθεί σε Αναμονή Πληρωμής."
}
```

- [ ] **Step 5: Add the pause/resume UI to `JobRow`** — in `src/features/deals/JobsBillingPanel.tsx`:
  - Import the hooks + icons at the top: `import { PauseCircle, PlayCircle } from 'lucide-react';` and `import { useJobPauseBilling, useJobResumeBilling } from '@/features/jobs/hooks/useJobBillingPause';`
  - In `JobRow`, after the existing `const end = useEndJob(dealId);`, add:

```tsx
  const pause = useJobPauseBilling(job.id, dealId);
  const resume = useJobResumeBilling(job.id, dealId);
  const [confirmPause, setConfirmPause] = useState(false);
  const [confirmResume, setConfirmResume] = useState(false);
  const isRecurring = job.billing_type === 'recurring_monthly' || job.billing_type === 'recurring_yearly';
  const isPaused = job.blocked_reason === 'billing_paused';
  const showPause = !readOnly && isRecurring && job.parent_job_id == null && !isPaused && !ended;
  const showResume = !readOnly && isRecurring && job.parent_job_id == null && isPaused;
```

  - In the Status `<td>` (the one rendering the `ended ? ended : active` badge), make `isPaused` take precedence:

```tsx
      <td className="px-1.5 py-1.5">
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
            isPaused
              ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300'
              : ended
                ? 'bg-muted text-muted-foreground'
                : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
          }`}
        >
          {isPaused ? t('jobs_billing.pause.paused') : ended ? t('jobs_billing.status.ended') : t('jobs_billing.status.active')}
        </span>
      </td>
```

  - In the actions `<td>` (the one with the "End" button), wrap the buttons in a flex row and add pause/resume before End:

```tsx
      <td className="px-1.5 py-1.5 text-right">
        <div className="flex items-center justify-end gap-1">
          {showPause && (
            <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-[11px]"
              onClick={() => setConfirmPause(true)} disabled={pause.isPending}>
              <PauseCircle className="size-3.5" />
              {t('jobs_billing.pause.pause')}
            </Button>
          )}
          {showResume && (
            <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-[11px]"
              onClick={() => setConfirmResume(true)} disabled={resume.isPending}>
              <PlayCircle className="size-3.5" />
              {t('jobs_billing.pause.resume')}
            </Button>
          )}
          {!readOnly && !ended && (
            <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-[11px]"
              onClick={() => setConfirmEnd(true)} disabled={end.isPending}>
              {t('jobs_billing.end')}
            </Button>
          )}
        </div>
        {!readOnly && (
          <ConfirmDialog
            open={confirmEnd}
            onOpenChange={setConfirmEnd}
            title={t('jobs_billing.end_confirm_title')}
            description={t('jobs_billing.end_confirm_body')}
            confirmLabel={t('jobs_billing.end')}
            pending={end.isPending}
            onConfirm={async () => {
              try { await end.mutateAsync(job.id); setConfirmEnd(false); }
              catch (err) { reportError(err); }
            }}
          />
        )}
        {showPause && (
          <ConfirmDialog
            open={confirmPause}
            onOpenChange={setConfirmPause}
            title={t('jobs_billing.pause.pause_confirm_title')}
            description={t('jobs_billing.pause.pause_confirm_body')}
            confirmLabel={t('jobs_billing.pause.pause')}
            pending={pause.isPending}
            onConfirm={async () => {
              try { await pause.mutateAsync(); setConfirmPause(false); }
              catch (err) { reportError(err); }
            }}
          />
        )}
        {showResume && (
          <ConfirmDialog
            open={confirmResume}
            onOpenChange={setConfirmResume}
            title={t('jobs_billing.pause.resume_confirm_title')}
            description={t('jobs_billing.pause.resume_confirm_body')}
            confirmLabel={t('jobs_billing.pause.resume')}
            pending={resume.isPending}
            onConfirm={async () => {
              try { await resume.mutateAsync(); setConfirmResume(false); }
              catch (err) { reportError(err); }
            }}
          />
        )}
      </td>
```

  (Replace the existing actions `<td>` block — which currently holds just the End button + its ConfirmDialog — with the above.)

- [ ] **Step 6: Run the new tests, verify they PASS**

Run: `npx vitest run src/features/deals/JobsBillingPanel.test.tsx`
Expected: all pass (the 4 new + the existing panel tests).

- [ ] **Step 7: Build gate**

Run: `npm run build`
Expected: green (no tsc/eslint errors). Note `blocked_reason` may be absent from the Supabase generated row type — if tsc flags the `.select` result, cast via the existing `(j.blocked_reason as string | null)` mapping (already specified in Step 3), which keeps it type-safe without regenerating types.

- [ ] **Step 8: Commit**

```bash
git add src/features/deals/hooks/useJobsBilling.ts src/features/deals/JobsBillingPanel.tsx src/features/deals/JobsBillingPanel.test.tsx src/i18n/locales/en/deals.json src/i18n/locales/el/deals.json
git commit -m "feat(billing): pause/resume a service from the deal billing panel"
```

- [ ] **Step 9: Browser smoke (safe target)** — open a deal with a recurring parent job on the Deal page → the row shows "Pause billing"; click → confirm → row shows a "Paused" badge + "Resume billing"; click Resume → confirm → back to active. Use a synthetic/test deal (pausing cancels real periods), and resume it so nothing is left paused. Check the console for errors.

---

## Self-Review

**Spec coverage:** placement in `JobsBillingPanel` JobRow (Step 5) ✓; reuse existing hooks + confirm (Steps 1/5) ✓; add `blocked_reason` to `useJobsBilling` (Step 3) ✓; eligibility recurring+parent+active/paused, `!readOnly` gating (Step 5 `showPause`/`showResume`) ✓; i18n el+en (Step 4) ✓; `JobBillingPauseCard` unchanged ✓; tests for all 4 states (Step 1) ✓; build gate (Step 7) ✓; browser smoke on safe target (Step 9) ✓.

**Placeholder scan:** none — all code blocks are complete; the one conditional ("if tsc flags the select") gives the exact cast to use.

**Type consistency:** `blocked_reason: string | null` defined in the type (Step 3) and read as `job.blocked_reason === 'billing_paused'` (Step 5); `makeJob` gets `blocked_reason: null` default (Step 1). Hook names `useJobPauseBilling`/`useJobResumeBilling` match the import path `@/features/jobs/hooks/useJobBillingPause` used in both the mock (Step 1) and the component (Step 5).
