import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { CampaignStatus } from '../hooks/useCampaigns';

// Same pill styling as StatusBadge in src/features/system_health/EmailHealthPage.tsx,
// so a campaign's status reads as native to the rest of the app.
const STATUS_STYLES: Record<CampaignStatus, string> = {
  draft: 'bg-muted text-muted-foreground',
  ready: 'bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-300',
  scheduled: 'bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-200',
  sending: 'bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300',
  paused: 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300',
  sent: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300',
  cancelled: 'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300',
};

export function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  const { t } = useTranslation('email_marketing');
  return (
    <span
      className={cn(
        'inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium',
        STATUS_STYLES[status] ?? STATUS_STYLES.draft,
      )}
    >
      {t(`status.${status}`)}
    </span>
  );
}
