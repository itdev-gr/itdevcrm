// src/features/support/SupportListPage.tsx
// The Support board (service_type 'maintenance') as a hosting-style list.
// The 8 maintenance pipeline_stages stay in the DB; the list collapses them:
// done/closed → Done, everything else → Active, is_blocked → Blocked chip.
import { JobsListPage } from '@/features/jobs/JobsListPage';

export function SupportListPage() {
  return (
    <JobsListPage
      serviceType="maintenance"
      title="Support"
      description="Monthly support — Active & Done."
      dueColumnLabel="Next due"
      doneStageCodes={['done', 'closed']}
      showBlocked
    />
  );
}

export default SupportListPage;
