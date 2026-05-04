import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { captureMutation } from '@/lib/sentry/captureMutation';

export function useArchiveSubpackage(parentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: captureMutation('service_packages', 'archive_subpackage', async ({ id, archived }: { id: string; archived: boolean }) => {
      const { error } = await supabase
        .from('service_subpackages')
        .update({ archived })
        .eq('id', id);
      if (error) throw new Error(error.message);
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.serviceSubpackages(parentId) });
    },
  });
}
