import type { OfferItem, OfferTotals } from './types';

export function calculateTotals(
  items: OfferItem[],
  discountAmount: number,
  vatPercent: number,
): OfferTotals {
  const subtotal = items.reduce((sum, i) => sum + i.lineTotal, 0);
  const effectiveDiscount = Math.min(Math.max(0, discountAmount), subtotal);
  const taxable = subtotal - effectiveDiscount;
  const vatAmount = taxable * (vatPercent / 100);
  return {
    subtotal,
    discountAmount: effectiveDiscount,
    taxable,
    vatAmount,
    total: taxable + vatAmount,
  };
}

export function formatEur(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR' }).format(amount);
}
