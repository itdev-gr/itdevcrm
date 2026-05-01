import { vi, beforeEach, describe, it, expect } from 'vitest';

vi.mock('@/lib/supabase', () => {
  const supabase = {
    auth: {
      signInWithPassword: vi.fn(),
      signOut: vi.fn(),
      updateUser: vi.fn(),
    },
  };
  return { supabase };
});

import { supabase } from '@/lib/supabase';
import { signIn, signOut, changePassword } from './auth';

describe('auth helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('signIn calls supabase.auth.signInWithPassword and returns data', async () => {
    (supabase.auth.signInWithPassword as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { user: { id: 'u1' }, session: { access_token: 't' } },
      error: null,
    });
    const result = await signIn('a@b.com', 'pw');
    expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'a@b.com',
      password: 'pw',
    });
    expect(result.user).toEqual({ id: 'u1' });
  });

  it('signIn throws on Supabase error', async () => {
    (supabase.auth.signInWithPassword as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { user: null, session: null },
      error: { message: 'Invalid login' },
    });
    await expect(signIn('a@b.com', 'wrong')).rejects.toThrow('Invalid login');
  });

  it('signOut calls supabase.auth.signOut', async () => {
    (supabase.auth.signOut as ReturnType<typeof vi.fn>).mockResolvedValue({ error: null });
    await signOut();
    expect(supabase.auth.signOut).toHaveBeenCalled();
  });

  it('changePassword calls supabase.auth.updateUser', async () => {
    (supabase.auth.updateUser as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { user: { id: 'u1' } },
      error: null,
    });
    await changePassword('newpw');
    expect(supabase.auth.updateUser).toHaveBeenCalledWith({ password: 'newpw' });
  });

  it('changePassword throws on error', async () => {
    (supabase.auth.updateUser as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { user: null },
      error: { message: 'Password too short' },
    });
    await expect(changePassword('pw')).rejects.toThrow('Password too short');
  });
});
