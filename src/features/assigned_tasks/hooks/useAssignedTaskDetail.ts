import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { AssignedTaskDepartment } from './useAssignedTasksOpen';

export type AssignedTaskClientEssentials = {
  id: string;
  name: string;
  industry: string | null;
  contact_first_name: string | null;
  contact_last_name: string | null;
  email: string | null;
  phone: string | null;
};

export type AssignedTaskCreator = {
  user_id: string;
  full_name: string;
  email: string;
};

export type AssignedTaskDetail = {
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
  importance: string;
  started_at: string | null;
  department_group_id: string;
  client: AssignedTaskClientEssentials | null;
  creator: AssignedTaskCreator | null;
  assignee: AssignedTaskCreator | null;
  department: AssignedTaskDepartment | null;
};

const SELECT = `
  id, title, description,
  deal_id, job_id, client_id, source_code,
  assignee_user_id, created_by_user_id,
  status, resolved_at, resolved_by_user_id, created_at, importance, started_at,
  department_group_id,
  client:client_id (
    id, name, industry,
    contact_first_name, contact_last_name, email, phone
  ),
  creator:created_by_user_id ( user_id, full_name, email ),
  assignee:assignee_user_id ( user_id, full_name, email ),
  department:department_group_id ( id, code, display_names, position )
`;

export function useAssignedTaskDetail(taskId: string | null) {
  return useQuery<AssignedTaskDetail>({
    enabled: !!taskId,
    queryKey: queryKeys.assignedTaskDetail(taskId ?? ''),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('assigned_tasks')
        .select(SELECT)
        .eq('id', taskId!)
        .single();
      if (error) throw new Error(error.message);
      return data as unknown as AssignedTaskDetail;
    },
  });
}
