import { vi, beforeEach, describe, it, expect } from 'vitest';

vi.mock('@/lib/supabase', () => {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(),
  };
  const supabase = { from: vi.fn().mockReturnValue(builder) };
  return { supabase, _builder: builder };
});

import * as supabaseMock from '@/lib/supabase';
import { fetchProfile, fetchUserGroupCodes } from './profile';

const builder = (
  supabaseMock as unknown as {
    _builder: {
      maybeSingle: ReturnType<typeof vi.fn>;
      eq: ReturnType<typeof vi.fn>;
      select: ReturnType<typeof vi.fn>;
    };
  }
)._builder;

describe('profile helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetchProfile queries profiles by user_id and returns the row', async () => {
    builder.maybeSingle.mockResolvedValue({
      data: { user_id: 'u1', email: 'a@b.com', is_admin: false, must_change_password: true },
      error: null,
    });
    const result = await fetchProfile('u1');
    expect(supabaseMock.supabase.from).toHaveBeenCalledWith('profiles');
    expect(builder.select).toHaveBeenCalled();
    expect(builder.eq).toHaveBeenCalledWith('user_id', 'u1');
    expect(builder.maybeSingle).toHaveBeenCalled();
    expect(result?.email).toBe('a@b.com');
  });

  it('fetchProfile returns null when no row exists (orphan session)', async () => {
    builder.maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(fetchProfile('u1')).resolves.toBeNull();
  });

  it('fetchProfile throws on supabase error', async () => {
    builder.maybeSingle.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(fetchProfile('u1')).rejects.toThrow('boom');
  });

  it('fetchUserGroupCodes returns array of group codes', async () => {
    const groupsBuilder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({
        data: [{ groups: { code: 'sales' } }, { groups: { code: 'accounting' } }],
        error: null,
      }),
    };
    (supabaseMock.supabase.from as ReturnType<typeof vi.fn>).mockReturnValueOnce(groupsBuilder);

    const codes = await fetchUserGroupCodes('u1');
    expect(codes).toEqual(['sales', 'accounting']);
  });
});
