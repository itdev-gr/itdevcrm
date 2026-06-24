import { useMutation, useQueryClient, type DefaultError } from '@tanstack/react-query';
import { setAnnouncementActive } from '@/lib/rpc';
import { queryKeys } from '@/lib/queryKeys';
import { captureMutation } from '@/lib/sentry/captureMutation';

export function useSetAnnouncementActive() {
  const qc = useQueryClient();
  return useMutation<void, DefaultError, { id: string; active: boolean }>({
    mutationFn: captureMutation(
      'announcements',
      'set_active',
      async ({ id, active }: { id: string; active: boolean }) => {
        const r = await setAnnouncementActive(id, active);
        if (!r.ok) throw new Error(r.errors[0] ?? 'update_failed');
      },
    ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.announcements() });
    },
  });
}
