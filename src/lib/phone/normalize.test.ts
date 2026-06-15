import { describe, it, expect } from 'vitest';
import { normalizePhone, phoneToTelHref } from './normalize';

describe('normalizePhone', () => {
  it('reduces any Greek format to the last 10 national digits', () => {
    expect(normalizePhone('+30 691 234 5678')).toBe('6912345678');
    expect(normalizePhone('691 234 5678')).toBe('6912345678');
    expect(normalizePhone('00306912345678')).toBe('6912345678');
    expect(normalizePhone('+30 210 1234567')).toBe('2101234567');
  });
  it('returns empty string for withheld / junk / too-short numbers', () => {
    expect(normalizePhone('')).toBe('');
    expect(normalizePhone(null)).toBe('');
    expect(normalizePhone('anonymous')).toBe('');
    expect(normalizePhone('123')).toBe('');
  });
});

describe('phoneToTelHref', () => {
  it('builds a tel: URI, assuming +30 for bare 10-digit numbers', () => {
    expect(phoneToTelHref('691 234 5678')).toBe('tel:6912345678');
    expect(phoneToTelHref('+1 234 567 8900')).toBe('tel:+12345678900');
  });
  it('returns null when there is nothing dialable', () => {
    expect(phoneToTelHref('')).toBeNull();
    expect(phoneToTelHref(null)).toBeNull();
    expect(phoneToTelHref('12')).toBeNull();
  });
});
