import { describe, it, expect } from 'vitest';
import { vatRateFor, effectiveVatRate, DEFAULT_VAT_RATE } from './countries';

describe('vatRateFor', () => {
  it('returns the country rate', () => {
    expect(vatRateFor('Greece')).toBe(0.24);
    expect(vatRateFor('Cyprus')).toBe(0);
  });
  it('defaults when country is unknown/empty', () => {
    expect(vatRateFor(null)).toBe(DEFAULT_VAT_RATE);
    expect(vatRateFor('Narnia')).toBe(DEFAULT_VAT_RATE);
  });
});

describe('effectiveVatRate', () => {
  it('cash is always VAT-free, regardless of country', () => {
    expect(effectiveVatRate('cash', 'Greece')).toBe(0);
    expect(effectiveVatRate('cash', 'Cyprus')).toBe(0);
    expect(effectiveVatRate('cash', null)).toBe(0);
    expect(effectiveVatRate('Cash', 'Greece')).toBe(0); // case-insensitive
  });
  it('non-cash uses the country rate', () => {
    expect(effectiveVatRate('online', 'Greece')).toBe(0.24);
    expect(effectiveVatRate('', 'Greece')).toBe(0.24); // unset payment method
    expect(effectiveVatRate(null, 'Greece')).toBe(0.24);
    expect(effectiveVatRate('online', 'Cyprus')).toBe(0);
  });
});
