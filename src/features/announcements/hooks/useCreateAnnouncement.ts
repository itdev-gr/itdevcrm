import { useMutation, useQueryClient, type DefaultError } from '@tanstack/react-query';
import { createAnnouncement } from '@/lib/rpc';
import type { CreateAnnouncementParams } from '../announcement';
import { queryKeys } from '@/lib/queryKeys';
import { captureMutation } from '@/lib/sentry/captureMutation';

export function useCreateAnnouncement() {
  const qc = useQueryClient();
  return useMutation<string, DefaultError, CreateAnnouncementParams>({
    mutationFn: captureMutation('announcements', 'create', async (params: CreateAnnouncementParams) => {
      const r = await createAnnouncement(params);
      if (!r.ok) {
        const err = new Error(r.errors[0] ?? 'create_failed');
        (err as Error & { errors?: string[] }).errors = r.errors;
        throw err;
      }
      return r.announcement_id;
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.announcements() });
    },
  });
}
