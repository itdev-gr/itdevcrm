import { describe, it, expect } from 'vitest';
import { parseCampaignUnsubscribe } from './campaign-unsubscribe';

const RECIPIENT = '11111111-1111-4111-8111-111111111111';
const TOKEN = '22222222-2222-4222-8222-222222222222';

describe('parseCampaignUnsubscribe', () => {
  it('accepts a valid recipient/token uuid pair', () => {
    expect(parseCampaignUnsubscribe({ r: RECIPIENT, t: TOKEN })).toEqual({
      recipient: RECIPIENT,
      token: TOKEN,
    });
  });

  it('rejects a non-UUID recipient', () => {
    expect(parseCampaignUnsubscribe({ r: 'not-a-uuid', t: TOKEN })).toBeNull();
  });

  it('rejects a non-UUID token', () => {
    expect(parseCampaignUnsubscribe({ r: RECIPIENT, t: 'not-a-uuid' })).toBeNull();
  });

  it('rejects a missing parameter', () => {
    expect(parseCampaignUnsubscribe({ r: RECIPIENT })).toBeNull();
    expect(parseCampaignUnsubscribe({ t: TOKEN })).toBeNull();
    expect(parseCampaignUnsubscribe({})).toBeNull();
  });

  it('rejects an array value (?r=a&r=b) instead of silently picking one', () => {
    expect(parseCampaignUnsubscribe({ r: [RECIPIENT, RECIPIENT], t: TOKEN })).toBeNull();
    expect(parseCampaignUnsubscribe({ r: RECIPIENT, t: [TOKEN, TOKEN] })).toBeNull();
  });
});
