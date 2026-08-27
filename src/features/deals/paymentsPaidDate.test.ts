import { describe, it, expect } from 'vitest';
import { todayDateString, maxPaidDateString, paidAtFromDate } from './paymentsPaidDate';

// Local-time constructors (not UTC ISO strings) so these assertions don't
// depend on the test runner's timezone.
const AUG_27_2026 = new Date(2026, 7, 27, 12, 0, 0);
const DEC_31_2026 = new Date(2026, 11, 31, 12, 0, 0);

describe('paymentsPaidDate', () => {
  it('todayDateString formats as yyyy-mm-dd', () => {
    expect(todayDateString(AUG_27_2026)).toBe('2026-08-27');
  });

  it('maxPaidDateString is one day after today', () => {
    expect(maxPaidDateString(AUG_27_2026)).toBe('2026-08-28');
  });

  it('maxPaidDateString rolls over year boundaries', () => {
    expect(maxPaidDateString(DEC_31_2026)).toBe('2027-01-01');
  });

  it('paidAtFromDate builds a midnight-UTC ISO payload', () => {
    expect(paidAtFromDate('2026-08-20')).toBe('2026-08-20T00:00:00Z');
  });
});
