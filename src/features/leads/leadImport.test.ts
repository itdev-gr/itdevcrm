import { describe, it, expect } from 'vitest';
import { mapHeader, mapRowsToLeads } from './leadImport';

describe('mapHeader', () => {
  it('matches english and greek aliases case-insensitively', () => {
    expect(mapHeader('Email')).toBe('email');
    expect(mapHeader('  E-MAIL ')).toBe('email');
    expect(mapHeader('Τηλέφωνο')).toBe('phone');
    expect(mapHeader('Mobile')).toBe('phone');
    expect(mapHeader('Εταιρεία')).toBe('company');
    expect(mapHeader('Full Name')).toBe('full_name');
    expect(mapHeader('Unknown Col')).toBeNull();
  });
});

describe('mapRowsToLeads', () => {
  it('maps known columns and preserves unknown ones in source_data', () => {
    const { rows } = mapRowsToLeads([
      { Name: 'Maria Pap', Email: 'maria@x.gr', 'Τηλέφωνο': '6900000000', City: 'Athens' },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.full_name).toBe('Maria Pap');
    expect(rows[0]?.email).toBe('maria@x.gr');
    expect(rows[0]?.phone).toBe('6900000000');
    expect(rows[0]?.source_data).toEqual({ City: 'Athens' });
  });

  it('skips rows with no name, email, or phone', () => {
    const { rows, skipped } = mapRowsToLeads([{ Email: 'a@b.gr' }, { City: 'Nowhere' }]);
    expect(rows).toHaveLength(1);
    expect(skipped).toBe(1);
  });

  it('caps at 2000 rows and reports the dropped count', () => {
    const big = Array.from({ length: 2050 }, (_, i) => ({ Email: `u${i}@x.gr` }));
    const { rows, dropped } = mapRowsToLeads(big);
    expect(rows).toHaveLength(2000);
    expect(dropped).toBe(50);
  });
});
