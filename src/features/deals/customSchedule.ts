/** One row of a custom payment schedule for a one-time web_dev job. */
export type ScheduleRow = { amount_net: number; due_date: string | null };

/** Sum of the parts, rounded to cents (avoids float drift in the UI total). */
export function scheduleTotal(rows: ScheduleRow[]): number {
  const cents = rows.reduce((acc, r) => acc + Math.round((r.amount_net || 0) * 100), 0);
  return cents / 100;
}

/**
 * Validate a custom schedule against the job total. Returns null when valid,
 * else an error code matching the server (schedule_required /
 * schedule_amount_positive / schedule_total_mismatch).
 */
export function validateCustomSchedule(rows: ScheduleRow[], total: number): string | null {
  if (rows.length === 0) return 'schedule_required';
  if (rows.some((r) => !(r.amount_net > 0))) return 'schedule_amount_positive';
  if (Math.round(scheduleTotal(rows) * 100) !== Math.round((total || 0) * 100)) {
    return 'schedule_total_mismatch';
  }
  return null;
}
