// src/features/hosting/HostingListPage.tsx
import { JobsListPage } from '@/features/jobs/JobsListPage';

export function HostingListPage() {
  return (
    <JobsListPage
      serviceType="hosting"
      title="Hosting"
      description="Yearly hosting — Active & Done."
      dueColumnLabel="Renewal due"
      doneStageCodes={['closed']}
      showBlocked
    />
  );
}

export default HostingListPage;
