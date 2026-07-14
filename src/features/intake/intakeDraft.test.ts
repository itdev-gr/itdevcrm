import { describe, it, expect } from 'vitest';
import {
  EMPTY_FORM_STATE,
  cleanSuggestions,
  computePatch,
  formatBytes,
  hydrateFormState,
  mergeDraft,
  normalizeForServer,
} from './intakeDraft';
import type { IntakeFormState } from './types';

describe('hydrateFormState', () => {
  it('coalesces nulls/missing to safe defaults (has_existing_domain defaults true)', () => {
    const s = hydrateFormState({ description: 'hi', existing_domain: null });
    expect(s.description).toBe('hi');
    expect(s.existing_domain).toBe('');
    expect(s.has_existing_domain).toBe(true);
    expect(s.wants_whatsapp_button).toBe(false);
    expect(s.domain_suggestions).toEqual([]);
  });

  it('reads a stored boolean false without falling back to the default', () => {
    expect(hydrateFormState({ has_existing_domain: false }).has_existing_domain).toBe(false);
  });
});

describe('mergeDraft', () => {
  const local: IntakeFormState = {
    ...EMPTY_FORM_STATE,
    description: 'local desc',
    contact_email: 'local@example.com',
    has_existing_domain: false,
    domain_suggestions: ['a.com'],
  };

  it('uses local values where the server field is blank', () => {
    const merged = mergeDraft({ contact_phone: '2101234567' }, local);
    expect(merged.description).toBe('local desc'); // filled from local
    expect(merged.contact_phone).toBe('2101234567'); // from server
  });

  it('lets a non-empty server value win over local', () => {
    const merged = mergeDraft({ description: 'server desc' }, local);
    expect(merged.description).toBe('server desc');
  });

  it('lets a server-stored boolean false win over local', () => {
    const merged = mergeDraft({ has_existing_domain: false }, { ...local, has_existing_domain: true });
    expect(merged.has_existing_domain).toBe(false);
  });

  it('returns the pure server state when there is no local draft', () => {
    const merged = mergeDraft({ description: 'x' }, null);
    expect(merged.description).toBe('x');
    expect(merged.contact_email).toBe('');
  });
});

describe('normalizeForServer', () => {
  it('clears the whatsapp number when the button is off', () => {
    const out = normalizeForServer({
      ...EMPTY_FORM_STATE,
      wants_whatsapp_button: false,
      whatsapp_button_number: '2101234567',
    });
    expect(out.whatsapp_button_number).toBe('');
  });

  it('keeps only the domain side selected by has_existing_domain', () => {
    const withDomain = normalizeForServer({
      ...EMPTY_FORM_STATE,
      has_existing_domain: true,
      existing_domain: 'acme.gr',
      domain_suggestions: ['ignored.com'],
    });
    expect(withDomain.existing_domain).toBe('acme.gr');
    expect(withDomain.domain_suggestions).toEqual([]);

    const withSuggestions = normalizeForServer({
      ...EMPTY_FORM_STATE,
      has_existing_domain: false,
      existing_domain: 'ignored.gr',
      domain_suggestions: [' a.com ', '', 'b.com'],
    });
    expect(withSuggestions.existing_domain).toBe('');
    expect(withSuggestions.domain_suggestions).toEqual(['a.com', 'b.com']);
  });
});

describe('computePatch', () => {
  it('returns only changed keys', () => {
    const prev = { ...EMPTY_FORM_STATE };
    const next = { ...EMPTY_FORM_STATE, description: 'new' };
    expect(computePatch(prev, next)).toEqual({ description: 'new' });
  });

  it('is empty when nothing meaningfully changed', () => {
    const prev = { ...EMPTY_FORM_STATE, wants_whatsapp_button: false, whatsapp_button_number: 'x' };
    // number is cleared by normalize because the button is off → no net change
    const next = { ...EMPTY_FORM_STATE, wants_whatsapp_button: false, whatsapp_button_number: 'y' };
    expect(computePatch(prev, next)).toEqual({});
  });

  it('captures boolean and array changes', () => {
    const prev = { ...EMPTY_FORM_STATE, has_existing_domain: true };
    const next = { ...EMPTY_FORM_STATE, has_existing_domain: false, domain_suggestions: ['a.com'] };
    const patch = computePatch(prev, next);
    expect(patch.has_existing_domain).toBe(false);
    expect(patch.domain_suggestions).toEqual(['a.com']);
  });
});

describe('cleanSuggestions', () => {
  it('trims and drops blanks', () => {
    expect(cleanSuggestions([' a ', '', '  ', 'b'])).toEqual(['a', 'b']);
  });
});

describe('formatBytes', () => {
  it('formats across units', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5 MB');
  });
});
