import { describe, it, expect } from 'vitest';
import { leadsToCsv, type CsvColumn } from './leadsCsv';

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
