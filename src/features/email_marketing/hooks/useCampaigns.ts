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

/** Statuses the server's `campaign_update` / `campaign_attach_audience` /
 *  `campaign_detach_audience` RPCs still accept a write against
 *  (`20260907270000_campaign_authoring_rpcs.sql:103-105`, `:511-513`,
 *  `:551-553`) — anything else and the write throws `invalid_state`. Shared
 *  by StepContent, StepAudience and StepSchedule's pacing fields so all
 *  three freeze their inputs together instead of drifting (final-review.md,
 *  Important-3). NOT the same set `campaign_launch` accepts — see
 *  `CAMPAIGN_LAUNCHABLE_STATUSES` below. */
export const CAMPAIGN_EDITABLE_STATUSES: ReadonlySet<CampaignStatus> = new Set(['draft', 'ready']);

/** Statuses `campaign_launch` actually accepts
 *  (`20260907280000_warmup_starts_on_first_launch.sql:53-55`). Deliberately
 *  narrower than `CAMPAIGN_EDITABLE_STATUSES` — a `draft` campaign can still
 *  have its pacing fields edited, but its recipient list was just
 *  invalidated (attach/detach/import all reset `prepared_at` to null and
 *  `status` to `draft` without deleting the old recipient rows), so it is
 *  NOT launchable until "Υπολογισμός παραληπτών" runs again in step 3
 *  (final-review.md, Important-1). */
export const CAMPAIGN_LAUNCHABLE_STATUSES: ReadonlySet<CampaignStatus> = new Set(['ready', 'scheduled']);

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

export type CampaignRecipientsPage = { rows: CampaignRecipientRow[]; count: number };

// Fix-pass, Critical-1: PostgREST caps an unranged `select()` at
// `supabase/config.toml`'s `max_rows` (1000, also the hosted default) and
// returns the first N rows with NO error — the drawer read that as "the
// whole list", so a 4,312-recipient campaign silently showed 1,000. This
// mirrors useSuppressions.ts's already-correct `.range()` + `count: 'exact'`
// pattern, the one call site in this feature that had skipped it.
export const CAMPAIGN_RECIPIENTS_PAGE_SIZE = 100;

/** Recipient rows for one campaign, optionally filtered by status
 *  (pending/sending/sent/failed/suppressed) for the detail page's drawer,
 *  paged server-side — never the whole table in one unranged request. */
export function useCampaignRecipients(
  id: string | undefined,
  filter?: CampaignRecipientStatus,
  page = 0,
) {
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const from = page * CAMPAIGN_RECIPIENTS_PAGE_SIZE;
  const to = from + CAMPAIGN_RECIPIENTS_PAGE_SIZE - 1;
  return useQuery({
    queryKey: queryKeys.campaignRecipients(id ?? '', filter, page),
    enabled: isAdmin && !!id,
    queryFn: async (): Promise<CampaignRecipientsPage> => {
      let query = supabase
        .from('email_campaign_recipients' as never)
        .select('*', { count: 'exact' })
        .eq('campaign_id', id as string)
        .order('queued_at', { ascending: true })
        .range(from, to);
      if (filter) query = query.eq('status', filter);
      const { data, error, count } = await query;
      if (error) throw new Error(error.message);
      return { rows: (data ?? []) as unknown as CampaignRecipientRow[], count: count ?? 0 };
    },
  });
}

// The requested page size for each drain round trip — NOT assumed to be
// what actually comes back (see the `from += rows.length` fix-pass note
// below). Chosen to match PostgREST's own `max_rows` ceiling
// (`supabase/config.toml`) so a drain against the local/default config
// takes the fewest possible round trips, but the loop is correct
// regardless of what the server's real cap turns out to be.
const EXPORT_BATCH_SIZE = 1000;

/**
 * Drains EVERY recipient row for one campaign/filter, paging through with
 * `.range()` until the server-reported `count` is exhausted — used ONLY by
 * the drawer's CSV export, which is the record of exactly who was mailed
 * and must never silently contain fewer rows than were actually sent to
 * (final-review.md, Critical-1). `onProgress` lets the caller show a
 * "fetching N of M" indicator instead of a frozen button during a
 * multi-thousand-row export.
 *
 * Second fix-pass (N-1): the offset advances by `rows.length` — what the
 * server ACTUALLY returned — never by the constant `EXPORT_BATCH_SIZE`.
 * Advancing by the constant silently reintroduces C-1 the moment the
 * hosted project's real `max_rows` is lower than `EXPORT_BATCH_SIZE` (a
 * separate setting from this repo's `supabase/config.toml`): every page
 * under-fills, the stride skips the remainder, and the file downloads
 * short with no error. It also protects a filtered export running during
 * an active send, where rows can leave the filter between requests and
 * shift what a fixed offset would land on. After the loop, a short drain
 * (fewer rows collected than the server's own `count` said existed) throws
 * instead of silently handing back a plausible-looking partial file — the
 * export is the GDPR record of exactly who was mailed, so failing loudly
 * beats a short file with no error.
 */
export async function fetchAllCampaignRecipients(
  campaignId: string,
  filter: CampaignRecipientStatus | undefined,
  onProgress?: (done: number, total: number) => void,
): Promise<CampaignRecipientRow[]> {
  const all: CampaignRecipientRow[] = [];
  let total = Infinity;
  let from = 0;
  while (from < total) {
    let query = supabase
      .from('email_campaign_recipients' as never)
      .select('*', { count: 'exact' })
      .eq('campaign_id', campaignId)
      .order('queued_at', { ascending: true })
      .range(from, from + EXPORT_BATCH_SIZE - 1);
    if (filter) query = query.eq('status', filter);
    const { data, error, count } = await query;
    if (error) throw new Error(error.message);
    total = count ?? 0;
    const rows = (data ?? []) as unknown as CampaignRecipientRow[];
    all.push(...rows);
    onProgress?.(Math.min(all.length, total), total);
    if (rows.length === 0) break; // Safety valve — never spin forever on an unexpected empty page.
    from += rows.length; // The server's real page size, NOT the requested EXPORT_BATCH_SIZE.
  }
  if (all.length < total) {
    throw new Error('export_incomplete');
  }
  return all;
}
