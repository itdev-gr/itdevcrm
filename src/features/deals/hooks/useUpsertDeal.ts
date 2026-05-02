import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { Database } from '@/types/supabase';

export type DealUpsert = Partial<Database['public']['Tables']['deals']['Insert']> & {
  id?: string;
  client_id: string;
  title: string;
  stage_id: string;
};

export function useUpsertDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: DealUpsert) => {
      if (vars.id) {
        const { id, ...patch } = vars;
        const { error } = await supabase.from('deals').update(patch).eq('id', id);
        if (error) throw new Error(error.message);
        return id;
      }
      const { data, error } = await supabase.from('deals').insert(vars).select('id').single();
      if (error || !data) throw new Error(error?.message ?? 'Insert failed');
      return data.id;
    },
    onSuccess: (id) => {
      void qc.invalidateQueries({ queryKey: queryKeys.deals() });
      void qc.invalidateQueries({ queryKey: queryKeys.deal(id) });
    },
  });
}
