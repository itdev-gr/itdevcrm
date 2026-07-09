import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { captureMutation } from '@/lib/sentry/captureMutation';

export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: captureMutation<string, void>(
      'user_tasks',
      'delete',
      async (id) => {
        const { error } = await supabase.from('user_tasks').delete().eq('id', id);
        if (error) throw new Error(error.message);
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
        const { error } = await supabase
          .from('user_tasks')
          .update({ completed_at: completed ? new Date().toISOString() : null })
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
    },
  });
}
