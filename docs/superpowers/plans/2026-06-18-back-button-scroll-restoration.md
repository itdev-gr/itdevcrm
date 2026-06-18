# Back Button — Scroll Restoration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** When the user clicks Back (or browser back), restore the exact scroll position of the previous page — including nested scroll containers like kanban columns.

**Architecture:** One generic manager mounted once in `AppShell`. A capture-phase scroll listener on `<main>` records the scroll position of every scrolled element (identified by its child-index path within `<main>`), keyed by the history `location.key`. On a POP navigation it replays the saved positions for that entry, retrying across animation frames so it still lands correctly after async data renders. Forward (PUSH) navigation resets to the top.

**Tech Stack:** React 19, react-router-dom v7 (`useLocation`, `useNavigationType`), Vitest + jsdom.

**Why generic:** scrolling lives in many nested containers (3 kanban column components, list tables, detail-page columns, the `<main>` container, and the horizontal board row). Capture-phase listening + position-paths covers all of them without per-page edits.

---

## File Structure

- `src/lib/scrollRestoration.ts` — pure helpers `domPath()` / `elementAtPath()` (new).
- `src/lib/scrollRestoration.test.ts` — unit tests for the helpers (new).
- `src/components/ScrollRestorer.tsx` — the manager component, renders null (new).
- `src/components/layout/AppShell.tsx` — add a ref on `<main>` and render `<ScrollRestorer>` (modify).

---

## Task 1: Pure path helpers (TDD)

**Files:**
- Test: `src/lib/scrollRestoration.test.ts` (create)
- Create: `src/lib/scrollRestoration.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { domPath, elementAtPath } from './scrollRestoration';

function tree() {
  const root = document.createElement('div');
  root.innerHTML = '<div><span></span><span id="t"></span></div><p></p>';
  return root;
}

describe('scrollRestoration path helpers', () => {
  it('round-trips a nested element', () => {
    const root = tree();
    const target = root.querySelector('#t')!;
    const path = domPath(target, root)!;
    expect(path).toBe('0.1');
    expect(elementAtPath(root, path)).toBe(target);
  });

  it('represents the root itself as empty string', () => {
    const root = tree();
    expect(domPath(root, root)).toBe('');
    expect(elementAtPath(root, '')).toBe(root);
  });

  it('disambiguates siblings', () => {
    const root = tree();
    const first = root.querySelector('span')!;
    const second = root.querySelector('#t')!;
    expect(domPath(first, root)).toBe('0.0');
    expect(domPath(second, root)).toBe('0.1');
    expect(elementAtPath(root, '0.0')).toBe(first);
  });

  it('returns null when element is outside root', () => {
    const root = tree();
    const stray = document.createElement('div');
    expect(domPath(stray, root)).toBeNull();
  });

  it('returns null for a path that no longer resolves', () => {
    const root = tree();
    expect(elementAtPath(root, '9.9')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npm run test:run -- src/lib/scrollRestoration.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
/**
 * Position-path of `el` within `root`: a dot-joined chain of child indices
 * (e.g. "0.1.2"). Returns '' when el === root, or null when el is not a
 * descendant of root. Re-resolvable with elementAtPath after a re-render,
 * because the same logical container keeps the same structural position.
 */
export function domPath(el: Element, root: Element): string | null {
  if (el === root) return '';
  const parts: number[] = [];
  let cur: Element | null = el;
  while (cur && cur !== root) {
    const parent: Element | null = cur.parentElement;
    if (!parent) return null;
    parts.push(Array.prototype.indexOf.call(parent.children, cur));
    cur = parent;
  }
  if (cur !== root) return null;
  return parts.reverse().join('.');
}

/** Inverse of domPath: walk child indices from root. Null if it doesn't resolve. */
export function elementAtPath(root: Element, path: string): Element | null {
  if (path === '') return root;
  let cur: Element | null = root;
  for (const part of path.split('.')) {
    cur = cur ? (cur.children[Number(part)] ?? null) : null;
    if (!cur) return null;
  }
  return cur;
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npm run test:run -- src/lib/scrollRestoration.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/scrollRestoration.ts src/lib/scrollRestoration.test.ts
git commit -m "feat(nav): dom path helpers for scroll restoration"
```

---

## Task 2: ScrollRestorer manager

**Files:**
- Create: `src/components/ScrollRestorer.tsx`

- [ ] **Step 1: Implement**

```tsx
import { useEffect, useRef, type RefObject } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';
import { domPath, elementAtPath } from '@/lib/scrollRestoration';

type Pos = { top: number; left: number };
const store = new Map<string, Record<string, Pos>>();
const MAX_KEYS = 50;

function remember(key: string, path: string, pos: Pos) {
  let rec = store.get(key);
  if (!rec) {
    rec = {};
    store.set(key, rec);
    while (store.size > MAX_KEYS) {
      const oldest = store.keys().next().value;
      if (oldest === undefined) break;
      store.delete(oldest);
    }
  }
  rec[path] = pos;
}

/**
 * Records scroll positions of every scrolled element under `rootRef` (keyed by
 * history entry) and restores them on Back/Forward (POP). Forward navigation
 * (PUSH/REPLACE) starts at the top. Rendered once in AppShell; renders nothing.
 */
export function ScrollRestorer({ rootRef }: { rootRef: RefObject<HTMLElement | null> }) {
  const location = useLocation();
  const navType = useNavigationType();
  const keyRef = useRef(location.key);
  const restoringRef = useRef(false);
  keyRef.current = location.key;

  // Save: one capture-phase listener catches scrolls in any nested container.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let scheduled = false;
    function onScroll(e: Event) {
      if (restoringRef.current) return;
      const target = e.target;
      if (!(target instanceof Element)) return;
      const path = domPath(target, root!);
      if (path == null) return;
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        remember(keyRef.current, path, { top: target.scrollTop, left: target.scrollLeft });
      });
    }
    root.addEventListener('scroll', onScroll, true);
    return () => root.removeEventListener('scroll', onScroll, true);
  }, [rootRef]);

  // Restore on POP; reset to top otherwise.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.scrollTop = 0;
    root.scrollLeft = 0;
    if (navType !== 'POP') return;
    const rec = store.get(location.key);
    if (!rec) return;
    restoringRef.current = true;
    let frames = 0;
    const tick = () => {
      let settled = true;
      for (const [path, pos] of Object.entries(rec)) {
        const el = elementAtPath(root, path) as HTMLElement | null;
        if (!el) {
          settled = false;
          continue;
        }
        if (el.scrollTop !== pos.top) el.scrollTop = pos.top;
        if (el.scrollLeft !== pos.left) el.scrollLeft = pos.left;
        const room = el.scrollHeight - el.clientHeight;
        if (Math.abs(el.scrollTop - pos.top) > 1 && room > el.scrollTop + 1) settled = false;
      }
      frames += 1;
      if (!settled && frames < 40) requestAnimationFrame(tick);
      else restoringRef.current = false;
    };
    requestAnimationFrame(tick);
  }, [location.key, navType, rootRef]);

  return null;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/ScrollRestorer.tsx
git commit -m "feat(nav): ScrollRestorer — restore scroll on Back"
```

---

## Task 3: Wire into AppShell

**Files:**
- Modify: `src/components/layout/AppShell.tsx`

- [ ] **Step 1: Add imports**

```tsx
import { useRef } from 'react';
import { ScrollRestorer } from '@/components/ScrollRestorer';
```
(merge `useRef` into the existing `react` import which already imports `useState, type ReactNode`).

- [ ] **Step 2: Add a ref and the manager**

Add `const mainRef = useRef<HTMLElement>(null);` in the component body, put `ref={mainRef}` on `<main>`, and render `<ScrollRestorer rootRef={mainRef} />` inside the root `<div>` (e.g. right before its closing tag).

- [ ] **Step 3: Verify AppShell test still passes**

Run: `npm run test:run -- src/components/layout/AppShell.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/layout/AppShell.tsx
git commit -m "feat(nav): mount ScrollRestorer in AppShell"
```

---

## Task 4: Verify

- [ ] `npm run typecheck` → PASS
- [ ] `npm run lint` → PASS (0 warnings)
- [ ] `npm run test:run` → suite green (ignore pre-existing Deno `send-email/templates.test.ts`)
- [ ] Browser (Playwright): log in, open Accounting onboarding, scroll a column, open a card, click Back → column scroll position restored.

---

## Changes / Revert

New: `src/lib/scrollRestoration.ts` (+test), `src/components/ScrollRestorer.tsx`.
Modified: `src/components/layout/AppShell.tsx` (ref on `<main>` + `<ScrollRestorer>`).
Revert: delete the new files; remove the ref, import, and `<ScrollRestorer>` line from AppShell. No DB changes.

**Known limitation:** the Sales kanban "Load more" (50/page) means deep scroll there can't fully restore until the extra pages re-render; the Accounting board renders all cards and restores exactly.
