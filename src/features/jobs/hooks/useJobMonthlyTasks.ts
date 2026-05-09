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
  // Casts to `never` keep the call sites clean until `npm run types:gen` runs
  // after the schema migration lands.
  const { error: rpcError } = await supabase.rpc(
    'ensure_job_monthly_task_period' as never,
    { p_job_id: jobId } as never,
  );
  if (rpcError) throw new Error((rpcError as { message: string }).message);

  const [{ data: job, error: jobError }, tplResult] = await Promise.all([
    supabase
      .from('jobs')
      .select('monthly_tasks, monthly_tasks_period')
      .eq('id', jobId)
      .single(),
    supabase
      .from('service_monthly_task_templates' as never)
      .select('tasks')
      .eq('service_type', serviceType)
      .maybeSingle(),
  ]);

  if (jobError || !job) throw new Error(jobError?.message ?? 'job not found');
  const tplErr = (tplResult as { error: { message: string } | null }).error;
  if (tplErr) throw new Error(tplErr.message);
  const tplData = (tplResult as { data: { tasks: MonthlyTaskLabel[] } | null }).data;

  return {
    period: job.monthly_tasks_period ?? null,
    tasks: (job.monthly_tasks as unknown as MonthlyTask[]) ?? [],
    template: tplData?.tasks ?? [],
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
