import { describe, it, expect } from 'vitest';
import { calculateTotals, formatEur } from './calculate';
import type { OfferItem } from './types';

const item = (lineTotal: number): OfferItem => ({
  category: 'web_dev',
  itemId: 'x',
  label: 'X',
  description: '',
  unitPrice: lineTotal,
  qty: 1,
  lineTotal,
});

describe('calculateTotals', () => {
  it('sums line totals into subtotal', () => {
    const r = calculateTotals([item(100), item(200)], 0, 0);
    expect(r.subtotal).toBe(300);
    expect(r.total).toBe(300);
  });

  it('clamps discount to subtotal', () => {
    const r = calculateTotals([item(100)], 500, 0);
    expect(r.discountAmount).toBe(100);
    expect(r.taxable).toBe(0);
    expect(r.total).toBe(0);
  });

  it('applies VAT to the post-discount taxable', () => {
    const r = calculateTotals([item(100)], 0, 24);
    expect(r.vatAmount).toBeCloseTo(24);
    expect(r.total).toBeCloseTo(124);
  });

  it('rejects negative discount', () => {
    const r = calculateTotals([item(100)], -50, 0);
    expect(r.discountAmount).toBe(0);
  });

  it('produces zeros for an empty cart', () => {
    const r = calculateTotals([], 100, 24);
    expect(r.subtotal).toBe(0);
    expect(r.discountAmount).toBe(0);
    expect(r.total).toBe(0);
  });
});

describe('formatEur', () => {
  it('renders euros with two decimals', () => {
    expect(formatEur(1234.5)).toBe('€1,234.50');
  });
});
