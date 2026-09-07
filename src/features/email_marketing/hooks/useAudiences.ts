import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { captureMutation } from '@/lib/sentry/captureMutation';
import { useAuthStore } from '@/lib/stores/authStore';

// Bridge: email_audiences / email_audience_members are not yet in the
// generated supabase.ts, same `as never` pattern as
// src/features/email/hooks/useEmailInbox.ts — drop after `npm run types:gen`.

export type AudienceKind = 'import' | 'segment' | 'manual';
export type ConsentBasis = 'existing_customer' | 'inquiry' | 'public_b2b' | 'purchased' | 'other';

export type AudienceRow = {
  id: string;
  name: string;
  kind: AudienceKind;
  source_file: string | null;
  consent_basis: ConsentBasis;
  source_note: string | null;
  row_count: number;
  created_by: string | null;
  created_at: string;
};

type RpcResult = { ok: boolean; errors?: string[] };

async function callRpc<T extends RpcResult>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) throw new Error(error.message);
  const result = data as unknown as T;
  if (!result.ok) throw new Error(result.errors?.[0] ?? `${fn}_failed`);
  return result;
}

/** Every audience list, newest first. Admin-only. */
export function useAudiences() {
  const isAdmin = useAuthStore((s) => s.isAdmin);
  return useQuery({
    queryKey: queryKeys.audiences(),
    enabled: isAdmin,
    queryFn: async (): Promise<AudienceRow[]> => {
      const { data, error } = await supabase
        .from('email_audiences' as never)
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as AudienceRow[];
    },
  });
}

// email_campaign_audiences has no columns beyond the (campaign_id,
// audience_id) pair, so this embeds the audience row through the FK.
type CampaignAudienceJoin = { audience_id: string; email_audiences: AudienceRow | AudienceRow[] | null };

/** Audiences attached to one campaign (StepAudience's list), with the same
 *  row_count/consent_basis columns as useAudiences() — just filtered down to
 *  the campaign's own attachments. */
export function useCampaignAudiences(campaignId: string | undefined) {
  const isAdmin = useAuthStore((s) => s.isAdmin);
  return useQuery({
    queryKey: queryKeys.campaignAudiences(campaignId ?? ''),
    enabled: isAdmin && !!campaignId,
    queryFn: async (): Promise<AudienceRow[]> => {
      const { data, error } = await supabase
        .from('email_campaign_audiences' as never)
        .select('audience_id, email_audiences(*)')
        .eq('campaign_id', campaignId as string);
      if (error) throw new Error(error.message);
      return ((data ?? []) as unknown as CampaignAudienceJoin[])
        .map((row) => (Array.isArray(row.email_audiences) ? row.email_audiences[0] : row.email_audiences))
        .filter((a): a is AudienceRow => a != null);
    },
  });
}

// --- audience_create -----------------------------------------------------------
export type AudienceCreateInput = {
  name: string;
  consentBasis: ConsentBasis;
  kind?: AudienceKind;
  sourceFile?: string | null;
  sourceNote?: string | null;
};
export type AudienceCreateResult = { ok: true; audience_id: string };

export function useCreateAudience() {
  const qc = useQueryClient();
  return useMutation<AudienceCreateResult, Error, AudienceCreateInput>({
    mutationFn: captureMutation('email_marketing', 'audience_create', async (input) =>
      callRpc<AudienceCreateResult>('audience_create', {
        p_name: input.name,
        p_consent_basis: input.consentBasis,
        p_kind: input.kind ?? 'import',
        p_source_file: input.sourceFile ?? null,
        p_source_note: input.sourceNote ?? null,
      }),
    ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.audiences() });
    },
  });
}

// --- audience_add_members -----------------------------------------------------------
// One row per member being imported. Callers (the Excel import dialog) are
// responsible for chunking large imports into batches — this hook just wraps
// one RPC call per batch.
export type AudienceMemberRow = {
  email: string;
  name?: string | null;
  company?: string | null;
  extra?: Record<string, unknown>;
  row?: number;
};
export type AudienceAddMembersResult = { ok: true; added: number; invalid: number; duplicate: number };

export function useAddAudienceMembers() {
  const qc = useQueryClient();
  return useMutation<AudienceAddMembersResult, Error, { audienceId: string; rows: AudienceMemberRow[] }>({
    mutationFn: captureMutation('email_marketing', 'audience_add_members', async ({ audienceId, rows }) =>
      callRpc<AudienceAddMembersResult>('audience_add_members', {
        p_audience_id: audienceId,
        p_rows: rows,
      }),
    ),
    onSuccess: (_data, { audienceId }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.audiences() });
      // A campaign already linked to this audience with a built recipient
      // list is reset server-side (review I-4 in the RPC migration) — no
      // campaign id is known here, so the caller refetches the campaign it's
      // editing on its own invalidation (useAttachAudience/useUpdateCampaign).
      void qc.invalidateQueries({ queryKey: ['email-audience-members', audienceId] });
    },
  });
}

// --- audience_delete ---------------------------------------------------------------
export type AudienceDeleteResult = { ok: true; audience_id: string };

export function useDeleteAudience() {
  const qc = useQueryClient();
  return useMutation<AudienceDeleteResult, Error, string>({
    mutationFn: captureMutation('email_marketing', 'audience_delete', async (audienceId) =>
      callRpc<AudienceDeleteResult>('audience_delete', { p_audience_id: audienceId }),
    ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.audiences() });
    },
  });
}
