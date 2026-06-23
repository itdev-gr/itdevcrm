import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { i18n } from '@/lib/i18n';

const { shuffleMutateAsync, authState, countsState } = vi.hoisted(() => ({
  shuffleMutateAsync: vi.fn().mockResolvedValue(4),
  authState: { isAdmin: true, user: { id: 'admin-1' } as { id: string } | null },
  countsState: new Map<string, number>(),
}));

vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (sel: (s: { isAdmin: boolean; user: { id: string } | null }) => unknown) =>
    sel({ isAdmin: authState.isAdmin, user: authState.user }),
}));

const stage = (code: string, position: number) => ({
  id: `stage-${code}`,
  board: 'sales',
  code,
  display_names: { en: code, el: code },
  position,
  archived: false,
});

vi.mock('@/features/stages/hooks/usePipelineStages', () => ({
  usePipelineStages: () => ({
    data: [stage('new_lead', 10), stage('no_answer', 20), stage('hot', 70), stage('won', 80)],
    isLoading: false,
  }),
}));

vi.mock('./hooks/useSalesKanbanCounts', () => ({
  useSalesKanbanCounts: () => ({ data: countsState }),
}));

vi.mock('./hooks/useShuffleStageLeads', () => ({
  useShuffleStageLeads: () => ({ mutateAsync: shuffleMutateAsync, isPending: false }),
}));

// Stub the heavy pieces unrelated to the shuffle control.
vi.mock('./useSalesKanbanRealtime', () => ({ useSalesKanbanRealtime: () => undefined }));
vi.mock('@/features/leads/hooks/useMoveLeadStage', () => ({
  useMoveLeadStage: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@/features/leads/hooks/useConvertLead', () => ({
  useConvertLead: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@/features/leads/hooks/useAssignableOwners', () => ({
  useAssignableOwners: () => ({ data: [] }),
}));
vi.mock('./SalesKanbanColumn', () => ({ SalesKanbanColumnContainer: () => null }));
vi.mock('./SalesKanbanCard', () => ({ SalesKanbanCard: () => null }));
vi.mock('@/features/leads/CreateLeadDialog', () => ({ CreateLeadDialog: () => null }));
vi.mock('@/features/saved_filters/SavedFiltersBar', () => ({ SavedFiltersBar: () => null }));

import { SalesKanbanPage } from './SalesKanbanPage';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <I18nextProvider i18n={i18n}>
          <SalesKanbanPage />
        </I18nextProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('SalesKanbanPage shuffle control', () => {
  beforeEach(() => {
    shuffleMutateAsync.mockClear();
    authState.isAdmin = true;
    authState.user = { id: 'admin-1' };
    countsState.clear();
    countsState.set('stage-no_answer', 12);
    vi.spyOn(window, 'alert').mockImplementation(() => undefined);
  });

  it('clicking Shuffle opens a confirm dialog instead of shuffling immediately', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /shuffle/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(shuffleMutateAsync).not.toHaveBeenCalled();
  });

  it('confirming the dialog shuffles the selected stage', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /shuffle/i }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /^shuffle$/i }));
    expect(shuffleMutateAsync).toHaveBeenCalledWith({
      stageId: 'stage-no_answer',
      stageCode: 'no_answer',
    });
  });

  it('hides the shuffle control from non-admins', () => {
    authState.isAdmin = false;
    renderPage();
    expect(screen.queryByRole('button', { name: /shuffle/i })).not.toBeInTheDocument();
  });

  it('disables the Shuffle button when the selected stage has no leads', () => {
    countsState.clear();
    renderPage();
    expect(screen.getByRole('button', { name: /shuffle/i })).toBeDisabled();
  });
});
