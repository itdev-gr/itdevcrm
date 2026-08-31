import { describe, it, expect } from 'vitest';
import { canViewJobPricing, canDeleteJob } from './permissions';

describe('canViewJobPricing', () => {
  it('allows admins', () => {
    expect(canViewJobPricing(true, [])).toBe(true);
  });

  it('allows the accounting group', () => {
    expect(canViewJobPricing(false, ['accounting'])).toBe(true);
  });

  it('hides pricing from technical/service teams and sales', () => {
    expect(canViewJobPricing(false, ['web_seo', 'local_seo'])).toBe(false);
    expect(canViewJobPricing(false, ['web_dev'])).toBe(false);
    expect(canViewJobPricing(false, ['sales'])).toBe(false);
    expect(canViewJobPricing(false, [])).toBe(false);
  });
});

describe('canDeleteJob', () => {
  it('admins can always delete', () => {
    expect(canDeleteJob(true, [], '2026-08-01T00:00:00Z')).toBe(true);
    expect(canDeleteJob(true, [], null)).toBe(true);
  });
  it('accounting can delete only while the deal was never Paid In Full', () => {
    expect(canDeleteJob(false, ['accounting'], null)).toBe(true);
    expect(canDeleteJob(false, ['accounting'], undefined)).toBe(true);
    expect(canDeleteJob(false, ['accounting'], '2026-08-01T00:00:00Z')).toBe(false);
  });
  it('everyone else never deletes', () => {
    expect(canDeleteJob(false, ['local_seo'], null)).toBe(false);
    expect(canDeleteJob(false, [], null)).toBe(false);
  });
});
