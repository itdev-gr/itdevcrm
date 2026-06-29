import { useAuthStore } from '@/lib/stores/authStore';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  PageHeader,
  SettingsCard,
  SettingsTableShell,
  settingsTheadClass,
  settingsThClass,
  settingsTrClass,
  settingsTdClass,
} from '@/components/layout/page-shell';
import { useEmailHealth } from './useEmailHealth';
import {
  useEmailQueue,
  useEmailFailures,
  useRetryEmail,
  useCancelEmail,
} from './hooks/useEmailOps';

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300',
  sending: 'bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-300',
  failed: 'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300',
  bounced: 'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300',
  complained: 'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        'inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium capitalize',
        STATUS_STYLES[status] ?? 'bg-muted text-muted-foreground',
      )}
    >
      {status}
    </span>
  );
}

export function EmailHealthPage() {
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const health = useEmailHealth(isAdmin);
  const queue = useEmailQueue(isAdmin);
  const failures = useEmailFailures(isAdmin);
  const retry = useRetryEmail();
  const cancel = useCancelEmail();

  const h = health.data;
  const statusColor =
    h?.status === 'down'
      ? 'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300'
      : h?.status === 'degraded'
        ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300'
        : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300';

  const queueRows = queue.data ?? [];
  const failureRows = failures.data ?? [];
  const busyId = retry.isPending ? retry.variables : cancel.isPending ? cancel.variables : null;

  return (
    <div className="flex flex-col gap-5">
      <SettingsCard className="p-5">
        <PageHeader
          title="Email health"
          description="Stuck or failed emails and recent delivery problems."
        />
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className={cn('inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize', statusColor)}>
            {h?.status ?? '—'}
          </span>
          <span className="text-sm text-muted-foreground">{h?.reason ?? 'Loading…'}</span>
          <div className="ml-auto flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span>Stuck: <b className="text-foreground">{h?.stuck_count ?? 0}</b></span>
            <span>Failed (1h): <b className="text-foreground">{h?.failed_count ?? 0}</b></span>
            <span>
              Drain last ran:{' '}
              <b className="text-foreground">
                {h?.last_run_age_seconds == null ? '—' : `${h.last_run_age_seconds}s ago`}
              </b>
            </span>
          </div>
        </div>
      </SettingsCard>

      <div>
        <h2 className="mb-2 px-1 text-sm font-semibold">Queue — needs attention</h2>
        <SettingsTableShell>
          <table className="w-full text-sm">
            <thead className={settingsTheadClass}>
              <tr>
                <th className={settingsThClass}>To</th>
                <th className={settingsThClass}>Template</th>
                <th className={settingsThClass}>Status</th>
                <th className={settingsThClass}>Attempts</th>
                <th className={settingsThClass}>Created</th>
                <th className={settingsThClass}>Error</th>
                <th className={settingsThClass}></th>
              </tr>
            </thead>
            <tbody>
              {queueRows.length === 0 ? (
                <tr className={settingsTrClass}>
                  <td className={cn(settingsTdClass, 'text-muted-foreground')} colSpan={7}>
                    {queue.isLoading ? 'Loading…' : 'No emails need attention 🎉'}
                  </td>
                </tr>
              ) : (
                queueRows.map((row) => (
                  <tr key={row.id} className={settingsTrClass}>
                    <td className={cn(settingsTdClass, 'break-all')}>{row.to_email}</td>
                    <td className={cn(settingsTdClass, 'font-mono text-xs')}>{row.template_key}</td>
                    <td className={settingsTdClass}><StatusBadge status={row.status} /></td>
                    <td className={settingsTdClass}>{row.attempts}</td>
                    <td className={cn(settingsTdClass, 'whitespace-nowrap text-muted-foreground')}>
                      {fmtWhen(row.created_at)}
                    </td>
                    <td className={cn(settingsTdClass, 'max-w-[22rem] truncate text-xs text-muted-foreground')} title={row.last_error ?? ''}>
                      {row.last_error ?? '—'}
                    </td>
                    <td className={cn(settingsTdClass, 'whitespace-nowrap text-right')}>
                      <Button
                        variant="outline"
                        size="xs"
                        disabled={busyId != null}
                        onClick={() => retry.mutate(row.id)}
                      >
                        Retry
                      </Button>
                      <Button
                        variant="ghost"
                        size="xs"
                        className="ml-1"
                        disabled={busyId != null}
                        onClick={() => cancel.mutate(row.id)}
                      >
                        Cancel
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </SettingsTableShell>
      </div>

      <div>
        <h2 className="mb-2 px-1 text-sm font-semibold">Recent failures &amp; bounces (last 7 days)</h2>
        <SettingsTableShell>
          <table className="w-full text-sm">
            <thead className={settingsTheadClass}>
              <tr>
                <th className={settingsThClass}>To</th>
                <th className={settingsThClass}>Template</th>
                <th className={settingsThClass}>Status</th>
                <th className={settingsThClass}>When</th>
                <th className={settingsThClass}>Error</th>
              </tr>
            </thead>
            <tbody>
              {failureRows.length === 0 ? (
                <tr className={settingsTrClass}>
                  <td className={cn(settingsTdClass, 'text-muted-foreground')} colSpan={5}>
                    {failures.isLoading ? 'Loading…' : 'No recent failures.'}
                  </td>
                </tr>
              ) : (
                failureRows.map((row) => (
                  <tr key={row.id} className={settingsTrClass}>
                    <td className={cn(settingsTdClass, 'break-all')}>{row.to_email}</td>
                    <td className={cn(settingsTdClass, 'font-mono text-xs')}>{row.template_key}</td>
                    <td className={settingsTdClass}><StatusBadge status={row.status} /></td>
                    <td className={cn(settingsTdClass, 'whitespace-nowrap text-muted-foreground')}>
                      {fmtWhen(row.created_at)}
                    </td>
                    <td className={cn(settingsTdClass, 'max-w-[26rem] truncate text-xs text-muted-foreground')} title={row.error ?? ''}>
                      {row.error || '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </SettingsTableShell>
      </div>
    </div>
  );
}
