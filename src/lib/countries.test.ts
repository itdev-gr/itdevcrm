import { describe, it, expect } from 'vitest';
import { vatRateFor, effectiveVatRate, DEFAULT_VAT_RATE } from './countries';

describe('vatRateFor', () => {
  it('returns the country rate', () => {
    expect(vatRateFor('Greece')).toBe(0.24);
    expect(vatRateFor('Cyprus')).toBe(0);
    expect(vatRateFor('United Arab Emirates')).toBe(0);
  });
  it('is case-insensitive and trims whitespace', () => {
    expect(vatRateFor('united arab emirates ')).toBe(0);
  });
  it('defaults when country is unknown/empty', () => {
    expect(vatRateFor(null)).toBe(DEFAULT_VAT_RATE);
    expect(vatRateFor('Narnia')).toBe(DEFAULT_VAT_RATE);
  });
});

describe('effectiveVatRate', () => {
  it('cash without charge-VAT is 0, regardless of country', () => {
    expect(effectiveVatRate('cash', 'Greece', false)).toBe(0);
    expect(effectiveVatRate('cash', 'Cyprus', false)).toBe(0);
    expect(effectiveVatRate('cash', null, false)).toBe(0);
  });
  it('cash WITH charge-VAT uses the country rate', () => {
    expect(effectiveVatRate('cash', 'Greece', true)).toBe(0.24);
    expect(effectiveVatRate('Cash', 'Greece', true)).toBe(0.24); // case-insensitive
    expect(effectiveVatRate('cash', 'Cyprus', true)).toBe(0);
  });
  it('non-cash ignores the flag and uses the country rate', () => {
    expect(effectiveVatRate('online', 'Greece', false)).toBe(0.24);
    expect(effectiveVatRate('online', 'Greece', true)).toBe(0.24);
    expect(effectiveVatRate('', 'Greece', false)).toBe(0.24);
    expect(effectiveVatRate(null, 'Greece', false)).toBe(0.24);
  });
  it('applies the UAE 0% rate like Cyprus', () => {
    expect(effectiveVatRate('bank', 'United Arab Emirates', false)).toBe(0);
  });
});
