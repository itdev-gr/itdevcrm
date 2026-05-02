import { supabase } from '@/lib/supabase';

export type LockDealResult = { ok: true; deal_id: string } | { ok: false; errors: string[] };

export async function lockDeal(dealId: string): Promise<LockDealResult> {
  const { data, error } = await supabase.rpc('lock_deal', { target_deal_id: dealId });
  if (error) {
    return { ok: false, errors: [error.message] };
  }
  return data as LockDealResult;
}

export type CompleteAccountingResult =
  | { ok: true; deal_id: string }
  | { ok: false; errors: string[] };

export async function completeAccounting(dealId: string): Promise<CompleteAccountingResult> {
  const { data, error } = await supabase.rpc('complete_accounting', { target_deal_id: dealId });
  if (error) {
    return { ok: false, errors: [error.message] };
  }
  return data as CompleteAccountingResult;
}

export type BlockClientResult = { ok: true; block_id: string } | { ok: false; errors: string[] };
export type UnblockClientResult = { ok: true; block_id: string } | { ok: false; errors: string[] };

export async function blockClient(clientId: string, reason: string): Promise<BlockClientResult> {
  const { data, error } = await supabase.rpc('block_client', {
    target_client_id: clientId,
    reason_text: reason,
  });
  if (error) return { ok: false, errors: [error.message] };
  return data as BlockClientResult;
}

export async function unblockClient(clientId: string): Promise<UnblockClientResult> {
  const { data, error } = await supabase.rpc('unblock_client', { target_client_id: clientId });
  if (error) return { ok: false, errors: [error.message] };
  return data as UnblockClientResult;
}
