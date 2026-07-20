/** i18next-style translate fn bound to the `deals` namespace. */
export type TranslateFn = (key: string, opts: { defaultValue: string }) => string;

/** Translate a known billing error code (e.g. schedule_required); non-codes fall through as-is. */
export function billingErrorMessage(t: TranslateFn, code: string): string {
  return t(`jobs_billing.billing_errors.${code}`, { defaultValue: code });
}

/** Alert an RPC failure: labelled error codes are translated, plain errors keep their message. */
export function reportBillingError(t: TranslateFn, err: unknown) {
  const errors = (err as Error & { errors?: string[] }).errors ?? [(err as Error).message];
  alert(errors.map((code) => (code ? billingErrorMessage(t, code) : String(code))).join('\n'));
}
