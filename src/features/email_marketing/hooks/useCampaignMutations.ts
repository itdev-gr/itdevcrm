import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { captureMutation } from '@/lib/sentry/captureMutation';
import type { CampaignStatus } from './useCampaigns';

// Every RPC below returns `{ok:true,...}` or `{ok:false,errors:[...]}` — an
// `ok:false` is NOT a network error (supabase-js's `error` stays null), so
// each mutationFn checks `result.ok` explicitly and throws so the caller can
// show a translated message. This exact bug (an ok:false that silently did
// nothing) has already shipped twice in this codebase.
//
// Bridge: these RPCs are not yet in the generated supabase.ts, same `as
// never` pattern as src/features/email/hooks/useEmailInbox.ts — drop after
// the next `npm run types:gen`.

type RpcResult = { ok: boolean; errors?: string[] };

async function callRpc<T extends RpcResult>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) throw new Error(error.message);
  const result = data as unknown as T;
  if (!result.ok) throw new Error(result.errors?.[0] ?? `${fn}_failed`);
  return result;
}

function invalidateCampaign(qc: ReturnType<typeof useQueryClient>, campaignId: string) {
  void qc.invalidateQueries({ queryKey: queryKeys.campaigns() });
  void qc.invalidateQueries({ queryKey: queryKeys.campaign(campaignId) });
}

// --- campaign_create -----------------------------------------------------------
export type CampaignCreateInput = {
  name: string;
  subject?: string;
  bodyMd?: string;
  preheader?: string | null;
  heroImageUrl?: string | null;
  replyTo?: string | null;
};
export type CampaignCreateResult = { ok: true; campaign_id: string };

export function useCreateCampaign() {
  const qc = useQueryClient();
  return useMutation<CampaignCreateResult, Error, CampaignCreateInput>({
    mutationFn: captureMutation('email_marketing', 'campaign_create', async (input) =>
      callRpc<CampaignCreateResult>('campaign_create', {
        p_name: input.name,
        p_subject: input.subject ?? '',
        p_body_md: input.bodyMd ?? '',
        p_preheader: input.preheader ?? null,
        p_hero_image_url: input.heroImageUrl ?? null,
        p_reply_to: input.replyTo ?? null,
      }),
    ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.campaigns() });
    },
  });
}

// --- campaign_update -------------------------------------------------------------
// Mirrors the exact key set the RPC accepts (20260907270000_campaign_authoring_rpcs.sql).
// Only keys present in the patch are applied — omit a key to leave it untouched.
export type CampaignPatch = Partial<{
  name: string;
  subject: string;
  preheader: string | null;
  body_md: string;
  hero_image_url: string | null;
  reply_to: string;
  segment: Record<string, unknown>;
  daily_cap: number | null;
  hourly_cap: number | null;
  send_window_start: string;
  send_window_end: string;
  send_days: number[];
  scheduled_at: string | null;
}>;
export type CampaignUpdateResult = { ok: true; campaign_id: string };

export function useUpdateCampaign() {
  const qc = useQueryClient();
  return useMutation<CampaignUpdateResult, Error, { campaignId: string; patch: CampaignPatch }>({
    mutationFn: captureMutation('email_marketing', 'campaign_update', async ({ campaignId, patch }) =>
      callRpc<CampaignUpdateResult>('campaign_update', { p_campaign_id: campaignId, p_patch: patch }),
    ),
    onSuccess: (_data, { campaignId }) => {
      invalidateCampaign(qc, campaignId);
      // A patch touching `segment` resets prepared_at/status server-side — the
      // previously-built recipient list is stale.
      void qc.invalidateQueries({ queryKey: queryKeys.campaignRecipients(campaignId) });
    },
  });
}

// --- campaign_delete ---------------------------------------------------------------
export type CampaignDeleteResult = { ok: true; campaign_id: string };

export function useDeleteCampaign() {
  const qc = useQueryClient();
  return useMutation<CampaignDeleteResult, Error, string>({
    mutationFn: captureMutation('email_marketing', 'campaign_delete', async (campaignId) =>
      callRpc<CampaignDeleteResult>('campaign_delete', { p_campaign_id: campaignId }),
    ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.campaigns() });
    },
  });
}

// --- campaign_reset_to_draft --------------------------------------------------------
export type CampaignResetResult = { ok: true; campaign_id: string; status: CampaignStatus };

export function useResetCampaignToDraft() {
  const qc = useQueryClient();
  return useMutation<CampaignResetResult, Error, string>({
    mutationFn: captureMutation('email_marketing', 'campaign_reset_to_draft', async (campaignId) =>
      callRpc<CampaignResetResult>('campaign_reset_to_draft', { p_campaign_id: campaignId }),
    ),
    onSuccess: (_data, campaignId) => {
      invalidateCampaign(qc, campaignId);
      void qc.invalidateQueries({ queryKey: queryKeys.campaignRecipients(campaignId) });
    },
  });
}

// --- campaign_attach_audience / campaign_detach_audience --------------------------
export type CampaignAudienceLinkInput = { campaignId: string; audienceId: string };
export type CampaignAudienceLinkResult = { ok: true; campaign_id: string; audience_id: string };

export function useAttachAudience() {
  const qc = useQueryClient();
  return useMutation<CampaignAudienceLinkResult, Error, CampaignAudienceLinkInput>({
    mutationFn: captureMutation('email_marketing', 'campaign_attach_audience', async ({ campaignId, audienceId }) =>
      callRpc<CampaignAudienceLinkResult>('campaign_attach_audience', {
        p_campaign_id: campaignId,
        p_audience_id: audienceId,
      }),
    ),
    onSuccess: (_data, { campaignId }) => {
      invalidateCampaign(qc, campaignId);
      void qc.invalidateQueries({ queryKey: queryKeys.campaignRecipients(campaignId) });
      void qc.invalidateQueries({ queryKey: queryKeys.campaignAudiences(campaignId) });
    },
  });
}

export function useDetachAudience() {
  const qc = useQueryClient();
  return useMutation<CampaignAudienceLinkResult, Error, CampaignAudienceLinkInput>({
    mutationFn: captureMutation('email_marketing', 'campaign_detach_audience', async ({ campaignId, audienceId }) =>
      callRpc<CampaignAudienceLinkResult>('campaign_detach_audience', {
        p_campaign_id: campaignId,
        p_audience_id: audienceId,
      }),
    ),
    onSuccess: (_data, { campaignId }) => {
      invalidateCampaign(qc, campaignId);
      void qc.invalidateQueries({ queryKey: queryKeys.campaignRecipients(campaignId) });
      void qc.invalidateQueries({ queryKey: queryKeys.campaignAudiences(campaignId) });
    },
  });
}

// --- build_campaign_recipients ------------------------------------------------------
export type BuildCampaignRecipientsResult = {
  ok: true;
  built: number;
  suppressed: number;
  by_reason: Record<string, number>;
};

export function useBuildCampaignRecipients() {
  const qc = useQueryClient();
  return useMutation<BuildCampaignRecipientsResult, Error, string>({
    mutationFn: captureMutation('email_marketing', 'build_campaign_recipients', async (campaignId) =>
      callRpc<BuildCampaignRecipientsResult>('build_campaign_recipients', { p_campaign_id: campaignId }),
    ),
    onSuccess: (_data, campaignId) => {
      invalidateCampaign(qc, campaignId);
      void qc.invalidateQueries({ queryKey: queryKeys.campaignRecipients(campaignId) });
      void qc.invalidateQueries({ queryKey: queryKeys.campaignStats(campaignId) });
    },
  });
}

// --- campaign_launch / pause / resume / cancel ---------------------------------------
export type CampaignLifecycleResult = { ok: true; campaign_id: string; status: CampaignStatus };

function useLifecycleMutation(rpc: string) {
  const qc = useQueryClient();
  return useMutation<CampaignLifecycleResult, Error, string>({
    mutationFn: captureMutation('email_marketing', rpc, async (campaignId) =>
      callRpc<CampaignLifecycleResult>(rpc, { p_campaign_id: campaignId }),
    ),
    onSuccess: (_data, campaignId) => {
      invalidateCampaign(qc, campaignId);
      void qc.invalidateQueries({ queryKey: queryKeys.campaignStats(campaignId) });
    },
  });
}

export function useLaunchCampaign() {
  return useLifecycleMutation('campaign_launch');
}
export function usePauseCampaign() {
  return useLifecycleMutation('campaign_pause');
}
export function useResumeCampaign() {
  return useLifecycleMutation('campaign_resume');
}
export function useCancelCampaign() {
  return useLifecycleMutation('campaign_cancel');
}

// --- marketing_settings_update -------------------------------------------------------
// The singleton email_marketing_settings row's only writer (Task 4's
// useEmailMarketingSettings is a plain read-only select — this is the write
// side, reused rather than duplicated). Carries the global kill switch
// (`paused`) plus `daily_cap`/`hourly_cap`/`batch_slice`. Only keys present in
// the patch are applied server-side — omit a key to leave it untouched, so a
// caller flipping just `paused` never has to know the current caps.
//
// The RPC returns `{ok:false, errors:['settings_row_missing']}` when zero
// rows changed (20260907270000:610-613) — that goes through callRpc's normal
// `ok:false` → throw path like every other mutation here, so a "true" that
// isn't real never reaches the UI as a silent success.
export type MarketingSettingsPatch = Partial<{
  paused: boolean;
  daily_cap: number;
  hourly_cap: number;
  batch_slice: number;
  /** Bounce ceiling for the auto-pause circuit breaker (0.07 = 7%). The RPC
   *  has always accepted it (20260907270000:604); it had no UI, so raising it
   *  meant a hand-written UPDATE against production. */
  max_bounce_rate: number;
}>;
export type MarketingSettingsUpdateResult = { ok: true };

export function useUpdateMarketingSettings() {
  const qc = useQueryClient();
  return useMutation<MarketingSettingsUpdateResult, Error, MarketingSettingsPatch>({
    mutationFn: captureMutation('email_marketing', 'marketing_settings_update', async (patch) =>
      callRpc<MarketingSettingsUpdateResult>('marketing_settings_update', { p_patch: patch }),
    ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.emailMarketingSettings() });
    },
  });
}
