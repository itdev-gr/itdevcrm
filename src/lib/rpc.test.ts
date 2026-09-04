import { vi, beforeEach, describe, it, expect } from 'vitest';

// Mirror @supabase/supabase-js: SupabaseClient.rpc() is a prototype method whose
// body is `return this.rest.rpc(...)`. So if our code captures `supabase.rpc`
// into a bare variable (detaching `this`), calling it throws
// "Cannot read properties of undefined (reading 'rest')" — the exact crash seen
// when adding a job in the billing panel.
vi.mock('@/lib/supabase', () => {
  const rest = {
    rpc: vi.fn((_fn: string, _args?: unknown) =>
      Promise.resolve({ data: { ok: true, job_id: 'job-1' }, error: null }),
    ),
  };
  const supabase = {
    rest,
    rpc(fn: string, args?: unknown) {
      // Depends on `this` being the client — exactly like the real library.
      return this.rest.rpc(fn, args);
    },
  };
  return { supabase };
});

import { supabase } from '@/lib/supabase';
import { createCustomJob, updateJobBilling } from './rpc';

type RestRpc = ReturnType<typeof vi.fn>;
const restRpc = (supabase as unknown as { rest: { rpc: RestRpc } }).rest.rpc;

describe('billing RPC wrappers preserve the supabase client binding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('createCustomJob calls supabase.rpc without losing `this`', async () => {
    const result = await createCustomJob({
      dealId: 'deal-1',
      title: 'Package',
      department: 'local_seo',
      billingType: 'recurring_monthly',
      amountNet: 220,
      vatRate: 24,
    });
    expect(result).toEqual({ ok: true, job_id: 'job-1' });
    expect(restRpc).toHaveBeenCalledWith(
      'create_custom_job',
      expect.objectContaining({ p_deal_id: 'deal-1', p_amount_net: 220 }),
    );
  });

  it('updateJobBilling calls supabase.rpc without losing `this`', async () => {
    const result = await updateJobBilling({ jobId: 'job-1', amountNet: 300 });
    expect(result).toEqual({ ok: true, job_id: 'job-1' });
    expect(restRpc).toHaveBeenCalledWith('update_job_billing', expect.any(Object));
  });
});
