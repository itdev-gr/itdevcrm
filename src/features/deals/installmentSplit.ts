/** Installment plans offered for one-time web_dev jobs. */
export type InstallmentPlan = 'none' | '50_50' | '50_25_25' | 'custom';

/**
 * Per-installment ratios for each ratio-split plan, in payment order.
 * 'custom' is intentionally absent — its parts come from the editor, not a
 * ratio split, so splitInstallments/planCount are never called for it.
 */
const RATIOS: Record<Exclude<InstallmentPlan, 'custom'>, number[]> = {
  none: [1],
  '50_50': [0.5, 0.5],
  '50_25_25': [0.5, 0.25, 0.25],
};

/** Ratios for a plan, falling back to a single full payment (covers 'custom'). */
function ratiosFor(plan: InstallmentPlan): number[] {
  return plan === 'custom' ? [1] : RATIOS[plan];
}

/** How many payments a plan produces (1 = no split). */
export function planCount(plan: InstallmentPlan): number {
  return ratiosFor(plan).length;
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
  const ratios = ratiosFor(plan);
  const totalCents = Math.round((amountNet || 0) * 100);
  const parts: number[] = [];
  let allocated = 0;
  for (let i = 0; i < ratios.length; i += 1) {
    const cents =
      i === ratios.length - 1 ? totalCents - allocated : Math.round(totalCents * (ratios[i] ?? 0));
    allocated += cents;
    parts.push(cents / 100);
  }
  return parts;
}
