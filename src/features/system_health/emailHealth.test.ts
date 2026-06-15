import { describe, it, expect } from 'vitest';
import { emailHealthMessage } from './emailHealth';

describe('emailHealthMessage', () => {
  it('returns null when healthy or missing', () => {
    expect(emailHealthMessage(null)).toBeNull();
    expect(emailHealthMessage({ status: 'ok' })).toBeNull();
  });
  it('maps down to a red banner with the reason', () => {
    expect(emailHealthMessage({ status: 'down', reason: 'drain last ran 7200s ago' })).toEqual({
      severity: 'down',
      text: 'Email: drain last ran 7200s ago',
    });
  });
  it('maps degraded to an amber banner', () => {
    const b = emailHealthMessage({ status: 'degraded', reason: '4 email(s) stuck pending' });
    expect(b?.severity).toBe('degraded');
    expect(b?.text).toBe('Email: 4 email(s) stuck pending');
  });
  it('falls back to a generic reason when none provided', () => {
    expect(emailHealthMessage({ status: 'down' })?.text).toBe('Email: pipeline is down');
  });
});
