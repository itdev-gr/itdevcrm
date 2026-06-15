import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export function useUpdateJobDetails(jobId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (details: Record<string, string>) => {
      const { error } = await supabase.from('jobs').update({ details } as never).eq('id', jobId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.job(jobId) }),
  });
}
