import { describe, it, expect } from 'vitest';
import { areasForJob, canUploadArea, LOCAL_AREA, WEB_AREA, WEBDEV_AREA } from './serviceAreas';

describe('areasForJob', () => {
  it('ai_seo parent → Local + Web', () => {
    expect(areasForJob({ service_type: 'ai_seo', parent_job_id: null })).toEqual([LOCAL_AREA, WEB_AREA]);
  });
  it('local_seo → Local', () => {
    expect(areasForJob({ service_type: 'local_seo', parent_job_id: null })).toEqual([LOCAL_AREA]);
  });
  it('web_seo → Web', () => {
    expect(areasForJob({ service_type: 'web_seo', parent_job_id: null })).toEqual([WEB_AREA]);
  });
  it('web_dev → Web Dev', () => {
    expect(areasForJob({ service_type: 'web_dev', parent_job_id: null })).toEqual([WEBDEV_AREA]);
  });
  it('AI SEO child (has parent) → no areas', () => {
    expect(areasForJob({ service_type: 'local_seo', parent_job_id: 'p1' })).toEqual([]);
  });
  it('other service → no areas', () => {
    expect(areasForJob({ service_type: 'hosting', parent_job_id: null })).toEqual([]);
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
