import { useMutation, useQueryClient, type DefaultError } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { captureMutation } from '@/lib/sentry/captureMutation';

type Patch = {
  title?: string;
  body?: string;
  status?: 'draft' | 'sent' | 'signed' | 'declined';
  sent_at?: string | null;
};

export function useUpdateContract() {
  const qc = useQueryClient();
  return useMutation<void, DefaultError, { id: string; patch: Patch }>({
    mutationFn: captureMutation('contracts', 'update', async ({ id, patch }) => {
      const { error } = await supabase.from('contracts').update(patch).eq('id', id);
      if (error) throw new Error(error.message);
    }),
    // All contract keys share the ['contracts'] root — one invalidation covers
    // the list, the client tab, and the detail view.
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.contracts }),
  });
}
