import { useMutation, useQueryClient, type DefaultError } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { Action, Board, Scope } from '@/lib/permissions';
import { captureMutation } from '@/lib/sentry/captureMutation';

type Vars = {
  groupId: string;
  board: Board;
  action: Action;
  allowed: boolean;
  scope: Scope;
};

export function useUpsertGroupPermission() {
  const qc = useQueryClient();
  return useMutation<void, DefaultError, Vars>({
    mutationFn: captureMutation('permissions', 'upsert_group', async ({ groupId, board, action, allowed, scope }: Vars) => {
      const { error } = await supabase
        .from('group_permissions')
        .upsert(
          { group_id: groupId, board, action, allowed, scope },
          { onConflict: 'group_id,board,action' },
        );
      if (error) throw new Error(error.message);
    }),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: queryKeys.groupPermissions(vars.groupId) });
    },
  });
}
