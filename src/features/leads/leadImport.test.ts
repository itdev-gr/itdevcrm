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

  it('matches Meta/Excel Greek headers incl. underscore form', () => {
    expect(mapHeader('αριθμός_τηλεφώνου')).toBe('phone');
    expect(mapHeader('Αριθμός Τηλεφώνου')).toBe('phone');
    expect(mapHeader('όνομα_εταιρείας')).toBe('company');
  });

  it('matches the Meta website-form English phone field work_phone_number', () => {
    expect(mapHeader('work_phone_number')).toBe('phone');
    expect(mapHeader('Work Phone Number')).toBe('phone');
  });

  it('matches the ClickUp/website-form Greek email header "Διεύθυνση email"', () => {
    expect(mapHeader('Διεύθυνση email')).toBe('email');
    expect(mapHeader('διευθυνση email')).toBe('email');
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

  it('maps Meta Greek headers and strips the p: phone prefix', () => {
    const { rows } = mapRowsToLeads([
      { Name: 'George Korfias', email: 'k@x.gr', 'αριθμός_τηλεφώνου': 'p:+41761650096', 'όνομα_εταιρείας': 'SAN GIORGIO' },
    ]);
    expect(rows[0]?.phone).toBe('+41761650096');
    expect(rows[0]?.company).toBe('SAN GIORGIO');
    expect(rows[0]?.full_name).toBe('George Korfias');
  });

  it('maps the work_phone_number column and strips the p: prefix', () => {
    const { rows } = mapRowsToLeads([
      { Name: 'Art Filatov', email: 'art@x.gr', work_phone_number: 'p:306977270071' },
    ]);
    expect(rows[0]?.phone).toBe('306977270071');
  });

  it('maps the website-form "Διεύθυνση email" column into email, not source_data', () => {
    const { rows } = mapRowsToLeads([
      { 'Φόρμα': '🌐 WEBSITE LEAD FORM', 'Διεύθυνση email': 'kyranak30@gmail.com', 'Κανάλι': 'Email' },
    ]);
    expect(rows[0]?.email).toBe('kyranak30@gmail.com');
    expect(rows[0]?.source_data).not.toHaveProperty('Διεύθυνση email');
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
