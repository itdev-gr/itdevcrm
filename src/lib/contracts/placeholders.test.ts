import { describe, it, expect } from 'vitest';
import {
  CONTRACT_PLACEHOLDERS,
  buildPlaceholderData,
  resolvePlaceholders,
} from './placeholders';

const client = {
  name: 'Acme SA',
  email: 'billing@acme.gr',
  phone: '2101234567',
  vat_number: 'EL123456789',
  address: 'Stadiou 1',
  city: 'Athens',
  postcode: '10564',
  country: 'Greece',
  contact_first_name: 'Maria',
  contact_last_name: 'Papadopoulou',
};

describe('buildPlaceholderData', () => {
  it('maps client card fields to placeholder values', () => {
    const d = buildPlaceholderData(client, new Date(2026, 5, 11));
    expect(d.client_name).toBe('Acme SA');
    expect(d.contact_full_name).toBe('Maria Papadopoulou');
    expect(d.vat_number).toBe('EL123456789');
    expect(d.date).toBe('11/06/2026');
  });

  it('turns null fields into empty strings', () => {
    const d = buildPlaceholderData(
      { ...client, phone: null, contact_first_name: null, contact_last_name: null },
      new Date(2026, 5, 11),
    );
    expect(d.phone).toBe('');
    expect(d.contact_full_name).toBe('');
  });
});

describe('resolvePlaceholders', () => {
  it('replaces {{key}} tokens, tolerating inner whitespace', () => {
    const out = resolvePlaceholders(
      'Μεταξύ της ITDEV και της {{client_name}} ({{ vat_number }}), {{date}}.',
      buildPlaceholderData(client, new Date(2026, 5, 11)),
    );
    expect(out).toBe('Μεταξύ της ITDEV και της Acme SA (EL123456789), 11/06/2026.');
  });

  it('replaces unknown placeholders with an empty string', () => {
    expect(resolvePlaceholders('x {{nope}} y', {})).toBe('x  y');
  });
});

describe('CONTRACT_PLACEHOLDERS', () => {
  it('every advertised placeholder resolves to a defined value', () => {
    const d = buildPlaceholderData(client, new Date(2026, 5, 11));
    for (const key of CONTRACT_PLACEHOLDERS) {
      expect(d[key], key).toBeDefined();
    }
  });
});
