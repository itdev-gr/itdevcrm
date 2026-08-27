import type { Database } from '@/types/supabase';

/** A row of the 04:00 `reconcile_payment_integrity()` cron's findings —
 *  a SEPARATE population from the live `accounting_integrity_alerts()` RPC
 *  (see alertPresenters.ts): this one is persisted into
 *  `public.data_integrity_alerts` and stays open until explicitly resolved. */
export type CronAlertRow = Database['public']['Tables']['data_integrity_alerts']['Row'];

export type CronAlertGroup = {
  kind: string;
  rows: CronAlertRow[];
  count: number;
  /** `detected_at` of the oldest still-open row in the group. */
  oldest: string;
};

/**
 * Group open cron-check rows by `kind`, oldest-first within and across
 * groups (`detected_at` ascending) — the row/group that has been sitting
 * unresolved longest surfaces first, since these have no severity field to
 * sort by (unlike the live-alert RPC's `severity`/`category`).
 */
export function groupCronAlerts(rows: CronAlertRow[]): CronAlertGroup[] {
  const map = new Map<string, CronAlertRow[]>();
  for (const r of rows) {
    const arr = map.get(r.kind);
    if (arr) arr.push(r);
    else map.set(r.kind, [r]);
  }
  return [...map.entries()]
    .map(([kind, rs]) => {
      const sorted = [...rs].sort((a, b) => a.detected_at.localeCompare(b.detected_at));
      return { kind, rows: sorted, count: sorted.length, oldest: sorted[0]!.detected_at };
    })
    .sort((a, b) => a.oldest.localeCompare(b.oldest));
}

/** Human label for a cron-check `kind`. Unknown kinds fall back to the raw
 *  key with underscores turned to spaces, so a future third check needs no
 *  frontend change to appear (mirrors how alertPresenters.ts renders
 *  check_key-driven rows without a per-key switch). */
const KIND_LABEL: Record<string, string> = {
  duplicate_period: 'Duplicate billing period',
  flip_out_of_paid_in_full: 'Flipped out of Paid In Full',
};

export function cronAlertKindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind.replace(/_/g, ' ');
}

/** Link a cron-alert row to its subject. Both current kinds carry
 *  `subject_type = 'deal'`; a future check on another table degrades to no
 *  link rather than guessing a wrong route. */
export function cronAlertLink(row: CronAlertRow): string | null {
  if (row.subject_type === 'deal') return '/deals/' + row.subject_id;
  return null;
}
