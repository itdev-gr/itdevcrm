import { describe, expect, it } from 'vitest';
import { jobCardHeading } from './jobCardTitle';

const client = {
  name: 'Acme Ltd',
  contact_first_name: 'Maria',
  contact_last_name: 'Papadopoulou',
};

describe('jobCardHeading', () => {
  it('titles a local_seo card by details.business_profile, moving names to the subtitle', () => {
    const r = jobCardHeading({
      service_type: 'local_seo',
      details: { business_profile: 'Acme Bakery Athens' },
      client,
      deal: { title: 'Acme deal' },
    });
    expect(r.headline).toBe('Acme Bakery Athens');
    expect(r.subtitleParts).toEqual(['Maria Papadopoulou', 'Acme Ltd']);
  });

  it('titles an ai_seo card the same way', () => {
    const r = jobCardHeading({
      service_type: 'ai_seo',
      details: { business_profile: 'Acme Bakery Athens' },
      client,
      deal: null,
    });
    expect(r.headline).toBe('Acme Bakery Athens');
  });

  it('ignores business_profile on other service types', () => {
    const r = jobCardHeading({
      service_type: 'web_dev',
      details: { business_profile: 'Acme Bakery Athens' },
      client,
      deal: null,
    });
    expect(r.headline).toBe('Maria Papadopoulou');
  });

  it('falls back when business_profile is empty or whitespace-only', () => {
    for (const bp of [undefined, null, '', '   ']) {
      const r = jobCardHeading({
        service_type: 'local_seo',
        details: { business_profile: bp },
        client,
        deal: null,
      });
      expect(r.headline).toBe('Maria Papadopoulou');
    }
  });

  it('keeps the fallback chain: contact name, client name, deal title, dash', () => {
    expect(
      jobCardHeading({ service_type: 'local_seo', details: null, client, deal: null }).headline,
    ).toBe('Maria Papadopoulou');
    expect(
      jobCardHeading({
        service_type: 'local_seo',
        details: null,
        client: { name: 'Acme Ltd', contact_first_name: null, contact_last_name: null },
        deal: null,
      }).headline,
    ).toBe('Acme Ltd');
    expect(
      jobCardHeading({
        service_type: 'local_seo',
        details: null,
        client: null,
        deal: { title: 'Acme deal' },
      }).headline,
    ).toBe('Acme deal');
    expect(
      jobCardHeading({ service_type: 'local_seo', details: null, client: null, deal: null })
        .headline,
    ).toBe('—');
  });

  it('in fallback mode, subtitle carries the client name only when a contact name exists', () => {
    expect(
      jobCardHeading({ service_type: 'local_seo', details: null, client, deal: null })
        .subtitleParts,
    ).toEqual(['Acme Ltd']);
    expect(
      jobCardHeading({
        service_type: 'local_seo',
        details: null,
        client: { name: 'Acme Ltd', contact_first_name: null, contact_last_name: null },
        deal: null,
      }).subtitleParts,
    ).toEqual([]);
  });

  it('with a business profile but no contact name, subtitle is just the client name', () => {
    const r = jobCardHeading({
      service_type: 'local_seo',
      details: { business_profile: 'Acme Bakery Athens' },
      client: { name: 'Acme Ltd', contact_first_name: null, contact_last_name: null },
      deal: null,
    });
    expect(r.subtitleParts).toEqual(['Acme Ltd']);
  });
});
