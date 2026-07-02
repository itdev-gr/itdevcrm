import { describe, it, expect } from 'vitest';
import { jobEmailStatus } from './jobEmailStatus';

const web = { service_type: 'web_seo', client_email: 'a@b.com' };
const local = { service_type: 'local_seo', client_email: 'a@b.com' };
const ads = { service_type: 'ads', client_email: 'a@b.com' };

describe('jobEmailStatus', () => {
  it('web_seo with a sent GSC email -> sent', () => {
    const map = { 'webseo_gsc_access|a@b.com': '2026-07-01T00:00:00Z' };
    expect(jobEmailStatus(web, map)).toEqual({ state: 'sent', templateKey: 'webseo_gsc_access', lastSent: '2026-07-01T00:00:00Z' });
  });
  it('local_seo with no send -> not_sent', () => {
    expect(jobEmailStatus(local, {})).toEqual({ state: 'not_sent', templateKey: 'localseo_gbp_access', lastSent: null });
  });
  it('ads (no onboarding email) -> coming_soon', () => {
    expect(jobEmailStatus(ads, {})).toEqual({ state: 'coming_soon', templateKey: null, lastSent: null });
  });
  it('email match is case-insensitive', () => {
    const map = { 'webseo_gsc_access|a@b.com': '2026-07-01T00:00:00Z' };
    expect(jobEmailStatus({ ...web, client_email: 'A@B.com' }, map).state).toBe('sent');
  });
});
