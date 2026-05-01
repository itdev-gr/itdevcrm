import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/supabase';

export type Profile = Database['public']['Tables']['profiles']['Row'];

export async function fetchProfile(userId: string): Promise<Profile> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', userId)
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? 'Profile not found');
  }
  return data;
}

export async function fetchUserGroupCodes(userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('user_groups')
    .select('groups(code)')
    .eq('user_id', userId);
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? [])
    .map((row) => (row as unknown as { groups: { code: string } | null }).groups?.code)
    .filter((c): c is string => typeof c === 'string');
}
