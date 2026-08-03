import { describe, it, expect } from 'vitest';
import { convertibleTargets, canConvert } from './serviceConversion';

describe('convertibleTargets', () => {
  it('offers group-A peers + ai_seo for a standalone web_seo', () => {
    expect(convertibleTargets({ service_type: 'web_seo', parent_job_id: null }).sort())
      .toEqual(['ads', 'ai_seo', 'local_seo', 'social_media']);
  });
  it('offers group-A peers + ai_seo for a standalone local_seo', () => {
    expect(convertibleTargets({ service_type: 'local_seo', parent_job_id: null }).sort())
      .toEqual(['ads', 'ai_seo', 'social_media', 'web_seo']);
  });
  it('offers domains for hosting (no ai_seo for group B)', () => {
    expect(convertibleTargets({ service_type: 'hosting', parent_job_id: null })).toEqual(['domains']);
  });
  it('offers web/local teardown for an ai_seo parent (billing_only)', () => {
    expect(
      convertibleTargets({ service_type: 'ai_seo', parent_job_id: null, billing_only: true }).sort(),
    ).toEqual(['local_seo', 'web_seo']);
  });
  it('offers nothing for a non-parent ai_seo, a child, or web_dev', () => {
    expect(convertibleTargets({ service_type: 'ai_seo', parent_job_id: null })).toEqual([]);
    expect(convertibleTargets({ service_type: 'ai_seo', parent_job_id: 'p' })).toEqual([]);
    expect(convertibleTargets({ service_type: 'web_dev', parent_job_id: null })).toEqual([]);
    expect(convertibleTargets({ service_type: 'web_seo', parent_job_id: 'x' })).toEqual([]);
  });
  it('canConvert reflects target availability', () => {
    expect(canConvert({ service_type: 'web_seo', parent_job_id: null })).toBe(true);
    expect(canConvert({ service_type: 'ai_seo', parent_job_id: null, billing_only: true })).toBe(true);
    expect(canConvert({ service_type: 'web_dev', parent_job_id: null })).toBe(false);
  });
});
