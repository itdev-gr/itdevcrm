import { vi, beforeEach, describe, it, expect } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const unsubscribe = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe } } })),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
  },
}));

vi.mock('@/lib/profile', () => ({
  fetchProfile: vi.fn().mockResolvedValue({
    user_id: 'u1',
    email: 'a@b.com',
    is_admin: true,
    must_change_password: false,
    is_active: true,
    full_name: 'Test',
  }),
  fetchUserGroupCodes: vi.fn().mockResolvedValue(['sales']),
}));

vi.mock('@/lib/queryClient', () => ({
  queryClient: { clear: vi.fn() },
}));

vi.mock('@/features/comments/commentDraftStore', () => ({
  clearAllDrafts: vi.fn(),
}));

import { supabase } from '@/lib/supabase';
import { fetchProfile } from '@/lib/profile';
import { queryClient } from '@/lib/queryClient';
import { clearAllDrafts } from '@/features/comments/commentDraftStore';
import { useAuthStore } from '@/lib/stores/authStore';
import { useAuthListener, __resetAuthHydrationForTests } from './useAuthListener';

describe('useAuthListener', () => {
  beforeEach(() => {
    useAuthStore.getState().reset();
    __resetAuthHydrationForTests();
    vi.clearAllMocks();
  });

  it('hydrates the store from initial getSession (no session)', async () => {
    renderHook(() => useAuthListener());
    await waitFor(() => {
      expect(useAuthStore.getState().isLoading).toBe(false);
    });
    expect(useAuthStore.getState().session).toBeNull();
  });

  it('hydrates store on session present (signs in flow)', async () => {
    const fakeSession = {
      access_token: 't',
      user: { id: 'u1', email: 'a@b.com' },
    };
    (supabase.auth.getSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { session: fakeSession },
    });
    renderHook(() => useAuthListener());
    await waitFor(() => {
      const s = useAuthStore.getState();
      expect(s.session).toBeTruthy();
      expect(s.isAdmin).toBe(true);
      expect(s.groupCodes).toEqual(['sales']);
    });
  });

  it('subscribes via onAuthStateChange and unsubscribes on unmount', () => {
    const { unmount } = renderHook(() => useAuthListener());
    expect(supabase.auth.onAuthStateChange).toHaveBeenCalled();
    unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('fetches the profile once when auth events repeat for the same user', async () => {
    const fakeSession = {
      access_token: 't',
      user: { id: 'u1', email: 'a@b.com' },
    };
    let fireAuthEvent: ((event: string, session: unknown) => void) | undefined;
    (supabase.auth.getSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { session: fakeSession },
    });
    (supabase.auth.onAuthStateChange as ReturnType<typeof vi.fn>).mockImplementation((cb) => {
      fireAuthEvent = cb as typeof fireAuthEvent;
      return { data: { subscription: { unsubscribe } } };
    });
    renderHook(() => useAuthListener());
    await waitFor(() => expect(useAuthStore.getState().isAdmin).toBe(true));
    // Supabase fires INITIAL_SESSION / SIGNED_IN / TOKEN_REFRESHED for the
    // same user; none of these should re-query profiles + user_groups.
    fireAuthEvent!('INITIAL_SESSION', fakeSession);
    fireAuthEvent!('SIGNED_IN', fakeSession);
    fireAuthEvent!('TOKEN_REFRESHED', fakeSession);
    await waitFor(() => expect(useAuthStore.getState().isLoading).toBe(false));
    expect(fetchProfile).toHaveBeenCalledTimes(1);
  });

  it('clears the query cache and comment drafts on SIGNED_OUT', async () => {
    let fireAuthEvent: ((event: string, session: unknown) => void) | undefined;
    (supabase.auth.onAuthStateChange as ReturnType<typeof vi.fn>).mockImplementation((cb) => {
      fireAuthEvent = cb as typeof fireAuthEvent;
      return { data: { subscription: { unsubscribe } } };
    });
    renderHook(() => useAuthListener());
    await waitFor(() => expect(fireAuthEvent).toBeDefined());

    expect(queryClient.clear).not.toHaveBeenCalled();
    expect(clearAllDrafts).not.toHaveBeenCalled();

    fireAuthEvent!('SIGNED_OUT', null);

    expect(queryClient.clear).toHaveBeenCalledTimes(1);
    expect(clearAllDrafts).toHaveBeenCalledTimes(1);
  });

  it('signs out when the session points at a user with no profile row', async () => {
    const fakeSession = {
      access_token: 't',
      user: { id: 'orphan-user', email: 'gone@example.test' },
    };
    (supabase.auth.getSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { session: fakeSession },
    });
    (fetchProfile as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    renderHook(() => useAuthListener());
    await waitFor(() => {
      expect(supabase.auth.signOut).toHaveBeenCalled();
    });
  });
});
