import { supabase } from '@/lib/supabase';

export type LockDealResult = { ok: true; deal_id: string } | { ok: false; errors: string[] };

export async function lockDeal(dealId: string): Promise<LockDealResult> {
  const { data, error } = await supabase.rpc('lock_deal', { target_deal_id: dealId });
  if (error) {
    return { ok: false, errors: [error.message] };
  }
  return data as LockDealResult;
}
