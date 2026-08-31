/** Snooze preset target: now + daysFromNow at 10:00 LOCAL, rolled off
 *  weekends to Monday (company schedule Mon-Fri — owner 2026-08-31). The DB
 *  clamps cadence-created tasks the same way (ud_business_due). */
export function nextBusinessAt10(daysFromNow: number, now: Date = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(10, 0, 0, 0);
  const day = d.getDay(); // 0=Sun, 6=Sat
  if (day === 6) d.setDate(d.getDate() + 2);
  else if (day === 0) d.setDate(d.getDate() + 1);
  return d.toISOString();
}
