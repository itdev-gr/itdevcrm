import { useMutation, useQueryClient, type DefaultError } from '@tanstack/react-query';
import { deleteAnnouncement } from '@/lib/rpc';
import { queryKeys } from '@/lib/queryKeys';
import { captureMutation } from '@/lib/sentry/captureMutation';

export function useDeleteAnnouncement() {
  const qc = useQueryClient();
  return useMutation<void, DefaultError, string>({
    mutationFn: captureMutation('announcements', 'delete', async (id: string) => {
      const r = await deleteAnnouncement(id);
      if (!r.ok) throw new Error(r.errors[0] ?? 'delete_failed');
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.announcements() });
    },
  });
}
