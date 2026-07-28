export type JobDueDateChip = { label: string; tooltip: string; tone: 'ok' | 'due-soon' | 'overdue' };

/**
 * Pure formatter for the web-dev delivery due-date chip.
 * - `due` is jobs.details.due_date (ISO yyyy-mm-dd, set manually on the
 *   web_dev Info tab) — distinct from the BILLING period chip in
 *   jobPeriodChip.ts, which reads jobs.period_due_date.
 * - `completed` forces tone=ok so a done job never shows a red overdue chip.
 * - `today` is passed in so tests are deterministic.
 * - Returns null when there is no valid due date.
 */
export function formatJobDueDateChip(
  input: { due: string | null | undefined; completed: boolean },
  today: Date,
  lang: 'en' | 'el',
): JobDueDateChip | null {
  if (typeof input.due !== 'string' || input.due === '') return null;
  const dueMs = Date.parse(input.due + 'T00:00:00Z');
  if (Number.isNaN(dueMs)) return null;

  const todayMs = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const daysDelta = Math.round((dueMs - todayMs) / (24 * 60 * 60 * 1000));

  const d = new Date(dueMs);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  const label = `${dd}/${mm}`;
  const tooltip =
    lang === 'el' ? `Παράδοση έως ${dd}/${mm}/${yyyy}` : `Delivery due ${dd}/${mm}/${yyyy}`;

  let tone: JobDueDateChip['tone'];
  if (input.completed) tone = 'ok';
  else if (daysDelta < 0) tone = 'overdue';
  else if (daysDelta <= 7) tone = 'due-soon';
  else tone = 'ok';

  return { label, tooltip, tone };
}
