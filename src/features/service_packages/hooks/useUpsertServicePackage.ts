import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { Database } from '@/types/supabase';

type Insert = Database['public']['Tables']['service_packages']['Insert'];
type Update = Database['public']['Tables']['service_packages']['Update'];

export function useUpsertServicePackage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id?: string } & (Insert | Update)): Promise<string> => {
      if (input.id) {
        const { id, ...patch } = input;
        const { error } = await supabase
          .from('service_packages')
          .update(patch as Update)
          .eq('id', id);
        if (error) throw new Error(error.message);
        return id;
      }
      const { data, error } = await supabase
        .from('service_packages')
        .insert(input as Insert)
        .select('id')
        .single();
      if (error || !data) throw new Error(error?.message ?? 'insert_failed');
      return data.id;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.servicePackages() });
    },
  });
}
