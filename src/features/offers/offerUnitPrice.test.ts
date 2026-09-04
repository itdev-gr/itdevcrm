import { describe, it, expect } from 'vitest';
import { getUnitPrice } from './OfferBuilderPage';

type Pkg = Parameters<typeof getUnitPrice>[0];

// Only the two fields getUnitPrice reads; the rest of CatalogPackage is noise here.
const pkg = (oneTime: number, monthly: number) =>
  ({ default_one_time_amount: oneTime, default_monthly_amount: monthly }) as Pkg;

describe('getUnitPrice', () => {
  it('uses the catalogue price when nothing was typed', () => {
    expect(getUnitPrice(pkg(500, 0), undefined)).toBe(500);
    expect(getUnitPrice(pkg(0, 120), undefined)).toBe(120);
    expect(getUnitPrice(pkg(0, 0), undefined)).toBe(0);
  });

  it('lets a typed price beat the catalogue — this is what accounting was missing', () => {
    // Before 2026-09-04 the catalogue default won and the field was not even
    // rendered for priced packages, so an offer could not carry a negotiated
    // figure.
    expect(getUnitPrice(pkg(500, 0), 350)).toBe(350);
    expect(getUnitPrice(pkg(0, 120), 90)).toBe(90);
  });

  it('accepts 0 as a real typed price, not as "unset"', () => {
    // A line given away for free is a legitimate offer. A falsy check here
    // would silently bill the list price instead.
    expect(getUnitPrice(pkg(500, 0), 0)).toBe(0);
  });
});
