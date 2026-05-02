import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { Action, Board, Scope } from '@/lib/permissions';

export type GroupPermissionRow = {
  id: string;
  group_id: string;
  board: Board;
  action: Action;
  scope: Scope;
  allowed: boolean;
};

export function useGroupPermissions(groupId: string) {
  return useQuery({
    queryKey: queryKeys.groupPermissions(groupId),
    queryFn: async (): Promise<GroupPermissionRow[]> => {
      const { data, error } = await supabase
        .from('group_permissions')
        .select('id, group_id, board, action, scope, allowed')
        .eq('group_id', groupId);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as GroupPermissionRow[];
    },
    enabled: !!groupId,
  });
}
