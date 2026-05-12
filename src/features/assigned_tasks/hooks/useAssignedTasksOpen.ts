import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export type AssignedTaskRow = {
  id: string;
  title: string;
  description: string | null;
  deal_id: string | null;
  job_id: string | null;
  client_id: string;
  source_code: string | null;
  assignee_user_id: string;
  created_by_user_id: string;
  status: 'open' | 'resolved';
  resolved_at: string | null;
  resolved_by_user_id: string | null;
  created_at: string;
  client: { id: string; name: string } | null;
};

const SELECT = `
  id, title, description,
  deal_id, job_id, client_id, source_code,
  assignee_user_id, created_by_user_id,
  status, resolved_at, resolved_by_user_id, created_at,
  client:client_id ( id, name )
`;

export function useAssignedTasksOpen(params: { assigneeUserId: string | null }) {
  const { assigneeUserId } = params;
  return useQuery<AssignedTaskRow[]>({
    queryKey: queryKeys.assignedTasksOpen(assigneeUserId),
    queryFn: async () => {
      let q = supabase
        .from('assigned_tasks')
        .select(SELECT)
        .eq('status', 'open');
      if (assigneeUserId) q = q.eq('assignee_user_id', assigneeUserId);
      const { data, error } = await q.order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as AssignedTaskRow[];
    },
  });
}
