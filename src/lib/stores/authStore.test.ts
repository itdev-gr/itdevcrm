import { useAuthStore } from './authStore';

describe('authStore', () => {
  beforeEach(() => {
    useAuthStore.getState().reset();
  });

  it('starts unauthenticated', () => {
    const s = useAuthStore.getState();
    expect(s.user).toBeNull();
    expect(s.session).toBeNull();
    expect(s.isAdmin).toBe(false);
    expect(s.groupCodes).toEqual([]);
  });

  it('setSession updates user, session, and clears isLoading', () => {
    const fakeUser = { id: 'u1' } as never;
    const fakeSession = { access_token: 't' } as never;
    useAuthStore.getState().setSession(fakeSession, fakeUser);
    const s = useAuthStore.getState();
    expect(s.user).toBe(fakeUser);
    expect(s.session).toBe(fakeSession);
    expect(s.isLoading).toBe(false);
  });

  it('setProfile updates admin + groups', () => {
    useAuthStore.getState().setProfile({ isAdmin: true, groupCodes: ['sales'] });
    const s = useAuthStore.getState();
    expect(s.isAdmin).toBe(true);
    expect(s.groupCodes).toEqual(['sales']);
  });

  it('reset clears everything', () => {
    useAuthStore.getState().setSession({ access_token: 't' } as never, { id: 'u' } as never);
    useAuthStore.getState().reset();
    const s = useAuthStore.getState();
    expect(s.user).toBeNull();
    expect(s.session).toBeNull();
  });
});
