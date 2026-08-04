import { describe, expect, it } from 'vitest';
import { canForceRenewal } from './renewalAction';

const base = { service_type: 'local_seo', archived: false, billing_only: false, stage: { code: 'done' } };

describe('canForceRenewal', () => {
  it('offers the action for a renewable card parked anywhere but Renewal', () => {
    expect(canForceRenewal(base)).toBe(true);
    expect(canForceRenewal({ ...base, stage: { code: 'active' } })).toBe(true);
    expect(canForceRenewal({ ...base, service_type: 'social_media' })).toBe(true);
  });

  it('hides it where there is nothing to force', () => {
    expect(canForceRenewal({ ...base, stage: { code: 'renewal' } })).toBe(false);
    expect(canForceRenewal({ ...base, stage: { code: 'closed' } })).toBe(false);
    expect(canForceRenewal({ ...base, archived: true })).toBe(false);
  });

  it('excludes services with no renewal lane and billing-only records', () => {
    expect(canForceRenewal({ ...base, service_type: 'web_dev' })).toBe(false);
    expect(canForceRenewal({ ...base, service_type: 'hosting' })).toBe(false);
    expect(canForceRenewal({ ...base, service_type: 'ai_seo', billing_only: true })).toBe(false);
  });
});
