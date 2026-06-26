export const HIGHLIGHT_WINDOW_DAYS = 14;

/** A task is "new" (highlight it) when the viewer hasn't opened it yet AND it was
 *  created within the highlight window. `cutoffMs` = now - HIGHLIGHT_WINDOW_DAYS days. */
export function isTaskHighlighted(params: {
  createdAtIso: string | null;
  opened: boolean;
  cutoffMs: number;
}): boolean {
  const { createdAtIso, opened, cutoffMs } = params;
  if (opened || !createdAtIso) return false;
  const t = Date.parse(createdAtIso);
  return Number.isFinite(t) && t >= cutoffMs;
}
