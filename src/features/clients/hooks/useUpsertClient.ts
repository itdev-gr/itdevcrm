import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { Database } from '@/types/supabase';

export type ClientUpsert = Partial<Database['public']['Tables']['clients']['Insert']> & {
  id?: string;
  name: string;
};

export function useUpsertClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: ClientUpsert) => {
      if (vars.id) {
        const { id, ...patch } = vars;
        const { error } = await supabase.from('clients').update(patch).eq('id', id);
        if (error) throw new Error(error.message);
        return id;
      } else {
        const { data, error } = await supabase.from('clients').insert(vars).select('id').single();
        if (error || !data) throw new Error(error?.message ?? 'Insert failed');
        return data.id;
      }
    },
    onSuccess: (id) => {
      void qc.invalidateQueries({ queryKey: queryKeys.clients() });
      void qc.invalidateQueries({ queryKey: queryKeys.client(id) });
    },
  });
}
