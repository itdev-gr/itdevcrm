import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PlugZap, Unplug } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { formatDate } from '@/lib/datetime';
import { useAuthStore } from '@/lib/stores/authStore';
import { useMentionableUsers } from '@/features/comments/hooks/useMentionableUsers';
import { canToggleDisconnect, disconnectStatus } from './disconnectStatus';
import { useSetJobDisconnected } from './hooks/useJobDisconnect';
import type { JobRow } from './hooks/useJobs';

/**
 * Job-page banner for the Local SEO "Closed → Disconnect" step. Red while the
 * closed job still has our GBP access; the Disconnect button (confirm) flips it
 * to green "Disconnected on <date> by <name>" with an Undo for mis-clicks or
 * re-opened jobs. Sits at the top of the Overview column so it is the first
 * thing the team sees when opening a closed card from the kanban.
 */
export function JobDisconnectCard({ job }: { job: JobRow }) {
  const { t } = useTranslation('jobs');
  const status = disconnectStatus(job);
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const groupCodes = useAuthStore((s) => s.groupCodes);
  const canToggle = canToggleDisconnect(isAdmin, groupCodes);
  const { data: users = [] } = useMentionableUsers();
  const setDisconnected = useSetJobDisconnected(job.id);
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (!status) return null;

  async function run(disconnected: boolean) {
    try {
      await setDisconnected.mutateAsync({ disconnected });
      setConfirmOpen(false);
    } catch (err) {
      alert(t('disconnect.error', { msg: (err as Error).message }));
    }
  }

  if (status === 'needs_disconnect') {
    return (
      <section
        role="alert"
        className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-900 shadow-sm dark:border-red-800/60 dark:bg-red-950/40 dark:text-red-200"
      >
        <div className="flex items-start gap-3">
          <Unplug className="mt-0.5 size-5 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{t('disconnect.card_title')}</p>
            <p className="mt-1 text-xs text-red-900/80 dark:text-red-200/80">
              {t('disconnect.card_body')}
            </p>
          </div>
          {canToggle && (
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={() => setConfirmOpen(true)}
              disabled={setDisconnected.isPending}
            >
              <Unplug className="size-3.5" />
              {t('disconnect.button')}
            </Button>
          )}
        </div>
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title={t('disconnect.confirm_title')}
          description={t('disconnect.confirm_body')}
          confirmLabel={t('disconnect.button')}
          pending={setDisconnected.isPending}
          onConfirm={() => run(true)}
        />
      </section>
    );
  }

  const by = job.disconnected_by ? users.find((u) => u.user_id === job.disconnected_by) : null;
  return (
    <section className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900 shadow-sm dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-200">
      <div className="flex items-start gap-3">
        <PlugZap className="mt-0.5 size-5 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">
            {t('disconnect.done_title', { date: formatDate(job.disconnected_at ?? '') })}
          </p>
          {by && (
            <p className="mt-1 text-xs text-emerald-900/80 dark:text-emerald-200/80">
              {t('disconnect.done_by', { name: by.full_name || by.email })}
            </p>
          )}
        </div>
        {canToggle && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => run(false)}
            disabled={setDisconnected.isPending}
          >
            {t('disconnect.undo')}
          </Button>
        )}
      </div>
    </section>
  );
}
