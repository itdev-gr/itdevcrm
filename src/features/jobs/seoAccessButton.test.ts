import { describe, it, expect } from 'vitest';
import { seoAccessState, seoAccessConfig } from './seoAccessButton';
import type { JobRow } from './hooks/useJobs';

function makeJob(serviceType: string, email: string | null): JobRow {
  return { service_type: serviceType, client: { email } } as unknown as JobRow;
}

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
  });
});

describe('seoAccessState', () => {
  it('hidden on services without an access email', () => {
    expect(seoAccessState(makeJob('web_dev', 'a@b.gr'), null)).toBe('hidden');
  });
  it('no-email when supported service but client has no email', () => {
    expect(seoAccessState(makeJob('local_seo', null), null)).toBe('no-email');
    expect(seoAccessState(makeJob('web_seo', '   '), null)).toBe('no-email');
  });
  it('idle when supported + email + never sent', () => {
    expect(seoAccessState(makeJob('web_seo', 'a@b.gr'), null)).toBe('idle');
  });
  it('sent when supported + email + a last-sent timestamp', () => {
    expect(seoAccessState(makeJob('local_seo', 'a@b.gr'), '2026-06-26T10:00:00Z')).toBe('sent');
  });
});
