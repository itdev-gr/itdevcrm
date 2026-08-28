import { describe, it, expect } from 'vitest';
import { sanitizeServiceBlock, buildServiceBlocks } from './_offer-pdf-core';

describe('sanitizeServiceBlock', () => {
  it('strips {{variables}} an admin pastes in (the PDF never interpolates)', () => {
    expect(sanitizeServiceBlock('Γεια σας {{name}}, προσφορά {{ offer_number }}.')).toBe(
      'Γεια σας , προσφορά .',
    );
  });

  it('trims whitespace-only bodies to empty', () => {
    expect(sanitizeServiceBlock('   \n\n  ')).toBe('');
  });
});

describe('buildServiceBlocks', () => {
  it('maps offer_svc_* keys to categories, dropping empty bodies', () => {
    const blocks = buildServiceBlocks([
      { key: 'offer_svc_local_seo', body: 'Τοπική προώθηση.' },
      { key: 'offer_svc_web_dev', body: '   ' },
      { key: 'offer_svc_ads', body: '{{name}}' },
    ]);
    expect(blocks).toEqual({ local_seo: 'Τοπική προώθηση.' });
  });
});
