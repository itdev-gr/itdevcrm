# Dark Mode Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Light / Dark / System theme toggle to the CRM that persists per browser, defaults to the OS setting, and makes every screen render correctly in dark mode.

**Architecture:** The dark palette already exists in `src/index.css` (the `.dark { … }` block, lines 85–117) and the `dark` Tailwind v4 variant is already declared (`@custom-variant dark (&:is(.dark *))`, line 5). So the design tokens are done — we only need (1) a mechanism to add/remove the `dark` class on `<html>`, plus a UI to drive it, and (2) a cleanup pass replacing hardcoded light colors (`bg-white`, `text-gray-*`, …) so token-unaware screens follow the theme. Theme state lives in a small zustand store (matching the existing `src/lib/stores/authStore.ts` pattern), backed by `localStorage` key `itdevcrm.theme` (mirrors the existing `itdevcrm.locale` key). A tiny inline script in `index.html` applies the saved theme before React paints to avoid a flash of the wrong theme.

**Tech Stack:** React 19, Vite 8, Tailwind CSS v4, shadcn/ui (radix-nova, `Select` primitive), zustand, react-i18next, lucide-react icons, Vitest + Testing Library.

**Two phases:**
- **Phase 1 (Tasks 1–8):** Working toggle. shadcn components and any screen already using semantic tokens flip to dark. Self-contained — you may stop here.
- **Phase 2 (Tasks 9–16):** Color migration. Replace ~473 hardcoded color utilities across ~75 files so every screen looks right in dark, one feature area per commit.

---

## File Structure

**Phase 1 — new files:**
- `src/lib/theme.ts` — pure theme helpers + constants (no React, no side effects beyond explicit DOM/storage functions). Unit-testable core.
- `src/lib/theme.test.ts` — unit tests for the pure helpers.
- `src/lib/stores/themeStore.ts` — zustand store holding `mode`, applying + persisting on change.
- `src/lib/stores/themeStore.test.ts` — store behavior tests.
- `src/lib/initTheme.ts` — one-time bootstrap: apply stored theme + subscribe to OS changes.
- `src/components/layout/ThemeToggle.tsx` — `Select`-based toggle, modeled on `LocaleSwitcher.tsx`.
- `src/components/layout/ThemeToggle.test.tsx` — render test.

**Phase 1 — modified files:**
- `vitest.setup.ts` — add a `window.matchMedia` mock (jsdom lacks it).
- `src/main.tsx` — call `initTheme()` before render.
- `index.html` — inline no-flash script in `<head>`.
- `src/components/layout/Topbar.tsx` — mount `<ThemeToggle />` next to `<LocaleSwitcher />`.
- `src/i18n/locales/en/common.json` + `src/i18n/locales/el/common.json` — add a `theme` block.

**Phase 2 — modified files:** ~75 `.tsx` files across feature areas (see Phase 2 task list). No new files.

---

## Phase 1 — Theme Toggle Infrastructure

### Task 1: Add `matchMedia` mock to the test setup

jsdom does not implement `window.matchMedia`. The theme store and `initTheme` call it, so tests would throw without a mock.

**Files:**
- Modify: `vitest.setup.ts`

- [ ] **Step 1: Add the mock**

Add this block to `vitest.setup.ts`, right after the existing `Element.prototype` block (around line 28) and before the `import.meta.env` block:

```ts
// jsdom does not implement matchMedia (used by the theme store / initTheme)
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}
```

- [ ] **Step 2: Verify the suite still runs**

Run: `npm run test:run`
Expected: PASS (same number of tests as before; no new failures from the setup change).

- [ ] **Step 3: Commit**

```bash
git add vitest.setup.ts
git commit -m "test: mock window.matchMedia for theme tests"
```

---

### Task 2: Pure theme helpers

**Files:**
- Create: `src/lib/theme.ts`
- Test: `src/lib/theme.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/theme.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  THEME_STORAGE_KEY,
  isThemeMode,
  resolveTheme,
  getStoredMode,
} from './theme';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('isThemeMode', () => {
  it('accepts the three valid modes', () => {
    expect(isThemeMode('light')).toBe(true);
    expect(isThemeMode('dark')).toBe(true);
    expect(isThemeMode('system')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isThemeMode('blue')).toBe(false);
    expect(isThemeMode(null)).toBe(false);
    expect(isThemeMode(undefined)).toBe(false);
  });
});

describe('resolveTheme', () => {
  it('returns the explicit mode unchanged for light/dark', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('follows the system preference when mode is system', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });
});

describe('getStoredMode', () => {
  it('defaults to system when nothing is stored', () => {
    expect(getStoredMode()).toBe('system');
  });

  it('returns a stored valid mode', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    expect(getStoredMode()).toBe('dark');
  });

  it('falls back to system for a corrupt stored value', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'banana');
    expect(getStoredMode()).toBe('system');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/theme.test.ts`
Expected: FAIL — `Failed to resolve import './theme'` (module does not exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/theme.ts`:

```ts
export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

/** localStorage key. Mirrors the locale key `itdevcrm.locale`. */
export const THEME_STORAGE_KEY = 'itdevcrm.theme';

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system';
}

/** Map a chosen mode + the current OS preference to the concrete theme to render. */
export function resolveTheme(mode: ThemeMode, systemPrefersDark: boolean): ResolvedTheme {
  if (mode === 'system') return systemPrefersDark ? 'dark' : 'light';
  return mode;
}

/** Read the saved mode, defaulting to 'system'. Safe if localStorage is unavailable. */
export function getStoredMode(): ThemeMode {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeMode(raw) ? raw : 'system';
  } catch {
    return 'system';
  }
}

/** Persist the chosen mode. Safe if localStorage is unavailable. */
export function storeMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    /* ignore (private mode / disabled storage) */
  }
}

/** Whether the OS currently prefers dark. */
export function systemPrefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
}

/** Toggle the `dark` class on <html> to match the resolved theme. */
export function applyResolvedTheme(resolved: ResolvedTheme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', resolved === 'dark');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/theme.test.ts`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/theme.ts src/lib/theme.test.ts
git commit -m "feat(theme): pure theme helpers + storage"
```

---

### Task 3: Theme store

**Files:**
- Create: `src/lib/stores/themeStore.ts`
- Test: `src/lib/stores/themeStore.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/stores/themeStore.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { THEME_STORAGE_KEY } from '@/lib/theme';
import { useThemeStore } from './themeStore';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove('dark');
  useThemeStore.setState({ mode: 'system' });
});

afterEach(() => {
  document.documentElement.classList.remove('dark');
});

describe('themeStore.setMode', () => {
  it('adds the dark class and persists when set to dark', () => {
    useThemeStore.getState().setMode('dark');
    expect(useThemeStore.getState().mode).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  it('removes the dark class when set to light', () => {
    document.documentElement.classList.add('dark');
    useThemeStore.getState().setMode('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });

  it('resolves system to light when the OS does not prefer dark (matchMedia mock returns false)', () => {
    document.documentElement.classList.add('dark');
    useThemeStore.getState().setMode('system');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('system');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/stores/themeStore.test.ts`
Expected: FAIL — `Failed to resolve import './themeStore'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/stores/themeStore.ts`:

```ts
import { create } from 'zustand';
import {
  applyResolvedTheme,
  getStoredMode,
  resolveTheme,
  storeMode,
  systemPrefersDark,
  type ThemeMode,
} from '@/lib/theme';

export type ThemeState = {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
};

export const useThemeStore = create<ThemeState>((set) => ({
  mode: getStoredMode(),
  setMode: (mode) => {
    storeMode(mode);
    applyResolvedTheme(resolveTheme(mode, systemPrefersDark()));
    set({ mode });
  },
}));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/stores/themeStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/stores/themeStore.ts src/lib/stores/themeStore.test.ts
git commit -m "feat(theme): zustand theme store"
```

---

### Task 4: Bootstrap (apply on load + react to OS changes)

This applies the saved theme once when the app starts and keeps `system` mode in sync when the OS flips dark/light while the app is open.

**Files:**
- Create: `src/lib/initTheme.ts`
- Modify: `src/main.tsx`

- [ ] **Step 1: Create the bootstrap module**

Create `src/lib/initTheme.ts`:

```ts
import {
  applyResolvedTheme,
  getStoredMode,
  resolveTheme,
  systemPrefersDark,
} from '@/lib/theme';
import { useThemeStore } from '@/lib/stores/themeStore';

/**
 * Apply the saved theme immediately and keep `system` mode in sync with the OS.
 * Call once at startup. The inline script in index.html handles the pre-paint
 * application to avoid a flash; this also wires the live media-query listener.
 */
export function initTheme(): void {
  applyResolvedTheme(resolveTheme(getStoredMode(), systemPrefersDark()));

  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return;
  }
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', (event) => {
    if (useThemeStore.getState().mode === 'system') {
      applyResolvedTheme(event.matches ? 'dark' : 'light');
    }
  });
}
```

- [ ] **Step 2: Call it from `main.tsx`**

In `src/main.tsx`, add the import and call after `initSentry()`. The file becomes:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { Providers } from './app/Providers';
import { initSentry } from './lib/sentry';
import { initTheme } from './lib/initTheme';
import './index.css';

initSentry();
initTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Providers>
      <App />
    </Providers>
  </StrictMode>,
);
```

- [ ] **Step 3: Verify typecheck + tests**

Run: `npm run typecheck && npm run test:run`
Expected: PASS (no type errors; all tests green).

- [ ] **Step 4: Commit**

```bash
git add src/lib/initTheme.ts src/main.tsx
git commit -m "feat(theme): apply theme on load + follow OS changes"
```

---

### Task 5: No-flash inline script

Without this, the page paints light first, then React swaps to dark — a visible flash on every load for dark/dark-OS users.

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Add the inline script to `<head>`**

In `index.html`, add this script as the last child of `<head>`, immediately before `</head>` (after the `<title>` line):

```html
    <script>
      // Apply saved theme before first paint to avoid a flash of the wrong theme.
      (function () {
        try {
          var mode = localStorage.getItem('itdevcrm.theme') || 'system';
          var dark =
            mode === 'dark' ||
            (mode === 'system' &&
              window.matchMedia('(prefers-color-scheme: dark)').matches);
          if (dark) document.documentElement.classList.add('dark');
        } catch (e) {
          /* ignore */
        }
      })();
```

> Note: the storage key `itdevcrm.theme` is duplicated here as a literal because this runs before any module loads. It must stay in sync with `THEME_STORAGE_KEY` in `src/lib/theme.ts`.

- [ ] **Step 2: Verify the build still succeeds**

Run: `npm run build`
Expected: PASS (build completes; no HTML/JS errors).

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat(theme): no-flash inline theme script"
```

---

### Task 6: i18n labels

**Files:**
- Modify: `src/i18n/locales/en/common.json`
- Modify: `src/i18n/locales/el/common.json`

- [ ] **Step 1: Add the English `theme` block**

In `src/i18n/locales/en/common.json`, add a `theme` key right after the closing brace of the `locale` block (after line 20, the `"el": "Ελληνικά"` line's closing `}`). Insert:

```json
  "theme": {
    "label": "Theme",
    "light": "Light",
    "dark": "Dark",
    "system": "System"
  },
```

The surrounding structure becomes:

```json
  "locale": {
    "label": "Language",
    "en": "English",
    "el": "Ελληνικά"
  },
  "theme": {
    "label": "Theme",
    "light": "Light",
    "dark": "Dark",
    "system": "System"
  },
  "cancel": "Cancel",
```

- [ ] **Step 2: Add the Greek `theme` block**

In `src/i18n/locales/el/common.json`, insert the same key after the `locale` block:

```json
  "theme": {
    "label": "Θέμα",
    "light": "Φωτεινό",
    "dark": "Σκοτεινό",
    "system": "Σύστημα"
  },
```

The surrounding structure becomes:

```json
  "locale": {
    "label": "Γλώσσα",
    "en": "English",
    "el": "Ελληνικά"
  },
  "theme": {
    "label": "Θέμα",
    "light": "Φωτεινό",
    "dark": "Σκοτεινό",
    "system": "Σύστημα"
  },
  "cancel": "Άκυρο",
```

- [ ] **Step 3: Verify JSON is valid**

Run: `node -e "require('./src/i18n/locales/en/common.json'); require('./src/i18n/locales/el/common.json'); console.log('valid')"`
Expected: prints `valid` (no JSON parse error).

- [ ] **Step 4: Commit**

```bash
git add src/i18n/locales/en/common.json src/i18n/locales/el/common.json
git commit -m "feat(theme): add theme toggle i18n labels"
```

---

### Task 7: ThemeToggle component + wire into Topbar

Modeled on `src/components/layout/LocaleSwitcher.tsx` (same `Select` primitive), with lucide icons.

**Files:**
- Create: `src/components/layout/ThemeToggle.tsx`
- Test: `src/components/layout/ThemeToggle.test.tsx`
- Modify: `src/components/layout/Topbar.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/layout/ThemeToggle.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import '@/lib/i18n';
import { useThemeStore } from '@/lib/stores/themeStore';
import { ThemeToggle } from './ThemeToggle';

beforeEach(() => {
  document.documentElement.classList.remove('dark');
  useThemeStore.setState({ mode: 'system' });
});

describe('ThemeToggle', () => {
  it('renders a labeled theme control', () => {
    render(<ThemeToggle />);
    expect(screen.getByLabelText('Theme')).toBeInTheDocument();
  });

  it('shows the current mode label', () => {
    useThemeStore.setState({ mode: 'dark' });
    render(<ThemeToggle />);
    expect(screen.getByText('Dark')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/layout/ThemeToggle.test.tsx`
Expected: FAIL — `Failed to resolve import './ThemeToggle'`.

- [ ] **Step 3: Write the component**

Create `src/components/layout/ThemeToggle.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { Monitor, Moon, Sun } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useThemeStore } from '@/lib/stores/themeStore';
import { isThemeMode } from '@/lib/theme';

export function ThemeToggle() {
  const { t } = useTranslation();
  const mode = useThemeStore((state) => state.mode);
  const setMode = useThemeStore((state) => state.setMode);

  return (
    <Select
      value={mode}
      onValueChange={(value) => {
        if (isThemeMode(value)) setMode(value);
      }}
    >
      <SelectTrigger className="w-36" aria-label={t('theme.label')}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="light">
          <span className="flex items-center gap-2">
            <Sun className="h-4 w-4" />
            {t('theme.light')}
          </span>
        </SelectItem>
        <SelectItem value="dark">
          <span className="flex items-center gap-2">
            <Moon className="h-4 w-4" />
            {t('theme.dark')}
          </span>
        </SelectItem>
        <SelectItem value="system">
          <span className="flex items-center gap-2">
            <Monitor className="h-4 w-4" />
            {t('theme.system')}
          </span>
        </SelectItem>
      </SelectContent>
    </Select>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/layout/ThemeToggle.test.tsx`
Expected: PASS.

- [ ] **Step 5: Mount it in the Topbar**

In `src/components/layout/Topbar.tsx`, add the import and render `<ThemeToggle />` immediately before `<LocaleSwitcher />`.

Add the import after the `LocaleSwitcher` import (line 5):

```tsx
import { ThemeToggle } from './ThemeToggle';
```

Change the right-hand controls group so `<LocaleSwitcher />` is preceded by `<ThemeToggle />`:

```tsx
        {session && <NotificationsBell />}
        <ThemeToggle />
        <LocaleSwitcher />
```

- [ ] **Step 6: Verify typecheck + full suite**

Run: `npm run typecheck && npm run test:run`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/layout/ThemeToggle.tsx src/components/layout/ThemeToggle.test.tsx src/components/layout/Topbar.tsx
git commit -m "feat(theme): theme toggle in topbar"
```

---

### Task 8: Phase 1 verification (manual)

- [ ] **Step 1: Build + lint gate**

Run: `npm run build`
Expected: PASS (this runs `tsc -b`, `eslint --max-warnings=0`, and `vite build`).

- [ ] **Step 2: Manual smoke in the browser**

Run: `npm run dev`, log in, then verify:
- The Topbar shows a Theme control next to the Language switcher.
- Selecting **Dark** turns the app chrome (topbar, sidebar, cards, dialogs) dark immediately.
- Selecting **System** matches your OS; flipping the OS appearance while the app is open flips the app (system mode only).
- Reload the page on **Dark** — it loads dark with **no flash** of light.
- The choice survives a full browser restart (localStorage `itdevcrm.theme`).

Expected: all of the above hold. (Some feature screens will still show light patches — that's the hardcoded-color debt fixed in Phase 2.)

- [ ] **Step 3 (optional): Capture a screenshot for the record**

Take a dark-mode screenshot of the dashboard to attach to the PR/commit description.

> **STOP POINT.** Phase 1 delivers a working, persistent toggle. If you only need the toggle, stop here. Continue to Phase 2 to make every screen render correctly in dark.

---

## Phase 2 — Color Migration

**Why:** ~75 component files use hardcoded light colors (`bg-white`, `text-gray-700`, `border-gray-200`, `hover:bg-slate-100`, …) — ~473 occurrences. These ignore the theme and stay light in dark mode (white cards on dark bg, unreadable gray text). We replace neutral hardcoded colors with semantic tokens, and give colored status badges a `dark:` variant.

**Per-task workflow (applies to every Phase 2 task):**
1. List the files in the area: run the area's `grep -rlE … <path>` command (given per task).
2. For each file, replace hardcoded utilities per the **Mapping Table** below. Use the **Status-color table** for colored badges/pills.
3. Leave the 5 files that already use `dark:` variants alone unless they also contain a neutral from the table.
4. Verify: `npm run typecheck && npm run lint`, then `npm run dev`, switch to **Dark**, navigate the area's screens, confirm no white-on-white panels and no unreadable text.
5. Commit the area as one commit.

### Mapping Table — neutrals → semantic tokens

Replace globally within each file (decide card vs page by context):

| Hardcoded utility | Replace with | Notes |
|---|---|---|
| `bg-white` | `bg-card` | use `bg-background` if it's a full-page/app surface, not a panel |
| `bg-gray-50`, `bg-gray-100`, `bg-slate-50`, `bg-slate-100`, `bg-neutral-50/100`, `bg-zinc-50/100` | `bg-muted` | subtle fills, table header rows, hover backdrops |
| `hover:bg-gray-50/100`, `hover:bg-slate-50/100` | `hover:bg-muted` | row/list hover |
| `text-gray-900`, `text-black`, `text-slate-900`, `text-neutral-900` | `text-foreground` | primary text |
| `text-gray-500/600/700`, `text-slate-500/600/700`, `text-neutral-500/600` | `text-muted-foreground` | secondary/label text |
| `text-gray-400`, `text-slate-400` | `text-muted-foreground` | placeholder/disabled-ish; acceptable |
| `border-gray-100/200/300`, `border-slate-200/300`, `border-neutral-200` | `border-border` (or just `border`) | dividers, card edges |
| `divide-gray-200`, `divide-slate-200` | `divide-border` | list separators |
| `ring-gray-200/300` | `ring-border` | focus/edge rings |

> If a `bg-*` neutral is paired with a `text-*` neutral that becomes invisible after only one is changed, change both together. Always preview the screen in dark before committing.

### Status-color table — colored badges/pills (keep hue, add dark variant)

Do **not** convert these to neutral tokens — they encode meaning (won/lost/blocked/etc.). Keep the light classes and append a dark variant:

| Existing (light) | Append |
|---|---|
| `bg-green-100 text-green-800` | `dark:bg-green-950/50 dark:text-green-300` |
| `bg-red-100 text-red-800` | `dark:bg-red-950/50 dark:text-red-300` |
| `bg-amber-100 text-amber-800` / `bg-yellow-100 text-yellow-800` | `dark:bg-amber-950/50 dark:text-amber-300` |
| `bg-blue-100 text-blue-800` | `dark:bg-blue-950/50 dark:text-blue-300` |
| `bg-purple-100 text-purple-800` | `dark:bg-purple-950/50 dark:text-purple-300` |
| standalone `text-green-600` / `text-red-600` (numbers, +/− deltas) | append `dark:text-green-400` / `dark:text-red-400` |

> Recharts series already use the `--chart-*` tokens (defined for both themes in `index.css`), so charts adapt automatically. If a chart hardcodes a hex `stroke`/`fill` or an axis color, swap it to `hsl(var(--muted-foreground))` / a `--chart-*` token while in that area's task.

---

### Task 9: Shared layout + global components (do first — highest blast radius)

These wrap every page; fixing them first makes the rest easier to judge visually.

**Files (exact):**
- `src/components/layout/Topbar.tsx` — `hover:bg-slate-100` → `hover:bg-muted`; `hover:text-slate-900` → `hover:text-foreground`
- `src/components/layout/Sidebar.tsx`
- `src/components/layout/AppShell.tsx`
- `src/components/CopyableCode.tsx`
- `src/app/HomePage.tsx` *(if it carries neutrals — confirm with the grep below)*

- [ ] **Step 1: Surface every occurrence in these files**

Run:
```bash
grep -rnE 'bg-white|bg-gray-|text-gray-|text-black|bg-slate-|text-slate-|border-gray-|hover:bg-gray-|hover:bg-slate-|hover:text-slate-' \
  src/components src/app/routes/HomePage.tsx src/app/HomePage.tsx 2>/dev/null
```
Expected: a list of lines to change.

- [ ] **Step 2: Apply the Mapping Table to each line** (and Status-color table for any colored pills).

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm run lint`
Then `npm run dev`, set Dark, and confirm the topbar, sidebar, app shell, and any copyable-code block read correctly.
Expected: typecheck + lint PASS; no white-on-white chrome.

- [ ] **Step 4: Commit**

```bash
git add src/components src/app
git commit -m "style(theme): dark-mode shared layout + global components"
```

---

### Task 10: `accounting_report` (9 files)

- [ ] **Step 1: List files**

Run: `grep -rlE 'bg-white|bg-gray-|text-gray-|text-black|bg-slate-|text-slate-|border-gray-|hover:bg-gray-|hover:bg-slate-' src/features/accounting_report --include="*.tsx"`

- [ ] **Step 2: Apply Mapping Table + Status-color table to each listed file.** Watch the report charts/tables for hardcoded chart colors (see note under the Status-color table).

- [ ] **Step 3: Verify** — `npm run typecheck && npm run lint`; then in dark mode open the Accounting Report screens and confirm tables, totals, and charts are readable.

- [ ] **Step 4: Commit**

```bash
git add src/features/accounting_report
git commit -m "style(theme): dark-mode accounting report"
```

---

### Task 11: `jobs` (8 files)

- [ ] **Step 1: List files** — `grep -rlE 'bg-white|bg-gray-|text-gray-|text-black|bg-slate-|text-slate-|border-gray-|hover:bg-gray-|hover:bg-slate-' src/features/jobs --include="*.tsx"`
- [ ] **Step 2: Apply Mapping Table + Status-color table.** Job status pills (blocked/active/done) use the Status-color table.
- [ ] **Step 3: Verify** — `npm run typecheck && npm run lint`; dark-mode check the job board + job detail (blocked/unblocked states).
- [ ] **Step 4: Commit**

```bash
git add src/features/jobs
git commit -m "style(theme): dark-mode jobs"
```

---

### Task 12: `deals` (8 files)

- [ ] **Step 1: List files** — `grep -rlE 'bg-white|bg-gray-|text-gray-|text-black|bg-slate-|text-slate-|border-gray-|hover:bg-gray-|hover:bg-slate-' src/features/deals --include="*.tsx"`
- [ ] **Step 2: Apply Mapping Table + Status-color table.** Deal Overview (jobs-only) cards use `bg-card`.
- [ ] **Step 3: Verify** — `npm run typecheck && npm run lint`; dark-mode check the deal page + overview + payments.
- [ ] **Step 4: Commit**

```bash
git add src/features/deals
git commit -m "style(theme): dark-mode deals"
```

---

### Task 13: `contracts` (6) + `accounting` (5) + `assigned_tasks` (5)

- [ ] **Step 1: List files** —
```bash
grep -rlE 'bg-white|bg-gray-|text-gray-|text-black|bg-slate-|text-slate-|border-gray-|hover:bg-gray-|hover:bg-slate-' \
  src/features/contracts src/features/accounting src/features/assigned_tasks --include="*.tsx"
```
- [ ] **Step 2: Apply Mapping Table + Status-color table** to each listed file.
- [ ] **Step 3: Verify** — `npm run typecheck && npm run lint`; dark-mode check the contracts list/detail, accounting kanban, and assigned-tasks views.
- [ ] **Step 4: Commit**

```bash
git add src/features/contracts src/features/accounting src/features/assigned_tasks
git commit -m "style(theme): dark-mode contracts, accounting, assigned tasks"
```

---

### Task 14: `sales` (3) + `leads` (3) + `offers` (3) + `permissions` (3)

- [ ] **Step 1: List files** —
```bash
grep -rlE 'bg-white|bg-gray-|text-gray-|text-black|bg-slate-|text-slate-|border-gray-|hover:bg-gray-|hover:bg-slate-' \
  src/features/sales src/features/leads src/features/offers src/features/permissions --include="*.tsx"
```
- [ ] **Step 2: Apply Mapping Table + Status-color table.** Sales pipeline/kanban column headers and lead-stage pills use the Status-color table; the offer builder preview should use `bg-card`.
- [ ] **Step 3: Verify** — `npm run typecheck && npm run lint`; dark-mode check the sales kanban, leads table, offer builder, and permissions screens.
- [ ] **Step 4: Commit**

```bash
git add src/features/sales src/features/leads src/features/offers src/features/permissions
git commit -m "style(theme): dark-mode sales, leads, offers, permissions"
```

---

### Task 15: Remaining small areas (tech, notifications, comments, clients, users, search, home, email, email_automations, dashboard, contacts, activity)

Each has 1–2 files.

- [ ] **Step 1: List files** —
```bash
grep -rlE 'bg-white|bg-gray-|text-gray-|text-black|bg-slate-|text-slate-|border-gray-|hover:bg-gray-|hover:bg-slate-' \
  src/features/tech src/features/notifications src/features/comments src/features/clients \
  src/features/users src/features/search src/features/home src/features/email \
  src/features/email_automations src/features/dashboard src/features/contacts src/features/activity \
  --include="*.tsx"
```
- [ ] **Step 2: Apply Mapping Table + Status-color table** to each listed file. The dashboard contains charts — verify chart axis/grid colors in dark.
- [ ] **Step 3: Verify** — `npm run typecheck && npm run lint`; dark-mode check the dashboard, global search dropdown, notifications panel, and a client/contact detail.
- [ ] **Step 4: Commit**

```bash
git add src/features
git commit -m "style(theme): dark-mode remaining feature areas"
```

---

### Task 16: Final sweep + verification

- [ ] **Step 1: Find any leftover neutrals**

Run:
```bash
grep -rnE 'bg-white|bg-gray-[0-9]|text-gray-[0-9]|text-black|bg-slate-[0-9]|text-slate-[0-9]|border-gray-[0-9]|hover:bg-slate-|hover:bg-gray-' \
  src --include="*.tsx"
```
Expected: only intentional exceptions remain (e.g. a color that must stay fixed regardless of theme — e.g. a brand element or a printed/PDF surface). For each remaining hit, either convert it per the Mapping Table or add a one-line `// theme: intentionally fixed — <reason>` comment above it.

- [ ] **Step 2: Confirm `text-*-600/800` status colors all have a `dark:` partner**

Run:
```bash
grep -rnE 'text-(green|red|amber|yellow|blue|purple)-(600|700|800)' src --include="*.tsx" | grep -v 'dark:'
```
Expected: empty, or only intentional fixed-color exceptions.

- [ ] **Step 3: Full build gate**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Whole-app dark walkthrough**

Run `npm run dev`, set theme to **Dark**, and click through one screen of every area touched (dashboard, sales kanban, leads, a deal + its jobs, offers, accounting kanban, accounting report, contracts, assigned tasks, notifications, global search, a client/contact, admin/permissions, profile). Confirm: no white panels, all text readable, badges legible, charts legible, dialogs/popovers/selects themed.

Expected: consistent dark UI throughout.

- [ ] **Step 5: Final commit (if Step 1/2 produced edits)**

```bash
git add -A
git commit -m "style(theme): final dark-mode sweep + intentional-exception markers"
```

---

## Self-Review

- **Spec coverage:** Toggle UI ✓ (Task 7), Light/Dark/System modes ✓ (Tasks 2–3, 7), System default ✓ (`getStoredMode` returns `'system'`, Task 2), persistence ✓ (`storeMode`/localStorage, Tasks 2–3), no-flash ✓ (Task 5), follow-OS-live ✓ (Task 4), "whole project" dark coverage ✓ (Phase 2, Tasks 9–16).
- **Type consistency:** `ThemeMode`/`ResolvedTheme` defined in `theme.ts` and reused by the store, `initTheme`, and the component; `THEME_STORAGE_KEY` used everywhere except the pre-module inline script (Task 5 flags the intentional literal duplication); `isThemeMode` guards both `getStoredMode` and the `Select` `onValueChange`; `useThemeStore` exposes exactly `{ mode, setMode }`, matching every consumer.
- **No placeholders:** Phase 1 steps contain complete code. Phase 2 is a mechanical migration driven by the Mapping Table + Status-color table + per-area grep commands (the "code" is the table); each area lists its files via a deterministic command and verifies in dark before commit.

---

## Changes / Revert

**New files (Phase 1):** `src/lib/theme.ts`, `src/lib/theme.test.ts`, `src/lib/stores/themeStore.ts`, `src/lib/stores/themeStore.test.ts`, `src/lib/initTheme.ts`, `src/components/layout/ThemeToggle.tsx`, `src/components/layout/ThemeToggle.test.tsx`.

**Modified files (Phase 1):** `vitest.setup.ts`, `src/main.tsx`, `index.html`, `src/components/layout/Topbar.tsx`, `src/i18n/locales/en/common.json`, `src/i18n/locales/el/common.json`.

**Modified files (Phase 2):** ~75 `.tsx` files across `src/components`, `src/app`, and `src/features/*` (color utilities only — no logic changes).

**No database changes.** This is entirely frontend; there is no migration to roll back.

**Revert:**
- Each task is its own atomic commit. To undo a single area: `git revert <commit-sha>`.
- To remove dark mode entirely: `git revert` the Phase 1 commits (the toggle, `initTheme` call in `main.tsx`, the inline script in `index.html`, and the Topbar mount). The `.dark { … }` block already in `src/index.css` predates this work and can stay — it is inert without the `dark` class being applied.
- Phase 2 commits are safe to keep even if Phase 1 is reverted: semantic tokens render identically to the old neutrals in light mode.
