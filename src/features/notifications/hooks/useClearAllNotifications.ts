import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { captureMutation } from '@/lib/sentry/captureMutation';

/** "Clear all" — permanently remove all of the caller's notifications. */
export function useClearAllNotifications() {
  const qc = useQueryClient();
  return useMutation<void, Error, void>({
    mutationFn: captureMutation<void, void>('notifications', 'clear_all', async () => {
      // RLS restricts the delete to the caller's own rows; the filter just
      // satisfies PostgREST's "delete needs a WHERE" guard (id is never null).
      const { error } = await supabase.from('notifications').delete().not('id', 'is', null);
      if (error) throw new Error(error.message);
    }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.notifications() }),
  });
}
