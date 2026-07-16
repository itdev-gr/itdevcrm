import { useEffect, useRef } from 'react';
import { useToastStore } from '../toastStore';
import { isToastable } from '../toastableTypes';
import { useNotifications } from './useNotifications';

// Pushes a toast whenever a new toastable `notifications` row arrives for the
// current user. Rather than opening its own realtime channel, this hook derives
// toasts from the SAME react-query list the bell renders (useNotifications):
// the bell's useNotificationsRealtime already owns the single postgres_changes
// subscription on `notifications` and refetches that query on every change.
// Reusing it means there is NO second postgres_changes subscription — Supabase
// does not reliably deliver INSERT events to a second subscription on the same
// table, so a dedicated channel here never fired and toasts never appeared.
//
// On each data change we diff against a ref-held set of already-seen ids and
// push a toast for the newly-arrived toastable ones. The first data arrival
// only SEEDS that set (no backfill), so existing notifications never toast on
// page load.
export function useNotificationToasts(): void {
  const { data } = useNotifications();
  // null until the first data arrival; from then on holds every id we've seen.
  const seenRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!data) return;

    // First data arrival: seed the seen-set with everything currently present
    // and push nothing, so page load does not backfill toasts.
    if (seenRef.current === null) {
      seenRef.current = new Set(data.map((n) => n.id));
      return;
    }

    const seen = seenRef.current;
    // data is newest-first; iterate oldest→newest of the NEW rows so the newest
    // is pushed last. The container is flex-col-reverse, so the last-pushed
    // toast renders topmost — this ordering makes the newest show on top.
    for (const n of [...data].reverse()) {
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      if (isToastable(n.type)) {
        // getState() reads the live push, avoiding a stale closure.
        useToastStore.getState().push(n);
      }
    }
  }, [data]);
}
