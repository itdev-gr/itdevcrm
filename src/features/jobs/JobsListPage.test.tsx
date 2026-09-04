import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { i18n } from '@/lib/i18n';
import { useAuthStore } from '@/lib/stores/authStore';
import type { JobRow } from './hooks/useJobs';

// Regression coverage for Task 6's owner-mandated rule: the Archived toggle
// on the hosting/domains/maintenance LIST boards (JobsListPage — the shared
// component all three thin wrapper pages render) must stay admin-only on
// BOTH of its guards — the button's visibility and the useArchivedJobs
// query's `enabled` flag. Losing either `isAdmin &&` would let a non-admin
// technical user see archived jobs. See task-6-report.md, fix round 1.

const activeJob = {
  id: 'active-1',
  code: 'H-1',
  client: { id: 'c1', name: 'Acme', contact_first_name: null, contact_last_name: null, industry: null },
  deal: null,
  details: {},
  stage_id: 'stage-active',
  stage: { id: 'stage-active', code: 'active', board: 'hosting', display_names: { en: 'Active', el: 'Ενεργό' } },
  is_blocked: false,
  period_due_date: null,
  parent_job_id: null,
} as unknown as JobRow;

const archivedJob = {
  id: 'archived-1',
  code: 'H-9',
  client: { id: 'c2', name: 'Old Co', contact_first_name: null, contact_last_name: null, industry: null },
  deal: null,
  details: {},
  stage_id: null,
  stage: null,
  is_blocked: false,
  archived: true,
  period_due_date: null,
  parent_job_id: null,
} as unknown as JobRow;

vi.mock('./hooks/useJobs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./hooks/useJobs')>()),
  useJobs: () => ({ data: [activeJob], isLoading: false }),
}));

// Records every call so a test can assert exactly what `enabled` value the
// component computed — including after `isAdmin` flips at runtime — without
// asserting on component internals that would pass even if the guard broke.
const useArchivedJobsMock = vi.fn((_serviceType: string, enabled: boolean) => ({
  jobs: enabled ? [archivedJob] : [],
}));
vi.mock('./hooks/useArchivedJobs', () => ({
  useArchivedJobs: (serviceType: string, enabled: boolean) => useArchivedJobsMock(serviceType, enabled),
}));

vi.mock('./hooks/useMoveJobStage', () => ({
  useMoveJobStage: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('./hooks/useBlockJob', () => ({
  useUnblockJob: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/features/stages/hooks/usePipelineStages', () => ({
  usePipelineStages: () => ({
    data: [
      { id: 'stage-active', board: 'hosting', code: 'active', archived: false },
      { id: 'stage-closed', board: 'hosting', code: 'closed', archived: false },
    ],
  }),
}));

import { JobsListPage } from './JobsListPage';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <JobsListPage
            serviceType="hosting"
            title="Hosting"
            description="Yearly hosting — Active & Done."
            dueColumnLabel="Renewal due"
            doneStageCodes={['closed']}
            showBlocked={false}
          />
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

describe('JobsListPage — admin-only Archived toggle', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await i18n.changeLanguage('en');
    useAuthStore.setState({ isAdmin: false, groupCodes: [] });
  });

  it('non-admin: the toggle is not rendered, and the archived query is not enabled', () => {
    renderPage();

    // Sanity: the page still renders its normal active rows.
    expect(screen.getByText('Acme')).toBeInTheDocument();
    // Guard 1 — button visibility. If `isAdmin &&` is dropped from the
    // button's render condition, this button appears for everyone.
    expect(screen.queryByRole('button', { name: /archived/i })).not.toBeInTheDocument();
    // Guard 2 — the query's enabled flag, asserted independently of the
    // button so a broken `enabled` expression fails even if the button
    // guard is intact.
    expect(useArchivedJobsMock).toHaveBeenCalledWith('hosting', false);
  });

  it('admin, default OFF: the active rows render exactly as before the toggle existed', () => {
    useAuthStore.setState({ isAdmin: true });
    renderPage();

    expect(screen.getByText('Acme')).toBeInTheDocument();
    expect(screen.queryByText('Old Co')).not.toBeInTheDocument();
    expect(useArchivedJobsMock).toHaveBeenCalledWith('hosting', false);
  });

  it('admin: the toggle is rendered, and clicking it swaps the list to the archived rows', async () => {
    useAuthStore.setState({ isAdmin: true });
    const user = userEvent.setup();
    renderPage();

    const toggle = screen.getByRole('button', { name: /archived/i });
    expect(toggle).toBeInTheDocument();

    await user.click(toggle);

    await waitFor(() => expect(screen.getByText('Old Co')).toBeInTheDocument());
    expect(screen.queryByText('Acme')).not.toBeInTheDocument();
    expect(useArchivedJobsMock).toHaveBeenLastCalledWith('hosting', true);
  });

  it('isAdmin flipping false after the archived query was enabled turns the toggle off again', async () => {
    // showArchived can never become true for a non-admin through the UI
    // alone (the button itself is admin-gated), so the only way to actually
    // exercise the `isAdmin &&` half of the `enabled` expression is to flip
    // `isAdmin` false AFTER local `showArchived` state is already true. If
    // the enabled expression regresses to bare `showArchived`, this is the
    // one scenario that catches it.
    useAuthStore.setState({ isAdmin: true });
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /archived/i }));
    await waitFor(() => expect(useArchivedJobsMock).toHaveBeenLastCalledWith('hosting', true));

    useAuthStore.setState({ isAdmin: false });

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /archived/i })).not.toBeInTheDocument(),
    );
    expect(useArchivedJobsMock).toHaveBeenLastCalledWith('hosting', false);
  });
});
