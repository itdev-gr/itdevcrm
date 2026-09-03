import { describe, it, expect } from 'vitest';
import { canCreateOffer } from './canCreateOffer';

describe('canCreateOffer', () => {
  it('allows admins regardless of group', () => {
    expect(canCreateOffer({ isAdmin: true, groupCodes: [] })).toBe(true);
    expect(canCreateOffer({ isAdmin: true, groupCodes: ['web_dev'] })).toBe(true);
  });

  it('allows sales and accounting', () => {
    expect(canCreateOffer({ isAdmin: false, groupCodes: ['sales'] })).toBe(true);
    expect(canCreateOffer({ isAdmin: false, groupCodes: ['accounting'] })).toBe(true);
    expect(canCreateOffer({ isAdmin: false, groupCodes: ['web_dev', 'accounting'] })).toBe(true);
  });

  it('denies the technical boards and the group-less', () => {
    for (const g of ['web_dev', 'web_seo', 'local_seo', 'social_media', 'ai_seo', 'hosting', 'ads', 'support']) {
      expect(canCreateOffer({ isAdmin: false, groupCodes: [g] })).toBe(false);
    }
    expect(canCreateOffer({ isAdmin: false, groupCodes: [] })).toBe(false);
  });
});
