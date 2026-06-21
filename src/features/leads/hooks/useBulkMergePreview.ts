import { useQuery } from '@tanstack/react-query';
import { bulkMergeIntakePreview } from '@/lib/rpc';

export function useBulkMergePreview() {
  return useQuery({
    queryKey: ['lead_intake', 'bulk_preview'],
    queryFn: async (): Promise<{ mergeable: number; dead_end: number }> => {
      const r = await bulkMergeIntakePreview();
      if (!r.ok) throw new Error(r.errors.join(', '));
      return { mergeable: r.mergeable, dead_end: r.dead_end };
    },
  });
}
