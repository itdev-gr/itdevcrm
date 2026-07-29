import type { LeadRow } from './hooks/useLeads';

export type CsvColumn<T> = { header: string; value: (row: T) => string };

export type LeadCsvDeps = {
  t: (key: string) => string;
  ownerLabel: (id: string | null) => string;
  statusLabel: (id: string | null) => string;
};

export function leadCsvColumns({ t, ownerLabel, statusLabel }: LeadCsvDeps): CsvColumn<LeadRow>[] {
  return [
    { header: t('table.code'), value: (l) => l.code ?? '' },
    { header: t('table.source'), value: (l) => l.source ?? '' },
    { header: t('table.title'), value: (l) => l.title ?? '' },
    {
      header: t('table.full_name'),
      value: (l) => [l.contact_first_name, l.contact_last_name].filter(Boolean).join(' '),
    },
    { header: t('table.email'), value: (l) => l.email ?? '' },
    { header: t('table.phone'), value: (l) => l.phone ?? '' },
    { header: t('table.website'), value: (l) => l.website ?? '' },
    { header: t('table.category'), value: (l) => l.industry ?? '' },
    { header: t('table.company'), value: (l) => l.company_name ?? '' },
    { header: t('form.budget'), value: (l) => l.budget ?? '' },
    { header: t('form.region'), value: (l) => l.region ?? '' },
    { header: t('table.assign'), value: (l) => ownerLabel(l.owner_user_id) },
    { header: t('table.status'), value: (l) => statusLabel(l.stage_id) },
  ];
}

function esc(s: string): string {
  const v = s ?? '';
  return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

export function leadsToCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const head = columns.map((c) => esc(c.header)).join(',');
  if (rows.length === 0) return head;
  const body = rows.map((r) => columns.map((c) => esc(c.value(r) ?? '')).join(',')).join('\n');
  return head + '\n' + body;
}
