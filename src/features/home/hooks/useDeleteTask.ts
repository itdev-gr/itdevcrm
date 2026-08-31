import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { captureMutation } from '@/lib/sentry/captureMutation';

export function useDeleteTask() {
  const qc = useQueryClient();
  const { t } = useTranslation('sales');
  return useMutation<void, Error, string>({
    mutationFn: captureMutation<string, void>(
      'user_tasks',
      'delete',
      async (id) => {
        // .select('id') so an RLS-blocked delete returns zero rows (no error) —
        // surface that as a failure instead of a silent no-op.
        const { data, error } = await supabase
          .from('user_tasks')
          .delete()
          .eq('id', id)
          .select('id');
        if (error) {
          throw new Error(
            error.message.includes('cadence_task_delete_blocked')
              ? t('ud.cadence.errors.cadence_task_delete_blocked')
              : error.message,
          );
        }
        if (!data || data.length === 0) throw new Error('Task was not deleted (no permission).');
      },
    ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['user-tasks'] });
      void qc.invalidateQueries({ queryKey: ['client-tasks'] });
      void qc.invalidateQueries({ queryKey: ['lead-tasks'] });
    },
  });
}

export function useToggleTaskComplete() {
  const qc = useQueryClient();
  return useMutation<void, Error, { id: string; completed: boolean }>({
    mutationFn: captureMutation<{ id: string; completed: boolean }, void>(
      'user_tasks',
      'toggle_complete',
      async ({ id, completed }) => {
        if (completed) {
          // Resolving stamps the caller's side via the RPC — a direct terminal
          // update is blocked by the DB guard. The task closes only once both
          // parties have stamped (or a single party for self/personal tasks).
          const { error } = await supabase.rpc('resolve_task' as never, {
            p_kind: 'user',
            p_task_id: id,
          } as never);
          if (error) throw new Error(error.message);
          return;
        }
        // Reopen (resolved→open) stays a direct update — the guard allows it.
        const { error } = await supabase
          .from('user_tasks')
          .update({ completed_at: null })
          .eq('id', id);
        if (error) throw new Error(error.message);
      },
    ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['user-tasks'] });
      void qc.invalidateQueries({ queryKey: ['client-tasks'] });
      void qc.invalidateQueries({ queryKey: ['lead-tasks'] });
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      void qc.invalidateQueries({ queryKey: ['comments'] });
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}
