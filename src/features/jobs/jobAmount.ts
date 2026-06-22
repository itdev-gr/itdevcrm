// Compact amount label for a job, by billing cadence. The figure lives in
// jobs.amount_net (the universal amount column): for recurring_monthly it's the
// monthly price, for recurring_yearly it's the ANNUAL price, for one_time the
// one-off price. Returns '—' when there's no amount.
export function jobAmountLabel(
  billingType: string | null,
  amountNet: number | string | null,
  lang: string = 'en',
): string {
  const n = Number(amountNet) || 0;
  if (n <= 0) return '—';
  const v = `€${n.toFixed(0)}`;
  if (billingType === 'recurring_monthly') return `${v}/${lang === 'el' ? 'μήνα' : 'mo'}`;
  if (billingType === 'recurring_yearly') return `${v}/${lang === 'el' ? 'έτος' : 'yr'}`;
  return v;
}
