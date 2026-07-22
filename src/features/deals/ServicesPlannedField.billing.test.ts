import { describe, it, expect } from 'vitest';
import { billingOptionsFor, defaultBillingFor } from './ServicesPlannedField';

describe('billingOptionsFor', () => {
  it('offers monthly + one-time for a standard service', () => {
    expect(billingOptionsFor('web_seo')).toEqual(['recurring_monthly', 'one_time']);
  });

  it('restricts hosting to yearly only', () => {
    expect(billingOptionsFor('hosting')).toEqual(['recurring_yearly']);
  });

  it('restricts franchise to one-time only', () => {
    expect(billingOptionsFor('franchise')).toEqual(['one_time']);
  });
});

describe('defaultBillingFor', () => {
  it('defaults franchise to one-time', () => {
    expect(defaultBillingFor('franchise')).toBe('one_time');
  });
});
