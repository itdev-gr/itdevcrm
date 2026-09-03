import { describe, it, expect } from 'vitest';
import { isPast } from './datetime';

const now = new Date('2026-09-03T12:00:00Z');

describe('isPast', () => {
  it('is true strictly before now and false at or after it', () => {
    expect(isPast('2026-09-03T11:59:59Z', now)).toBe(true);
    expect(isPast('2026-09-03T12:00:00Z', now)).toBe(false);
    expect(isPast('2026-09-03T12:00:01Z', now)).toBe(false);
  });

  it('treats a missing or unparseable value as not past', () => {
    // The no-show button keys off this: a lead with no appointment must never
    // offer to send a missed-appointment email.
    expect(isPast(null, now)).toBe(false);
    expect(isPast(undefined, now)).toBe(false);
    expect(isPast('', now)).toBe(false);
    expect(isPast('not a date', now)).toBe(false);
  });

  it('accepts a Date as well as an ISO string', () => {
    expect(isPast(new Date('2026-09-02T00:00:00Z'), now)).toBe(true);
    expect(isPast(new Date('2026-09-04T00:00:00Z'), now)).toBe(false);
  });
});
