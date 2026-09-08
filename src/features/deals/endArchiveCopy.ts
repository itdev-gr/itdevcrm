import type { TFunction } from 'i18next';
import type { JobBillingRow } from './hooks/useJobsBilling';

/** Ποσό σε ευρώ, ελληνική μορφή: 240,50 € */
function eur(amount: number): string {
  return `${amount.toFixed(2).replace('.', ',')} €`;
}

/**
 * Το End σε αυτό το job θα αφήσει (ή μπορεί να αφήσει) κάρτα Local SEO στο
 * Closed μέχρι το GBP disconnect, αντί να αρχειοθετήσει αμέσως (απόφαση Α,
 * 2026-09-08):
 * - local_seo job χωρίς disconnected_at → σίγουρα·
 * - AI SEO billing record (billing_only γονιός) → το «AI SEO — Local» παιδί
 *   του μπορεί (το panel δεν βλέπει το disconnect state του παιδιού).
 */
export function endDefersForDisconnect(
  job: Pick<JobBillingRow, 'department' | 'billing_only' | 'disconnected_at'>,
): boolean {
  if (job.department === 'local_seo') return job.disconnected_at == null;
  return job.department === 'ai_seo' && job.billing_only === true;
}

/**
 * Κείμενο του παραθύρου επιβεβαίωσης του End. Η προειδοποίηση για ανεξόφλητα
 * ΔΕΝ μπλοκάρει (απόφαση ιδιοκτήτη 2026-09-04) — απλώς λέει τι χρωστιέται.
 * `null` σημαίνει «δεν ξέρουμε ακόμη», όχι «μηδέν»: δεν προειδοποιούμε τότε.
 * `defersForDisconnect` προσθέτει τη σημείωση ότι η κάρτα Local SEO μένει στο
 * Closed μέχρι το disconnect (βλ. endDefersForDisconnect).
 */
export function endConfirmBody(
  t: TFunction,
  unpaidGross: number | null,
  defersForDisconnect = false,
): string {
  let body = t('jobs_billing.end_confirm_body');
  if (unpaidGross !== null && Number.isFinite(unpaidGross) && unpaidGross > 0) {
    body = `${body} ${t('jobs_billing.end_confirm_unpaid', { amount: eur(unpaidGross) })}`;
  }
  if (defersForDisconnect) {
    body = `${body} ${t('jobs_billing.end_confirm_disconnect_defer')}`;
  }
  return body;
}
