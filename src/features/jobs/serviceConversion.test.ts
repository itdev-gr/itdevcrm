import { describe, it, expect } from 'vitest';
import { convertibleTargets, canConvert } from './serviceConversion';

describe('convertibleTargets', () => {
  it('offers same-group peers for group A', () => {
    expect(convertibleTargets({ service_type: 'web_seo', parent_job_id: null }).sort())
      .toEqual(['ads', 'local_seo', 'social_media']);
  });
  it('offers domains for hosting (group B)', () => {
    expect(convertibleTargets({ service_type: 'hosting', parent_job_id: null })).toEqual(['domains']);
  });
  it('offers nothing for ai_seo / web_dev / children', () => {
    expect(convertibleTargets({ service_type: 'ai_seo', parent_job_id: null })).toEqual([]);
    expect(convertibleTargets({ service_type: 'web_dev', parent_job_id: null })).toEqual([]);
    expect(convertibleTargets({ service_type: 'web_seo', parent_job_id: 'x' })).toEqual([]);
    expect(convertibleTargets({ service_type: 'web_seo', parent_job_id: null, hasChildren: true })).toEqual([]);
  });
  it('canConvert reflects target availability', () => {
    expect(canConvert({ service_type: 'web_seo', parent_job_id: null })).toBe(true);
    expect(canConvert({ service_type: 'web_dev', parent_job_id: null })).toBe(false);
  });
});
