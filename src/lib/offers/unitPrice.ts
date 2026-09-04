/** The price of one catalogue line in an offer or a pro forma.
 *
 *  A hand-typed price ALWAYS wins, including 0 — a line given away for free is
 *  a real offer, not a missing value, which is why this takes `undefined`
 *  rather than doing a falsy check. The catalogue is the default, not a
 *  ceiling: before 2026-09-04 the catalogue won and the price field was not
 *  even rendered for priced packages, so accounting — whose deals carry no
 *  planned services to prefill from — was stuck at list prices with no way to
 *  quote a negotiated figure.
 *
 *  Shared by OfferBuilderPage and ProFormaBuilderPage so the two can never
 *  disagree on what a line costs. */
export function unitPriceFor(
  pkg: { default_one_time_amount: number; default_monthly_amount: number },
  customPrice: number | undefined,
): number {
  if (customPrice !== undefined) return customPrice;
  if (pkg.default_one_time_amount > 0) return pkg.default_one_time_amount;
  if (pkg.default_monthly_amount > 0) return pkg.default_monthly_amount;
  return 0;
}
