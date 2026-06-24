import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useDealJobs } from './useDealJobs';
import { SERVICE_AREA_KINDS } from '@/features/attachments/serviceAreas';
import type { AttachmentRow } from '@/features/attachments/hooks/useAttachments';

export function useDealServiceAttachments(dealId: string) {
  const { data: jobs = [] } = useDealJobs(dealId);
  const jobIds = jobs.map((j) => j.id);
  return useQuery<AttachmentRow[]>({
    queryKey: ['deal-service-attachments', dealId, jobIds.join(',')],
    enabled: jobIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('attachments')
        .select('*')
        .eq('parent_type', 'job')
        .in('parent_id', jobIds)
        .in('kind', SERVICE_AREA_KINDS)
        .eq('archived', false)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as AttachmentRow[];
    },
  });
}
