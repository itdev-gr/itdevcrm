import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/lib/stores/authStore';
import { deptBccFor } from '../../../supabase/functions/_shared/recipients.ts';

/** The sender's department mailbox(es) (sales@ / accounting@ / support@) —
 *  the same resolution sendPersonal uses for the archive copy, surfaced so
 *  the compose dialog can SHOW the copy in the Cc field instead of it being
 *  an invisible server-side Bcc. */
export function useDeptCc(enabled: boolean) {
  const uid = useAuthStore((s) => s.user?.id);
  return useQuery({
    queryKey: ['dept-cc', uid],
    enabled: enabled && !!uid,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase
        .from('user_groups')
        .select('groups(parent_label)')
        .eq('user_id', uid!);
      if (error) throw new Error(error.message);
      // One-to-one FK embed comes back as an object at runtime but the
      // generated types widen it to an array — normalise both shapes.
      type GroupRow = { parent_label: string | null };
      const labels = ((data ?? []) as { groups: GroupRow | GroupRow[] | null }[])
        .flatMap((g) => (Array.isArray(g.groups) ? g.groups : g.groups ? [g.groups] : []))
        .map((g) => g.parent_label)
        .filter((l): l is string => !!l);
      return deptBccFor(labels);
    },
  });
}
