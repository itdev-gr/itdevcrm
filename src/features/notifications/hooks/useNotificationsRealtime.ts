import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/lib/stores/authStore';
import { queryKeys } from '@/lib/queryKeys';

export function useNotificationsRealtime() {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`notifications-${userId}`)
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
  }, [qc, userId]);
}
