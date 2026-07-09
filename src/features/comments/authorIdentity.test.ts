import { describe, it, expect } from 'vitest';
import { resolveAuthorIdentity } from './authorIdentity';

// Eirini's user_id from the reported bug (was rendered as a raw UUID).
const AID = '139f2b2d-3915-4f3a-91d9-f221247d598e';

describe('resolveAuthorIdentity', () => {
  it('prefers the directory name (fixes RLS-hidden authors shown as a raw UUID)', () => {
    const dir = new Map([[AID, { full_name: 'Eirini Marketaki', email: 'emarketaki@itdev.gr' }]]);
    // Embedded author is null because profiles RLS hides other users' rows.
    expect(resolveAuthorIdentity(AID, null, dir)).toEqual({
      name: 'Eirini Marketaki',
      email: 'emarketaki@itdev.gr',
    });
  });

  it('falls back to the directory email when full_name is blank/whitespace', () => {
    const dir = new Map([[AID, { full_name: '   ', email: 'stavroula@itdev.gr' }]]);
    expect(resolveAuthorIdentity(AID, null, dir)).toEqual({
      name: null,
      email: 'stavroula@itdev.gr',
    });
  });

  it('uses the embedded profile (own row) before the directory has loaded', () => {
    expect(
      resolveAuthorIdentity(AID, { full_name: 'Eirini Marketaki', email: 'emarketaki@itdev.gr' }, undefined),
    ).toEqual({ name: 'Eirini Marketaki', email: 'emarketaki@itdev.gr' });
  });

  it('directory overrides a null/empty embedded row', () => {
    const dir = new Map([[AID, { full_name: 'Eirini Marketaki', email: 'emarketaki@itdev.gr' }]]);
    expect(resolveAuthorIdentity(AID, { full_name: null, email: null }, dir).name).toBe('Eirini Marketaki');
  });

  it('never shows a raw UUID when any email is known', () => {
    const dir = new Map([[AID, { full_name: null, email: 'emarketaki@itdev.gr' }]]);
    expect(resolveAuthorIdentity(AID, null, dir).email).toBe('emarketaki@itdev.gr');
  });

  it('last-resort returns the author id only when nothing is known anywhere', () => {
    expect(resolveAuthorIdentity(AID, null, new Map())).toEqual({ name: null, email: AID });
  });
});
