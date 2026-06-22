import { useQuery } from '@tanstack/react-query';
import { bulkReleaseIntakePreview } from '@/lib/rpc';

export function useBulkReleasePreview() {
  return useQuery({
    queryKey: ['lead_intake', 'bulk_release_preview'],
    queryFn: async (): Promise<{ releasable: number }> => {
      const r = await bulkReleaseIntakePreview();
      if (!r.ok) throw new Error(r.errors.join(', '));
      return { releasable: r.releasable };
    },
  });
}
