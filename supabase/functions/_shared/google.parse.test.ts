// supabase/functions/_shared/google.parse.test.ts
import { describe, it, expect } from 'vitest';
import { parseAddress, extractJobCode } from './google.ts';

describe('parseAddress', () => {
  it('splits "Name <email>" and lowercases the address', () => {
    expect(parseAddress('Marios Kifokeris <MKifokeris@itdev.gr>'))
      .toEqual({ name: 'Marios Kifokeris', email: 'mkifokeris@itdev.gr' });
  });
  it('handles a bare address', () => {
    expect(parseAddress('admin@upd8.gr')).toEqual({ name: '', email: 'admin@upd8.gr' });
  });
});

describe('extractJobCode', () => {
  it('finds the code inside a Re: subject', () => {
    expect(extractJobCode('Re: 000280-WEBDEV Re: Orthohouse')).toBe('000280-WEBDEV');
  });
  it('returns null when there is no code', () => {
    expect(extractJobCode('Meeting tomorrow')).toBeNull();
  });
});
