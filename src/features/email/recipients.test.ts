import { describe, it, expect } from 'vitest';
import {
  parseRecipientList,
  parseAddressList,
} from '../../../supabase/functions/_shared/recipients.ts';

describe('parseRecipientList', () => {
  it('accepts a comma string, trims, lowercases, dedupes', () => {
    expect(parseRecipientList(' A@b.gr , c@d.gr,, a@B.gr ')).toEqual(['a@b.gr', 'c@d.gr']);
  });
  it('accepts an array', () => {
    expect(parseRecipientList(['a@b.gr', 'C@d.gr'])).toEqual(['a@b.gr', 'c@d.gr']);
  });
  it('returns [] for empty/absent input', () => {
    expect(parseRecipientList(undefined)).toEqual([]);
    expect(parseRecipientList('')).toEqual([]);
    expect(parseRecipientList([])).toEqual([]);
  });
  it('returns null when any entry is invalid', () => {
    expect(parseRecipientList('a@b.gr, not-an-email')).toBeNull();
    expect(parseRecipientList('a@b.gr, x@y')).toBeNull();
  });
  it('returns null on header-injection attempts', () => {
    expect(parseRecipientList('a@b.gr\r\nBcc: evil@x.gr')).toBeNull();
  });
  it('returns null above 10 recipients', () => {
    const eleven = Array.from({ length: 11 }, (_, i) => `u${i}@x.gr`).join(',');
    expect(parseRecipientList(eleven)).toBeNull();
    const ten = Array.from({ length: 10 }, (_, i) => `u${i}@x.gr`).join(',');
    expect(parseRecipientList(ten)).toHaveLength(10);
  });
  it('rejects non-string non-array input', () => {
    expect(parseRecipientList(42)).toBeNull();
    expect(parseRecipientList({})).toBeNull();
  });
});

describe('parseAddressList', () => {
  it('parses a Cc header with display names', () => {
    expect(parseAddressList('"K, Maria" <m@itdev.gr>, plain@x.gr')).toEqual([
      'm@itdev.gr',
      'plain@x.gr',
    ]);
  });
  it('returns [] for empty header', () => {
    expect(parseAddressList('')).toEqual([]);
  });
  it('drops unparsable fragments instead of failing', () => {
    expect(parseAddressList('m@itdev.gr, garbage')).toEqual(['m@itdev.gr']);
  });
});
