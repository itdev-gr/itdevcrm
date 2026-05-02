import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { Action, Board, Scope } from '@/lib/permissions';

export type EffectivePermissionRow = {
  user_id: string;
  board: Board;
  action: Action;
  allowed: boolean;
  scope: Scope | null;
};

export function useUserEffectivePermissions(userId: string) {
  return useQuery({
    queryKey: queryKeys.effectivePermissions(userId),
    queryFn: async (): Promise<EffectivePermissionRow[]> => {
      const { data, error } = await supabase
        .from('user_effective_permissions')
        .select('user_id, board, action, allowed, scope')
        .eq('user_id', userId);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as EffectivePermissionRow[];
    },
    enabled: !!userId,
  });
}
