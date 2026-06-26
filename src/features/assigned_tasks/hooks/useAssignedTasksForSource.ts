import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { AssignedTaskRow, AssignedTaskDepartment } from './useAssignedTasksOpen';

export type { AssignedTaskDepartment };

const SELECT = `
  id, title, description,
  deal_id, job_id, client_id, source_code,
  assignee_user_id, created_by_user_id,
  status, resolved_at, resolved_by_user_id, created_at,
  department_group_id,
  client:client_id ( id, name ),
  department:department_group_id ( id, code, display_names, position )
`;

export function useAssignedTasksForSource(
  source: { kind: 'deal' | 'job'; id: string },
  deptMatch?: { dealId: string; departmentGroupId: string },
) {
  const column = source.kind === 'deal' ? 'deal_id' : 'job_id';
  const baseKey =
    source.kind === 'deal'
      ? queryKeys.assignedTasksForDeal(source.id)
      : queryKeys.assignedTasksForJob(source.id);
  const useUnion = source.kind === 'job' && !!deptMatch;
  const key = useUnion ? [...baseKey, 'dept', deptMatch!.departmentGroupId] : baseKey;

  return useQuery<AssignedTaskRow[]>({
    queryKey: key,
    enabled: !!source.id,
    queryFn: async () => {
      let q = supabase.from('assigned_tasks').select(SELECT);
      if (useUnion) {
        q = q.or(
          `job_id.eq.${source.id},and(deal_id.eq.${deptMatch!.dealId},department_group_id.eq.${deptMatch!.departmentGroupId})`,
        );
      } else {
        q = q.eq(column, source.id);
      }
      const { data, error } = await q.order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as AssignedTaskRow[];
    },
  });
}
