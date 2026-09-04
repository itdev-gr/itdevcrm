import { describe, it, expect } from 'vitest';
import { endConfirmBody } from './endArchiveCopy';
import el from '@/i18n/locales/el/deals.json';
import en from '@/i18n/locales/en/deals.json';

const t = ((k: string, o?: Record<string, unknown>) =>
  o && 'amount' in o ? `${k}|${String(o.amount)}` : k) as unknown as Parameters<typeof endConfirmBody>[0];

describe('endConfirmBody', () => {
  it('χωρίς ανεξόφλητα δείχνει μόνο το βασικό κείμενο', () => {
    expect(endConfirmBody(t, 0)).toBe('jobs_billing.end_confirm_body');
  });

  it('όσο δεν ξέρουμε ακόμη το υπόλοιπο, δεν προειδοποιεί', () => {
    expect(endConfirmBody(t, null)).toBe('jobs_billing.end_confirm_body');
  });

  it('με ανεξόφλητα προσθέτει την προειδοποίηση με το ποσό', () => {
    expect(endConfirmBody(t, 240.5)).toBe(
      'jobs_billing.end_confirm_body jobs_billing.end_confirm_unpaid|240,50 €',
    );
  });

  it('αρνητικό ή NaN υπόλοιπο δεν προειδοποιεί', () => {
    expect(endConfirmBody(t, -10)).toBe('jobs_billing.end_confirm_body');
    expect(endConfirmBody(t, Number.NaN)).toBe('jobs_billing.end_confirm_body');
  });
});

// end_and_archive_job can fail with one of these codes (permission_denied,
// job_not_found — e.g. a second, stale tab confirming End after the job was
// already ended+archived elsewhere — or the generic end_archive_failed
// fallback). billingErrors.ts resolves them via
// `jobs_billing.billing_errors.<code>`, falling back to the bare code when a
// key is missing — which is exactly the "user sees literally 'job_not_found'"
// bug this guards against.
describe('end_and_archive_job error codes are translated, not shown raw', () => {
  const codes = ['permission_denied', 'job_not_found', 'end_archive_failed'];

  it.each(codes)('el has real copy for %s', (code) => {
    const msg = (el.jobs_billing.billing_errors as Record<string, string>)[code];
    expect(msg).toBeTruthy();
    expect(msg).not.toBe(code);
  });

  it.each(codes)('en has real copy for %s', (code) => {
    const msg = (en.jobs_billing.billing_errors as Record<string, string>)[code];
    expect(msg).toBeTruthy();
    expect(msg).not.toBe(code);
  });
});
