import { describe, it, expect } from 'vitest';
import { leadTitle } from './_lead-title';

describe('leadTitle', () => {
  it('name + form → "Name (Form)"', () => {
    expect(leadTitle('Μαργαρίτα Γραβέζα', 'Local SEO', false)).toBe(
      'Μαργαρίτα Γραβέζα (Local SEO)',
    );
    expect(leadTitle('Γιώργος Παπάς', 'Website', false)).toBe('Γιώργος Παπάς (Website)');
  });
  it('franchise uses the literal Franchise label regardless of the raw form name', () => {
    expect(leadTitle('Νίκος Χ.', 'FRANCHISE ΦΟΡΜΑ ΣΕΠ 2026 v3', true)).toBe('Νίκος Χ. (Franchise)');
    expect(leadTitle('Νίκος Χ.', null, true)).toBe('Νίκος Χ. (Franchise)');
  });
  it('no name → form alone (current behavior)', () => {
    expect(leadTitle(null, 'Web SEO', false)).toBe('Web SEO');
    expect(leadTitle('   ', 'AI SEO', false)).toBe('AI SEO');
  });
  it('no name, franchise → Franchise', () => {
    expect(leadTitle(null, 'whatever franchise form', true)).toBe('Franchise');
  });
  it('neither → Meta lead', () => {
    expect(leadTitle(null, null, false)).toBe('Meta lead');
    expect(leadTitle('', '', false)).toBe('Meta lead');
  });
  it('normalizes known service keywords inside noisy form names', () => {
    expect(leadTitle('Diamantoula Peraki', '📍 LOCAL SEO LEAD FORM — ITDEV', false)).toBe(
      'Diamantoula Peraki (Local SEO)',
    );
    expect(leadTitle('ΑΓΓΕΛΙΚΗ ΣΕΧΗ', '🌐 WEBSITE LEAD FORM — ITDEV-copy', false)).toBe(
      'ΑΓΓΕΛΙΚΗ ΣΕΧΗ (Website)',
    );
    expect(leadTitle('Α Β', 'WEB SEO CAMPAIGN v2', false)).toBe('Α Β (Web SEO)');
    expect(leadTitle('Α Β', 'ai seo φόρμα 2026', false)).toBe('Α Β (AI SEO)');
  });

  it('unknown form names stay raw; SEO forms win over the website keyword', () => {
    expect(leadTitle('Α Β', 'Καμπάνια Σεπτεμβρίου', false)).toBe('Α Β (Καμπάνια Σεπτεμβρίου)');
    expect(leadTitle('Α Β', 'WEBSITE + LOCAL SEO combo', false)).toBe('Α Β (Local SEO)');
  });

  it('caps at 200 chars after composing', () => {
    const long = 'Α'.repeat(190);
    const out = leadTitle(long, 'Local SEO', false);
    expect(out.length).toBe(200);
    expect(out.startsWith('Α')).toBe(true);
  });
});
