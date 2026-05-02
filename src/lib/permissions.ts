import { supabase } from '@/lib/supabase';

export const ALL_ACTIONS = [
  'view',
  'create',
  'edit',
  'delete',
  'move_stage',
  'assign_owner',
  'comment',
  'attach_file',
  'lock_deal',
  'complete_accounting',
  'block_client',
  'unblock_client',
  'complete_job',
  'manage_permissions',
] as const;

export type Action = (typeof ALL_ACTIONS)[number];

export const ALL_BOARDS = [
  'sales',
  'accounting_onboarding',
  'accounting_recurring',
  'web_seo',
  'local_seo',
  'web_dev',
  'social_media',
  'clients',
  'users',
  'permissions',
] as const;

export type Board = (typeof ALL_BOARDS)[number];

export const ALL_SCOPES = ['own', 'group', 'all'] as const;
export type Scope = (typeof ALL_SCOPES)[number];

const SCOPE_RANK: Record<Scope, number> = { own: 1, group: 2, all: 3 };

export function maxScope(a: Scope | null, b: Scope | null): Scope | null {
  if (a == null) return b;
  if (b == null) return a;
  return SCOPE_RANK[a] >= SCOPE_RANK[b] ? a : b;
}

export async function currentUserCan(board: Board, action: Action): Promise<boolean> {
  const { data, error } = await supabase.rpc('current_user_can', {
    target_board: board,
    target_action: action,
  });
  if (error) throw new Error(error.message);
  return Boolean(data);
}

export async function currentUserScope(board: Board, action: Action): Promise<Scope | null> {
  const { data, error } = await supabase.rpc('current_user_scope', {
    target_board: board,
    target_action: action,
  });
  if (error) throw new Error(error.message);
  return (data ?? null) as Scope | null;
}
