import { describe, it, expect } from 'vitest';
import { areasForJob, canUploadArea, LOCAL_AREA, WEB_AREA, WEBDEV_AREA } from './serviceAreas';

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
  it('other service → no areas', () => {
    expect(areasForJob({ service_type: 'hosting' })).toEqual([]);
  });
});

describe('canUploadArea', () => {
  it('admin can upload any area', () => {
    expect(canUploadArea(true, [], LOCAL_AREA)).toBe(true);
  });
  it('member of the area group can upload', () => {
    expect(canUploadArea(false, ['local_seo'], LOCAL_AREA)).toBe(true);
  });
  it('non-member cannot', () => {
    expect(canUploadArea(false, ['web_seo'], LOCAL_AREA)).toBe(false);
  });
});
