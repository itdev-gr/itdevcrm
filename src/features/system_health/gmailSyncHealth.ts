import type { HealthBanner } from './emailHealth';

export type GmailSyncHealth = {
  accounts?: number;
  stale_accounts?: number;
  newest_synced_at?: string | null;
  oldest_synced_at?: string | null;
  status?: string;
};

// Maps a Gmail sweep result to a banner, or null when there's nothing to show.
// No accounts (or all fresh) → healthy; some stale → amber; all stale → red.
export function gmailSyncMessage(h: GmailSyncHealth | null | undefined): HealthBanner | null {
  if (!h) return null;
  const accounts = h.accounts ?? 0;
  const stale = h.stale_accounts ?? 0;
  if (accounts === 0 || stale === 0) return null;
  const severity: HealthBanner['severity'] = stale >= accounts ? 'down' : 'degraded';
  return { severity, text: `Gmail sync: ${stale} of ${accounts} mailbox(es) stale (30+ min)` };
}
