export type CountryCode = 'GR' | 'CY';

export type CountryEntry = {
  code: CountryCode;
  // Stored value goes into clients.country / leads.country (matches existing
  // free-text data: "Greece" / "Cyprus"). Frontend reads/writes this label.
  storedValue: string;
  vatRate: number;
};

export const COUNTRIES: CountryEntry[] = [
  { code: 'GR', storedValue: 'Greece', vatRate: 0.24 },
  { code: 'CY', storedValue: 'Cyprus', vatRate: 0.0 },
];

export const DEFAULT_VAT_RATE = 0.24;

export function vatRateFor(country: string | null | undefined): number {
  if (!country) return DEFAULT_VAT_RATE;
  const match = COUNTRIES.find((c) => c.storedValue.toLowerCase() === country.trim().toLowerCase());
  return match?.vatRate ?? DEFAULT_VAT_RATE;
}

export function formatEur(amount: number): string {
  return `€${amount.toFixed(2)}`;
}
