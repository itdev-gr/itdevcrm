export type JobPeriodChip = { label: string; tone: 'ok' | 'due-soon' | 'overdue' };

/**
 * Pure formatter for the job's "current paid period" chip.
 * - `start` / `due` are the ISO-yyyy-mm-dd values on jobs.period_start_date /
 *   period_due_date.
 * - `today` is passed in so tests are deterministic.
 * - Returns null when there is nothing meaningful to show (no paid coverage).
 */
export function formatJobPeriodChip(
  period: { start: string | null; due: string | null },
  today: Date,
): JobPeriodChip | null {
  if (!period.due) return null;

  const dueMs = Date.parse(period.due + 'T00:00:00Z');
  if (Number.isNaN(dueMs)) return null;

  const todayMs = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const daysDelta = Math.round((dueMs - todayMs) / (24 * 60 * 60 * 1000));

  const d = new Date(dueMs);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const label = `Due ${dd}/${mm}`;

  let tone: JobPeriodChip['tone'];
  if (daysDelta < 0) tone = 'overdue';
  else if (daysDelta <= 7) tone = 'due-soon';
  else tone = 'ok';

  return { label, tone };
}
