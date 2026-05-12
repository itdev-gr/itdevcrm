import { describe, it, expect } from 'vitest';
import { canCreateAssignedTask } from './canCreateAssignedTask';

describe('canCreateAssignedTask', () => {
  it('allows admins regardless of groups', () => {
    expect(canCreateAssignedTask({ isAdmin: true, groupCodes: [] })).toBe(true);
  });
  it('allows accounting members', () => {
    expect(
      canCreateAssignedTask({ isAdmin: false, groupCodes: ['accounting'] }),
    ).toBe(true);
  });
  it('allows any tech group member', () => {
    for (const g of ['web_seo','local_seo','web_dev','social_media','ai_seo','hosting','ads']) {
      expect(canCreateAssignedTask({ isAdmin: false, groupCodes: [g] })).toBe(true);
    }
  });
  it('denies sales-only members', () => {
    expect(
      canCreateAssignedTask({ isAdmin: false, groupCodes: ['sales'] }),
    ).toBe(false);
  });
  it('denies users with no groups', () => {
    expect(canCreateAssignedTask({ isAdmin: false, groupCodes: [] })).toBe(false);
  });
});
