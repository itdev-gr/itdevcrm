import { describe, it, expect } from 'vitest';
import { emailStatusColor, summarizeEmailStatuses } from './emailStatusColor';

describe('emailStatusColor', () => {
  it('delivered -> green', () => expect(emailStatusColor('delivered')).toBe('green'));
  it('sent -> yellow', () => expect(emailStatusColor('sent')).toBe('yellow'));
  it('bounced/failed/complained/unknown -> red', () => {
    expect(emailStatusColor('bounced')).toBe('red');
    expect(emailStatusColor('failed')).toBe('red');
    expect(emailStatusColor('complained')).toBe('red');
    expect(emailStatusColor('anything')).toBe('red');
  });
});

describe('summarizeEmailStatuses', () => {
  it('counts a mixed set', () => {
    expect(
      summarizeEmailStatuses([
        { status: 'delivered' }, { status: 'delivered' },
        { status: 'sent' }, { status: 'bounced' }, { status: 'failed' },
      ]),
    ).toEqual({ green: 2, yellow: 1, red: 2, total: 5 });
  });
  it('handles empty', () =>
    expect(summarizeEmailStatuses([])).toEqual({ green: 0, yellow: 0, red: 0, total: 0 }));
});
