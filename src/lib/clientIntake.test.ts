import { describe, it, expect } from 'vitest';
import {
  intakeFormSchema,
  phoneRegex,
  intakeLinkState,
  missingItems,
  sanitizeIntakeFileName,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  MAX_LOGO_BYTES,
} from './clientIntake';

describe('intakeFormSchema', () => {
  const base = {
    description: 'A description.',
    recommended_site: 'https://example.com',
    contact_email: 'owner@acme.com',
    contact_phone: '+30 210 000 0000',
    contact_whatsapp: '',
    wants_whatsapp_button: false,
    whatsapp_button_number: '',
    has_existing_domain: true,
    existing_domain: 'acme.com',
    domain_suggestions: [],
  };

  it('accepts full valid payload', () => {
    expect(intakeFormSchema.safeParse(base).success).toBe(true);
  });
  it('requires existing_domain when has_existing_domain is true', () => {
    const parsed = intakeFormSchema.safeParse({ ...base, existing_domain: '' });
    expect(parsed.success).toBe(false);
  });
  it('requires 1-3 domain_suggestions when has_existing_domain is false', () => {
    const noDomain = { ...base, has_existing_domain: false, existing_domain: null };
    expect(intakeFormSchema.safeParse({ ...noDomain, domain_suggestions: [] }).success).toBe(false);
    expect(intakeFormSchema.safeParse({ ...noDomain, domain_suggestions: ['a.com'] }).success).toBe(true);
    expect(intakeFormSchema.safeParse({ ...noDomain, domain_suggestions: ['a.com', 'b.com', 'c.com'] }).success).toBe(true);
    expect(intakeFormSchema.safeParse({ ...noDomain, domain_suggestions: ['a', 'b', 'c', 'd'] }).success).toBe(false);
  });
  it('rejects non-URL recommended_site', () => {
    expect(intakeFormSchema.safeParse({ ...base, recommended_site: 'not a url' }).success).toBe(false);
  });
  it('accepts empty recommended_site (optional)', () => {
    const parsed = intakeFormSchema.parse({ ...base, recommended_site: '' });
    expect(parsed.recommended_site).toBe(null);
  });
  it('accepts missing recommended_site key', () => {
    const { recommended_site: _drop, ...rest } = base;
    void _drop;
    const parsed = intakeFormSchema.parse(rest);
    expect(parsed.recommended_site).toBe(null);
  });
  it('trims description', () => {
    const parsed = intakeFormSchema.parse({ ...base, description: '  hello  ' });
    expect(parsed.description).toBe('hello');
  });
  it('requires contact_email', () => {
    expect(intakeFormSchema.safeParse({ ...base, contact_email: '' }).success).toBe(false);
    expect(intakeFormSchema.safeParse({ ...base, contact_email: 'not an email' }).success).toBe(false);
  });
  it('requires contact_phone', () => {
    expect(intakeFormSchema.safeParse({ ...base, contact_phone: '' }).success).toBe(false);
    expect(intakeFormSchema.safeParse({ ...base, contact_phone: 'abc' }).success).toBe(false);
  });
  it('contact_whatsapp is optional', () => {
    const parsed = intakeFormSchema.parse({ ...base, contact_whatsapp: '' });
    expect(parsed.contact_whatsapp).toBe(null);
    expect(intakeFormSchema.safeParse({ ...base, contact_whatsapp: '+306900000000' }).success).toBe(true);
    expect(intakeFormSchema.safeParse({ ...base, contact_whatsapp: 'abc' }).success).toBe(false);
  });
  it('whatsapp_button_number required when wants_whatsapp_button is true', () => {
    expect(intakeFormSchema.safeParse({ ...base, wants_whatsapp_button: true, whatsapp_button_number: '' }).success).toBe(false);
    expect(intakeFormSchema.safeParse({ ...base, wants_whatsapp_button: true, whatsapp_button_number: '+306900000000' }).success).toBe(true);
  });
  it('whatsapp_button_number not required when wants_whatsapp_button is false', () => {
    const parsed = intakeFormSchema.parse({ ...base, wants_whatsapp_button: false, whatsapp_button_number: '' });
    expect(parsed.whatsapp_button_number).toBe(null);
  });
});

describe('phoneRegex', () => {
  it('accepts common international formats', () => {
    expect(phoneRegex.test('+30 210 000 0000')).toBe(true);
    expect(phoneRegex.test('+306900000000')).toBe(true);
  });
  it('rejects garbage', () => {
    expect(phoneRegex.test('abc')).toBe(false);
    expect(phoneRegex.test('')).toBe(false);
  });
});

describe('upload limits', () => {
  it('exposes the expected byte ceilings', () => {
    expect(MAX_FILE_BYTES).toBe(500 * 1024 * 1024);
    expect(MAX_TOTAL_BYTES).toBe(5 * 1024 * 1024 * 1024);
    expect(MAX_LOGO_BYTES).toBe(5 * 1024 * 1024);
  });
});

describe('sanitizeIntakeFileName', () => {
  it('replaces non-ASCII-safe characters with underscore', () => {
    expect(sanitizeIntakeFileName('Τιμολόγιο.pdf')).toBe('_________.pdf');
    expect(sanitizeIntakeFileName('my file (1).png')).toBe('my_file__1_.png');
  });
  it('keeps already-safe names intact', () => {
    expect(sanitizeIntakeFileName('logo_v2.png')).toBe('logo_v2.png');
  });
  it('caps length at 200 characters', () => {
    expect(sanitizeIntakeFileName('a'.repeat(300)).length).toBe(200);
  });
});

describe('intakeLinkState', () => {
  const now = new Date('2026-07-14T12:00:00Z');
  const future = '2026-07-20T12:00:00Z';
  const past = '2026-07-01T12:00:00Z';

  it('returns not_found for a null form', () => {
    expect(intakeLinkState(null, now)).toBe('not_found');
  });
  it('returns locked when status is locked', () => {
    expect(intakeLinkState({ status: 'locked', expires_at: future }, now)).toBe('locked');
  });
  it('returns expired when expires_at is in the past', () => {
    expect(intakeLinkState({ status: 'draft', expires_at: past }, now)).toBe('expired');
  });
  it('returns valid for a live draft', () => {
    expect(intakeLinkState({ status: 'draft', expires_at: future }, now)).toBe('valid');
  });
  it('keeps a submitted (not locked) link valid — reopenable until locked', () => {
    expect(intakeLinkState({ status: 'submitted', expires_at: future }, now)).toBe('valid');
  });
  it('locked beats expired', () => {
    expect(intakeLinkState({ status: 'locked', expires_at: past }, now)).toBe('locked');
  });
  it('treats expires_at exactly at now as expired', () => {
    expect(intakeLinkState({ status: 'draft', expires_at: now.toISOString() }, now)).toBe('expired');
  });
});

describe('missingItems', () => {
  const fullData = {
    description: 'A description.',
    contact_email: 'owner@acme.com',
    contact_phone: '+30 210 000 0000',
    has_existing_domain: true,
    existing_domain: 'acme.com',
    domain_suggestions: [],
  };

  it('flags every required item when nothing is provided', () => {
    expect(missingItems({ logo_path: null, fileCount: 0, data: {} })).toEqual([
      'logo',
      'files',
      'description',
      'contact_email',
      'contact_phone',
      'domain',
    ]);
  });
  it('flags only the logo when everything else is present', () => {
    expect(missingItems({ logo_path: null, fileCount: 2, data: fullData })).toEqual(['logo']);
  });
  it('returns an empty array when nothing is missing', () => {
    expect(missingItems({ logo_path: 'clients/logo.png', fileCount: 2, data: fullData })).toEqual([]);
  });
  it('flags domain when has_existing_domain is false and no suggestions given', () => {
    const data = { ...fullData, has_existing_domain: false, existing_domain: null, domain_suggestions: [] };
    expect(missingItems({ logo_path: 'l.png', fileCount: 1, data })).toEqual(['domain']);
  });
  it('does not flag domain when has_existing_domain is false but suggestions exist', () => {
    const data = { ...fullData, has_existing_domain: false, existing_domain: null, domain_suggestions: ['a.com'] };
    expect(missingItems({ logo_path: 'l.png', fileCount: 1, data })).toEqual([]);
  });
});
