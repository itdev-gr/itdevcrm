import { useEffect, useId } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/lib/stores/authStore';
import { queryKeys } from '@/lib/queryKeys';

export function useAnnouncementsRealtime() {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const instanceId = useId();
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`announcements-${userId}-${instanceId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'announcements' },
        () => {
          void qc.invalidateQueries({ queryKey: queryKeys.myAnnouncements() });
          void qc.invalidateQueries({ queryKey: queryKeys.announcements() });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc, userId, instanceId]);
}
