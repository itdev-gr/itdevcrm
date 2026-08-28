import type { JobRow } from './hooks/useJobs';

/** Boards whose Closed lane asks the team to disconnect from the client's
 *  Google profile. Owner request 2026-08-28 is Local SEO (GBP) only; add
 *  'web_seo' here if GSC ever needs the same reminder. */
export const DISCONNECT_BOARDS: ReadonlySet<string> = new Set(['local_seo']);

/** Stage code of the terminal "Closed" lane (migration 20260618000010). */
const CLOSED_STAGE_CODE = 'closed';

export type DisconnectStatus = 'needs_disconnect' | 'disconnected' | null;

/**
 * Single source of truth for the red/green disconnect indicator.
 * - 'needs_disconnect' (red): board job sitting in Closed, not yet disconnected.
 * - 'disconnected' (green): disconnected_at is stamped — shown in ANY stage so
 *   the team knows the profile is still disconnected if the job is re-opened
 *   (Undo clears it once they reconnect).
 * - null: nothing to show.
 */
export function disconnectStatus(
  job: Pick<JobRow, 'service_type' | 'stage' | 'disconnected_at'>,
): DisconnectStatus {
  if (!DISCONNECT_BOARDS.has(job.service_type)) return null;
  if (job.disconnected_at) return 'disconnected';
  if (job.stage?.code === CLOSED_STAGE_CODE) return 'needs_disconnect';
  return null;
}

/** Disconnecting is the Local SEO team's call (plus admins). Accounting can
 *  edit jobs via RLS but does not own this step, so the button hides for them. */
export function canToggleDisconnect(isAdmin: boolean, groupCodes: string[]): boolean {
  return isAdmin || groupCodes.includes('local_seo');
}
