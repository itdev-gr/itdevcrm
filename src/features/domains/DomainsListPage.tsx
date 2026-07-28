// src/features/domains/DomainsListPage.tsx
// The Domains board (service_type 'domains') as a hosting-style list.
// Mirrors HostingListPage: 2-stage board, never payment-blocked.
import { JobsListPage } from '@/features/jobs/JobsListPage';

export function DomainsListPage() {
  return (
    <JobsListPage
      serviceType="domains"
      title="Domains"
      description="Yearly domain renewals — Active & Done."
      dueColumnLabel="Renewal due"
      doneStageCodes={['closed']}
      showBlocked={false}
    />
  );
}

export default DomainsListPage;
