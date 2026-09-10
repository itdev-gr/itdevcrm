export type OfferItem = {
  category: string;
  itemId: string;
  label: string;
  description: string;
  unitPrice: number;
  qty: number;
  lineTotal: number;
  /** Selected sub-packages — their prices are folded into lineTotal, but the
   *  labels are persisted so the PDF/detail views can show what's included.
   *  `code` is the catalog code (stored since 2026-09-10 so the PDF can
   *  re-home hosting/support extras to their own row/category). */
  subpackages?: { code?: string; label: string; price: number }[];
};

export type OfferTotals = {
  subtotal: number;
  discountAmount: number;
  taxable: number;
  vatAmount: number;
  total: number;
};
