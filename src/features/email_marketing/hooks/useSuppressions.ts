import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { captureMutation } from '@/lib/sentry/captureMutation';
import { useAuthStore } from '@/lib/stores/authStore';

// Bridge: email_suppressions is not yet in the generated supabase.ts, same
// `as never` pattern as src/features/email/hooks/useEmailInbox.ts — drop
// after the next `npm run types:gen`.

export type SuppressionReason = 'hard_bounce' | 'soft_bounce' | 'complaint' | 'manual' | 'invalid' | 'unsubscribed';

export type SuppressionRow = {
  email_lower: string;
  reason: SuppressionReason;
  source: string | null;
  bounce_count: number;
  first_seen_at: string;
  last_seen_at: string;
  note: string | null;
};

/** The full suppression list (~450 rows), newest activity first. Admin-only. */
export function useSuppressions() {
  const isAdmin = useAuthStore((s) => s.isAdmin);
  return useQuery({
    queryKey: queryKeys.suppressions(),
    enabled: isAdmin,
    queryFn: async (): Promise<SuppressionRow[]> => {
      const { data, error } = await supabase
        .from('email_suppressions' as never)
        .select('*')
        .order('last_seen_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as SuppressionRow[];
    },
  });
}

/**
 * unsuppress_email(p_email) — unlike every other RPC in this feature, it
 * returns a plain boolean, not `{ok,...}`: `true` if a row was actually
 * deleted, `false` if the address was already not suppressed. A non-admin
 * caller gets a real Postgres exception (raised server-side), which surfaces
 * through supabase-js's `error` and is thrown here like any other error.
 */
export function useUnsuppressEmail() {
  const qc = useQueryClient();
  return useMutation<boolean, Error, string>({
    mutationFn: captureMutation('email_marketing', 'unsuppress_email', async (email) => {
      const { data, error } = await supabase.rpc('unsuppress_email' as never, {
        p_email: email,
      } as never);
      if (error) throw new Error(error.message);
      return data as unknown as boolean;
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.suppressions() });
    },
  });
}
