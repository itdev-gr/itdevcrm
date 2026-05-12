import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export type CreateAssignedTaskInput = {
  source: { kind: 'deal' | 'job'; id: string };
  title: string;
  description: string | null;
  assigneeUserId: string;
};

export function useCreateAssignedTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateAssignedTaskInput): Promise<string> => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in');
      const { data, error } = await supabase
        .from('assigned_tasks')
        .insert({
          title: input.title,
          description: input.description,
          deal_id: input.source.kind === 'deal' ? input.source.id : null,
          job_id: input.source.kind === 'job' ? input.source.id : null,
          assignee_user_id: input.assigneeUserId,
          created_by_user_id: user.id,
        })
        .select('id')
        .single();
      if (error) throw new Error(error.message);
      return data.id as string;
    },
    onSuccess: (_id, input) => {
      qc.invalidateQueries({ queryKey: ['assigned-tasks'] });
      if (input.source.kind === 'deal') {
        qc.invalidateQueries({ queryKey: queryKeys.assignedTasksForDeal(input.source.id) });
      } else {
        qc.invalidateQueries({ queryKey: queryKeys.assignedTasksForJob(input.source.id) });
      }
    },
  });
}
