import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { serviceTypesForBoard, type JobRow, type ServiceType } from './useJobs';

// Ίδιο select με το useJobs, αλλά ΜΟΝΟ τα αρχειοθετημένα. Ξεχωριστό query key
// ώστε η κανονική λίστα του board να μη μεγαλώνει και να μην ξαναφορτώνεται
// όταν αλλάζει κάτι στα αρχειοθετημένα.
const ARCHIVED_COLS =
  '*, parent_job_id, client:clients(id, code, name, contact_first_name, contact_last_name, email, phone, phone_normalized, website, industry), deal:deals(id, code, title), stage:pipeline_stages!jobs_stage_id_fkey(id, code, board, display_names)';

export function useArchivedJobs(serviceType: ServiceType, enabled: boolean): { jobs: JobRow[] } {
  const query = useQuery({
    queryKey: queryKeys.archivedJobsByService(serviceType),
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<JobRow[]> => {
      const { data, error } = await supabase
        .from('jobs')
        .select(ARCHIVED_COLS)
        // Same board-scoped set as the live query (useJobs.ts): ai_seo work
        // cards cascade-archived from a Web/Local SEO parent must land in
        // that board's Archived column too, not just under their own
        // (nonexistent) ai_seo board.
        .in('service_type', serviceTypesForBoard(serviceType))
        .eq('archived', true)
        .order('archived_at', { ascending: false, nullsFirst: false })
        .limit(200);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as JobRow[];
    },
  });
  return { jobs: query.data ?? [] };
}
