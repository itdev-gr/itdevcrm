import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { useAuthStore } from '@/lib/stores/authStore';
import type { ClientRow } from './useClients';

export function useMyClients() {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const groupCodes = useAuthStore((s) => s.groupCodes);

  return useQuery({
    queryKey: [...queryKeys.myClients(), userId, groupCodes.join(',')] as const,
    queryFn: async (): Promise<ClientRow[]> => {
      if (!userId) return [];
      const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

      const { data: owned, error: e1 } = await supabase
        .from('clients')
        .select('*')
        .eq('assigned_owner_id', userId)
        .eq('archived', false);
      if (e1) throw new Error(e1.message);

      const { data: dealClientIds, error: e2 } = await supabase
        .from('deals')
        .select('client_id')
        .eq('owner_user_id', userId)
        .eq('archived', false)
        .gte('updated_at', cutoff);
      if (e2) throw new Error(e2.message);

      const { data: myGroups } = await supabase
        .from('groups')
        .select('id')
        .in('code', groupCodes.length > 0 ? groupCodes : ['__none__']);
      const myGroupIds = (myGroups ?? []).map((g) => g.id);

      const { data: jobClientIds, error: e3 } = await supabase
        .from('jobs')
        .select('client_id')
        .in(
          'assigned_group_id',
          myGroupIds.length > 0 ? myGroupIds : ['00000000-0000-0000-0000-000000000000'],
        )
        .eq('archived', false)
        .gte('updated_at', cutoff);
      if (e3) throw new Error(e3.message);

      const ids = new Set<string>();
      (dealClientIds ?? []).forEach((r) => ids.add(r.client_id));
      (jobClientIds ?? []).forEach((r) => ids.add(r.client_id));
      (owned ?? []).forEach((c) => ids.add(c.id));

      const ownedById = new Map((owned ?? []).map((c) => [c.id, c as ClientRow]));
      const remoteIds = [...ids].filter((id) => !ownedById.has(id));
      let extras: ClientRow[] = [];
      if (remoteIds.length > 0) {
        const { data, error } = await supabase
          .from('clients')
          .select('*')
          .in('id', remoteIds)
          .eq('archived', false);
        if (error) throw new Error(error.message);
        extras = (data ?? []) as ClientRow[];
      }
      return [...(owned ?? []), ...extras] as ClientRow[];
    },
    enabled: !!userId,
  });
}
