/**
 * Pure date helpers for every "mark paid" date picker across the app
 * (PaymentsPanel, ExpensesPage, ExpenseDetailDialog, useMarkExpensePaid,
 * NewExpenseDialog). Kept dependency-free so it is trivial to unit test
 * without touching Supabase or React.
 *
 * These MUST use local date parts (getFullYear/getMonth/getDate), never
 * `toISOString()` — `toISOString()` reads the UTC date, which is still
 * "yesterday" in Athens (UTC+2/+3) before 02:00-03:00 local time. Several
 * call sites used to derive today's date via `toISOString().slice(0, 10)`
 * directly and would default a paid-date picker to the wrong day in that
 * window; this module is the single source of truth so that bug can only
 * exist in one place.
 *
 * The DB guard (money_paid_needs_date(), migration 20260827170000) rejects
 * paid_at more than 1 day in the future, so the UI's max must match exactly.
 */

/** Today as yyyy-mm-dd in the local timezone. */
export function todayLocalISO(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** One day after today — the latest paid_at the DB guard allows. */
export function maxPaidDateISO(now: Date = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  return todayLocalISO(d);
}

/** Turn a yyyy-mm-dd date into the paid_at payload: midnight UTC that day. */
export function paidAtFromDate(dateStr: string): string {
  return `${dateStr}T00:00:00Z`;
}
