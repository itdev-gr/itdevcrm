export type EmailHealth = {
  status: 'ok' | 'degraded' | 'down';
  reason?: string;
  last_run_age_seconds?: number | null;
  stuck_count?: number;
  failed_count?: number;
  oldest_pending_age_seconds?: number | null;
};

export type HealthBanner = { severity: 'down' | 'degraded'; text: string };

// Maps a health result to a banner, or null when there's nothing to show.
export function emailHealthMessage(h: EmailHealth | null | undefined): HealthBanner | null {
  if (!h || h.status === 'ok') return null;
  const reason = h.reason ?? (h.status === 'down' ? 'pipeline is down' : 'pipeline degraded');
  return { severity: h.status, text: `Email: ${reason}` };
}
