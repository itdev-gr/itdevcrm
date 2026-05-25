import { renderHook } from '@testing-library/react';
import { useAuthStore } from './stores/authStore';
import {
  isTestViewAsEmail,
  TEST_VIEW_AS_EMAIL,
  useCanViewAsAccounts,
  useEffectiveGroupCodes,
  useEffectiveIsAdmin,
  useEffectiveUserId,
} from './viewAs';

describe('view-as helpers', () => {
  beforeEach(() => useAuthStore.getState().reset());

  it('matches the dedicated test account email case-insensitively', () => {
    expect(isTestViewAsEmail(TEST_VIEW_AS_EMAIL.toUpperCase())).toBe(true);
    expect(isTestViewAsEmail('other@example.com')).toBe(false);
  });

  it('allows only the admin test account to view as another account', () => {
    useAuthStore
      .getState()
      .setSession({ access_token: 't' } as never, { id: 'u1', email: TEST_VIEW_AS_EMAIL } as never);
    useAuthStore.getState().setProfile({ isAdmin: true, groupCodes: [] });

    expect(renderHook(() => useCanViewAsAccounts()).result.current).toBe(true);

    useAuthStore.getState().setProfile({ isAdmin: false, groupCodes: [] });
    expect(renderHook(() => useCanViewAsAccounts()).result.current).toBe(false);
  });

  it('returns the selected account as the effective user', () => {
    useAuthStore.getState().setSession(
      { access_token: 't' } as never,
      { id: 'actual', email: TEST_VIEW_AS_EMAIL } as never,
    );
    useAuthStore.getState().setProfile({ isAdmin: true, groupCodes: ['accounting'] });
    useAuthStore.getState().setViewAsUser({
      userId: 'target',
      email: 'sales@example.com',
      fullName: 'Sales User',
      isAdmin: false,
      groupCodes: ['sales'],
    });

    expect(renderHook(() => useEffectiveUserId()).result.current).toBe('target');
    expect(renderHook(() => useEffectiveIsAdmin()).result.current).toBe(false);
    expect(renderHook(() => useEffectiveGroupCodes()).result.current).toEqual(['sales']);
  });
});
