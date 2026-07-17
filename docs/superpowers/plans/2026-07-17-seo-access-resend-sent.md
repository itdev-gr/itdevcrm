# SEO Access Email — Resend for Already-Sent Emails: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the SEO access-email Resend action available when the email has *already* been sent — on both the job detail header and the kanban-card dot — with a "last sent" line in the confirm dialog.

**Architecture:** Frontend-only change to `JobEmailStatusBadge.tsx`: widen `canSend` to include the `sent` state, add a Resend button to the detail-variant `sent` branch, make the card-variant green dot a button (same treatment as the amber dot), and append a last-sent line to the shared confirm dialog. The send path (`useRequestSeoAccess` → `send-email` edge function) and state derivation (`jobEmailStatus`) are untouched.

**Tech Stack:** React + TypeScript, react-i18next, Radix Dialog (shadcn/ui), Vitest + Testing Library (jsdom).

**Spec:** `docs/superpowers/specs/2026-07-17-seo-access-resend-sent-design.md`

## Global Constraints

- `npm run build` must pass (it runs `tsc -b` + eslint with `--max-warnings=0` — stricter than `tsc --noEmit`).
- Do NOT run the full vitest suite (parts of it hit production). Run only the test files named in each step.
- One commit per task; push to `main` only in the final task, after the build passes (no PRs).
- No backend, edge-function, or SQL changes. Server-side guards (pay gate, closed-clients block) stay as-is.
- i18n: every new key goes to BOTH `src/i18n/locales/el/common.json` and `src/i18n/locales/en/common.json`.

---

### Task 1: Detail-variant Resend on `sent` + last-sent dialog line

**Files:**
- Modify: `src/features/jobs/JobEmailStatusBadge.tsx`
- Modify: `src/i18n/locales/el/common.json` (seo_access block, ~line 106)
- Modify: `src/i18n/locales/en/common.json` (seo_access block, ~line 106)
- Create: `src/features/jobs/JobEmailStatusBadge.test.tsx`

**Interfaces:**
- Consumes: `JobEmailStatusBadge({ job, variant })` (existing component), `useSeoAccessSentMap(enabled)` → `Record<string, string>` keyed `"<templateKey>|<email>"`, `useRequestSeoAccess()` → `{ mutate, isPending }` with input `{ to, code, templateKey }`.
- Produces: `sent` state in `variant="detail"` renders a Resend button (`seo_access.resend`) that opens the existing confirm dialog; the dialog shows `seo_access.last_sent_line` when `lastSent` is set. Task 2 relies on `canSend` being true for the `sent` state and on `resendDialog` rendering in that state.

- [ ] **Step 1: Write the failing component test**

Create `src/features/jobs/JobEmailStatusBadge.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { i18n } from '@/lib/i18n';

const sentMapMock = vi.fn();
vi.mock('./hooks/useSeoAccessSentMap', () => ({
  useSeoAccessSentMap: (enabled: boolean) => sentMapMock(enabled),
}));

const mutate = vi.fn();
vi.mock('./hooks/useRequestSeoAccess', () => ({
  useRequestSeoAccess: () => ({ mutate, isPending: false }),
}));

import { JobEmailStatusBadge } from './JobEmailStatusBadge';
import type { JobRow } from './hooks/useJobs';

const webSeoJob = {
  id: 'j1',
  service_type: 'web_seo',
  code: '000123-WEBSEO',
  client: { id: 'c1', name: 'ACME', email: 'a@b.com' },
  deal: { id: 'd1', code: '000123', title: null },
  parent_job_id: null,
} as unknown as JobRow;

const SENT_MAP = { 'webseo_gsc_access|a@b.com': '2026-07-01T00:00:00Z' };

function wrap(node: React.ReactNode) {
  return <I18nextProvider i18n={i18n}>{node}</I18nextProvider>;
}

describe('JobEmailStatusBadge — sent state resend (detail)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sentMapMock.mockReturnValue(SENT_MAP);
  });

  it('renders a Resend button next to the sent pill', () => {
    render(wrap(<JobEmailStatusBadge job={webSeoJob} variant="detail" />));
    expect(screen.getByText(/access email sent/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /resend/i })).toBeInTheDocument();
  });

  it('confirm flow sends with the GSC template and shows the last-sent line', async () => {
    const user = userEvent.setup();
    render(wrap(<JobEmailStatusBadge job={webSeoJob} variant="detail" />));
    await user.click(screen.getByRole('button', { name: /resend/i }));
    expect(await screen.findByText(/request gsc access/i)).toBeInTheDocument();
    expect(screen.getByText(/last sent on/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(mutate).toHaveBeenCalledWith(
      { to: 'a@b.com', code: '000123-WEBSEO', templateKey: 'webseo_gsc_access' },
      expect.anything(),
    );
  });

  it('not_sent dialog has no last-sent line', async () => {
    sentMapMock.mockReturnValue({});
    const user = userEvent.setup();
    render(wrap(<JobEmailStatusBadge job={webSeoJob} variant="detail" />));
    await user.click(screen.getByRole('button', { name: /resend/i }));
    expect(await screen.findByText(/request gsc access/i)).toBeInTheDocument();
    expect(screen.queryByText(/last sent on/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/features/jobs/JobEmailStatusBadge.test.tsx`
Expected: the first two tests FAIL (`sent` state renders no Resend button today); the `not_sent` test passes (existing behavior).

- [ ] **Step 3: Add the `last_sent_line` i18n key (both locales)**

In `src/i18n/locales/en/common.json`, inside the `seo_access` block, change:

```json
    "resend": "Resend"
```

to:

```json
    "resend": "Resend",
    "last_sent_line": "Last sent on {{date}}."
```

In `src/i18n/locales/el/common.json`, same spot, change:

```json
    "resend": "Επαναποστολή"
```

to:

```json
    "resend": "Επαναποστολή",
    "last_sent_line": "Είχε σταλεί ξανά στις {{date}}."
```

- [ ] **Step 4: Implement the detail-variant change**

In `src/features/jobs/JobEmailStatusBadge.tsx`:

(a) Widen `canSend` (currently `state === 'not_sent' && templateKey !== null && email !== ''`):

```tsx
  const canSend =
    (state === 'not_sent' || state === 'sent') && templateKey !== null && email !== '';
```

(b) Add the last-sent line to the shared dialog — replace the `DialogDescription` inside `resendDialog`:

```tsx
        <DialogDescription>
          {t(cfg.confirmBodyKey, { email })}
          {lastSent ? (
            <>
              <br />
              {t('seo_access.last_sent_line', { date: formatDate(lastSent) })}
            </>
          ) : null}
        </DialogDescription>
```

(c) Replace the detail-variant `sent` branch (the `case 'sent':` inside the `// variant === 'detail'` switch) with:

```tsx
    case 'sent': {
      const sentDate = lastSent ? formatDate(lastSent) : null;
      return (
        <>
          <span
            className={cn(
              detailHeaderStatusBadgeClass,
              'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300',
            )}
          >
            <CheckCircle2 className="size-2.5" />
            {t('seo_access.sent')}
            {sentDate ? ` · ${sentDate}` : ''}
          </span>
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={!canSend}
            onClick={() => setOpen(true)}
          >
            {t('seo_access.resend')}
          </Button>
          {resendDialog}
        </>
      );
    }
```

(d) Update the component doc comment — replace the paragraph starting `` * `not_sent` renders a Resend action `` with:

```tsx
 * `not_sent` and `sent` both render a Resend action that mirrors the SEO
 * access-request confirm-then-send flow (same `seo_access.*` copy, same
 * `useRequestSeoAccess` mutation — no new send path); `sent` additionally
 * shows a last-sent line in the confirm dialog. AI SEO parents (and any
 * other service without an onboarding template) always resolve to
 * `coming_soon`.
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/features/jobs/JobEmailStatusBadge.test.tsx`
Expected: all 3 tests PASS. (The card-variant `sent` dot is still a plain span — that's Task 2.)

Also run the untouched unit tests to confirm no regression:
`npx vitest run src/features/jobs/jobEmailStatus.test.ts src/features/jobs/seoAccessButton.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/jobs/JobEmailStatusBadge.tsx src/features/jobs/JobEmailStatusBadge.test.tsx src/i18n/locales/el/common.json src/i18n/locales/en/common.json
git commit -m "feat(jobs): resend SEO access email from detail header when already sent

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Card-variant green dot becomes a Resend button

**Files:**
- Modify: `src/features/jobs/JobEmailStatusBadge.tsx` (card-variant `sent` branch)
- Modify: `src/features/jobs/JobEmailStatusBadge.test.tsx` (append a describe block)

**Interfaces:**
- Consumes: `canSend` / `resendDialog` from Task 1 (already true / rendered for the `sent` state); existing i18n keys `seo_access.sent_title` ("Access requested {{date}} · click to resend" — currently unused, left over from the old per-card access button) and `cfg.requestKey` for the aria-label.
- Produces: card-variant `sent` dot = `<button>` with `stopPropagation`, opening the same confirm dialog.

- [ ] **Step 1: Write the failing test**

Append to `src/features/jobs/JobEmailStatusBadge.test.tsx`:

```tsx
describe('JobEmailStatusBadge — sent state resend (card)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sentMapMock.mockReturnValue(SENT_MAP);
  });

  it('green dot is a button that opens the dialog without triggering the card', async () => {
    const user = userEvent.setup();
    const onCardClick = vi.fn();
    render(
      wrap(
        <div onClick={onCardClick}>
          <JobEmailStatusBadge job={webSeoJob} variant="card" />
        </div>,
      ),
    );
    await user.click(
      screen.getByRole('button', { name: /request google search console access/i }),
    );
    expect(onCardClick).not.toHaveBeenCalled();
    expect(await screen.findByText(/request gsc access/i)).toBeInTheDocument();
  });

  it('coming_soon dot stays non-interactive', () => {
    sentMapMock.mockReturnValue({});
    const adsJob = { ...webSeoJob, service_type: 'ads' } as unknown as JobRow;
    render(wrap(<JobEmailStatusBadge job={adsJob} variant="card" />));
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('dot is disabled when the client has no email', () => {
    sentMapMock.mockReturnValue({});
    const noEmailJob = {
      ...webSeoJob,
      client: { id: 'c1', name: 'ACME', email: null },
    } as unknown as JobRow;
    render(wrap(<JobEmailStatusBadge job={noEmailJob} variant="card" />));
    expect(screen.getByRole('button')).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/features/jobs/JobEmailStatusBadge.test.tsx`
Expected: "green dot is a button" FAILS (dot is a span today); "coming_soon" passes (existing behavior).

- [ ] **Step 3: Implement the card-variant change**

In `src/features/jobs/JobEmailStatusBadge.tsx`, replace the card-variant `sent` branch (the `case 'sent':` inside `if (variant === 'card')`) with:

```tsx
      case 'sent': {
        const sentDate = lastSent ? formatDate(lastSent) : null;
        return (
          <>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (canSend) setOpen(true);
              }}
              disabled={!canSend}
              aria-label={cfg ? t(cfg.requestKey) : t('seo_access.sent')}
              title={
                sentDate ? t('seo_access.sent_title', { date: sentDate }) : t('seo_access.sent')
              }
              className="shrink-0 rounded-full p-0.5 transition-colors hover:bg-muted disabled:cursor-not-allowed"
            >
              <span className="block size-2 rounded-full bg-emerald-500" />
            </button>
            {resendDialog}
          </>
        );
      }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/features/jobs/JobEmailStatusBadge.test.tsx`
Expected: all 6 tests PASS. ("coming_soon" and "no email" assert existing
behavior and should pass from Step 2 already.)

- [ ] **Step 5: Commit**

```bash
git add src/features/jobs/JobEmailStatusBadge.tsx src/features/jobs/JobEmailStatusBadge.test.tsx
git commit -m "feat(jobs): kanban-card green dot resends SEO access email

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Full verification + push

**Files:** none new — verification only.

- [ ] **Step 1: Run the strict build**

Run: `npm run build`
Expected: exits 0 (tsc -b + eslint `--max-warnings=0` both clean).

- [ ] **Step 2: Run the touched-area tests once more**

Run: `npx vitest run src/features/jobs/JobEmailStatusBadge.test.tsx src/features/jobs/jobEmailStatus.test.ts src/features/jobs/seoAccessButton.test.ts`
Expected: all PASS.

- [ ] **Step 3: Push to main**

```bash
git log origin/main..HEAD --oneline   # review: expect the 2 feature commits (+ spec/plan docs)
git push origin main
```

---

## Revert

Frontend-only. `git revert` the two feature commits — no data, schema, or edge-function changes.
