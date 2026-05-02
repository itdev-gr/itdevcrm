import { vi, beforeEach, describe, it, expect } from 'vitest';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc } }));

import { currentUserCan, currentUserScope, maxScope } from './permissions';

describe('permission helpers', () => {
  beforeEach(() => vi.clearAllMocks());

  it('maxScope returns the more permissive scope', () => {
    expect(maxScope('own', 'group')).toBe('group');
    expect(maxScope('group', 'all')).toBe('all');
    expect(maxScope(null, 'own')).toBe('own');
    expect(maxScope('all', null)).toBe('all');
    expect(maxScope(null, null)).toBeNull();
  });

  it('currentUserCan calls the RPC with correct args', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    const ok = await currentUserCan('sales', 'edit');
    expect(rpc).toHaveBeenCalledWith('current_user_can', {
      target_board: 'sales',
      target_action: 'edit',
    });
    expect(ok).toBe(true);
  });

  it('currentUserCan throws on error', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(currentUserCan('sales', 'edit')).rejects.toThrow('boom');
  });

  it('currentUserScope returns the scope or null', async () => {
    rpc.mockResolvedValue({ data: 'all', error: null });
    expect(await currentUserScope('sales', 'view')).toBe('all');
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await currentUserScope('sales', 'view')).toBeNull();
  });
});
