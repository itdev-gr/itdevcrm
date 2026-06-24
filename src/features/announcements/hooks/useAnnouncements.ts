import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export type AdminAnnouncement = {
  id: string;
  title: string;
  body: string;
  severity: 'info' | 'warning';
  target_all: boolean;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
  announcement_targets: {
    group_id: string;
    groups: { code: string; display_names: { en: string; el: string } } | null;
  }[];
};

// `announcements` is not yet in the generated Supabase types (pending a
// types:gen, which needs CLI auth). Use a loose `.from` for this admin-only read;
// the result is validated by the AdminAnnouncement cast and the runtime FK embed.
type LooseQuery = {
  select: (cols: string) => {
    order: (
      col: string,
      opts: { ascending: boolean },
    ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  };
};
const looseFrom = supabase.from.bind(supabase) as unknown as (table: string) => LooseQuery;

export function useAnnouncements() {
  return useQuery<AdminAnnouncement[]>({
    queryKey: queryKeys.announcements(),
    queryFn: async () => {
      const { data, error } = await looseFrom('announcements')
        .select(
          'id, title, body, severity, target_all, expires_at, is_active, created_at, announcement_targets(group_id, groups(code, display_names))',
        )
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data as AdminAnnouncement[] | null) ?? [];
    },
  });
}
