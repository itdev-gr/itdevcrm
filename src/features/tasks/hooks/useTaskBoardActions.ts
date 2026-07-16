import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { captureMutation } from '@/lib/sentry/captureMutation';
import type { Database } from '@/types/supabase';
import type { TaskCard, DragAction } from '../taskCard';
import type { ResolveTaskResult } from './useResolveTask';

type Vars = { card: TaskCard; action: DragAction };
type Result = ResolveTaskResult | null;
type UserUpdate = Database['public']['Tables']['user_tasks']['Update'];
type AssignedUpdate = Database['public']['Tables']['assigned_tasks']['Update'];

/** Apply a drag/button action to the underlying table. The decision lives in
 *  resolveDrag (pure); this only executes the resulting patch.
 *
 *  RESOLVE goes through the `resolve_task` RPC (a direct terminal update is now
 *  blocked by the DB guard, and the RPC stamps the caller's side — the task
 *  only closes once both parties have). The mutation surfaces the RPC's
 *  `{ closed, … }` jsonb so the board can toast when a stamp doesn't yet close
 *  the task. Set-importance and reopen stay direct per-table updates (each in
 *  its own branch so the patch keeps that table's Update type — a cross-table
 *  union breaks under exactOptionalPropertyTypes). */
export function useTaskBoardActions() {
  const qc = useQueryClient();
  return useMutation<Result, Error, Vars>({
    mutationFn: captureMutation<Vars, Result>('task_board', 'apply', async ({ card, action }) => {
      if (action.type === 'noop') return null;
      if (action.type === 'resolve') {
        const { data, error } = await supabase.rpc('resolve_task' as never, {
          p_kind: card.kind,
          p_task_id: card.id,
        } as never);
        if (error) throw new Error(error.message);
        return data as ResolveTaskResult;
      }
      if (card.kind === 'user') {
        const patch: UserUpdate =
          action.type === 'set-importance'
            ? { importance: action.importance }
            : { completed_at: null, importance: action.importance };
        const { error } = await supabase.from('user_tasks').update(patch).eq('id', card.id);
        if (error) throw new Error(error.message);
      } else {
        const patch: AssignedUpdate =
          action.type === 'set-importance'
            ? { importance: action.importance }
            : { status: 'open', importance: action.importance };
        const { error } = await supabase.from('assigned_tasks').update(patch).eq('id', card.id);
        if (error) throw new Error(error.message);
      }
      return null;
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['user-tasks'] });
      void qc.invalidateQueries({ queryKey: ['assigned-tasks'] });
      void qc.invalidateQueries({ queryKey: ['tasks'] }); // archive
      void qc.invalidateQueries({ queryKey: ['comments'] });
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}
