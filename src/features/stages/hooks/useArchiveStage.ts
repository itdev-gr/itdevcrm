import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { captureMutation } from '@/lib/sentry/captureMutation';

export function useArchiveStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: captureMutation('stages', 'archive', async (id: string) => {
      const { error } = await supabase
        .from('pipeline_stages')
        .update({ archived: true })
        .eq('id', id);
      if (error) throw new Error(error.message);
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.pipelineStages() });
    },
  });
}
