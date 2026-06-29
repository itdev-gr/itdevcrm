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
    code?: string | null;
    contact_first_name: string | null;
    contact_last_name: string | null;
    industry: string | null;
    email?: string | null;
    phone?: string | null;
    phone_normalized?: string | null;
    website?: string | null;
    contact_info?: string | null;
    additional_contacts?:
      | { full_name?: string | null; email?: string | null; phone?: string | null; info?: string | null }[]
      | null;
  } | null;
  deal?: { id: string; code: string | null; title: string | null } | null;
  stage?: { id: string; code: string; board: string; display_names: unknown } | null;
  details?: Record<string, unknown> | null;
  parent_job_id: string | null;
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
          '*, parent_job_id, client:clients(id, code, name, contact_first_name, contact_last_name, email, phone, phone_normalized, website, industry), deal:deals(id, code, title), stage:pipeline_stages!jobs_stage_id_fkey(id, code, board, display_names)',
        )
        .in('service_type', serviceTypesForBoard(serviceType))
        .eq('archived', false)
        // Stable, fixed order so cards never reshuffle when a job is opened or
        // edited (newest-created on top, id as a deterministic tie-breaker).
        // The board's visible order is finalised in groupJobsForBoard.
        .order('created_at', { ascending: false })
        .order('id', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as JobRow[];
    },
  });
}
