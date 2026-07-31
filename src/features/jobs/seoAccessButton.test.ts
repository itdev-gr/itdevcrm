import { describe, it, expect } from 'vitest';
import { seoAccessConfig, seoFollowupConfig } from './seoAccessButton';

describe('seoAccessConfig', () => {
  it('maps local_seo to the GBP template', () => {
    expect(seoAccessConfig('local_seo')?.templateKey).toBe('localseo_gbp_access');
  });
  it('maps web_seo to the GSC template', () => {
    expect(seoAccessConfig('web_seo')?.templateKey).toBe('webseo_gsc_access');
  });
  it('returns null for services without an access email', () => {
    expect(seoAccessConfig('web_dev')).toBeNull();
    expect(seoAccessConfig('hosting')).toBeNull();
    expect(seoAccessConfig('domains')).toBeNull();
  });
});

describe('seoFollowupConfig', () => {
  it('maps local_seo to the GBP follow-up template', () => {
    expect(seoFollowupConfig('local_seo')?.templateKey).toBe('localseo_gbp_followup');
  });
  it('maps web_seo to the GSC follow-up template', () => {
    expect(seoFollowupConfig('web_seo')?.templateKey).toBe('webseo_gsc_followup');
  });
  it('returns null for services without a follow-up email', () => {
    expect(seoFollowupConfig('web_dev')).toBeNull();
    expect(seoFollowupConfig('social_media')).toBeNull();
    expect(seoFollowupConfig('ads')).toBeNull();
  });
});
