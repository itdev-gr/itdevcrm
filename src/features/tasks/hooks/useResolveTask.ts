import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export type TaskKind = 'user' | 'assigned';

/** Shape of the jsonb returned by the `resolve_task` RPC. `closed:false` means
 *  the caller's side was stamped but the task still awaits the other party. */
export type ResolveTaskResult = {
  closed: boolean;
  your_side: 'creator' | 'assignee' | 'both';
  awaiting: string | null; // uuid of the party still pending, or null when closed
};

type Vars = { kind: TaskKind; id: string };

/** Every query surface a resolve/unresolve can shift. Mirrors the keys
 *  invalidated by useResolveAssignedTask (['assigned-tasks'], ['client-tasks'],
 *  ['comments']) plus the wider board/detail/notification set. */
function invalidateTaskQueries(qc: QueryClient): void {
  const keys: readonly string[][] = [
    ['tasks'],
    ['user-tasks'],
    ['assigned-tasks'],
    ['assigned-task'],
    ['client-tasks'],
    ['client-user-tasks'],
    ['lead-tasks'],
    ['comments'],
    ['notifications'],
  ];
  for (const queryKey of keys) {
    void qc.invalidateQueries({ queryKey });
  }
}

/**
 * Stamp the current user's side of a task via the `resolve_task` RPC. Surfaces
 * the RPC's `{ closed, your_side, awaiting }` jsonb as the mutation result so
 * callers can toast differently when `closed` is false (task still awaiting the
 * other party) versus true (task fully closed).
 */
export function useResolveTask() {
  const qc = useQueryClient();
  return useMutation<ResolveTaskResult, Error, Vars>({
    mutationFn: async ({ kind, id }) => {
      const { data, error } = await supabase.rpc('resolve_task' as never, {
        p_kind: kind,
        p_task_id: id,
      } as never);
      if (error) throw new Error(error.message);
      return data as ResolveTaskResult;
    },
    onSuccess: () => invalidateTaskQueries(qc),
  });
}

/** Withdraw the current user's resolve stamp via the `unresolve_task` RPC. */
export function useUnresolveTask() {
  const qc = useQueryClient();
  return useMutation<void, Error, Vars>({
    mutationFn: async ({ kind, id }) => {
      const { error } = await supabase.rpc('unresolve_task' as never, {
        p_kind: kind,
        p_task_id: id,
      } as never);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => invalidateTaskQueries(qc),
  });
}
