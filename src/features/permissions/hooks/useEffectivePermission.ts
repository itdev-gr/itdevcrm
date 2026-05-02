import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/lib/stores/authStore';
import {
  currentUserCan,
  currentUserScope,
  type Action,
  type Board,
  type Scope,
} from '@/lib/permissions';

type PermissionResult = { allowed: boolean; scope: Scope | null; isLoading: boolean };

export function useEffectivePermission(board: Board, action: Action): PermissionResult {
  const userId = useAuthStore((s) => s.user?.id ?? null);

  const allowedQuery = useQuery({
    queryKey: ['can', userId, board, action] as const,
    queryFn: () => currentUserCan(board, action),
    enabled: !!userId,
    staleTime: 60_000,
  });

  const scopeQuery = useQuery({
    queryKey: ['scope', userId, board, action] as const,
    queryFn: () => currentUserScope(board, action),
    enabled: !!userId && allowedQuery.data === true,
    staleTime: 60_000,
  });

  return {
    allowed: allowedQuery.data === true,
    scope: scopeQuery.data ?? null,
    isLoading: allowedQuery.isLoading || (allowedQuery.data === true && scopeQuery.isLoading),
  };
}
