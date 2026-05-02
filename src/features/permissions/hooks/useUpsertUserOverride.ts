import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { Action, Board, Scope } from '@/lib/permissions';

type Vars = {
  userId: string;
  board: Board;
  action: Action;
  allowed: boolean;
  scope: Scope;
};

export function useUpsertUserOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, board, action, allowed, scope }: Vars) => {
      const { error } = await supabase
        .from('user_permissions')
        .upsert(
          { user_id: userId, board, action, allowed, scope },
          { onConflict: 'user_id,board,action' },
        );
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: queryKeys.userOverrides(vars.userId) });
      void qc.invalidateQueries({ queryKey: queryKeys.effectivePermissions(vars.userId) });
    },
  });
}
