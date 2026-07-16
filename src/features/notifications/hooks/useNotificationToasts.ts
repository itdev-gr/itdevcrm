import { useEffect, useId } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/lib/stores/authStore';
import { useToastStore } from '../toastStore';
import { isToastable } from '../toastableTypes';
import type { NotificationRow } from './useNotifications';

// Pushes a toast whenever a toastable `notifications` row is INSERTed for the
// current user. Mirrors useNotificationsRealtime's channel config exactly
// (per-user filter + a per-instance useId() suffix so this channel never
// collides with the bell's — two consumers cannot share a channel name), but:
//   - listens to INSERT only (toasts are for brand-new notifications),
//   - filters by isToastable(type) before pushing,
//   - does NOT invalidate any react-query cache (useNotificationsRealtime
//     already owns that; invalidating here would double the work).
//
// Note: initial page load does NOT backfill toasts — realtime only fires for
// inserts that land after .subscribe(), which is the desired behavior.
export function useNotificationToasts(): void {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  // Unique suffix per hook instance — see useNotificationsRealtime for why a
  // shared channel name breaks postgres_changes callbacks.
  const instanceId = useId();
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`toast-notifications-${userId}-${instanceId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        (payload) => {
          // payload.new is the freshly inserted row; its columns match
          // NotificationRow (id, user_id, type, payload, read_at, created_at).
          const row = payload.new as NotificationRow;
          if (!isToastable(row.type)) return;
          // getState() reads the live push, avoiding a stale closure and
          // keeping this effect's deps minimal so it doesn't re-subscribe.
          useToastStore.getState().push(row);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, instanceId]);
}
