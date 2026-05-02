import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { useAuthStore } from '@/lib/stores/authStore';
import type { Database } from '@/types/supabase';

type LeadInsert = Database['public']['Tables']['leads']['Insert'];

export function useCreateLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: Omit<LeadInsert, 'created_by' | 'owner_user_id'> & { owner_user_id?: string },
    ): Promise<string> => {
      const userId = useAuthStore.getState().user?.id ?? null;
      const ownerUserId = input.owner_user_id ?? userId ?? undefined;
      const { data, error } = await supabase
        .from('leads')
        .insert({
          ...input,
          created_by: userId,
          ...(ownerUserId !== undefined ? { owner_user_id: ownerUserId } : {}),
        })
        .select('id')
        .single();
      if (error || !data) throw new Error(error?.message ?? 'create_failed');
      return data.id;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.leads() });
    },
  });
}
