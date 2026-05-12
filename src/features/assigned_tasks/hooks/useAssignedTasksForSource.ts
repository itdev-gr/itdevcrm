import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { AssignedTaskRow } from './useAssignedTasksOpen';

const SELECT = `
  id, title, description,
  deal_id, job_id, client_id, source_code,
  assignee_user_id, created_by_user_id,
  status, resolved_at, resolved_by_user_id, created_at,
  client:client_id ( id, name )
`;

export function useAssignedTasksForSource(source: { kind: 'deal' | 'job'; id: string }) {
  const column = source.kind === 'deal' ? 'deal_id' : 'job_id';
  const key =
    source.kind === 'deal'
      ? queryKeys.assignedTasksForDeal(source.id)
      : queryKeys.assignedTasksForJob(source.id);

  return useQuery<AssignedTaskRow[]>({
    queryKey: key,
    enabled: !!source.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('assigned_tasks')
        .select(SELECT)
        .eq(column, source.id)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as AssignedTaskRow[];
    },
  });
}
