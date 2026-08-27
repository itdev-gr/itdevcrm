/**
 * Pure date helpers for the "mark paid" date picker shared by PaymentsPanel
 * (and, in spirit, every other mark-paid surface). Kept dependency-free so it
 * is trivial to unit test without touching Supabase or React.
 *
 * The DB guard (money_paid_needs_date(), migration 20260827170000) rejects
 * paid_at more than 1 day in the future, so the UI's max must match exactly.
 */

/** Today as yyyy-mm-dd in the browser's local timezone. */
export function todayDateString(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** One day after today — the latest paid_at the DB guard allows. */
export function maxPaidDateString(now: Date = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  return todayDateString(d);
}

/** Turn a yyyy-mm-dd date into the paid_at payload: midnight UTC that day. */
export function paidAtFromDate(dateStr: string): string {
  return `${dateStr}T00:00:00Z`;
}
