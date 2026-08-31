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
  it('caps at 200 chars after composing', () => {
    const long = 'Α'.repeat(190);
    const out = leadTitle(long, 'Local SEO', false);
    expect(out.length).toBe(200);
    expect(out.startsWith('Α')).toBe(true);
  });
});
