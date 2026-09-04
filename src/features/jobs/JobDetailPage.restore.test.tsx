import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { i18n } from '@/lib/i18n';
import { useAuthStore } from '@/lib/stores/authStore';
import type { JobRow } from './hooks/useJobs';

// Regression test for the "restore ConfirmDialog swallows a rejected
// mutateAsync" defect: unarchive_job can return {ok:false, errors:[...]}
// (permission_denied / job_not_found are both real server responses), and
// JobDetailPage must surface a TRANSLATED message rather than leaving the
// admin with an unhandled promise rejection and a dialog that just sits
// there. See fix-round-1 review notes in task-4-report.md.

const TEST_JOB_ID = 'job-test-1';

const archivedJob = {
  id: TEST_JOB_ID,
  code: 'JOB-001',
  title: 'Test job',
  service_type: 'franchise',
  billing_type: 'one_time',
  status: 'completed',
  archived: true,
  is_blocked: false,
  blocked_reason: null,
  owner_user_id: null,
  parent_job_id: null,
  stage_id: null,
  created_at: '2026-01-01T00:00:00Z',
  deal_id: 'deal-1',
  client_id: 'client-1',
  client: {
    id: 'client-1',
    name: 'Acme',
    contact_first_name: null,
    contact_last_name: null,
    industry: null,
  },
  deal: { id: 'deal-1', code: 'D-1', title: 'Deal', first_paid_in_full_at: null },
  details: {},
  amount_net: 0,
  vat_rate: 24,
  installment_plan: 'none',
  installment_schedule: null,
  period_start_date: null,
  period_due_date: null,
  description: null,
  billing_active: false,
} as unknown as JobRow;

vi.mock('./hooks/useJob', () => ({
  useJob: (id: string) =>
    id === TEST_JOB_ID
      ? { data: archivedJob, isLoading: false, error: null }
      : { data: undefined, isLoading: false, error: null },
}));

const unarchiveMutate = vi.fn();
vi.mock('./hooks/useUnarchiveJob', () => ({
  useUnarchiveJob: () => ({ mutateAsync: unarchiveMutate, isPending: false }),
}));

vi.mock('./hooks/useMoveJobStage', () => ({
  useMoveJobStage: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('./hooks/useBlockJob', () => ({
  useBlockJob: () => ({ mutate: vi.fn(), isPending: false }),
  useUnblockJob: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('./hooks/useDeleteJobs', () => ({
  useDeleteJobs: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('./hooks/useJobBillingRefCount', () => ({
  useJobBillingRefCount: () => ({ data: 0 }),
}));
vi.mock('./hooks/useForceJobRenewal', () => ({
  useForceJobRenewal: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/features/deals/hooks/useCustomJobMutations', () => ({
  useUpdateJobBilling: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/features/stages/hooks/usePipelineStages', () => ({
  usePipelineStages: () => ({ data: [] }),
}));
vi.mock('@/features/groups/hooks/useGroups', () => ({
  useGroups: () => ({ data: [] }),
}));
vi.mock('@/features/comments/hooks/useMentionableUsers', () => ({
  useMentionableUsers: () => ({ data: [] }),
}));

vi.mock('./JobEmailStatusBadge', () => ({ JobEmailStatusBadge: () => null }));
vi.mock('./JobEmailsBox', () => ({ JobEmailsBox: () => null }));
vi.mock('./JobFollowupButton', () => ({ JobFollowupButton: () => null }));
vi.mock('./JobDisconnectBadge', () => ({ JobDisconnectBadge: () => null }));
vi.mock('./ContactsCard', () => ({ ContactsCard: () => null }));
vi.mock('./JobNotesCard', () => ({ JobNotesCard: () => null }));
vi.mock('./JobDisconnectCard', () => ({ JobDisconnectCard: () => null }));
vi.mock('./JobBillingEditCard', () => ({ JobBillingEditCard: () => null }));
vi.mock('./JobBillingPauseCard', () => ({ JobBillingPauseCard: () => null }));
vi.mock('@/features/comments/CommentsPanel', () => ({ CommentsPanel: () => null }));

import { JobDetailPage } from './JobDetailPage';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[`/jobs/${TEST_JOB_ID}`]}>
          <Routes>
            <Route path="/jobs/:jobId" element={<JobDetailPage />} />
          </Routes>
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

describe('JobDetailPage — restore from archive', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await i18n.changeLanguage('en');
    useAuthStore.setState({ isAdmin: true, groupCodes: [] });
  });

  it('surfaces a translated message and keeps the dialog open when unarchive_job fails', async () => {
    unarchiveMutate.mockRejectedValueOnce(new Error('permission_denied'));
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const user = userEvent.setup();

    renderPage();

    await user.click(await screen.findByRole('button', { name: /^restore$/i }));
    expect(await screen.findByText('Restore from archive?')).toBeInTheDocument();
    // Trigger button and dialog confirm button share the "Restore" label; the
    // dialog's is last in DOM order (same convention as JobDisconnectCard.test.tsx).
    await user.click(screen.getAllByRole('button', { name: /^restore$/i }).at(-1)!);

    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith(
        'Restore did not complete. You may not have permission, or the job was already restored.',
      ),
    );
    // On failure the dialog must stay open so the admin can retry or cancel deliberately.
    expect(screen.getByText('Restore from archive?')).toBeInTheDocument();

    alertSpy.mockRestore();
  });

  it('closes the dialog on a successful restore', async () => {
    unarchiveMutate.mockResolvedValueOnce({ ok: true, job_id: TEST_JOB_ID });
    const user = userEvent.setup();

    renderPage();

    await user.click(await screen.findByRole('button', { name: /^restore$/i }));
    expect(await screen.findByText('Restore from archive?')).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: /^restore$/i }).at(-1)!);

    await waitFor(() => expect(screen.queryByText('Restore from archive?')).not.toBeInTheDocument());
  });
});
