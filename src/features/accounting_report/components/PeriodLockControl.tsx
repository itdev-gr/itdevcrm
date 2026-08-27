import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Lock, LockOpen } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { usePeriodLocks, useLockPeriod, useUnlockPeriod, type PeriodLock } from '../hooks/usePeriodLocks';

const RECENT_MONTHS = 12;

/** 'YYYY-MM' for the last `n` months, most recent first, current month included. */
function recentPeriods(n: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

function formatPeriod(period: string, locale: string): string {
  const [y, m] = period.split('-').map(Number);
  if (!y || !m) return period;
  try {
    return new Intl.DateTimeFormat(locale === 'el' ? 'el-GR' : 'en-GB', {
      month: 'long',
      year: 'numeric',
    }).format(new Date(y, m - 1, 1));
  } catch {
    return period;
  }
}

/**
 * Admin-only control on the Report page: shows recent months with their lock
 * state and lets an admin lock/unlock a month via the DB RPCs (which
 * themselves re-check admin status — this component is UI convenience, not
 * the security boundary).
 */
export function PeriodLockControl() {
  const { t, i18n } = useTranslation('accounting_report');
  const locks = usePeriodLocks();
  const lockMut = useLockPeriod();
  const unlockMut = useUnlockPeriod();
  const [confirm, setConfirm] = useState<{ period: string; action: 'lock' | 'unlock' } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const lockedByPeriod = useMemo(() => {
    const map = new Map<string, PeriodLock>();
    for (const l of locks.data ?? []) map.set(l.period, l);
    return map;
  }, [locks.data]);

  const periods = useMemo(() => {
    const set = new Set<string>(recentPeriods(RECENT_MONTHS));
    // Keep any locked period visible even if it falls outside the recent
    // window, so it always has a reachable unlock button.
    for (const l of locks.data ?? []) set.add(l.period);
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [locks.data]);

  const pending = lockMut.isPending || unlockMut.isPending;

  async function onConfirm() {
    if (!confirm) return;
    setError(null);
    try {
      if (confirm.action === 'lock') {
        await lockMut.mutateAsync(confirm.period);
      } else {
        await unlockMut.mutateAsync(confirm.period);
      }
      setConfirm(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('period_locks.title')}</CardTitle>
        <CardDescription>{t('period_locks.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
        <ul className="divide-y divide-border">
          {periods.map((period) => {
            const lock = lockedByPeriod.get(period);
            const isLocked = !!lock;
            return (
              <li key={period} className="flex items-center justify-between gap-3 py-2">
                <div className="flex items-center gap-2">
                  {isLocked ? (
                    <Lock className="size-4 text-muted-foreground" aria-hidden />
                  ) : (
                    <LockOpen className="size-4 text-muted-foreground" aria-hidden />
                  )}
                  <span className="text-sm">{formatPeriod(period, i18n.resolvedLanguage ?? 'en')}</span>
                  <span className="text-xs text-muted-foreground">
                    {isLocked ? t('period_locks.status_locked') : t('period_locks.status_open')}
                  </span>
                </div>
                {isLocked ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pending}
                    onClick={() => setConfirm({ period, action: 'unlock' })}
                  >
                    {t('period_locks.unlock')}
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pending}
                    onClick={() => setConfirm({ period, action: 'lock' })}
                  >
                    {t('period_locks.lock')}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => {
          if (!o) setConfirm(null);
        }}
        title={
          confirm?.action === 'lock'
            ? t('period_locks.confirm_lock_title', { period: formatPeriod(confirm.period, i18n.resolvedLanguage ?? 'en') })
            : t('period_locks.confirm_unlock_title', {
                period: confirm ? formatPeriod(confirm.period, i18n.resolvedLanguage ?? 'en') : '',
              })
        }
        description={
          confirm?.action === 'lock'
            ? t('period_locks.confirm_lock_desc')
            : t('period_locks.confirm_unlock_desc')
        }
        confirmLabel={
          confirm?.action === 'lock' ? t('period_locks.lock') : t('period_locks.unlock')
        }
        onConfirm={onConfirm}
        pending={pending}
      />
    </Card>
  );
}
