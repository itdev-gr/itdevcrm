import { describe, it, expect } from 'vitest';
import { renderBody, renderContractHtml } from './_contract-pdf-template.js';

describe('renderBody', () => {
  it('renders ## lines as section headings', () => {
    const html = renderBody('## Άρθρο 1 – Αντικείμενο\n\nΚείμενο άρθρου.');
    expect(html).toContain('<h3 class="sec">Άρθρο 1 – Αντικείμενο</h3>');
    expect(html).toContain('<p>Κείμενο άρθρου.</p>');
  });

  it('renders dash lines as a real list', () => {
    const html = renderBody('- πρώτο\n- δεύτερο');
    expect(html).toContain('<ul><li>πρώτο</li><li>δεύτερο</li></ul>');
  });

  it('turns 3+ underscore runs into fill-in spans', () => {
    const html = renderBody('ΑΦΜ: ______');
    expect(html).toContain('class="fill"');
    expect(html).not.toContain('______');
  });

  it('keeps short underscore runs literal and escapes HTML', () => {
    const html = renderBody('a __ b <script>x</script>');
    expect(html).toContain('a __ b');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('groups consecutive lines into one paragraph with line breaks', () => {
    const html = renderBody('γραμμή 1\nγραμμή 2\n\nγραμμή 3');
    expect(html).toContain('<p>γραμμή 1<br/>γραμμή 2</p>');
    expect(html).toContain('<p>γραμμή 3</p>');
  });
});

describe('renderContractHtml', () => {
  const base = {
    contractNumber: 'CTR-202608-0001',
    title: 'ΣΥΜΒΑΣΗ SEO',
    body: 'ΣΥΜΒΑΣΗ SEO\n\n## Άρθρο 1\n\nΚείμενο.',
    clientName: 'Acme SA',
    contactName: 'Maria P',
    email: 'a@b.gr',
    phone: '210',
    vatNumber: 'EL1',
    address: 'Stadiou 1',
    createdAt: '2026-08-21T12:00:00Z',
  };

  it('drops a leading body line that repeats the title', () => {
    const html = renderContractHtml(base);
    // The title appears exactly once — as the H1, not again as a body paragraph.
    expect(html.match(/ΣΥΜΒΑΣΗ SEO/g)?.length).toBe(1);
    expect(html).toContain('<h1 class="title">ΣΥΜΒΑΣΗ SEO</h1>');
    expect(html).not.toContain('<p>ΣΥΜΒΑΣΗ SEO</p>');
  });

  it('renders client and provider party cards', () => {
    const html = renderContractHtml(base);
    expect(html).toContain('Acme SA');
    expect(html).toContain('ΑΦΜ: EL1');
    expect(html).toContain('IT. DEV E.E.');
    expect(html).toContain('Για τον Πάροχο');
    expect(html).toContain('Για τον Πελάτη');
  });
});
