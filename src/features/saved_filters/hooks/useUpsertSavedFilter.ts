import { useMutation, useQueryClient, type DefaultError } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { useAuthStore } from '@/lib/stores/authStore';
import type { Json } from '@/types/supabase';
import { captureMutation } from '@/lib/sentry/captureMutation';

type Vars = {
  id?: string;
  board: string;
  name: string;
  filter_json: Record<string, unknown>;
};

export function useUpsertSavedFilter() {
  const qc = useQueryClient();
  return useMutation<void, DefaultError, Vars>({
    mutationFn: captureMutation('saved_filters', 'upsert', async (vars: Vars) => {
      const userId = useAuthStore.getState().user?.id;
      if (!userId) throw new Error('not_authenticated');
      const filterJson = vars.filter_json as Json;
      if (vars.id) {
        const { error } = await supabase
          .from('saved_filters')
          .update({ board: vars.board, name: vars.name, filter_json: filterJson })
          .eq('id', vars.id);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase.from('saved_filters').insert({
          board: vars.board,
          name: vars.name,
          filter_json: filterJson,
          user_id: userId,
        });
        if (error) throw new Error(error.message);
      }
    }),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: queryKeys.savedFilters(vars.board) });
    },
  });
}
