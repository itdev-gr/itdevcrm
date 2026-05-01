import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

type Vars = { userId: string; groupIds: string[] };

export function useUpdateUserGroups() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, groupIds }: Vars) => {
      const { data: current, error: e1 } = await supabase
        .from('user_groups')
        .select('group_id')
        .eq('user_id', userId);
      if (e1) throw new Error(e1.message);
      const currentSet = new Set((current ?? []).map((r) => r.group_id));
      const targetSet = new Set(groupIds);

      const toAdd = [...targetSet].filter((g) => !currentSet.has(g));
      const toRemove = [...currentSet].filter((g) => !targetSet.has(g));

      if (toAdd.length > 0) {
        const { error } = await supabase
          .from('user_groups')
          .insert(toAdd.map((groupId) => ({ user_id: userId, group_id: groupId })));
        if (error) throw new Error(error.message);
      }
      if (toRemove.length > 0) {
        const { error } = await supabase
          .from('user_groups')
          .delete()
          .eq('user_id', userId)
          .in('group_id', toRemove);
        if (error) throw new Error(error.message);
      }
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: queryKeys.user(vars.userId) });
      void qc.invalidateQueries({ queryKey: queryKeys.users() });
    },
  });
}
