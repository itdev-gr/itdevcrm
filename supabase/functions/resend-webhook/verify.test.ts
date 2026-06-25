import { describe, it, expect } from 'vitest';
import { statusForResendEvent } from './verify';

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
