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
      // RLS lets view-only staff match 0 rows without an error — verify a row
      // was actually updated so Save can't silently no-op.
      const { data, error } = await supabase
        .from('contracts')
        .update(patch)
        .eq('id', id)
        .select('id');
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) {
        throw new Error('Update failed — no permission to edit contracts?');
      }
    }),
    // All contract keys share the ['contracts'] root — one invalidation covers
    // the list, the client tab, and the detail view. Returning the promise makes
    // mutateAsync await the refetch, so callers never see the stale cached row.
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.contracts }),
  });
}
