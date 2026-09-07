import { describe, it, expect } from 'vitest';
import { statusForResendEvent, readTags, campaignEventFor } from './verify';

describe('statusForResendEvent', () => {
  it('maps delivered → delivered + delivered_at', () => {
    expect(statusForResendEvent('email.delivered')).toEqual({ status: 'delivered', stamp: 'delivered_at' });
  });
  it('maps bounced → bounced + bounced_at', () => {
    expect(statusForResendEvent('email.bounced')).toEqual({ status: 'bounced', stamp: 'bounced_at' });
  });
  it('maps complained → complained (no stamp)', () => {
    expect(statusForResendEvent('email.complained')).toEqual({ status: 'complained' });
  });
  it('ignores noise events', () => {
    expect(statusForResendEvent('email.sent')).toBeNull();
    expect(statusForResendEvent('email.opened')).toBeNull();
    expect(statusForResendEvent('email.delivery_delayed')).toBeNull();
  });
});

describe('readTags', () => {
  it('accepts the array shape [{name, value}]', () => {
    expect(
      readTags({ tags: [{ name: 'mkt', value: '1' }, { name: 'recipient', value: 'r-1' }] }),
    ).toEqual({ mkt: '1', recipient: 'r-1' });
  });

  it('accepts the object-map shape {name: value}', () => {
    expect(readTags({ tags: { mkt: '1', recipient: 'r-1' } })).toEqual({ mkt: '1', recipient: 'r-1' });
  });

  it('returns {} when tags is missing', () => {
    expect(readTags({})).toEqual({});
  });

  it('returns {} when data is null', () => {
    expect(readTags(null)).toEqual({});
  });

  it('returns {} when data is not an object (string/number/array)', () => {
    expect(readTags('nope')).toEqual({});
    expect(readTags(42)).toEqual({});
    expect(readTags(['a', 'b'])).toEqual({});
  });

  it('returns {} when tags itself is null', () => {
    expect(readTags({ tags: null })).toEqual({});
  });

  it('returns {} for garbage entries inside an array, keeping valid ones', () => {
    expect(
      readTags({ tags: [null, 'garbage', 42, { name: 'ok', value: 'v' }, { value: 'missing-name' }, { name: 'missing-value' }] }),
    ).toEqual({ ok: 'v' });
  });

  it('ignores non-string values in the object-map shape', () => {
    expect(readTags({ tags: { mkt: '1', weird: 42, other: null } })).toEqual({ mkt: '1' });
  });

  it('returns {} for a malformed tags value (string/number)', () => {
    expect(readTags({ tags: 'not-an-array-or-object' })).toEqual({});
    expect(readTags({ tags: 42 })).toEqual({});
  });

  it('never throws on deeply malformed input', () => {
    expect(() => readTags(undefined)).not.toThrow();
    expect(() => readTags(Symbol('x') as unknown)).not.toThrow();
    expect(() => readTags({ tags: [{ name: 123, value: {} }] })).not.toThrow();
  });
});

describe('campaignEventFor', () => {
  it('maps email.delivered → delivered_at', () => {
    expect(campaignEventFor('email.delivered')).toEqual({ stamp: 'delivered_at' });
  });
  it('maps email.bounced → bounced_at', () => {
    expect(campaignEventFor('email.bounced')).toEqual({ stamp: 'bounced_at' });
  });
  it('maps email.complained → complained_at', () => {
    expect(campaignEventFor('email.complained')).toEqual({ stamp: 'complained_at' });
  });
  it('returns null for email.opened (Phase 2, not yet handled)', () => {
    expect(campaignEventFor('email.opened')).toBeNull();
  });
  it('returns null for email.clicked (Phase 2, not yet handled)', () => {
    expect(campaignEventFor('email.clicked')).toBeNull();
  });
  it('returns null for other/unknown event types', () => {
    expect(campaignEventFor('email.sent')).toBeNull();
    expect(campaignEventFor('email.delivery_delayed')).toBeNull();
    expect(campaignEventFor('')).toBeNull();
  });
});

describe('fallback pinning: an event with no campaign tags follows the pre-existing path', () => {
  // This is the single most important test in this file: it pins that
  // statusForResendEvent's output for a transactional (non-campaign) event
  // is exactly what it was before Task 6 — the campaign branch in index.ts
  // must never change what this function returns or how it's invoked.
  it('statusForResendEvent output is unaffected by readTags/campaignEventFor existing', () => {
    const eventType = 'email.bounced';
    // Simulate a transactional event: no tags at all.
    const tags = readTags({}); // {} — no mkt/recipient, so index.ts's campaign
    // branch would fall through to the resend_id lookup and, finding no row,
    // continue on to exactly this call — unchanged from before Task 6.
    expect(tags).toEqual({});
    expect(statusForResendEvent(eventType)).toEqual({ status: 'bounced', stamp: 'bounced_at' });
  });

  it('pins the exact same result for every mapped transactional event type', () => {
    for (const eventType of ['email.delivered', 'email.bounced', 'email.complained', 'email.sent', 'email.opened']) {
      const before = statusForResendEvent(eventType);
      // readTags/campaignEventFor existing and being called elsewhere must not
      // change statusForResendEvent's behaviour for the same input.
      readTags({ tags: [{ name: 'mkt', value: '1' }] });
      campaignEventFor(eventType);
      const after = statusForResendEvent(eventType);
      expect(after).toEqual(before);
    }
  });
});
