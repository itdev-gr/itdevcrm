import { describe, it, expect } from 'vitest';
import { toYeastarContact } from './mapContact';

const row = {
  id: '11111111-2222-3333-4444-555555555555',
  name: 'Acme SA',
  contact_first_name: 'Maria',
  contact_last_name: 'Papadopoulou',
  email: 'maria@acme.gr',
  phone: '+30 210 1234567',
  source: 'client' as const,
};

describe('toYeastarContact', () => {
  it('maps a client row into the Yeastar contact envelope', () => {
    const out = toYeastarContact(row, 'https://crm.itdev.gr/');
    expect(out).toEqual({
      contact: {
        id: '11111111-2222-3333-4444-555555555555',
        firstname: 'Maria',
        lastname: 'Papadopoulou',
        company: 'Acme SA',
        email: 'maria@acme.gr',
        businessphone: '+30 210 1234567',
        mobilephone: '',
        url: 'https://crm.itdev.gr/clients/11111111-2222-3333-4444-555555555555',
      },
    });
  });

  it('points lead rows at the sales route and tolerates null fields', () => {
    const out = toYeastarContact(
      { ...row, source: 'lead', contact_first_name: null, contact_last_name: null, email: null },
      'https://crm.itdev.gr',
    );
    expect(out.contact.firstname).toBe('');
    expect(out.contact.email).toBe('');
    expect(out.contact.url).toBe(
      'https://crm.itdev.gr/sales/leads/11111111-2222-3333-4444-555555555555',
    );
  });
});
