import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { captureMutation } from '@/lib/sentry/captureMutation';
import type { Database } from '@/types/supabase';
import type { TaskCard, DragAction } from '../taskCard';

type Vars = { card: TaskCard; action: DragAction };
type UserUpdate = Database['public']['Tables']['user_tasks']['Update'];
type AssignedUpdate = Database['public']['Tables']['assigned_tasks']['Update'];

/** Apply a drag/button action to the underlying table. The decision lives in
 *  resolveDrag (pure); this only executes the resulting patch. Each table is
 *  updated in its own branch so the patch keeps that table's Update type
 *  (a cross-table union breaks under exactOptionalPropertyTypes). */
export function useTaskBoardActions() {
  const qc = useQueryClient();
  return useMutation<void, Error, Vars>({
    mutationFn: captureMutation<Vars, void>('task_board', 'apply', async ({ card, action }) => {
      if (action.type === 'noop') return;
      if (card.kind === 'user') {
        const patch: UserUpdate =
          action.type === 'set-importance'
            ? { importance: action.importance }
            : action.type === 'resolve'
              ? { completed_at: new Date().toISOString() }
              : { completed_at: null, importance: action.importance };
        const { error } = await supabase.from('user_tasks').update(patch).eq('id', card.id);
        if (error) throw new Error(error.message);
      } else {
        const patch: AssignedUpdate =
          action.type === 'set-importance'
            ? { importance: action.importance }
            : action.type === 'resolve'
              ? { status: 'resolved' }
              : { status: 'open', importance: action.importance };
        const { error } = await supabase.from('assigned_tasks').update(patch).eq('id', card.id);
        if (error) throw new Error(error.message);
      }
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['user-tasks'] });
      void qc.invalidateQueries({ queryKey: ['assigned-tasks'] });
      void qc.invalidateQueries({ queryKey: ['tasks'] }); // archive
    },
  });
}
