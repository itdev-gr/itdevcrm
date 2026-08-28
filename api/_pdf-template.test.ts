import { describe, it, expect } from 'vitest';
import { renderOfferHtml } from './_pdf-template';

const baseArgs = {
  offerId: '11111111-2222-3333-4444-555555555555',
  offerNumber: 'OFR-202608-0042',
  clientName: 'Κώστας',
  companyName: 'Artdance',
  email: 'x@y.gr',
  currency: 'EUR',
  vatPercent: 24,
  validityDays: 14,
  notes: null,
  items: [
    { category: 'local_seo', itemId: 'local-basic', label: 'Local SEO Basic', description: 'GBP', unitPrice: 200, qty: 1, lineTotal: 200 },
    { category: 'web_dev', itemId: 'site', label: 'Ιστοσελίδα', description: '', unitPrice: 900, qty: 1, lineTotal: 900 },
  ],
  totals: { subtotal: 1100, discountAmount: 0, taxable: 1100, vatAmount: 264, total: 1364 },
  createdAt: '2026-08-28T00:00:00Z',
};

describe('renderOfferHtml service blocks', () => {
  it('renders each category description above its item bullets', () => {
    const html = renderOfferHtml({
      ...baseArgs,
      serviceBlocks: {
        local_seo: 'Ενισχύουμε την τοπική σας παρουσία.\n\nΠεριλαμβάνει GBP.',
        web_dev: 'Κατασκευάζουμε σύγχρονες ιστοσελίδες.',
      },
    });
    expect(html).toContain('<p class="text-sm text-gray-700">Ενισχύουμε την τοπική σας παρουσία.</p>');
    expect(html).toContain('<p class="text-sm text-gray-700">Περιλαμβάνει GBP.</p>');
    expect(html).toContain('Κατασκευάζουμε σύγχρονες ιστοσελίδες.');
    // the description sits before the category's first item bullet
    expect(html.indexOf('Ενισχύουμε την τοπική')).toBeLessThan(html.indexOf('Local SEO Basic'));
  });

  it('renders identically to today when no serviceBlocks are given', () => {
    expect(renderOfferHtml(baseArgs)).toBe(renderOfferHtml({ ...baseArgs, serviceBlocks: {} }));
  });

  it('escapes HTML inside a block and skips categories without one', () => {
    const html = renderOfferHtml({
      ...baseArgs,
      serviceBlocks: { local_seo: 'A <b>bold</b> & claim' },
    });
    expect(html).toContain('A &lt;b&gt;bold&lt;/b&gt; &amp; claim');
    expect(html).not.toContain('A <b>bold</b>');
  });
});
