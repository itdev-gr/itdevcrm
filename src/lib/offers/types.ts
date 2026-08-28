export type OfferItem = {
  category: string;
  itemId: string;
  label: string;
  description: string;
  unitPrice: number;
  qty: number;
  lineTotal: number;
  /** Selected sub-packages — their prices are folded into lineTotal, but the
   *  labels are persisted so the PDF/detail views can show what's included. */
  subpackages?: { label: string; price: number }[];
};

export type OfferTotals = {
  subtotal: number;
  discountAmount: number;
  taxable: number;
  vatAmount: number;
  total: number;
};
