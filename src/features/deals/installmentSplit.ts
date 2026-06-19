/** Installment plans offered for one-time web_dev jobs. */
export type InstallmentPlan = 'none' | '50_50' | '50_25_25';

/** Per-installment ratios for each plan, in payment order. */
const RATIOS: Record<InstallmentPlan, number[]> = {
  none: [1],
  '50_50': [0.5, 0.5],
  '50_25_25': [0.5, 0.25, 0.25],
};

/** How many payments a plan produces (1 = no split). */
export function planCount(plan: InstallmentPlan): number {
  return RATIOS[plan].length;
}

/**
 * Split a net amount into installment parts for the given plan.
 *
 * Works in integer cents so there is no floating-point drift, and rounds each
 * part half-away-from-zero (matching Postgres `round(numeric, 2)` so the DB
 * generation produces identical figures). The LAST part absorbs the cent
 * remainder, guaranteeing the parts sum exactly to the original amount.
 */
export function splitInstallments(amountNet: number, plan: InstallmentPlan): number[] {
  const ratios = RATIOS[plan];
  const totalCents = Math.round((amountNet || 0) * 100);
  const parts: number[] = [];
  let allocated = 0;
  for (let i = 0; i < ratios.length; i += 1) {
    const cents = i === ratios.length - 1 ? totalCents - allocated : Math.round(totalCents * ratios[i]);
    allocated += cents;
    parts.push(cents / 100);
  }
  return parts;
}
