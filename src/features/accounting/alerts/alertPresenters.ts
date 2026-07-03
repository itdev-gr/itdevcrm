export type AlertRow = {
  check_key: string;
  severity: 'red' | 'amber' | 'grey';
  category: 'money' | 'lifecycle' | 'missing';
  subject_type: string;
  subject_id: string;
  subject_code: string;
  title: string;
  detail: string;
  deal_id: string | null;
  job_id: string | null;
  signature: string;
};

const CATEGORY_ORDER: AlertRow['category'][] = ['money', 'lifecycle', 'missing'];

/**
 * Bucket alert rows into the fixed category order (money → lifecycle → missing),
 * dropping empty categories and preserving input row order within a bucket
 * (the RPC already sorts rows by severity).
 */
export function groupAlerts(rows: AlertRow[]): { category: AlertRow['category']; rows: AlertRow[] }[] {
  return CATEGORY_ORDER.map((category) => ({
    category,
    rows: rows.filter((r) => r.category === category),
  })).filter((g) => g.rows.length > 0);
}

/** Link a row to its job (preferred) or deal detail page, else null. */
export function alertLink(row: AlertRow): string | null {
  if (row.job_id) return '/jobs/' + row.job_id;
  if (row.deal_id) return '/deals/' + row.deal_id;
  return null;
}

/** Tailwind chip classes for a severity level. */
export function severityClass(sev: AlertRow['severity']): string {
  switch (sev) {
    case 'red':
      return 'bg-destructive/10 text-destructive';
    case 'amber':
      return 'bg-amber-500/10 text-amber-600';
    case 'grey':
      return 'bg-muted text-muted-foreground';
  }
}
