export type AlertRow = {
  check_key: string;
  severity: 'red' | 'amber' | 'grey';
  category: 'money' | 'lifecycle' | 'missing' | 'possible_mistakes';
  subject_type: string;
  subject_id: string;
  subject_code: string;
  title: string;
  detail: string;
  deal_id: string | null;
  job_id: string | null;
  signature: string;
};

const CATEGORY_ORDER: AlertRow['category'][] = ['money', 'lifecycle', 'missing', 'possible_mistakes'];

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

const SEVERITY_RANK: Record<AlertRow['severity'], number> = { red: 0, amber: 1, grey: 2 };

/**
 * Group alerts by their subject ENTITY — the base code before the first '-',
 * so a deal `000084` and its job `000084-LOCALSEO` land in one group. Groups
 * are ordered by their most-severe alert (worst customers first); rows within
 * a group are ordered by severity.
 */
export function groupAlertsBySubject(rows: AlertRow[]): { code: string; rows: AlertRow[] }[] {
  const map = new Map<string, AlertRow[]>();
  for (const r of rows) {
    // subject_code can be null (e.g. a client without a code); fall back to the id.
    const raw = r.subject_code ?? '';
    const code = raw.split('-')[0] || raw || r.subject_id;
    const arr = map.get(code);
    if (arr) arr.push(r);
    else map.set(code, [r]);
  }
  return [...map.entries()]
    .map(([code, rs]) => ({
      code,
      rows: [...rs].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]),
    }))
    .sort((a, b) => {
      const wa = Math.min(...a.rows.map((r) => SEVERITY_RANK[r.severity]));
      const wb = Math.min(...b.rows.map((r) => SEVERITY_RANK[r.severity]));
      return wa - wb || a.code.localeCompare(b.code);
    });
}

/** Link a row to its DEAL (preferred — accounting works at the deal level),
 *  else its client, else its job. Null if none. */
export function alertLink(row: AlertRow): string | null {
  if (row.deal_id) return '/deals/' + row.deal_id;
  if (row.subject_type === 'client') return '/clients/' + row.subject_id;
  if (row.job_id) return '/jobs/' + row.job_id;
  return null;
}

/** Label for the navigation button, matching where alertLink points. */
export function alertLinkLabel(row: AlertRow): string {
  if (row.deal_id) return 'Open deal';
  if (row.subject_type === 'client') return 'Open client';
  if (row.job_id) return 'Open job';
  return 'Open';
}

/** Importance label shown on the chip (the colour comes from severityClass). */
export function severityLabel(sev: AlertRow['severity']): string {
  switch (sev) {
    case 'red':
      return 'High';
    case 'amber':
      return 'Medium';
    case 'grey':
      return 'Low';
  }
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
