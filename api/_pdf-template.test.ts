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

  it('labels every service type in Greek, including the formerly missing ones', () => {
    const html = renderOfferHtml({
      ...baseArgs,
      items: [
        { category: 'maintenance', itemId: 'support', label: 'Support plan', description: '', unitPrice: 50, qty: 1, lineTotal: 50 },
        { category: 'domains', itemId: 'domain', label: 'Domain', description: '', unitPrice: 15, qty: 1, lineTotal: 15 },
        { category: 'franchise', itemId: 'fr', label: 'Franchise pack', description: '', unitPrice: 100, qty: 1, lineTotal: 100 },
      ],
    });
    expect(html).toContain('Υποστήριξη');
    expect(html).toContain('Domains');
    expect(html).toContain('Franchise');
    expect(html).not.toContain('>maintenance<');
  });

  // Owner report 2026-09-10: multiline notes were collapsing into one run-on
  // <p> — the newlines exist in the DB but a bare <p> swallows them in HTML.
  it('renders multiline notes as separate paragraphs with line breaks', () => {
    const html = renderOfferHtml({
      ...baseArgs,
      notes: '1. Migration — 100€\nΜεταφορά της ιστοσελίδας.\n\n2. Hosting — 120€\nΕτήσια φιλοξενία.',
    });
    expect(html).toContain('1. Migration — 100€<br>Μεταφορά της ιστοσελίδας.');
    expect(html).toContain('<p class="text-sm text-gray-700">2. Hosting — 120€<br>Ετήσια φιλοξενία.</p>');
    // the two blank-line blocks become two separate <p>, not one glued run.
    expect(html).not.toContain('Μεταφορά της ιστοσελίδας. 2. Hosting');
  });

  // Owner 2026-09-10: sub-packages get their OWN priced table row — no more
  // «+ …» lines folded inside the web-dev row.
  it('renders selected sub-packages as separate priced rows, not "+" lines', () => {
    const html = renderOfferHtml({
      ...baseArgs,
      items: [{
        category: 'web_dev', itemId: 'site', label: 'Ιστοσελίδα', description: '',
        unitPrice: 900, qty: 1, lineTotal: 1000,
        subpackages: [
          { code: 'extra-page', label: 'Extra σελίδα', price: 50 },
          { code: 'extra-diglosso', label: 'Μετάφραση', price: 50 },
        ],
      }],
    });
    expect(html).not.toContain('+ Extra σελίδα');
    expect(html).toContain('<p class="text-sm font-medium text-gray-900">Extra σελίδα</p>');
    expect(html).toContain('<p class="text-sm font-medium text-gray-900">Μετάφραση</p>');
    // the parent row shows its OWN price (lineTotal minus the extras)
    expect(html).toContain('€900.00');
    // each extra carries its own line total
    const matches = html.match(/€50\.00/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  // Η «Δημιουργία Google Business Profile» είναι εφάπαξ (120€ + ΦΠΑ, owner
  // 2026-09-10) — δεν πρέπει να κληρονομεί το «/ μήνα» της local_seo κατηγορίας.
  it('does not suffix the one-time GBP-creation item with "/ μήνα"', () => {
    const html = renderOfferHtml({
      ...baseArgs,
      items: [{
        category: 'local_seo', itemId: 'local-seo-gbp-creation',
        label: 'Δημιουργία Google Business Profile', description: '',
        unitPrice: 120, qty: 1, lineTotal: 120,
      }],
    });
    expect(html).toContain('€120.00');
    expect(html).not.toContain('€120.00 / μήνα');
  });

  it('re-homes hosting/support sub-packages to their own category rows', () => {
    const html = renderOfferHtml({
      ...baseArgs,
      items: [{
        category: 'web_dev', itemId: 'web-dev-professional', label: 'Επαγγελματική Ιστοσελίδα', description: '',
        unitPrice: 400, qty: 1, lineTotal: 755,
        subpackages: [
          { code: 'extra-hosting-simple', label: 'Hosting απλό site', price: 120 },
          { code: 'extra-migration-small', label: 'Migration μικρό site', price: 175 },
          // παλιά προσφορά χωρίς code — ο χαρακτηρισμός πέφτει στο label
          { label: 'Μηνιαίο Support απλό site', price: 60 },
        ],
      }],
    });
    expect(html).toContain('Φιλοξενία');   // hosting category label on the extra's row
    expect(html).toContain('Υποστήριξη');  // support category label (via label fallback)
    expect(html).toContain('€60.00 / μήνα');
    // parent shows 400, not the folded 755
    expect(html).toContain('€400.00');
    // migration has no own category — stays under the parent's
    expect(html).toContain('Migration μικρό site');
  });
});
