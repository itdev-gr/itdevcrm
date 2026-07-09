import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { ImportanceCode } from '@/features/tasks/importance';

export type CreateAssignedTaskInput = {
  source: { kind: 'deal' | 'job'; id: string };
  title: string;
  description: string | null;
  assigneeUserId: string;
  departmentId: string;
  importance: ImportanceCode;
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
        // client_id + source_code are filled by the
        // assigned_tasks_populate_source BEFORE INSERT trigger from
        // deal_id/job_id, so the caller never supplies them. The generated
        // supabase types still mark them NOT NULL — hence the cast.
        .insert({
          title: input.title,
          description: input.description,
          deal_id: input.source.kind === 'deal' ? input.source.id : null,
          job_id: input.source.kind === 'job' ? input.source.id : null,
          assignee_user_id: input.assigneeUserId,
          created_by_user_id: user.id,
          department_group_id: input.departmentId,
          importance: input.importance,
        } as never)
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
      qc.invalidateQueries({ queryKey: ['comments'] });
    },
  });
}
