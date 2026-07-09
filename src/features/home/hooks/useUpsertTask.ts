import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { captureMutation } from '@/lib/sentry/captureMutation';
import type { ImportanceCode } from '@/features/tasks/importance';

type Input = {
  id?: string;
  /** Assignee — whose calendar the task lands on. */
  user_id: string;
  /** Who created the task; required when assigning to someone else (RLS). */
  created_by?: string | null;
  title: string;
  notes: string | null;
  due_at: string; // ISO
  importance: ImportanceCode;
  completed_at?: string | null;
  client_id?: string | null;
  lead_id?: string | null;
};

export function useUpsertTask() {
  const qc = useQueryClient();
  return useMutation<string, Error, Input>({
    mutationFn: captureMutation<Input, string>(
      'user_tasks',
      'upsert',
      async (input) => {
        const payload = {
          user_id: input.user_id,
          title: input.title.trim(),
          notes: input.notes,
          due_at: input.due_at,
          importance: input.importance,
          completed_at: input.completed_at ?? null,
          ...(input.created_by !== undefined ? { created_by: input.created_by } : {}),
          ...(input.client_id !== undefined ? { client_id: input.client_id } : {}),
          ...(input.lead_id !== undefined ? { lead_id: input.lead_id } : {}),
        };
        if (input.id) {
          const { data, error } = await supabase
            .from('user_tasks')
            .update(payload)
            .eq('id', input.id)
            .select('id')
            .single();
          if (error || !data) throw new Error(error?.message ?? 'update failed');
          return data.id;
        }
        const { data, error } = await supabase
          .from('user_tasks')
          .insert(payload)
          .select('id')
          .single();
        if (error || !data) throw new Error(error?.message ?? 'insert failed');
        return data.id;
      },
    ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['user-tasks'] });
      void qc.invalidateQueries({ queryKey: ['client-tasks'] });
      void qc.invalidateQueries({ queryKey: ['lead-tasks'] });
      void qc.invalidateQueries({ queryKey: ['comments'] });
    },
  });
}
