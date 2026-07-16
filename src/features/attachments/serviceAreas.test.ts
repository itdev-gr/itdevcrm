import { describe, it, expect } from 'vitest';
import {
  areasForJob,
  areaForKind,
  canUploadArea,
  LOCAL_AREA,
  WEB_AREA,
  WEBDEV_AREA,
  ADS_AREA,
  SOCIAL_AREA,
} from './serviceAreas';

describe('areasForJob', () => {
  it('ai_seo parent → no area (files live on its children)', () => {
    expect(areasForJob({ service_type: 'ai_seo' })).toEqual([]);
  });
  it('local_seo (standalone or AI SEO child) → Local', () => {
    expect(areasForJob({ service_type: 'local_seo' })).toEqual([LOCAL_AREA]);
  });
  it('web_seo (standalone or AI SEO child) → Web', () => {
    expect(areasForJob({ service_type: 'web_seo' })).toEqual([WEB_AREA]);
  });
  it('web_dev → Web Dev', () => {
    expect(areasForJob({ service_type: 'web_dev' })).toEqual([WEBDEV_AREA]);
  });
  it('ads → Ads', () => {
    expect(areasForJob({ service_type: 'ads' })).toEqual([ADS_AREA]);
  });
  it('social_media → Social Media', () => {
    expect(areasForJob({ service_type: 'social_media' })).toEqual([SOCIAL_AREA]);
  });
  it('other service → no areas', () => {
    expect(areasForJob({ service_type: 'hosting' })).toEqual([]);
  });
});

describe('areaForKind', () => {
  it('resolves the ads/social kinds', () => {
    expect(areaForKind('svc_ads')).toBe(ADS_AREA);
    expect(areaForKind('svc_social')).toBe(SOCIAL_AREA);
  });
  it('non-service kind → null', () => {
    expect(areaForKind('contract')).toBeNull();
  });
});

describe('canUploadArea', () => {
  it('admin can upload any area', () => {
    expect(canUploadArea(true, [], ADS_AREA)).toBe(true);
  });
  it('member of the area group can upload', () => {
    expect(canUploadArea(false, ['local_seo'], LOCAL_AREA)).toBe(true);
    expect(canUploadArea(false, ['ads'], ADS_AREA)).toBe(true);
    expect(canUploadArea(false, ['social_media'], SOCIAL_AREA)).toBe(true);
  });
  it('non-member cannot', () => {
    expect(canUploadArea(false, ['web_seo'], LOCAL_AREA)).toBe(false);
    expect(canUploadArea(false, ['web_seo'], ADS_AREA)).toBe(false);
  });
});
