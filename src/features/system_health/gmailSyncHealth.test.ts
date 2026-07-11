import { describe, it, expect } from 'vitest';
import { gmailSyncMessage } from './gmailSyncHealth';

describe('gmailSyncMessage', () => {
  it('returns null when healthy or missing', () => {
    expect(gmailSyncMessage(null)).toBeNull();
    expect(gmailSyncMessage({ status: 'ok' })).toBeNull();
    expect(gmailSyncMessage({ accounts: 3, stale_accounts: 0 })).toBeNull();
    expect(gmailSyncMessage({ accounts: 0, stale_accounts: 0 })).toBeNull();
  });
  it('maps some-stale to an amber banner', () => {
    const b = gmailSyncMessage({ accounts: 3, stale_accounts: 1 });
    expect(b?.severity).toBe('degraded');
    expect(b?.text).toBe('Gmail sync: 1 of 3 mailbox(es) stale (30+ min)');
  });
  it('maps all-stale to a red banner', () => {
    const b = gmailSyncMessage({ accounts: 3, stale_accounts: 3 });
    expect(b?.severity).toBe('down');
    expect(b?.text).toBe('Gmail sync: 3 of 3 mailbox(es) stale (30+ min)');
  });
});
