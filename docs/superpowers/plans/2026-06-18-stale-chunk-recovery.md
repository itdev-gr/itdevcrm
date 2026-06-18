# Stale-Chunk Recovery (Failed to fetch dynamically imported module)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Stop users seeing "Failed to fetch dynamically imported module" / React Router's default error page after a deploy. Recover automatically; show a friendly fallback if recovery fails.

**Root cause:** Each route is a lazy `import()` → a content-hashed JS chunk. A new Vercel deploy replaces those filenames; a browser tab opened before the deploy still references the old names, which 404 on navigation. React Router catches the load error and, with no `errorElement`, shows its developer placeholder.

**Approach (two layers):**
1. Wrap every lazy `import()` in `importWithRetry`: one quick retry (transient blips), then a single guarded full reload to fetch the new app (the real fix for post-deploy stale chunks).
2. Add a React Router `errorElement` (`RouteError`) as a safety net: detects chunk-load errors → auto-reloads once / offers a Reload button; for other errors shows a clean "Something went wrong".

Reloads are guarded by a timestamped sessionStorage key (at most one reload per 10s) so a genuinely broken chunk can never loop.

**Tech Stack:** React 19, react-router-dom v7 (`createBrowserRouter`, `useRouteError`), Vitest + jsdom.

---

## File Structure
- `src/lib/dynamicImport.ts` — `isChunkLoadError`, `reloadForNewVersion`, `importWithRetry` (new).
- `src/lib/dynamicImport.test.ts` — unit tests (new).
- `src/app/RouteError.tsx` — router error boundary UI (new).
- `src/app/router.tsx` — wrap lazy imports + add `errorElement` (modify).

---

## Task 1: dynamicImport helpers (TDD)

**Files:** Test `src/lib/dynamicImport.test.ts`; Create `src/lib/dynamicImport.ts`.

- [ ] **Step 1 — failing test**

```ts
import { isChunkLoadError, reloadForNewVersion, importWithRetry } from './dynamicImport';

function fakeStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

describe('isChunkLoadError', () => {
  it('matches dynamic import failures', () => {
    expect(isChunkLoadError(new Error('Failed to fetch dynamically imported module: https://x/a.js'))).toBe(true);
    expect(isChunkLoadError(new Error('Importing a module script failed.'))).toBe(true);
  });
  it('ignores unrelated errors', () => {
    expect(isChunkLoadError(new Error('boom'))).toBe(false);
  });
});

describe('reloadForNewVersion', () => {
  it('reloads once, then suppresses within the window', () => {
    const storage = fakeStorage();
    let reloads = 0;
    const reload = () => { reloads += 1; };
    expect(reloadForNewVersion(1000, storage, reload)).toBe(true);
    expect(reloadForNewVersion(5000, storage, reload)).toBe(false); // within 10s
    expect(reloadForNewVersion(20000, storage, reload)).toBe(true); // window passed
    expect(reloads).toBe(2);
  });
});

describe('importWithRetry', () => {
  it('returns the module on first success', async () => {
    const mod = { default: 1 };
    await expect(importWithRetry(() => Promise.resolve(mod), { retryDelayMs: 0 })).resolves.toBe(mod);
  });
  it('retries once and succeeds', async () => {
    let n = 0;
    const factory = () => (n++ === 0 ? Promise.reject(new Error('net')) : Promise.resolve('ok'));
    await expect(importWithRetry(factory, { retryDelayMs: 0 })).resolves.toBe('ok');
  });
  it('rethrows a non-chunk error after the retry', async () => {
    const factory = () => Promise.reject(new Error('boom'));
    await expect(importWithRetry(factory, { retryDelayMs: 0 })).rejects.toThrow('boom');
  });
});
```

- [ ] **Step 2 — run, expect FAIL** (`npm run test:run -- src/lib/dynamicImport.test.ts`).

- [ ] **Step 3 — implement**

```ts
const RELOAD_KEY = 'app:chunk-reload-at';
const RELOAD_WINDOW_MS = 10_000;

type MiniStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const CHUNK_RE =
  /dynamically imported module|Importing a module script failed|error loading dynamically imported|Failed to fetch/i;

export function isChunkLoadError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return CHUNK_RE.test(msg);
}

function defaultStorage(): MiniStorage {
  try {
    return window.sessionStorage;
  } catch {
    const m = new Map<string, string>();
    return {
      getItem: (k) => m.get(k) ?? null,
      setItem: (k, v) => void m.set(k, v),
      removeItem: (k) => void m.delete(k),
    };
  }
}

/**
 * Reload the page to pick up a freshly-deployed build, at most once per
 * RELOAD_WINDOW_MS so a genuinely missing chunk can't loop. Returns whether a
 * reload was triggered. Deps are injectable for tests.
 */
export function reloadForNewVersion(
  now: number = Date.now(),
  storage: MiniStorage = defaultStorage(),
  reload: () => void = () => window.location.reload(),
): boolean {
  const last = Number(storage.getItem(RELOAD_KEY) ?? 0);
  if (now - last < RELOAD_WINDOW_MS) return false;
  storage.setItem(RELOAD_KEY, String(now));
  reload();
  return true;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Wrap a dynamic import() factory: retry once for transient failures, then —
 * if it still fails with a chunk-load error after a deploy — reload to fetch
 * the new app. While reloading, returns a never-settling promise so no error
 * UI flashes first.
 */
export async function importWithRetry<T>(
  factory: () => Promise<T>,
  opts: { retryDelayMs?: number } = {},
): Promise<T> {
  try {
    return await factory();
  } catch {
    try {
      await delay(opts.retryDelayMs ?? 500);
      return await factory();
    } catch (err2) {
      if (isChunkLoadError(err2) && reloadForNewVersion()) {
        return new Promise<T>(() => {});
      }
      throw err2;
    }
  }
}
```

- [ ] **Step 4 — run, expect PASS.**
- [ ] **Step 5 — commit** `feat(app): dynamic-import retry + version reload helpers`.

---

## Task 2: RouteError component

**Files:** Create `src/app/RouteError.tsx`.

- [ ] **Step 1 — implement**

```tsx
import { useEffect } from 'react';
import { useRouteError } from 'react-router-dom';
import { isChunkLoadError, reloadForNewVersion } from '@/lib/dynamicImport';

export function RouteError() {
  const error = useRouteError();
  const chunk = isChunkLoadError(error);

  useEffect(() => {
    if (chunk) reloadForNewVersion();
  }, [chunk]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="text-2xl font-bold">
        {chunk ? 'Updating to the latest version…' : 'Something went wrong'}
      </h1>
      <p className="text-sm text-muted-foreground">
        {chunk
          ? 'A new version of the app is available. Reloading…'
          : 'The team has been notified. Try reloading the page.'}
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90"
      >
        Reload
      </button>
    </div>
  );
}
```

- [ ] **Step 2 — typecheck.**
- [ ] **Step 3 — commit** `feat(app): RouteError boundary for chunk/load failures`.

---

## Task 3: Wire into the router

**Files:** Modify `src/app/router.tsx`.

- [ ] **Step 1 — imports**: add
```tsx
import { importWithRetry } from '@/lib/dynamicImport';
import { RouteError } from './RouteError';
```

- [ ] **Step 2 — wrap the helper**: change `lazyPage` body to
```tsx
return lazy(() => importWithRetry(importer).then((mod) => ({ default: mod[name] })));
```

- [ ] **Step 3 — wrap the direct lazy (JobsKanbanPage)**:
```tsx
const JobsKanbanPage = lazy(() =>
  importWithRetry(() => import('@/features/jobs/JobsKanbanPage')).then((m) => ({
    default: m.JobsKanbanPage,
  })),
);
```

- [ ] **Step 4 — add errorElement**: wrap the existing top-level array in one pathless parent route so a single `errorElement` covers everything:
```tsx
export const router = createBrowserRouter([
  {
    errorElement: <RouteError />,
    children: [
      // ...the current top-level routes (ShellLayout route + /login + /forgot-password + /reset-password + /set-password) unchanged...
    ],
  },
]);
```

- [ ] **Step 5 — typecheck + lint + full test run** (ignore the pre-existing Deno `send-email` suite).
- [ ] **Step 6 — commit** `fix(app): recover from stale chunks after deploy`.

---

## Task 4: Verify
- [ ] Unit tests green.
- [ ] Browser (Playwright): intercept a lazy chunk request and force a 404; navigate to that route; observe the app reload / friendly fallback instead of React Router's developer page.

## Changes / Revert
New: `src/lib/dynamicImport.ts` (+test), `src/app/RouteError.tsx`.
Modified: `src/app/router.tsx` (wrap lazy imports + errorElement parent).
Revert: delete new files; restore `lazyPage`/`JobsKanbanPage` to plain `import()`; remove the `errorElement` parent wrapper. No DB changes.
