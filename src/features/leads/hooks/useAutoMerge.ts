import { useMutation, useQuery, useQueryClient, type DefaultError } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

const KEY = ['lead-auto-merge'] as const;

type FromAny = (table: string) => {
  select: (cols: string) => {
    eq: (c: string, v: unknown) => {
      single: () => Promise<{
        data: { auto_merge_enabled: boolean } | null;
        error: { message: string } | null;
      }>;
    };
  };
  update: (patch: Record<string, unknown>) => {
    eq: (c: string, v: unknown) => Promise<{ error: { message: string } | null }>;
  };
};
// `.bind(supabase)` is required — see useLeadDistribution.ts for the full why.
const from = supabase.from.bind(supabase) as unknown as FromAny;

export function useAutoMerge() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<{ auto_merge_enabled: boolean }> => {
      const { data, error } = await from('lead_distribution_state')
        .select('auto_merge_enabled')
        .eq('id', true)
        .single();
      if (error) throw new Error(error.message);
      return { auto_merge_enabled: data?.auto_merge_enabled ?? false };
    },
  });
  const setEnabled = useMutation<void, DefaultError, boolean>({
    mutationFn: async (enabled: boolean) => {
      const { error } = await from('lead_distribution_state')
        .update({ auto_merge_enabled: enabled, updated_at: new Date().toISOString() })
        .eq('id', true);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEY });
    },
  });
  return {
    autoEnabled: query.data?.auto_merge_enabled ?? false,
    isLoading: query.isLoading,
    setEnabled,
  };
}
