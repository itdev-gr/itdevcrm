export type EmailColor = 'green' | 'yellow' | 'red';

/** email_log.status -> traffic-light color. delivered = green,
 *  sent (awaiting delivery) = yellow, everything else
 *  (bounced/failed/complained/unknown) = red. */
export function emailStatusColor(status: string): EmailColor {
  if (status === 'delivered') return 'green';
  if (status === 'sent') return 'yellow';
  return 'red';
}

export function summarizeEmailStatuses(
  rows: ReadonlyArray<{ status: string }>,
): { green: number; yellow: number; red: number; total: number } {
  const s = { green: 0, yellow: 0, red: 0, total: rows.length };
  for (const r of rows) s[emailStatusColor(r.status)] += 1;
  return s;
}
