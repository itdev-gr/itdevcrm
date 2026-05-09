import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { Database } from '@/types/supabase';

export type ServiceType = 'web_seo' | 'local_seo' | 'web_dev' | 'social_media' | 'ai_seo' | 'hosting' | 'ads';

type JobBase = Database['public']['Tables']['jobs']['Row'];

export type JobRow = JobBase & {
  client?: {
    id: string;
    name: string;
    contact_first_name: string | null;
    contact_last_name: string | null;
    industry: string | null;
  } | null;
  deal?: { id: string; code: string | null; title: string | null } | null;
  stage?: { id: string; code: string; board: string; display_names: unknown } | null;
};

// Web SEO and Local SEO kanbans also surface ai_seo jobs (AI SEO has no
// dedicated board — see migration 20260509000005). Other service types
// only see their own jobs.
function serviceTypesForBoard(serviceType: ServiceType): ServiceType[] {
  if (serviceType === 'web_seo' || serviceType === 'local_seo') {
    return [serviceType, 'ai_seo'];
  }
  return [serviceType];
}

export function useJobs(serviceType: ServiceType) {
  return useQuery({
    queryKey: queryKeys.jobsByService(serviceType),
    queryFn: async (): Promise<JobRow[]> => {
      const { data, error } = await supabase
        .from('jobs')
        .select(
          '*, client:clients(id, name, contact_first_name, contact_last_name, industry), deal:deals(id, code, title), stage:pipeline_stages!jobs_stage_id_fkey(id, code, board, display_names)',
        )
        .in('service_type', serviceTypesForBoard(serviceType))
        .eq('archived', false)
        .order('updated_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as JobRow[];
    },
  });
}
