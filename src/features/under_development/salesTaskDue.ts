/** True iff the instant falls on the same LOCAL calendar date as `now`.
 *  Replaces a day-of-month-only check that made "snoozed to Oct 31" render
 *  as a bare time on Aug 31 (2026-08-31 audit finding). */
export function isDueToday(iso: string, now: Date): boolean {
  const d = new Date(iso);
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}
