import { useMutation, useQueryClient, type DefaultError } from '@tanstack/react-query';
import { dismissAnnouncement } from '@/lib/rpc';
import { queryKeys } from '@/lib/queryKeys';
import { captureMutation } from '@/lib/sentry/captureMutation';

export function useDismissAnnouncement() {
  const qc = useQueryClient();
  return useMutation<void, DefaultError, string>({
    mutationFn: captureMutation('announcements', 'dismiss', async (id: string) => {
      const r = await dismissAnnouncement(id);
      if (!r.ok) throw new Error(r.errors[0] ?? 'dismiss_failed');
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.myAnnouncements() });
    },
  });
}
