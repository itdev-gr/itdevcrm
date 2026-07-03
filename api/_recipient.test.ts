import { describe, it, expect } from 'vitest';
import { resolveOfferRecipient } from './_recipient';

describe('resolveOfferRecipient', () => {
  it('uses the client when one is linked (contact name preferred)', () => {
    const r = resolveOfferRecipient(
      {
        name: 'Acme Ltd',
        email: 'acct@acme.gr',
        contact_first_name: 'Maria',
        contact_last_name: 'Pap',
      },
      null,
    );
    expect(r.clientName).toBe('Maria Pap');
    expect(r.companyName).toBe('Acme Ltd');
    expect(r.email).toBe('acct@acme.gr');
  });

  it('falls back to the lead when there is no linked client (the normal new-offer case)', () => {
    const r = resolveOfferRecipient(null, {
      company_name: 'Beta EE',
      email: 'lead@beta.gr',
      contact_first_name: 'Nikos',
      contact_last_name: 'Georgiou',
    });
    expect(r.clientName).toBe('Nikos Georgiou');
    expect(r.companyName).toBe('Beta EE');
    expect(r.email).toBe('lead@beta.gr');
  });

  it('uses the company name for the lead when there is no contact name', () => {
    const r = resolveOfferRecipient(null, {
      company_name: 'Gamma AE',
      email: null,
      contact_first_name: null,
      contact_last_name: null,
    });
    expect(r.clientName).toBe('Gamma AE');
  });

  it('prefers the client over the lead when both exist', () => {
    const r = resolveOfferRecipient(
      { name: 'Acme Ltd', email: null, contact_first_name: 'Maria', contact_last_name: null },
      { company_name: 'Beta EE', email: null, contact_first_name: 'Nikos', contact_last_name: null },
    );
    expect(r.clientName).toBe('Maria');
    expect(r.companyName).toBe('Acme Ltd');
  });

  it('only falls back to the literal "Client" when there is neither client nor lead', () => {
    const r = resolveOfferRecipient(null, null);
    expect(r.clientName).toBe('Client');
    expect(r.companyName).toBeNull();
    expect(r.email).toBeNull();
  });
});
