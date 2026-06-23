import { describe, it, expect } from 'vitest';
import { sanitizeStorageFileName } from './sanitizeStorageKey';

describe('sanitizeStorageFileName', () => {
  it('leaves a plain ASCII filename unchanged', () => {
    expect(sanitizeStorageFileName('invoice-2024.pdf')).toBe('invoice-2024.pdf');
  });

  it('replaces Greek (non-ASCII) characters so the storage key is valid', () => {
    const out = sanitizeStorageFileName('Τιμολόγιο.pdf');
    expect(out).toMatch(/^[a-zA-Z0-9._-]+$/); // only Supabase-safe characters
    expect(out.endsWith('.pdf')).toBe(true);
  });

  it('replaces spaces and parentheses', () => {
    expect(sanitizeStorageFileName('Invoice (final) 2024.pdf')).toBe('Invoice__final__2024.pdf');
  });

  it('keeps ASCII alphanumerics that appear amongst non-ASCII', () => {
    expect(sanitizeStorageFileName('Τιμ123.pdf')).toBe('___123.pdf');
  });

  it('caps the length at 200 characters', () => {
    expect(sanitizeStorageFileName('a'.repeat(300))).toHaveLength(200);
  });
});
