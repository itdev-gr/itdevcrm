import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { Action, Board, Scope } from '@/lib/permissions';

export type UserOverrideRow = {
  id: string;
  user_id: string;
  board: Board;
  action: Action;
  scope: Scope;
  allowed: boolean;
};

export function useUserOverrides(userId: string) {
  return useQuery({
    queryKey: queryKeys.userOverrides(userId),
    queryFn: async (): Promise<UserOverrideRow[]> => {
      const { data, error } = await supabase
        .from('user_permissions')
        .select('id, user_id, board, action, scope, allowed')
        .eq('user_id', userId);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as UserOverrideRow[];
    },
    enabled: !!userId,
  });
}
