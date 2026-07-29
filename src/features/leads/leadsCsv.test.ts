import { describe, it, expect } from 'vitest';
import { leadsToCsv, leadCsvColumns, type CsvColumn } from './leadsCsv';
import type { LeadRow } from './hooks/useLeads';

type Row = { code: string; company: string | null };

describe('leadsToCsv', () => {
  const cols: CsvColumn<Row>[] = [
    { header: 'Code', value: (r) => r.code },
    { header: 'Company', value: (r) => r.company ?? '' },
  ];

  it('writes a header row then one line per row', () => {
    const csv = leadsToCsv([{ code: 'L-1', company: 'Acme' }], cols);
    expect(csv).toBe('Code,Company\nL-1,Acme');
  });

  it('escapes commas, quotes and newlines', () => {
    const csv = leadsToCsv([{ code: 'L-2', company: 'A,"B"\nC' }], cols);
    expect(csv).toBe('Code,Company\nL-2,"A,""B""\nC"');
  });

  it('handles an empty row list (header only)', () => {
    expect(leadsToCsv<Row>([], cols)).toBe('Code,Company');
  });
});

describe('leadCsvColumns', () => {
  const t = (k: string) =>
    (({ 'form.budget': 'Budget', 'form.region': 'Region' }) as Record<string, string>)[k] ?? k;
  const cols = leadCsvColumns({ t, ownerLabel: () => '', statusLabel: () => '' });

  it('exports budget and region columns', () => {
    const lead = { budget: '30.000€', region: 'Θεσσαλονίκη' } as unknown as LeadRow;
    const csv = leadsToCsv([lead], cols);
    const [header, row] = csv.split('\n');
    expect(header).toContain('Budget');
    expect(header).toContain('Region');
    expect(row).toContain('30.000€');
    expect(row).toContain('Θεσσαλονίκη');
  });
});
