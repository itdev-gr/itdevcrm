import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { todayLocalISO, maxPaidDateISO, paidAtFromDate } from './paymentsPaidDate';

// No @types/node in this project's tsconfig (browser/vite lib set) — declare
// just enough of the ambient `process` to read/restore TZ for the test below.
declare const process: { env: Record<string, string | undefined> };

// Local-time constructors (not UTC ISO strings) so these assertions don't
// depend on the test runner's timezone.
const AUG_27_2026 = new Date(2026, 7, 27, 12, 0, 0);
const DEC_31_2026 = new Date(2026, 11, 31, 12, 0, 0);

describe('paymentsPaidDate', () => {
  it('todayLocalISO formats as yyyy-mm-dd', () => {
    expect(todayLocalISO(AUG_27_2026)).toBe('2026-08-27');
  });

  it('maxPaidDateISO is one day after today', () => {
    expect(maxPaidDateISO(AUG_27_2026)).toBe('2026-08-28');
  });

  it('maxPaidDateISO rolls over year boundaries', () => {
    expect(maxPaidDateISO(DEC_31_2026)).toBe('2027-01-01');
  });

  it('paidAtFromDate builds a midnight-UTC ISO payload', () => {
    expect(paidAtFromDate('2026-08-20')).toBe('2026-08-20T00:00:00Z');
  });
});

describe('paymentsPaidDate — early-morning timezone edge (M1/T2)', () => {
  const originalTZ = process.env.TZ;

  beforeAll(() => {
    process.env.TZ = 'Europe/Athens';
  });

  afterAll(() => {
    process.env.TZ = originalTZ;
  });

  it('reads the LOCAL date, not the UTC date, just after local midnight', () => {
    // 2026-08-27T22:30:00Z is 2026-08-28 01:30 in Athens (UTC+3 in August).
    // The old bug (`toISOString().slice(0, 10)`) would report the row's day
    // as still 2026-08-27 at this instant, defaulting a "mark paid today"
    // picker to yesterday until ~03:00 local time.
    const earlyMorningAthens = new Date('2026-08-27T22:30:00Z');
    expect(todayLocalISO(earlyMorningAthens)).toBe('2026-08-28');
    // Demonstrate the bug this guards against: the naive UTC-slice approach
    // gets it wrong at exactly this instant.
    expect(earlyMorningAthens.toISOString().slice(0, 10)).toBe('2026-08-27');
  });

  it('maxPaidDateISO also stays on the LOCAL day at the same edge', () => {
    const earlyMorningAthens = new Date('2026-08-27T22:30:00Z');
    expect(maxPaidDateISO(earlyMorningAthens)).toBe('2026-08-29');
  });
});
