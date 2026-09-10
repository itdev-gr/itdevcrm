import { describe, it, expect } from 'vitest';
import { billingOptionsFor, defaultBillingFor, inferBillingForPackage } from './ServicesPlannedField';

describe('billingOptionsFor', () => {
  it('offers monthly + one-time for a standard service', () => {
    expect(billingOptionsFor('web_seo')).toEqual(['recurring_monthly', 'one_time']);
  });

  it('restricts hosting to yearly only', () => {
    expect(billingOptionsFor('hosting')).toEqual(['recurring_yearly']);
  });

  it('restricts domains to yearly only (hosting mirror)', () => {
    expect(billingOptionsFor('domains')).toEqual(['recurring_yearly']);
    expect(defaultBillingFor('domains')).toBe('recurring_yearly');
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

// Owner report 2026-09-10: picking the one-time-only «Δημιουργία GBP» package
// on a Local SEO row left the row on «Monthly 0€» while the pricing summary
// counted the one-time amount — the billing must follow the package's shape.
describe('inferBillingForPackage', () => {
  it('flips a monthly row to one-time for a one-time-only package (GBP creation)', () => {
    expect(inferBillingForPackage('recurring_monthly', 'local_seo', 120, 0)).toBe('one_time');
  });

  it('flips a one-time row back to monthly for a monthly-only package', () => {
    expect(inferBillingForPackage('one_time', 'local_seo', 0, 250)).toBe('recurring_monthly');
  });

  it('keeps the current billing for a package with both amounts', () => {
    expect(inferBillingForPackage('recurring_monthly', 'local_seo', 300, 250)).toBe('recurring_monthly');
  });

  it('never leaves the service\'s allowed options (hosting stays yearly)', () => {
    expect(inferBillingForPackage('recurring_yearly', 'hosting', 120, 0)).toBe('recurring_yearly');
  });
});
