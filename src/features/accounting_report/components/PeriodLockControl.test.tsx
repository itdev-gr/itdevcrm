import type { ReactNode } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, afterEach, describe, it, expect } from 'vitest';
import '@/lib/i18n';

const { locksData, lockMutateAsync, unlockMutateAsync } = vi.hoisted(() => ({
  locksData: { current: [] as { period: string; locked_at: string; locked_by: string | null }[] },
  lockMutateAsync: vi.fn(),
  unlockMutateAsync: vi.fn(),
}));

vi.mock('../hooks/usePeriodLocks', () => ({
  usePeriodLocks: () => ({ data: locksData.current, isLoading: false }),
  useLockPeriod: () => ({ mutateAsync: lockMutateAsync, isPending: false }),
  useUnlockPeriod: () => ({ mutateAsync: unlockMutateAsync, isPending: false }),
}));

import { PeriodLockControl } from './PeriodLockControl';

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

describe('PeriodLockControl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 7, 27)); // 27 Aug 2026
    locksData.current = [];
    lockMutateAsync.mockResolvedValue(undefined);
    unlockMutateAsync.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the current month as open with a Lock action', () => {
    render(wrap(<PeriodLockControl />));
    expect(screen.getAllByText('Open').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Lock' }).length).toBeGreaterThan(0);
  });

  it('shows a locked month as Locked with an Unlock action', () => {
    locksData.current = [{ period: '2026-07', locked_at: '2026-08-01T00:00:00Z', locked_by: 'u1' }];
    render(wrap(<PeriodLockControl />));
    expect(screen.getByText('Locked')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Unlock' })).toBeTruthy();
  });

  it('locking a month requires confirmation before calling the RPC', async () => {
    render(wrap(<PeriodLockControl />));
    fireEvent.click(screen.getAllByRole('button', { name: 'Lock' })[0]!);
    // dialog open, RPC not yet called
    expect(lockMutateAsync).not.toHaveBeenCalled();
    // the confirm dialog renders its own "Lock" button; it's the last one on screen
    const allLockButtons = screen.getAllByRole('button', { name: 'Lock' });
    fireEvent.click(allLockButtons[allLockButtons.length - 1]!);
    await waitFor(() => expect(lockMutateAsync).toHaveBeenCalledWith('2026-08'));
  });

  it('unlocking a month requires confirmation before calling the RPC', async () => {
    locksData.current = [{ period: '2026-07', locked_at: '2026-08-01T00:00:00Z', locked_by: 'u1' }];
    render(wrap(<PeriodLockControl />));
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(unlockMutateAsync).not.toHaveBeenCalled();
    const allUnlockButtons = screen.getAllByRole('button', { name: 'Unlock' });
    fireEvent.click(allUnlockButtons[allUnlockButtons.length - 1]!);
    await waitFor(() => expect(unlockMutateAsync).toHaveBeenCalledWith('2026-07'));
  });

  it('shows the RPC error inline when locking fails (e.g. non-admin)', async () => {
    lockMutateAsync.mockRejectedValue(new Error('admin only'));
    render(wrap(<PeriodLockControl />));
    fireEvent.click(screen.getAllByRole('button', { name: 'Lock' })[0]!);
    const allLockButtons = screen.getAllByRole('button', { name: 'Lock' });
    fireEvent.click(allLockButtons[allLockButtons.length - 1]!);
    await waitFor(() => expect(screen.getByText('admin only')).toBeTruthy());
  });
});
