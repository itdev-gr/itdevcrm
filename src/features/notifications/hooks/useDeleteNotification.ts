import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { captureMutation } from '@/lib/sentry/captureMutation';

/** Permanently remove a single notification (the X button in the column). */
export function useDeleteNotification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: captureMutation('notifications', 'delete', async (id: string) => {
      const { error } = await supabase.from('notifications').delete().eq('id', id);
      if (error) throw new Error(error.message);
    }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.notifications() }),
  });
}
