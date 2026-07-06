import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { captureMutation } from '@/lib/sentry/captureMutation';

/** Bulk mark-read. Invalidates the ['notifications'] prefix so the bell,
 *  the notifications column and the task-card badge refresh together. */
export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: captureMutation('notifications', 'mark_read_bulk', async (ids: string[]) => {
      if (ids.length === 0) return;
      const { error } = await supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .in('id', ids);
      if (error) throw new Error(error.message);
    }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.notifications() }),
  });
}
