import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { captureMutation } from '@/lib/sentry/captureMutation';

type Input = {
  id?: string;
  user_id: string;
  title: string;
  notes: string | null;
  due_at: string; // ISO
  completed_at?: string | null;
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
          completed_at: input.completed_at ?? null,
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
    },
  });
}
