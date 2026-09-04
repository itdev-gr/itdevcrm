import { describe, it, expect } from 'vitest';
import { endConfirmBody } from './endArchiveCopy';

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
