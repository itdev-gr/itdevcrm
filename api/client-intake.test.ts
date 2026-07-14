import { describe, it, expect } from 'vitest';
import {
  filterPatch,
  logoStoragePath,
  fileStoragePath,
  firstForwardedFor,
  INTAKE_PATCH_KEYS,
} from './client-intake';
import { sanitizeIntakeFileName } from '../src/lib/clientIntake';

describe('filterPatch (draft whitelist)', () => {
  it('keeps only recognised schema fields', () => {
    const out = filterPatch({
      description: 'hello',
      contact_email: 'a@b.gr',
      domain_suggestions: ['x.gr'],
      // not on the whitelist:
      status: 'locked',
      token: 'evil',
      job_id: 'other',
      __proto__polluted: true,
    });
    expect(out).toEqual({
      description: 'hello',
      contact_email: 'a@b.gr',
      domain_suggestions: ['x.gr'],
    });
  });

  it('returns an empty object when nothing is whitelisted', () => {
    expect(filterPatch({ status: 'x', foo: 1 })).toEqual({});
  });

  it('whitelist covers every intake schema field name', () => {
    // Guards against the schema and the whitelist drifting apart.
    expect(new Set(INTAKE_PATCH_KEYS)).toEqual(
      new Set([
        'description',
        'recommended_site',
        'contact_email',
        'contact_phone',
        'contact_whatsapp',
        'wants_whatsapp_button',
        'whatsapp_button_number',
        'has_existing_domain',
        'existing_domain',
        'domain_suggestions',
      ]),
    );
  });
});

describe('storage path builders', () => {
  const jobId = '11111111-1111-1111-1111-111111111111';

  it('builds a stable logo path under the job folder', () => {
    expect(logoStoragePath(jobId, 'brand.png')).toBe(`job/${jobId}/logo-brand.png`);
  });

  it('builds a unique file path with the supplied id prefix', () => {
    expect(fileStoragePath(jobId, 'abc-uuid', 'photo.jpg')).toBe(`job/${jobId}/abc-uuid-photo.jpg`);
  });

  it('paths use the shared sanitiser output for non-ASCII names', () => {
    const safe = sanitizeIntakeFileName('Τιμολόγιο.pdf');
    expect(fileStoragePath(jobId, 'id', safe)).toBe(`job/${jobId}/id-${safe}`);
    // sanity: the raw Greek name is not present in the key
    expect(fileStoragePath(jobId, 'id', safe)).not.toContain('Τιμολόγιο');
  });
});

describe('firstForwardedFor', () => {
  it('takes the first value of a comma-joined header', () => {
    expect(firstForwardedFor('1.2.3.4, 5.6.7.8')).toBe('1.2.3.4');
  });

  it('takes the first element of an array header', () => {
    expect(firstForwardedFor(['9.9.9.9', '8.8.8.8'])).toBe('9.9.9.9');
  });

  it('falls back to "unknown" when the header is absent or empty', () => {
    expect(firstForwardedFor(undefined)).toBe('unknown');
    expect(firstForwardedFor('')).toBe('unknown');
    expect(firstForwardedFor('   ')).toBe('unknown');
  });
});
