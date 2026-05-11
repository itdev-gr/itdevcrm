import { useEffect, useId } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/lib/stores/authStore';
import { queryKeys } from '@/lib/queryKeys';

export function useNotificationsRealtime() {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  // A unique suffix per hook instance avoids the "cannot add postgres_changes
  // callbacks after subscribe()" error when multiple consumers (e.g. the
  // NotificationsBell and the NotificationsColumn) mount at the same time and
  // would otherwise share the same channel name in the Supabase client.
  const instanceId = useId();
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`notifications-${userId}-${instanceId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        () => {
          void qc.invalidateQueries({ queryKey: queryKeys.notifications() });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc, userId, instanceId]);
}
