import { useMutation, useQueryClient, type DefaultError } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { captureMutation } from '@/lib/sentry/captureMutation';
import { useAuthStore } from '@/lib/stores/authStore';

type Vars = { disconnected: boolean };

/**
 * Flip the Local SEO "disconnected from the client's GBP" flag on a job.
 * true  → stamps disconnected_at = now, disconnected_by = current user.
 * false → clears both (Undo). Plain row update: RLS jobs_mutate_admin_or_service
 * already allows admins + the owning service team.
 */
export function useSetJobDisconnected(jobId: string) {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  return useMutation<void, DefaultError, Vars>({
    mutationFn: captureMutation('jobs', 'set_disconnected', async ({ disconnected }: Vars) => {
      const patch = disconnected
        ? { disconnected_at: new Date().toISOString(), disconnected_by: userId }
        : { disconnected_at: null, disconnected_by: null };
      const { error } = await supabase.from('jobs').update(patch).eq('id', jobId);
      if (error) throw new Error(error.message);
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.job(jobId) });
      // Prefix of every board query (queryKeys.jobsByService) — same as useBlockJob.
      void qc.invalidateQueries({ queryKey: ['jobs'] });
    },
  });
}
