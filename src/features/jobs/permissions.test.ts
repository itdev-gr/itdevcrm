import { describe, it, expect } from 'vitest';
import { canViewJobPricing } from './permissions';

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
