import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
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

export const SUPPRESSIONS_PAGE_SIZE = 50;

export type SuppressionsParams = {
  /** Free-text search against `email_lower`, matched server-side with
   *  `ilike` — the list is ~450 rows and growing, so it is never fetched
   *  whole and filtered in the browser. */
  search?: string | undefined;
  reason?: SuppressionReason | undefined;
  /** Zero-based page index. */
  page?: number | undefined;
};

export type SuppressionsResult = { rows: SuppressionRow[]; count: number };

/** The suppression list (~450 rows and growing), newest activity first,
 *  searched and paged server-side. Admin-only. */
export function useSuppressions({ search = '', reason, page = 0 }: SuppressionsParams = {}) {
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const term = search.trim();
  const from = page * SUPPRESSIONS_PAGE_SIZE;
  const to = from + SUPPRESSIONS_PAGE_SIZE - 1;
  return useQuery({
    queryKey: queryKeys.suppressions({ search: term, reason, page }),
    enabled: isAdmin,
    // Keeps the current page's rows on screen while the next page/search
    // term loads, instead of flashing back to a loading state on every click.
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<SuppressionsResult> => {
      let query = supabase
        .from('email_suppressions' as never)
        .select('*', { count: 'exact' })
        .order('last_seen_at', { ascending: false })
        .range(from, to);
      if (term) query = query.ilike('email_lower', `%${term}%`);
      if (reason) query = query.eq('reason', reason);
      const { data, error, count } = await query;
      if (error) throw new Error(error.message);
      return { rows: (data ?? []) as unknown as SuppressionRow[], count: count ?? 0 };
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
      // Prefix match (no exact params) so every open page/search/reason
      // filter's cached query is invalidated, not just one specific one.
      void qc.invalidateQueries({ queryKey: ['email-suppressions'] });
    },
  });
}
