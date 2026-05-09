import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export type MonthlyTask = {
  code: string;
  completed: boolean;
  completed_at: string | null;
  completed_by: string | null;
};

export type MonthlyTaskLabel = {
  code: string;
  label_en: string;
  label_el: string;
};

export type MonthlyTasksData = {
  period: string | null;
  tasks: MonthlyTask[];
  template: MonthlyTaskLabel[];
};

async function fetchData(jobId: string, serviceType: string): Promise<MonthlyTasksData> {
  const { error: rpcError } = await supabase.rpc('ensure_job_monthly_task_period', {
    p_job_id: jobId,
  });
  if (rpcError) throw new Error(rpcError.message);

  const [{ data: job, error: jobError }, { data: tpl, error: tplError }] = await Promise.all([
    supabase
      .from('jobs')
      .select('monthly_tasks, monthly_tasks_period')
      .eq('id', jobId)
      .single(),
    supabase
      .from('service_monthly_task_templates')
      .select('tasks')
      .eq('service_type', serviceType)
      .maybeSingle(),
  ]);

  if (jobError || !job) throw new Error(jobError?.message ?? 'job not found');
  if (tplError) throw new Error(tplError.message);

  return {
    period: job.monthly_tasks_period ?? null,
    tasks: (job.monthly_tasks as unknown as MonthlyTask[]) ?? [],
    template: (tpl?.tasks as unknown as MonthlyTaskLabel[]) ?? [],
  };
}

export function useJobMonthlyTasks(jobId: string, serviceType: string) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.jobMonthlyTasks(jobId),
    queryFn: () => fetchData(jobId, serviceType),
    enabled: !!jobId && !!serviceType,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!jobId) return;
    const channel = supabase
      .channel(`job-monthly-tasks-${jobId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'jobs', filter: `id=eq.${jobId}` },
        () => {
          void qc.invalidateQueries({ queryKey: queryKeys.jobMonthlyTasks(jobId) });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [jobId, qc]);

  return query;
}
