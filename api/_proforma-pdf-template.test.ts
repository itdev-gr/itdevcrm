import { describe, it, expect } from 'vitest';
import { renderProFormaHtml } from './_proforma-pdf-template';

const baseArgs = {
  proFormaId: '11111111-2222-3333-4444-555555555555',
  proFormaNumber: 'PRF-202609-0007',
  clientName: 'Κώστας',
  companyName: 'Artdance',
  email: 'x@y.gr',
  currency: 'EUR',
  vatPercent: 24,
  validityDays: 14,
  notes: null as string | null,
  items: [
    { category: 'web_dev', itemId: 'site', label: 'Ιστοσελίδα', description: '', unitPrice: 900, qty: 1, lineTotal: 900 },
  ],
  totals: { subtotal: 900, discountAmount: 0, taxable: 900, vatAmount: 216, total: 1116 },
  createdAt: '2026-09-10T00:00:00Z',
};

describe('renderProFormaHtml notes', () => {
  // Same defect as the offer template (owner report 2026-09-10): a bare <p>
  // collapsed the stored newlines into one run-on block.
  it('renders multiline notes as separate paragraphs with line breaks', () => {
    const html = renderProFormaHtml({
      ...baseArgs,
      notes: '1. Δόση Α — 500€\nΜε την ανάθεση.\n\n2. Δόση Β — 500€\nΜε την παράδοση.',
    });
    expect(html).toContain('1. Δόση Α — 500€<br>Με την ανάθεση.');
    expect(html).toContain('<p class="text-sm text-gray-700">2. Δόση Β — 500€<br>Με την παράδοση.</p>');
    expect(html).not.toContain('Με την ανάθεση. 2. Δόση Β');
  });

  it('still escapes HTML inside notes', () => {
    const html = renderProFormaHtml({ ...baseArgs, notes: 'A <b>bold</b> & claim' });
    expect(html).toContain('A &lt;b&gt;bold&lt;/b&gt; &amp; claim');
    expect(html).not.toContain('A <b>bold</b>');
  });

  it('renders no notes section when notes is null', () => {
    expect(renderProFormaHtml(baseArgs)).not.toContain('Σημειώσεις');
  });
});
