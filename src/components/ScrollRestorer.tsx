import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
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
 *
 * A single capture-phase listener catches scrolls in any nested container
 * (kanban columns, list tables, the board's horizontal scroll, the main panel),
 * so this is universal without per-page wiring.
 */
export function ScrollRestorer({ rootRef }: { rootRef: RefObject<HTMLElement | null> }) {
  const location = useLocation();
  const navType = useNavigationType();
  const keyRef = useRef(location.key);
  const restoringRef = useRef(false);
  const guardUntilRef = useRef(0);

  // Keep the current history key available to the (once-attached) scroll
  // listener without re-binding it on every navigation. Must run *before* paint
  // (layout effect): when navigating away, the outgoing page's teardown can clamp
  // a container's scroll to 0 and fire a scroll event — that write must land on
  // the NEW key, not clobber the position we just saved for the page we're leaving.
  useLayoutEffect(() => {
    keyRef.current = location.key;
  }, [location.key]);

  // A click that navigates (a card, a link, the Back button) fires here in the
  // capture phase *before* react-router tears the page down. The teardown can
  // clamp a container's scroll to 0 and fire a scroll event that would clobber
  // the position we want to keep — so briefly ignore scroll writes after a
  // click. Touch/wheel scrolling produces no click, so it still saves normally.
  useEffect(() => {
    const onClick = () => {
      guardUntilRef.current = Date.now() + 700;
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  // Save: one capture-phase listener catches scrolls in any nested container.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let scheduled = false;
    function onScroll(e: Event) {
      if (restoringRef.current) return;
      if (Date.now() < guardUntilRef.current) return;
      const target = e.target;
      if (!(target instanceof Element) || !root) return;
      const path = domPath(target, root);
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
      // Keep retrying for ~2.5s: the destination page may still be fetching its
      // data (kanban cards, table rows), so the target containers — and their
      // full height — only appear a few hundred ms after the route changes.
      if (!settled && frames < 150) requestAnimationFrame(tick);
      else restoringRef.current = false;
    };
    requestAnimationFrame(tick);
  }, [location.key, navType, rootRef]);

  return null;
}
