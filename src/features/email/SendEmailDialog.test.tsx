import type { ReactNode } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, beforeEach, describe, it, expect } from 'vitest';
import '@/lib/i18n';

const { mutateAsync } = vi.hoisted(() => ({ mutateAsync: vi.fn() }));
vi.mock('./useSendEmail', () => ({ useSendEmail: () => ({ mutateAsync, isPending: false }) }));
vi.mock('./useGoogleConnection', () => ({ useGoogleConnection: () => ({ connected: false, email: null, connect: vi.fn(), disconnect: vi.fn(), isLoading: false }) }));

import { SendEmailDialog } from './SendEmailDialog';

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

describe('SendEmailDialog', () => {
  beforeEach(() => { vi.clearAllMocks(); mutateAsync.mockResolvedValue({ status: 'sent' }); });

  it('blocks send when recipient is empty', () => {
    render(wrap(<SendEmailDialog open identity="sales" to="" subject="S" body="B" onClose={() => {}} />));
    fireEvent.click(screen.getByRole('button', { name: /Αποστολή|Send/ }));
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('sends the edited subject/body to the recipient', () => {
    render(wrap(<SendEmailDialog open identity="sales" to="c@x.gr" subject="S" body="B" onClose={() => {}} />));
    fireEvent.click(screen.getByRole('button', { name: /Αποστολή|Send/ }));
    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ identity: 'sales', to: 'c@x.gr', subject: 'S', body: 'B' }),
    );
  });

  it('shows the connect prompt for a personal send when not connected', () => {
    render(wrap(<SendEmailDialog open identity="personal" to="c@x.gr" subject="S" body="B" onClose={() => {}} />));
    expect(screen.getAllByText(/Connect Google|Συνδέστε το Google/).length).toBeGreaterThan(0);
  });
});
