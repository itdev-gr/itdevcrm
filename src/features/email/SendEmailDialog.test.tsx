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

  // Regression (2026-08-24): a long message used to grow the panel past the
  // viewport, pushing Send off-screen. The panel must cap its height and
  // scroll the field area internally, with Send in a pinned footer OUTSIDE
  // the scroll container. (jsdom can't measure layout — assert structure.)
  it('caps the panel height and keeps Send outside the scroll area', () => {
    const { container } = render(
      wrap(<SendEmailDialog open identity="sales" to="c@x.gr" subject="S" body="B" onClose={() => {}} />),
    );
    const panel = container.querySelector('.max-h-\\[90vh\\]');
    expect(panel).not.toBeNull();
    expect(panel!.className).toContain('flex-col');
    const scrollArea = panel!.querySelector('.overflow-y-auto');
    expect(scrollArea).not.toBeNull();
    const sendButton = screen.getByRole('button', { name: /Αποστολή|Send/ });
    expect(scrollArea!.contains(sendButton)).toBe(false);
    expect(panel!.contains(sendButton)).toBe(true);
  });

  // The deal welcome mail and the pro forma mail keep the dialog mounted and
  // only flip `open`. Without the reset the second open kept the previous
  // session's state — most visibly the green "sent" screen — and ignored the
  // new to/subject/body props.
  it('reloads its props and clears edits when reopened', () => {
    const { rerender } = render(
      wrap(<SendEmailDialog open identity="sales" to="first@x.gr" subject="first" body="B" onClose={() => {}} />),
    );
    const to = () => screen.getByLabelText(/^(To|Προς)$/);
    fireEvent.change(to(), { target: { value: 'typed@x.gr' } });
    expect(to()).toHaveValue('typed@x.gr');

    rerender(
      wrap(<SendEmailDialog open={false} identity="sales" to="first@x.gr" subject="first" body="B" onClose={() => {}} />),
    );
    rerender(
      wrap(<SendEmailDialog open identity="sales" to="second@x.gr" subject="second" body="B" onClose={() => {}} />),
    );

    expect(to()).toHaveValue('second@x.gr');
    expect(screen.getByLabelText(/^(Subject|Θέμα)$/)).toHaveValue('second');
  });
});
