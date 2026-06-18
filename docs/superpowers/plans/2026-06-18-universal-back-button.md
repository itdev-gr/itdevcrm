# Universal Back Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single global "Back" button that appears on every authenticated page of the CRM.

**Architecture:** A self-contained `BackButton` component is rendered once inside `AppShell` (which wraps every authenticated route via `ShellLayout`). It goes back in browser history when in-app history exists (react-router's `window.history.state.idx > 0`), otherwise navigates Home. It hides itself on the Home route, where "back to home" is a no-op.

**Tech Stack:** React 19, react-router-dom v7, react-i18next, lucide-react, Tailwind, Vitest + Testing Library.

---

## File Structure

- `src/components/BackButton.tsx` — the component (new).
- `src/components/BackButton.test.tsx` — its unit tests (new).
- `src/components/layout/AppShell.tsx` — render `<BackButton />` above page content (modify).
- `src/i18n/locales/en/common.json` — add `"back": "Back"` (modify).
- `src/i18n/locales/el/common.json` — add `"back": "Πίσω"` (modify).

---

## Task 1: Add the `back` i18n strings

**Files:**
- Modify: `src/i18n/locales/en/common.json:2`
- Modify: `src/i18n/locales/el/common.json:2`

- [ ] **Step 1: Add the English string**

In `src/i18n/locales/en/common.json`, add a `back` key immediately after the opening `app_title` line. The top of the file becomes:

```json
{
  "app_title": "ITDevCRM",
  "back": "Back",
  "tagline": "Multi-department CRM",
```

- [ ] **Step 2: Add the Greek string**

In `src/i18n/locales/el/common.json`, add the matching key in the same place:

```json
{
  "app_title": "ITDevCRM",
  "back": "Πίσω",
  "tagline": "CRM πολλαπλών τμημάτων",
```

- [ ] **Step 3: Verify both files are valid JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('src/i18n/locales/en/common.json','utf8')); JSON.parse(require('fs').readFileSync('src/i18n/locales/el/common.json','utf8')); console.log('ok')"`
Expected: prints `ok` (no JSON parse error).

- [ ] **Step 4: Commit**

```bash
git add src/i18n/locales/en/common.json src/i18n/locales/el/common.json
git commit -m "feat(i18n): add 'back' label to common namespace"
```

---

## Task 2: Create the `BackButton` component (TDD)

**Files:**
- Test: `src/components/BackButton.test.tsx` (create)
- Create: `src/components/BackButton.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/BackButton.test.tsx` with the full content below. It mocks `useNavigate` (the existing pattern from `ResetPasswordPage.test.tsx`), keeps the real `MemoryRouter`/`useLocation`, and drives `window.history.state.idx` directly to simulate in-app history vs a direct load.

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/lib/i18n';
import { BackButton } from './BackButton';

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => navigateMock,
}));

function wrap(path: string) {
  return (
    <MemoryRouter initialEntries={[path]}>
      <BackButton />
    </MemoryRouter>
  );
}

describe('BackButton', () => {
  beforeEach(() => {
    navigateMock.mockClear();
    window.history.replaceState(null, '', '/');
  });

  it('renders the arrow icon and the Back label', () => {
    render(wrap('/deals/abc'));
    const btn = screen.getByRole('button', { name: /back/i });
    expect(btn).toBeInTheDocument();
    expect(btn.querySelector('svg')).toBeInTheDocument();
  });

  it('goes back one entry when in-app history exists', () => {
    window.history.replaceState({ idx: 2 }, '', '/deals/abc');
    render(wrap('/deals/abc'));
    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(navigateMock).toHaveBeenCalledWith(-1);
  });

  it('falls back to Home when there is no in-app history', () => {
    window.history.replaceState({ idx: 0 }, '', '/deals/abc');
    render(wrap('/deals/abc'));
    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(navigateMock).toHaveBeenCalledWith('/');
  });

  it('renders nothing on the Home route', () => {
    render(wrap('/'));
    expect(screen.queryByRole('button', { name: /back/i })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:run -- src/components/BackButton.test.tsx`
Expected: FAIL — `BackButton.tsx` does not exist yet (module-not-found / import error).

- [ ] **Step 3: Write the minimal implementation**

Create `src/components/BackButton.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

/**
 * Universal back button, rendered once in AppShell above page content so it
 * appears on every authenticated page.
 *
 * react-router stamps a numeric `idx` onto `window.history.state` as you
 * navigate within the app. When `idx > 0` there is an in-app entry to return
 * to, so we pop history (landing exactly where the user came from). On a fresh
 * load (direct link, refresh, email/Zapier link, new tab) `idx` is 0/absent, so
 * we fall back to Home instead of dead-ending.
 *
 * Hidden on the Home route itself, where "back to home" would be a no-op.
 */
export function BackButton() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  if (pathname === '/') return null;

  function handleClick() {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate('/');
  }

  return (
    <div className="px-6 pt-4 sm:px-8">
      <button
        type="button"
        onClick={handleClick}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" />
        {t('back')}
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:run -- src/components/BackButton.test.tsx`
Expected: PASS — all 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/components/BackButton.tsx src/components/BackButton.test.tsx
git commit -m "feat(nav): add universal BackButton component"
```

---

## Task 3: Render `BackButton` globally in `AppShell`

**Files:**
- Modify: `src/components/layout/AppShell.tsx`

- [ ] **Step 1: Add the import**

In `src/components/layout/AppShell.tsx`, add this import alongside the existing imports (after the `EmailHealthBanner` import line):

```tsx
import { BackButton } from '@/components/BackButton';
```

- [ ] **Step 2: Render it above page content**

Change the `<main>` block from:

```tsx
        <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">{children}</main>
```

to:

```tsx
        <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          <BackButton />
          {children}
        </main>
```

- [ ] **Step 3: Verify the existing AppShell test still passes**

Run: `npm run test:run -- src/components/layout/AppShell.test.tsx`
Expected: PASS — `renders children with topbar and sidebar` still green (BackButton renders nothing extra that breaks it; the test mounts at `/` where BackButton returns null).

- [ ] **Step 4: Commit**

```bash
git add src/components/layout/AppShell.tsx
git commit -m "feat(nav): render BackButton on every page via AppShell"
```

---

## Task 4: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`
Expected: PASS — no type errors.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: PASS — 0 warnings (the build enforces `--max-warnings=0`).

- [ ] **Step 3: Full test suite**

Run: `npm run test:run`
Expected: PASS — entire suite green, including the new `BackButton` tests.

- [ ] **Step 4: Manual smoke (optional but recommended)**

Run: `npm run dev`, log in, and confirm:
- The Back link shows at the top-left of a deal/lead/job/client/accounting/admin page.
- Clicking it returns to the previous page.
- Opening a detail URL directly (or refreshing it) then clicking Back lands on Home.
- The Home page (`/`) shows no Back link.

---

## Self-Review Notes

- **Spec coverage:** component (Task 2), global placement in AppShell (Task 3), smart history-vs-Home behavior (Task 2 impl + tests), hidden on `/` (Task 2), i18n en/el (Task 1), tests (Task 2). All spec sections covered.
- **No DB/migration** — matches the spec's Changes/Revert section.
- **Revert:** delete `BackButton.tsx` + `BackButton.test.tsx`, revert the `AppShell.tsx` import + line, remove the two `back` keys.
