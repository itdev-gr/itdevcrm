import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { GmailSyncHealth } from './gmailSyncHealth';

// Polls the Gmail sweep health RPC. Never throws — the RPC may not exist yet
// (migration applied later), so any error resolves to null and no banner renders.
export function useGmailSyncHealth(enabled: boolean) {
  return useQuery({
    queryKey: ['gmail-sync-health'] as const,
    enabled,
    queryFn: async (): Promise<GmailSyncHealth | null> => {
      const { data, error } = await supabase.rpc('gmail_sync_health' as never);
      if (error) return null;
      return (data ?? null) as GmailSyncHealth | null;
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}
