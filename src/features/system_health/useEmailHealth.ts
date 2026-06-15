import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { EmailHealth } from './emailHealth';

// Polls the health RPC. Never throws — a monitoring failure must not break the app.
export function useEmailHealth(enabled: boolean) {
  return useQuery({
    queryKey: ['email-health'] as const,
    enabled,
    queryFn: async (): Promise<EmailHealth | null> => {
      const { data, error } = await supabase.rpc('email_pipeline_health' as never);
      if (error) return null;
      return (data ?? null) as EmailHealth | null;
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}
