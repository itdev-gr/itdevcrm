import { describe, it, expect } from 'vitest';
import { infoFieldsFor, sharedDealFields, SERVICE_INFO_FIELDS } from './serviceInfoFields';

describe('SERVICE_INFO_FIELDS', () => {
  it('ai_seo combines local + web seo with distinct keys', () => {
    const keys = SERVICE_INFO_FIELDS.ai_seo.map((f) => f.key);
    expect(keys).toEqual([
      'profile_url', 'business_profile', 'local_report_url', 'local_notes',
      'website_username', 'website_password', 'website_path', 'web_report_url', 'seo_notes',
    ]);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it('web_dev has its six fields', () => {
    expect(infoFieldsFor('web_dev').map((f) => f.key)).toEqual([
      'webdev_notes', 'hosting', 'supabase_name', 'temp_url', 'live_url', 'email',
    ]);
  });
  it('ads has a single notes field shared with the deal', () => {
    const fields = infoFieldsFor('ads');
    expect(fields.map((f) => f.key)).toEqual(['ads_notes']);
    expect(fields[0]?.type).toBe('textarea');
    expect(fields[0]?.sharedWithDeal).toBe(true);
  });
  it('returns [] for a service without an Info tab', () => {
    expect(infoFieldsFor('social_media')).toEqual([]);
  });
});

describe('sharedDealFields', () => {
  it('returns only populated notes + report urls, never credentials', () => {
    const out = sharedDealFields('web_seo', {
      website_username: 'u', website_password: 'p',
      web_report_url: 'https://r', seo_notes: 'hello',
    });
    expect(out.map((f) => f.key)).toEqual(['web_report_url', 'seo_notes']);
  });
  it('skips empty values', () => {
    expect(sharedDealFields('local_seo', { local_notes: '' })).toEqual([]);
  });
  it('flows ads notes through to the deal', () => {
    expect(sharedDealFields('ads', { ads_notes: 'campaign paused' }).map((f) => f.key)).toEqual([
      'ads_notes',
    ]);
  });
});
