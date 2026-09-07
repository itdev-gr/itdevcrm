import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { useAuthStore } from '@/lib/stores/authStore';

// Bridge: email_campaigns / email_campaign_recipients are not yet in the
// generated supabase.ts (they ship in migrations the type generator hasn't
// seen) — same `as never` bridge the rest of the codebase uses for this,
// see src/features/email/hooks/useEmailInbox.ts. Drop the casts after the
// next `npm run types:gen`.

export type CampaignStatus = 'draft' | 'ready' | 'scheduled' | 'sending' | 'paused' | 'sent' | 'cancelled';

export type CampaignRow = {
  id: string;
  name: string;
  status: CampaignStatus;
  identity: string;
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
  prepared_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  autopause_reason: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type CampaignRecipientStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'suppressed';

export type CampaignRecipientRow = {
  id: string;
  campaign_id: string;
  email_lower: string;
  display_name: string | null;
  company: string | null;
  lead_id: string | null;
  client_id: string | null;
  audience_id: string | null;
  status: CampaignRecipientStatus;
  suppression_reason: string | null;
  unsubscribe_token: string;
  resend_id: string | null;
  attempts: number;
  claimed_at: string | null;
  error: string | null;
  queued_at: string;
  sent_at: string | null;
  delivered_at: string | null;
  bounced_at: string | null;
  bounce_type: string | null;
  complained_at: string | null;
  unsubscribed_at: string | null;
  open_count: number;
  click_count: number;
  first_opened_at: string | null;
  first_clicked_at: string | null;
  replied_at: string | null;
};

export type CampaignStatsResult = {
  ok: true;
  campaign_id: string;
  by_status: Record<string, number>;
  by_suppression_reason: Record<string, number>;
  sent: number;
  delivered: number;
  bounced: number;
  complained: number;
  unsubscribed: number;
};

type RpcFailure = { ok: false; errors: string[] };

/** List of every campaign, newest first. Admin-only — never even issues the
 *  query for a non-admin, per the owner's "hiding the UI is not enough" rule. */
export function useCampaigns() {
  const isAdmin = useAuthStore((s) => s.isAdmin);
  return useQuery({
    queryKey: queryKeys.campaigns(),
    enabled: isAdmin,
    queryFn: async (): Promise<CampaignRow[]> => {
      const { data, error } = await supabase
        .from('email_campaigns' as never)
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as CampaignRow[];
    },
  });
}

/** A single campaign by id. */
export function useCampaign(id: string | undefined) {
  const isAdmin = useAuthStore((s) => s.isAdmin);
  return useQuery({
    queryKey: queryKeys.campaign(id ?? ''),
    enabled: isAdmin && !!id,
    queryFn: async (): Promise<CampaignRow> => {
      const { data, error } = await supabase
        .from('email_campaigns' as never)
        .select('*')
        .eq('id', id as string)
        .single();
      if (error) throw new Error(error.message);
      return data as unknown as CampaignRow;
    },
  });
}

/** campaign_stats RPC — counts by status/suppression reason plus the funnel
 *  totals. Like every RPC in this module, `ok:false` is a real failure (not a
 *  network error) and must be thrown so the UI never shows stale/blank stats
 *  as if they were current. */
export function useCampaignStats(id: string | undefined) {
  const isAdmin = useAuthStore((s) => s.isAdmin);
  return useQuery({
    queryKey: queryKeys.campaignStats(id ?? ''),
    enabled: isAdmin && !!id,
    queryFn: async (): Promise<CampaignStatsResult> => {
      const { data, error } = await supabase.rpc('campaign_stats' as never, {
        p_campaign_id: id,
      } as never);
      if (error) throw new Error(error.message);
      const result = data as unknown as CampaignStatsResult | RpcFailure;
      if (!result.ok) throw new Error(result.errors?.[0] ?? 'campaign_stats_failed');
      return result;
    },
  });
}

export type EmailMarketingSettingsRow = {
  /** Global kill switch — when true, nothing sends anywhere in the system.
   *  The emergency-stop AudiencesPage's settings card exposes. */
  paused: boolean;
  daily_cap: number;
  hourly_cap: number;
  batch_slice: number;
  warmup_ladder: number[];
  /** Date the domain's warm-up ladder began (YYYY-MM-DD), or null if it
   *  hasn't yet — set once, on a campaign's first successful launch
   *  (20260907280000_warmup_starts_on_first_launch.sql), never before. */
  warmup_started_on: string | null;
};

/** The singleton platform pacing config (email_marketing_settings) — the
 *  live `paused`/`daily_cap`/`hourly_cap`/`batch_slice`/`warmup_ladder`/
 *  `warmup_started_on` values `campaign_daily_budget` actually paces sending
 *  by (`supabase/migrations/20260907220000_campaign_queue_ops.sql`). Read
 *  directly (admin-only RLS select policy, `20260907200000:158-162`) since
 *  that RPC itself is service-role-only. StepSchedule's completion estimate
 *  uses this instead of a hardcoded mirror of the schema default, so a live
 *  cap/ladder/warm-up-start change is reflected without a code change. Also
 *  the ONE hook AudiencesPage's global-controls card reads from — reused
 *  rather than duplicated, per task-6-brief.md. */
export function useEmailMarketingSettings() {
  const isAdmin = useAuthStore((s) => s.isAdmin);
  return useQuery({
    queryKey: queryKeys.emailMarketingSettings(),
    enabled: isAdmin,
    queryFn: async (): Promise<EmailMarketingSettingsRow> => {
      const { data, error } = await supabase
        .from('email_marketing_settings' as never)
        .select('paused, daily_cap, hourly_cap, batch_slice, warmup_ladder, warmup_started_on')
        .eq('id', true)
        .single();
      if (error) throw new Error(error.message);
      return data as unknown as EmailMarketingSettingsRow;
    },
  });
}

/** Recipient rows for one campaign, optionally filtered by status
 *  (pending/sending/sent/failed/suppressed) for the detail page's drawer. */
export function useCampaignRecipients(id: string | undefined, filter?: CampaignRecipientStatus) {
  const isAdmin = useAuthStore((s) => s.isAdmin);
  return useQuery({
    queryKey: queryKeys.campaignRecipients(id ?? '', filter),
    enabled: isAdmin && !!id,
    queryFn: async (): Promise<CampaignRecipientRow[]> => {
      let query = supabase
        .from('email_campaign_recipients' as never)
        .select('*')
        .eq('campaign_id', id as string)
        .order('queued_at', { ascending: true });
      if (filter) query = query.eq('status', filter);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as CampaignRecipientRow[];
    },
  });
}
