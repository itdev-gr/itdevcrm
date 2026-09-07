import { describe, it, expect } from 'vitest';
import { renderCampaignEmail, campaignTags, unsubscribeHeaders } from './render';

const UNSUB_URL = 'https://www.itdevcrm.com/api/campaign-unsubscribe?r=11111111-1111-1111-1111-111111111111&t=22222222-2222-2222-2222-222222222222';

describe('renderCampaignEmail', () => {
  it('includes the unsubscribe link in the html (HTML-escaped, as an href)', () => {
    const { html } = renderCampaignEmail({
      bodyMd: 'Γεια σας,\n\nΝέα προσφορά.',
      heroImageUrl: null,
      displayName: 'Κώστας',
      unsubscribeUrl: UNSUB_URL,
    });
    // The URL itself contains `&`, which must be HTML-escaped inside the
    // href attribute — assert the escaped form is present and used as a link.
    expect(html).toContain(`href="${UNSUB_URL.replace(/&/g, '&amp;')}"`);
  });

  it('renders the body markdown into the html and a plain-text twin', () => {
    const { html, text } = renderCampaignEmail({
      bodyMd: '## Τίτλος\n\nΈνα **έντονο** κείμενο.',
      heroImageUrl: null,
      displayName: 'Μαρία',
      unsubscribeUrl: UNSUB_URL,
    });
    expect(html).toContain('<h3');
    expect(html).toContain('<strong>έντονο</strong>');
    expect(text).toContain('Τίτλος');
    expect(text).toContain('έντονο');
    expect(text).not.toContain('**');
  });

  it('includes a hero image row only when a valid https hero URL is given', () => {
    const withHero = renderCampaignEmail({
      bodyMd: 'κείμενο',
      heroImageUrl: 'https://www.itdevcrm.com/email-assets/hero.jpg',
      displayName: null,
      unsubscribeUrl: UNSUB_URL,
    });
    expect(withHero.html).toContain('<img src="https://www.itdevcrm.com/email-assets/hero.jpg"');

    const withoutHero = renderCampaignEmail({
      bodyMd: 'κείμενο',
      heroImageUrl: null,
      displayName: null,
      unsubscribeUrl: UNSUB_URL,
    });
    expect(withoutHero.html).not.toContain('<img');
  });

  it('does not render a non-https hero URL (defensive: never trust an arbitrary scheme)', () => {
    const { html } = renderCampaignEmail({
      bodyMd: 'κείμενο',
      heroImageUrl: 'javascript:alert(1)',
      displayName: null,
      unsubscribeUrl: UNSUB_URL,
    });
    expect(html).not.toContain('<img');
  });

  it('interpolates the display name into the greeting when present', () => {
    const { html, text } = renderCampaignEmail({
      bodyMd: 'κείμενο',
      heroImageUrl: null,
      displayName: 'Ελένη Παπαδοπούλου',
      unsubscribeUrl: UNSUB_URL,
    });
    expect(html).toContain('Ελένη Παπαδοπούλου');
    expect(text).toContain('Ελένη Παπαδοπούλου');
  });

  it('falls back to a neutral Greek greeting when displayName is missing, blank, or whitespace', () => {
    for (const displayName of [null, '', '   ']) {
      const { html, text } = renderCampaignEmail({
        bodyMd: 'κείμενο',
        heroImageUrl: null,
        displayName,
        unsubscribeUrl: UNSUB_URL,
      });
      expect(html.toLowerCase()).not.toContain('undefined');
      expect(text.toLowerCase()).not.toContain('undefined');
      expect(html).toContain('Γεια σας,');
      expect(text.trim().length).toBeGreaterThan(0);
    }
  });

  it('always produces a non-empty plaintext alternative', () => {
    const { text } = renderCampaignEmail({
      bodyMd: 'Μόνο ένα σύντομο κείμενο.',
      heroImageUrl: null,
      displayName: null,
      unsubscribeUrl: UNSUB_URL,
    });
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain('Μόνο ένα σύντομο κείμενο.');
    expect(text).toContain(UNSUB_URL);
  });

  it('escapes HTML in the body rather than rendering it raw (bodyMd is markdown-lite, not HTML)', () => {
    const { html } = renderCampaignEmail({
      bodyMd: '<script>alert(1)</script>',
      heroImageUrl: null,
      displayName: null,
      unsubscribeUrl: UNSUB_URL,
    });
    expect(html).not.toContain('<script>');
  });
});

describe('campaignTags', () => {
  it('returns exactly the three expected tags: mkt, campaign, recipient', () => {
    const tags = campaignTags('c-123', 'r-456');
    expect(tags).toHaveLength(3);
    expect(tags).toEqual([
      { name: 'mkt', value: '1' },
      { name: 'campaign', value: 'c-123' },
      { name: 'recipient', value: 'r-456' },
    ]);
  });
});

describe('unsubscribeHeaders', () => {
  it('produces both required headers, correctly formatted', () => {
    const headers = unsubscribeHeaders(UNSUB_URL);
    expect(Object.keys(headers).sort()).toEqual(['List-Unsubscribe', 'List-Unsubscribe-Post'].sort());
    expect(headers['List-Unsubscribe']).toBe(`<${UNSUB_URL}>`);
    expect(headers['List-Unsubscribe']?.startsWith('<')).toBe(true);
    expect(headers['List-Unsubscribe']?.endsWith('>')).toBe(true);
    expect(headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });
});
