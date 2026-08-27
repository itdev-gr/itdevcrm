import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, beforeEach, describe, it, expect } from 'vitest';
import '@/lib/i18n';
import type { CronAlertRow } from './cronAlertPresenters';

const { resolveKindMutateAsync, resolveOneMutateAsync } = vi.hoisted(() => ({
  resolveKindMutateAsync: vi.fn(),
  resolveOneMutateAsync: vi.fn(),
}));

vi.mock('./hooks/useIntegrityAlerts', () => ({
  useIntegrityAlerts: () => ({ data: [], isLoading: false }),
}));
vi.mock('./hooks/useAlertDismissals', () => ({
  useDismissAlert: () => ({ mutate: vi.fn() }),
  useDismissedAlerts: () => ({ data: [], isLoading: false }),
  useUndismissAlert: () => ({ mutate: vi.fn() }),
}));
vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (sel: (s: { isAdmin: boolean }) => unknown) => sel({ isAdmin: true }),
}));

const cronRows: CronAlertRow[] = [
  {
    id: 'a1',
    kind: 'duplicate_period',
    subject_type: 'deal',
    subject_id: 'd1',
    details: { period: '2026-06' },
    detected_at: '2026-07-01T08:00:00Z',
    resolved_at: null,
    resolved_by: null,
  } as CronAlertRow,
];

vi.mock('./hooks/useCronAlerts', () => ({
  useCronAlerts: () => ({ data: cronRows, isLoading: false }),
}));
vi.mock('./hooks/useResolveCronAlert', () => ({
  useResolveCronAlert: () => ({ mutate: resolveOneMutateAsync, isPending: false }),
  useResolveCronAlertsKind: () => ({ mutateAsync: resolveKindMutateAsync, isPending: false }),
}));

import AccountingAlertsPage from './AlertsPage';

describe('AlertsPage — nightly checks "Resolve all" confirmation (I5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveKindMutateAsync.mockResolvedValue(1);
  });

  it('does not resolve immediately — it opens a confirm dialog first', () => {
    render(<MemoryRouter><AccountingAlertsPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Resolve all' }));

    expect(resolveKindMutateAsync).not.toHaveBeenCalled();
    expect(screen.getByText('This marks every open alert of this kind as resolved. It cannot be undone — there is no bulk "un-resolve".')).toBeTruthy();
  });

  it('does nothing when the confirm dialog is cancelled', () => {
    render(<MemoryRouter><AccountingAlertsPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Resolve all' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(resolveKindMutateAsync).not.toHaveBeenCalled();
  });

  it('resolves the whole kind once the confirm dialog is confirmed', async () => {
    render(<MemoryRouter><AccountingAlertsPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Resolve all' }));
    // Two "Resolve all" buttons now exist: the trigger + the dialog's confirm button.
    const buttons = screen.getAllByRole('button', { name: 'Resolve all' });
    fireEvent.click(buttons[buttons.length - 1]!);

    expect(resolveKindMutateAsync).toHaveBeenCalledWith('duplicate_period');
  });
});
