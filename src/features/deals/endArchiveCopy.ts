import type { TFunction } from 'i18next';

/** Ποσό σε ευρώ, ελληνική μορφή: 240,50 € */
function eur(amount: number): string {
  return `${amount.toFixed(2).replace('.', ',')} €`;
}

/**
 * Κείμενο του παραθύρου επιβεβαίωσης του End. Η προειδοποίηση για ανεξόφλητα
 * ΔΕΝ μπλοκάρει (απόφαση ιδιοκτήτη 2026-09-04) — απλώς λέει τι χρωστιέται.
 * `null` σημαίνει «δεν ξέρουμε ακόμη», όχι «μηδέν»: δεν προειδοποιούμε τότε.
 */
export function endConfirmBody(t: TFunction, unpaidGross: number | null): string {
  const base = t('jobs_billing.end_confirm_body');
  if (unpaidGross === null || !Number.isFinite(unpaidGross) || unpaidGross <= 0) return base;
  return `${base} ${t('jobs_billing.end_confirm_unpaid', { amount: eur(unpaidGross) })}`;
}
