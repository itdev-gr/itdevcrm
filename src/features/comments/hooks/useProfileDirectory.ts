import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { DirectoryEntry } from '../authorIdentity';

type DirectoryRow = { user_id: string; full_name: string | null; email: string };

/**
 * Staff identity (name + email) for ALL users, via the security-definer
 * `profile_directory` RPC. This bypasses the self-or-admin RLS on `profiles`
 * so every comment author resolves to a name instead of a raw UUID.
 * Returned as a Map keyed by user_id for O(1) lookups.
 */
export function useProfileDirectory() {
  return useQuery({
    queryKey: ['profile-directory'] as const,
    queryFn: async (): Promise<Map<string, DirectoryEntry>> => {
      // Cast mirrors deal_email_statuses: the RPC isn't in the generated types.
      const { data, error } = await supabase.rpc('profile_directory' as never);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as unknown as DirectoryRow[];
      const map = new Map<string, DirectoryEntry>();
      for (const r of rows) map.set(r.user_id, { full_name: r.full_name, email: r.email });
      return map;
    },
    staleTime: 5 * 60_000,
  });
}
