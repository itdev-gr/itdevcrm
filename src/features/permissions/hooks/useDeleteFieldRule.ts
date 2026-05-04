import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { captureMutation } from '@/lib/sentry/captureMutation';

export function useDeleteFieldRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: captureMutation('permissions', 'delete', async (id: string) => {
      const { error } = await supabase.from('field_permissions').delete().eq('id', id);
      if (error) throw new Error(error.message);
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.fieldPermissions() });
    },
  });
}
