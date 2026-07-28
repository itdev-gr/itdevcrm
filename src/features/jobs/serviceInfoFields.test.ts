import { describe, it, expect } from 'vitest';
import { infoFieldsFor, sharedDealFields, selectOptions, SERVICE_INFO_FIELDS } from './serviceInfoFields';
import { INDUSTRIES } from '@/lib/industries';

describe('SERVICE_INFO_FIELDS', () => {
  it('ai_seo combines local + web seo with distinct keys', () => {
    const keys = SERVICE_INFO_FIELDS.ai_seo.map((f) => f.key);
    expect(keys).toEqual([
      'profile_url', 'business_profile', 'local_report_url', 'local_notes',
      'website', 'website_username', 'website_password', 'website_path', 'web_report_url', 'seo_notes',
    ]);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it('web_dev leads with website + industry + due date then its six base fields', () => {
    expect(infoFieldsFor('web_dev').map((f) => f.key)).toEqual([
      'website', 'industry', 'due_date', 'webdev_notes', 'hosting', 'supabase_name', 'temp_url', 'live_url', 'email',
    ]);
  });
  it('web_dev due date is a date field not shared with the deal', () => {
    const due = infoFieldsFor('web_dev').find((f) => f.key === 'due_date');
    expect(due?.type).toBe('date');
    expect(due?.sharedWithDeal).toBeUndefined();
  });
  it('web_dev industry is a select backed by INDUSTRIES', () => {
    const industry = infoFieldsFor('web_dev').find((f) => f.key === 'industry');
    expect(industry?.type).toBe('select');
    expect(industry?.options?.map((o) => o.value)).toEqual(INDUSTRIES.map((i) => i.code));
  });
  it('web_dev website is a url field', () => {
    expect(infoFieldsFor('web_dev').find((f) => f.key === 'website')?.type).toBe('url');
  });
  it('ads has a single notes field shared with the deal', () => {
    const fields = infoFieldsFor('ads');
    expect(fields.map((f) => f.key)).toEqual(['ads_notes']);
    expect(fields[0]?.type).toBe('textarea');
    expect(fields[0]?.sharedWithDeal).toBe(true);
  });
  it('social_media has a single notes field shared with the deal', () => {
    const fields = infoFieldsFor('social_media');
    expect(fields.map((f) => f.key)).toEqual(['social_notes']);
    expect(fields[0]?.type).toBe('textarea');
    expect(fields[0]?.sharedWithDeal).toBe(true);
  });
  it('returns [] for a service without an Info tab', () => {
    expect(infoFieldsFor('hosting')).toEqual([]);
  });
  it('domains has a single Domain text field', () => {
    expect(infoFieldsFor('domains').map((f) => f.key)).toEqual(['domain']);
    expect(infoFieldsFor('domains')[0]?.type).toBe('text');
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
  it('flows social notes through to the deal', () => {
    expect(sharedDealFields('social_media', { social_notes: 'reels scheduled' }).map((f) => f.key)).toEqual([
      'social_notes',
    ]);
  });
});

describe('selectOptions', () => {
  const industry = infoFieldsFor('web_dev').find((f) => f.key === 'industry')!;

  it('leads with a blank option and localizes labels', () => {
    const en = selectOptions(industry, '', 'en');
    expect(en[0]).toEqual({ value: '', label: '—' });
    expect(en[1]).toEqual({ value: 'technology', label: 'Technology / IT' });
    const el = selectOptions(industry, '', 'el');
    expect(el[1]).toEqual({ value: 'technology', label: 'Τεχνολογία / IT' });
  });

  it('keeps an unknown/legacy value as a one-off trailing option', () => {
    const out = selectOptions(industry, 'agriculture', 'en');
    expect(out.at(-1)).toEqual({ value: 'agriculture', label: 'agriculture (legacy)' });
  });

  it('adds no legacy option for a known or empty value', () => {
    expect(selectOptions(industry, 'retail', 'en').some((o) => o.label.includes('(legacy)'))).toBe(false);
    expect(selectOptions(industry, '', 'en').some((o) => o.label.includes('(legacy)'))).toBe(false);
  });
});
