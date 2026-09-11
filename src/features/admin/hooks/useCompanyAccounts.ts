import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { captureMutation } from '@/lib/sentry/captureMutation';
import { useAuthStore } from '@/lib/stores/authStore';

// Bridge: company_accounts and its RPCs are not yet in the generated
// supabase.ts — same `as never` pattern as useSuppressions.ts. Drop after the
// next `npm run types:gen`.

/** One company account, WITHOUT its password: the list RPC never returns
 *  passwords — `has_password` only says whether one is stored. The plaintext
 *  is fetched one row at a time by useCompanyAccountPassword. */
export type CompanyAccountRow = {
  id: string;
  title: string;
  email: string | null;
  notes: string | null;
  has_password: boolean;
  created_at: string;
  updated_at: string;
};

export type CompanyAccountInput = {
  id?: string | null;
  title: string;
  email?: string | null;
  notes?: string | null;
  /** null = leave the stored password untouched (an edit that left the field
   *  blank); '' = clear it; anything else = the new password. Mirrors the
   *  server contract in company_account_upsert. */
  password?: string | null;
};

/** Every company account, alphabetically. Admin-only server-side — the RPC
 *  raises 42501 for anyone else — and `enabled` keeps non-admins from even
 *  asking. Searching happens in the page: this list is a handful of rows. */
export function useCompanyAccounts() {
  const isAdmin = useAuthStore((s) => s.isAdmin);
  return useQuery({
    queryKey: queryKeys.companyAccounts(),
    enabled: isAdmin,
    queryFn: async (): Promise<CompanyAccountRow[]> => {
      const { data, error } = await supabase.rpc('company_accounts_list' as never);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as CompanyAccountRow[];
    },
  });
}

/** Decrypts ONE account's password, on demand — this is what the reveal/copy
 *  buttons call. Deliberately a mutation, not a query: nothing caches a
 *  plaintext password, and every reveal is a fresh server round-trip. */
export function useCompanyAccountPassword() {
  return useMutation<string | null, Error, string>({
    mutationFn: captureMutation('company_accounts', 'reveal_password', async (id) => {
      const { data, error } = await supabase.rpc('company_account_password' as never, {
        p_id: id,
      } as never);
      if (error) throw new Error(error.message);
      return (data ?? null) as unknown as string | null;
    }),
  });
}

export function useUpsertCompanyAccount() {
  const qc = useQueryClient();
  return useMutation<string, Error, CompanyAccountInput>({
    mutationFn: captureMutation('company_accounts', 'upsert', async (input) => {
      const { data, error } = await supabase.rpc('company_account_upsert' as never, {
        p_id: input.id ?? null,
        p_title: input.title,
        p_email: input.email ?? null,
        p_password: input.password ?? null,
        p_notes: input.notes ?? null,
      } as never);
      if (error) throw new Error(error.message);
      return data as unknown as string;
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.companyAccounts() });
    },
  });
}

export function useDeleteCompanyAccount() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: captureMutation('company_accounts', 'delete', async (id) => {
      const { error } = await supabase.rpc('company_account_delete' as never, {
        p_id: id,
      } as never);
      if (error) throw new Error(error.message);
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.companyAccounts() });
    },
  });
}
