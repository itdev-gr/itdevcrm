import { useQuery } from '@tanstack/react-query';
import { getMyAnnouncements, type MyAnnouncementRow } from '@/lib/rpc';
import { queryKeys } from '@/lib/queryKeys';
import { useAuthStore } from '@/lib/stores/authStore';

export function useMyAnnouncements() {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  return useQuery<MyAnnouncementRow[]>({
    queryKey: queryKeys.myAnnouncements(),
    queryFn: getMyAnnouncements,
    enabled: !!userId,
  });
}
