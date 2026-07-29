// Helpers for keeping one logical email = ONE email_messages row
// (spec docs/superpowers/specs/2026-07-29-email-mirror-dedup-design.md).
// send-email writes a mirror row per Resend send; gmail-sync captures the
// delivered dept-CC copy of the same email minutes later. These helpers give
// both sides a shared definition of "mirror row" and of the time window in
// which a captured copy may claim one.

export const ADOPTION_WINDOW_MS = 30 * 60_000;

/** RFC822 Message-ID used for BOTH the wire email (Resend `headers`) and the
 *  mirror row, so a captured delivered copy dedups on the unique constraint. */
export function newCrmMessageId(uuid: string = crypto.randomUUID()): string {
  return `<crm-${uuid}@itdev.gr>`;
}

/** A mirror row not yet folded into its captured copy. Adoption rewrites
 *  message_id to the real Message-ID, so this doubles as the "un-adopted"
 *  marker. `resend:` is the pre-2026-07-29 scheme (cleaned up by migration
 *  20260729090000); `<crm-` is the current one. */
export function isUnadoptedMirrorId(id: string): boolean {
  return id.startsWith('resend:') || id.startsWith('<crm-');
}

/** Nearest row to `targetIso` by sent_at, within ADOPTION_WINDOW_MS. */
export function nearestBySentAt<T extends { sent_at: string | null }>(
  rows: T[],
  targetIso: string,
): T | undefined {
  const t = Date.parse(targetIso);
  return rows
    .map((r) => ({ r, d: r.sent_at ? Math.abs(Date.parse(r.sent_at) - t) : Number.NaN }))
    .filter((x) => Number.isFinite(x.d) && x.d <= ADOPTION_WINDOW_MS)
    .sort((a, b) => a.d - b.d)[0]?.r;
}
