import { vi, beforeEach, describe, it, expect } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const unsubscribe = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe } } })),
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

import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/lib/stores/authStore';
import { useAuthListener } from './useAuthListener';

describe('useAuthListener', () => {
  beforeEach(() => {
    useAuthStore.getState().reset();
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
});
