import { describe, it, expect, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { DEFAULT_DOCUMENT_TITLE, formatPageTitle, useDocumentTitle } from './documentTitle';

describe('formatPageTitle', () => {
  it('combines name, type and code', () => {
    expect(formatPageTitle('Acme Corp', 'Job', '000013-WEBSEO')).toBe(
      'Acme Corp · Job 000013-WEBSEO',
    );
  });

  it('omits the code when none is given', () => {
    expect(formatPageTitle('Acme Corp', 'Deal')).toBe('Acme Corp · Deal');
  });

  it('omits a blank code (no trailing separator)', () => {
    expect(formatPageTitle('Acme Corp', 'Deal', '   ')).toBe('Acme Corp · Deal');
  });

  it('trims whitespace around the name and code', () => {
    expect(formatPageTitle('  Acme Corp  ', 'Offer', '  0042  ')).toBe('Acme Corp · Offer 0042');
  });

  it('returns undefined when the name is missing, so the tab keeps the default title', () => {
    expect(formatPageTitle('', 'Deal')).toBeUndefined();
    expect(formatPageTitle('   ', 'Deal')).toBeUndefined();
    expect(formatPageTitle(null, 'Deal')).toBeUndefined();
    expect(formatPageTitle(undefined, 'Deal')).toBeUndefined();
  });
});

describe('useDocumentTitle', () => {
  afterEach(() => {
    document.title = DEFAULT_DOCUMENT_TITLE;
  });

  it('sets the browser tab title to the given value', () => {
    renderHook(() => useDocumentTitle('Acme Corp · Deal 000013'));
    expect(document.title).toBe('Acme Corp · Deal 000013');
  });

  it('restores the default app title when the page unmounts', () => {
    const { unmount } = renderHook(() => useDocumentTitle('Acme Corp · Deal'));
    expect(document.title).toBe('Acme Corp · Deal');
    unmount();
    expect(document.title).toBe(DEFAULT_DOCUMENT_TITLE);
  });

  it('leaves the current title untouched while the value is empty (data still loading)', () => {
    document.title = 'sentinel';
    renderHook(() => useDocumentTitle(undefined));
    expect(document.title).toBe('sentinel');
  });
});
