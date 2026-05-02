import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { useAuthStore } from '@/lib/stores/authStore';

export function useArchiveLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) => {
      const userId = useAuthStore.getState().user?.id ?? null;
      const { error } = await supabase
        .from('leads')
        .update({
          archived: true,
          archived_at: new Date().toISOString(),
          archived_by: userId,
          archived_reason: reason ?? null,
        })
        .eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.leads() });
    },
  });
}
