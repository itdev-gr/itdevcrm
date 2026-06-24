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

export function useAnnouncements() {
  return useQuery<AdminAnnouncement[]>({
    queryKey: queryKeys.announcements(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('announcements')
        .select(
          'id, title, body, severity, target_all, expires_at, is_active, created_at, announcement_targets(group_id, groups(code, display_names))',
        )
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as AdminAnnouncement[];
    },
  });
}
