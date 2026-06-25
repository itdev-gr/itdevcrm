import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { captureMutation } from '@/lib/sentry/captureMutation';

type Vars = { kind: 'user' | 'assigned'; id: string };

/** Mark a task started (assignee only, enforced in UI). The `.is('started_at', null)`
 *  guard makes the write idempotent so a double-click can't re-stamp/re-notify. */
export function useStartTask() {
  const qc = useQueryClient();
  return useMutation<void, Error, Vars>({
    mutationFn: captureMutation<Vars, void>('task', 'start', async ({ kind, id }) => {
      const startedAt = new Date().toISOString();
      if (kind === 'user') {
        const { error } = await supabase
          .from('user_tasks').update({ started_at: startedAt }).eq('id', id).is('started_at', null);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase
          .from('assigned_tasks').update({ started_at: startedAt }).eq('id', id).is('started_at', null);
        if (error) throw new Error(error.message);
      }
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['user-tasks'] });
      void qc.invalidateQueries({ queryKey: ['assigned-tasks'] });
      void qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}
